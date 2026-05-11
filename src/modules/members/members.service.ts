import { Prisma, MemberStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError } from '../../middlewares/error.middleware';
import { buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { generateMatricule } from '../../utils/matricule.util';
import { buildMemberScopeFilter } from '../../middlewares/scope.middleware';
import { assertAssemblyAccess } from '../../utils/scope-access.util';
import { planLimitService } from '../../services/plan-limit.service';
import type { CreateMemberDto, UpdateMemberDto } from './members.validation';
import type { PaginationParams } from '../../utils/pagination.util';
import { Request } from 'express';
import { AuthUser } from '../../shared/types/express';

async function checkMemberScope(memberId: string, currentUser: AuthUser): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { id: memberId, deletedAt: null },
    select: { assemblyId: true },
  });
  if (!member) throw new NotFoundError('Membre');
  await assertAssemblyAccess(currentUser, member.assemblyId);
}

const memberInclude = {
  assembly: {
    select: {
      id: true, name: true,
      district: {
        select: {
          id: true, name: true,
          region: { select: { id: true, name: true } },
        },
      },
    },
  },
  preachingPoint: { select: { id: true, name: true } },
  ministryMembers: {
    where: { status: 'ACTIVE' },
    include: { ministry: { select: { id: true, name: true, type: true } } },
  },
};

export class MembersService {
  async list(
    pagination: PaginationParams,
    filters: {
      search?: string;
      assemblyId?: string;
      districtId?: string;
      regionId?: string;
      ministryId?: string;
      gender?: string;
      status?: string;
      maritalStatus?: string;
      sortBy?: string;
      sortOrder?: string;
    },
    currentUser: AuthUser
  ) {
    const scopeFilter = await buildMemberScopeFilter(currentUser);

    // scopeFilter est toujours appliqué; les filtres client viennent en contrainte
    // supplémentaire (AND) pour éviter qu'un filtre client écrase le périmètre.
    const where: Prisma.MemberWhereInput = {
      deletedAt: null,
      AND: [
        scopeFilter as Prisma.MemberWhereInput,
        {
          ...(filters.assemblyId && { assemblyId: filters.assemblyId }),
          ...(filters.districtId && { assembly: { districtId: filters.districtId } }),
          ...(filters.regionId && { assembly: { district: { regionId: filters.regionId } } }),
          ...(filters.gender && { gender: filters.gender as any }),
          ...(filters.status && { status: filters.status as MemberStatus }),
          ...(filters.maritalStatus && { maritalStatus: filters.maritalStatus }),
          ...(filters.ministryId && {
            ministryMembers: { some: { ministryId: filters.ministryId, status: 'ACTIVE' } },
          }),
          ...(filters.search && {
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' } },
              { lastName: { contains: filters.search, mode: 'insensitive' } },
              { matricule: { contains: filters.search, mode: 'insensitive' } },
              { phone: { contains: filters.search, mode: 'insensitive' } },
              { email: { contains: filters.search, mode: 'insensitive' } },
            ],
          }),
        },
      ],
    };

    const allowedSort = ['firstName', 'lastName', 'matricule', 'createdAt', 'memberSince', 'status'];
    const sortField = allowedSort.includes(filters.sortBy ?? '') ? filters.sortBy! : 'lastName';

    const [data, total] = await prisma.$transaction([
      prisma.member.findMany({
        where,
        include: memberInclude,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { [sortField]: filters.sortOrder ?? 'asc' },
      }),
      prisma.member.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    const member = await prisma.member.findUnique({
      where: { id, deletedAt: null },
      include: {
        ...memberInclude,
        pastor: true,
        transfers: {
          orderBy: { createdAt: 'desc' },
          include: {
            fromAssembly: { select: { id: true, name: true } },
            toAssembly: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, email: true, status: true } },
      },
    });
    if (!member) throw new NotFoundError('Membre');

    // Vérification scope — couvre les cas assemblyId exact, { in: [...] } (district/région)
    await assertAssemblyAccess(currentUser, member.assemblyId);

    return member;
  }

  async create(dto: CreateMemberDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertAssemblyAccess(currentUser, dto.assemblyId);
    await planLimitService.assertCanCreateMember(dto.assemblyId);

    const assembly = await prisma.assembly.findUnique({
      where: { id: dto.assemblyId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!assembly) throw new NotFoundError('Assemblée');

    if (dto.preachingPointId) {
      const pp = await prisma.preachingPoint.findUnique({
        where: { id: dto.preachingPointId, assemblyId: dto.assemblyId, deletedAt: null },
      });
      if (!pp) throw new NotFoundError('Point de prêche');
    }

    const matricule = await generateMatricule(assembly.code ?? undefined);

    const member = await prisma.member.create({
      data: {
        ...dto,
        matricule,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        salvationDate: dto.salvationDate ? new Date(dto.salvationDate) : null,
        baptismDate: dto.baptismDate ? new Date(dto.baptismDate) : null,
        memberSince: dto.memberSince ? new Date(dto.memberSince) : new Date(),
      },
      include: memberInclude,
    });

    await createAuditLog({
      actorId,
      action: 'CREATE',
      entityType: 'Member',
      entityId: member.id,
      newValues: { firstName: member.firstName, lastName: member.lastName, matricule: member.matricule, assemblyId: member.assemblyId },
      req,
    });

    return member;
  }

  async update(id: string, dto: UpdateMemberDto, actorId: string, req: Request, currentUser: AuthUser) {
    await checkMemberScope(id, currentUser);
    const existing = await prisma.member.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Membre');

    const member = await prisma.member.update({
      where: { id },
      data: {
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        salvationDate: dto.salvationDate ? new Date(dto.salvationDate) : undefined,
        baptismDate: dto.baptismDate ? new Date(dto.baptismDate) : undefined,
        memberSince: dto.memberSince ? new Date(dto.memberSince) : undefined,
      },
      include: memberInclude,
    });

    await createAuditLog({
      actorId,
      action: 'UPDATE',
      entityType: 'Member',
      entityId: id,
      oldValues: { status: existing.status, assemblyId: existing.assemblyId },
      newValues: dto,
      req,
    });

    return member;
  }

  async softDelete(id: string, actorId: string, req: Request, currentUser: AuthUser) {
    await checkMemberScope(id, currentUser);
    const existing = await prisma.member.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Membre');

    await prisma.member.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await createAuditLog({ actorId, action: 'DELETE', entityType: 'Member', entityId: id, req });
  }

  async getHistory(id: string) {
    const member = await prisma.member.findUnique({
      where: { id, deletedAt: null },
      include: { pastor: { select: { id: true } } },
    });
    if (!member) throw new NotFoundError('Membre');

    const [transfers, ministryHistory, assignments] = await Promise.all([
      prisma.transfer.findMany({
        where: { memberId: id },
        include: {
          fromAssembly: { select: { id: true, name: true } },
          toAssembly: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.ministryMember.findMany({
        where: { memberId: id },
        include: { ministry: { select: { id: true, name: true, type: true } } },
        orderBy: { joinedAt: 'desc' },
      }),
      member.pastor
        ? prisma.assignment.findMany({
            where: { pastor: { memberId: id } },
            include: {
              assembly: { select: { id: true, name: true } },
              district: { select: { id: true, name: true } },
            },
            orderBy: { startDate: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    return { member, transfers, ministryHistory, assignments };
  }
}

export const membersService = new MembersService();
