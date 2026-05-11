import { TransferStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError, AppError, ForbiddenError } from '../../middlewares/error.middleware';
import { buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { Request } from 'express';
import type { PaginationParams } from '../../utils/pagination.util';
import { notifyUsers } from '../../utils/notify.util';
import { z } from 'zod';
import { getScopedTransferWhere, assertAssemblyAccess } from '../../utils/scope-access.util';
import { AuthUser } from '../../shared/types/express';

export const createTransferSchema = z.object({
  memberId: z.string().uuid(),
  toAssemblyId: z.string().uuid(),
  reason: z.string().min(5, 'Motif requis (min 5 caractères)'),
  notes: z.string().optional(),
  effectiveDate: z.string().datetime().optional(),
});

export const processTransferSchema = z.object({
  rejectionReason: z.string().optional(),
});

const transferInclude = {
  member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
  fromAssembly: {
    select: {
      id: true, name: true,
      district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
    },
  },
  toAssembly: {
    select: {
      id: true, name: true,
      district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
    },
  },
};

export class TransfersService {
  async list(
    pagination: PaginationParams,
    filters: { memberId?: string; fromAssemblyId?: string; toAssemblyId?: string; status?: string },
    currentUser: AuthUser,
  ) {
    const scopeWhere = await getScopedTransferWhere(currentUser);

    const where = {
      ...scopeWhere,
      ...(filters.memberId && { memberId: filters.memberId }),
      ...(filters.fromAssemblyId && { fromAssemblyId: filters.fromAssemblyId }),
      ...(filters.toAssemblyId && { toAssemblyId: filters.toAssemblyId }),
      ...(filters.status && { status: filters.status as TransferStatus }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.transfer.findMany({
        where,
        include: transferInclude,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { requestedAt: 'desc' },
      }),
      prisma.transfer.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    const transfer = await prisma.transfer.findUnique({ where: { id }, include: transferInclude });
    if (!transfer) throw new NotFoundError('Transfert');
    await assertAssemblyAccess(currentUser, transfer.fromAssemblyId);
    return transfer;
  }

  async create(dto: z.infer<typeof createTransferSchema>, currentUser: AuthUser, req: Request) {
    const requestedBy = currentUser.id;
    const member = await prisma.member.findUnique({
      where: { id: dto.memberId, deletedAt: null },
      include: { assembly: true },
    });
    if (!member) throw new NotFoundError('Membre');
    if (member.status === 'TRANSFERRED') throw new AppError('Ce membre est déjà en cours de transfert', 409, 'ALREADY_TRANSFERRED');

    const toAssembly = await prisma.assembly.findUnique({ where: { id: dto.toAssemblyId, deletedAt: null } });
    if (!toAssembly) throw new NotFoundError('Assemblée de destination');

    // Vérifier que l'utilisateur a accès à l'assemblée source
    await assertAssemblyAccess(currentUser, member.assemblyId);

    // Vérifier que le membre source et l'assemblée de destination sont dans le même tenant
    const fromRegion = await prisma.region.findFirst({
      where: { districts: { some: { assemblies: { some: { id: member.assemblyId } } } } },
      select: { tenantId: true },
    });
    const toRegion = await prisma.region.findFirst({
      where: { districts: { some: { assemblies: { some: { id: dto.toAssemblyId } } } } },
      select: { tenantId: true },
    });
    if (fromRegion?.tenantId !== toRegion?.tenantId) {
      throw new ForbiddenError('Le transfert inter-communauté n\'est pas autorisé');
    }


    if (member.assemblyId === dto.toAssemblyId) {
      throw new AppError('Le membre appartient déjà à cette assemblée', 400, 'SAME_ASSEMBLY');
    }

    // Vérifier qu'aucun transfert PENDING n'existe déjà
    const pending = await prisma.transfer.findFirst({ where: { memberId: dto.memberId, status: 'PENDING' } });
    if (pending) throw new AppError('Un transfert est déjà en attente pour ce membre', 409, 'PENDING_TRANSFER_EXISTS');

    const transfer = await prisma.$transaction(async (tx) => {
      const t = await tx.transfer.create({
        data: {
          memberId: dto.memberId,
          fromAssemblyId: member.assemblyId,
          toAssemblyId: dto.toAssemblyId,
          requestedBy,
          reason: dto.reason,
          notes: dto.notes,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
        },
        include: transferInclude,
      });

      // Marquer le membre comme en cours de transfert
      await tx.member.update({ where: { id: dto.memberId }, data: { status: 'TRANSFERRED' } });

      return t;
    });

    await createAuditLog({
      actorId: requestedBy,
      action: 'TRANSFER_REQUEST',
      entityType: 'Transfer',
      entityId: transfer.id,
      newValues: { memberId: dto.memberId, fromAssemblyId: member.assemblyId, toAssemblyId: dto.toAssemblyId, reason: dto.reason },
      req,
    });

    return transfer;
  }

  async approve(id: string, approvedBy: string, req: Request) {
    const transfer = await prisma.transfer.findUnique({ where: { id }, include: { member: true } });
    if (!transfer) throw new NotFoundError('Transfert');
    if (transfer.status !== 'PENDING') throw new AppError('Seuls les transferts en attente peuvent être approuvés', 400, 'INVALID_STATUS');

    const updatedTransfer = await prisma.$transaction(async (tx) => {
      const t = await tx.transfer.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy,
          processedAt: new Date(),
        },
        include: transferInclude,
      });

      // Déplacer le membre vers la nouvelle assemblée
      await tx.member.update({
        where: { id: transfer.memberId },
        data: {
          assemblyId: transfer.toAssemblyId,
          status: 'ACTIVE',
          preachingPointId: null, // Réinitialiser le point de prêche
        },
      });

      // Retirer des ministères de l'ancienne assemblée
      // updateMany ne supporte pas les filtres de relation — on récupère d'abord les IDs
      const ministriesInOldAssembly = await tx.ministry.findMany({
        where: { assemblyId: transfer.fromAssemblyId },
        select: { id: true },
      });
      const ministryIds = ministriesInOldAssembly.map((m) => m.id);
      if (ministryIds.length > 0) {
        await tx.ministryMember.updateMany({
          where: {
            memberId: transfer.memberId,
            ministryId: { in: ministryIds },
            status: 'ACTIVE',
          },
          data: { status: 'INACTIVE', leftAt: new Date() },
        });
      }

      return t;
    });

    await createAuditLog({
      actorId: approvedBy,
      action: 'TRANSFER_APPROVE',
      entityType: 'Transfer',
      entityId: id,
      newValues: { toAssemblyId: transfer.toAssemblyId },
      req,
    });

    // Notify the member's linked user if one exists
    const memberUser = await prisma.user.findFirst({ where: { memberId: transfer.memberId, deletedAt: null }, select: { id: true } });
    if (memberUser) {
      void notifyUsers({
        title: 'Transfert approuvé',
        message: `Votre demande de transfert a été approuvée.`,
        type: 'TRANSFER',
        entityType: 'Transfer',
        entityId: id,
        userIds: [memberUser.id],
      });
    }

    return updatedTransfer;
  }

  async reject(id: string, rejectedBy: string, rejectionReason: string, req: Request) {
    const transfer = await prisma.transfer.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundError('Transfert');
    if (transfer.status !== 'PENDING') throw new AppError('Seuls les transferts en attente peuvent être rejetés', 400, 'INVALID_STATUS');

    const updatedTransfer = await prisma.$transaction(async (tx) => {
      const t = await tx.transfer.update({
        where: { id },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          rejectionReason,
        },
        include: transferInclude,
      });

      // Remettre le membre comme actif dans son assemblée originale
      await tx.member.update({ where: { id: transfer.memberId }, data: { status: 'ACTIVE' } });

      return t;
    });

    await createAuditLog({
      actorId: rejectedBy,
      action: 'TRANSFER_REJECT',
      entityType: 'Transfer',
      entityId: id,
      newValues: { rejectionReason },
      req,
    });

    const memberUser = await prisma.user.findFirst({ where: { memberId: transfer.memberId, deletedAt: null }, select: { id: true } });
    if (memberUser) {
      void notifyUsers({
        title: 'Transfert refusé',
        message: `Votre demande de transfert a été refusée. Motif : ${rejectionReason}`,
        type: 'TRANSFER_REJECTED',
        entityType: 'Transfer',
        entityId: id,
        userIds: [memberUser.id],
      });
    }

    return updatedTransfer;
  }
}

export const transfersService = new TransfersService();
