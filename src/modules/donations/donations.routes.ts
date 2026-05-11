import { Router } from 'express';
import { DonationMethod, DonationStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { AppError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { createAuditLog } from '../../utils/audit.util';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import {
  assertAssemblyAccess,
  assertManageableMember,
  getActorScope,
} from '../../utils/scope-access.util';
import { PERMISSIONS } from '../../shared/constants/permissions';
import type { AuthUser } from '../../shared/types/express';

const createDonationSchema = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(3).max(3).default('XAF'),
  method: z.nativeEnum(DonationMethod),
  purpose: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(1000).optional(),
  provider: z.string().trim().max(80).optional(),
  providerReference: z.string().trim().max(120).optional(),
  assemblyId: z.string().uuid().optional().nullable(),
  memberId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateDonationStatusSchema = z.object({
  status: z.nativeEnum(DonationStatus),
  notes: z.string().trim().max(1000).optional(),
  paidAt: z.string().datetime().optional().nullable(),
  providerReference: z.string().trim().max(120).optional(),
});

const router = Router();
router.use(authenticate);

function isPlainMember(user: AuthUser) {
  return user.roles.every((role) => role.role.name === 'member');
}

function serializeDonation(
  donation: Prisma.DonationGetPayload<{
    include: {
      user: { select: { id: true; firstName: true; lastName: true; email: true } };
      member: { select: { id: true; firstName: true; lastName: true; matricule: true } };
      assembly: { select: { id: true; name: true } };
    };
  }>,
) {
  return {
    ...donation,
    amount: donation.amount.toString(),
  };
}

async function buildDonationWhere(
  user: AuthUser,
  filters: {
    status?: DonationStatus;
    method?: DonationMethod;
    assemblyId?: string;
    memberId?: string;
  },
): Promise<Prisma.DonationWhereInput> {
  const baseWhere: Prisma.DonationWhereInput = {
    deletedAt: null,
    ...(filters.status && { status: filters.status }),
    ...(filters.method && { method: filters.method }),
    ...(filters.assemblyId && { assemblyId: filters.assemblyId }),
    ...(filters.memberId && { memberId: filters.memberId }),
  };

  if (isPlainMember(user)) {
    return {
      AND: [baseWhere, { userId: user.id }],
    };
  }

  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return baseWhere;
    case 'tenant':
      return { AND: [baseWhere, { assembly: { district: { region: { tenantId: scope.tenantId } } } }] };
    case 'region':
      return { AND: [baseWhere, { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } }] };
    case 'district':
      return { AND: [baseWhere, { assembly: { districtId: scope.districtId } }] };
    case 'assembly':
      return { AND: [baseWhere, { assemblyId: scope.assemblyId }] };
    default:
      return { AND: [baseWhere, { userId: user.id }] };
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { status, method, assemblyId, memberId } = req.query as Record<string, string | undefined>;
    const { page, limit, skip } = req.pagination!;
    const where = await buildDonationWhere(req.user!, {
      status: status as DonationStatus | undefined,
      method: method as DonationMethod | undefined,
      assemblyId,
      memberId,
    });

    const [rows, total] = await prisma.$transaction([
      prisma.donation.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
          assembly: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.donation.count({ where }),
    ]);

    sendPaginated(res, rows.map(serializeDonation), buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const where = await buildDonationWhere(req.user!, {});
    const donation = await prisma.donation.findFirst({
      where: {
        id: req.params['id'],
        AND: [where],
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        assembly: { select: { id: true, name: true } },
      },
    });

    if (!donation) {
      throw new NotFoundError('Don');
    }

    sendSuccess(res, serializeDonation(donation));
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(createDonationSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createDonationSchema>;

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.id, deletedAt: null },
      select: {
        memberId: true,
        member: {
          select: {
            assemblyId: true,
          },
        },
      },
    });

    if (!actor) {
      throw new NotFoundError('Utilisateur');
    }

    if (dto.memberId && isPlainMember(req.user!) && dto.memberId !== actor.memberId) {
      throw new ForbiddenError('Vous ne pouvez enregistrer qu un don pour votre propre profil');
    }

    if (dto.memberId) {
      await assertManageableMember(req.user!, dto.memberId);
    }

    let resolvedAssemblyId = dto.assemblyId ?? actor.member?.assemblyId ?? null;
    const resolvedMemberId = dto.memberId ?? actor.memberId ?? null;

    if (dto.assemblyId) {
      await assertAssemblyAccess(req.user!, dto.assemblyId);
      resolvedAssemblyId = dto.assemblyId;
    }

    if (resolvedMemberId && !resolvedAssemblyId) {
      const member = await prisma.member.findUnique({
        where: { id: resolvedMemberId, deletedAt: null },
        select: { assemblyId: true },
      });

      if (!member) {
        throw new NotFoundError('Membre');
      }

      resolvedAssemblyId = member.assemblyId;
    }

    if (!resolvedAssemblyId) {
      throw new AppError('Une assemblee cible est requise pour enregistrer un don', 400, 'ASSEMBLY_REQUIRED');
    }

    const donation = await prisma.donation.create({
      data: {
        reference: `DON-${Date.now()}-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')}`,
        userId: req.user!.id,
        memberId: resolvedMemberId,
        assemblyId: resolvedAssemblyId,
        amount: dto.amount,
        currency: dto.currency.toUpperCase(),
        method: dto.method,
        status: DonationStatus.PENDING,
        purpose: dto.purpose,
        notes: dto.notes,
        provider: dto.provider,
        providerReference: dto.providerReference,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        assembly: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'CREATE',
      entityType: 'Donation',
      entityId: donation.id,
      newValues: {
        amount: dto.amount,
        currency: dto.currency.toUpperCase(),
        method: dto.method,
        status: DonationStatus.PENDING,
      },
      req,
    });

    sendCreated(res, serializeDonation(donation), 'Don enregistre');
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.DONATIONS_WRITE),
  validate(updateDonationStatusSchema),
  async (req, res, next) => {
    try {
      const donation = await prisma.donation.findUnique({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          assembly: {
            select: { id: true },
          },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        },
      });

      if (!donation) {
        throw new NotFoundError('Don');
      }

      if (donation.assemblyId) {
        await assertAssemblyAccess(req.user!, donation.assemblyId);
      }

      const dto = req.body as z.infer<typeof updateDonationStatusSchema>;

      const updated = await prisma.donation.update({
        where: { id: donation.id },
        data: {
          status: dto.status,
          notes: dto.notes,
          providerReference: dto.providerReference,
          paidAt:
            dto.paidAt !== undefined
              ? dto.paidAt
                ? new Date(dto.paidAt)
                : null
              : dto.status === DonationStatus.CONFIRMED && !donation.paidAt
                ? new Date()
                : undefined,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
          assembly: { select: { id: true, name: true } },
        },
      });

      await createAuditLog({
        actorId: req.user!.id,
        action: 'UPDATE',
        entityType: 'Donation',
        entityId: updated.id,
        oldValues: { status: donation.status },
        newValues: { status: updated.status, paidAt: updated.paidAt?.toISOString() ?? null },
        req,
      });

      sendSuccess(res, serializeDonation(updated), 'Statut du don mis a jour');
    } catch (err) {
      next(err);
    }
  },
);

export default router;
