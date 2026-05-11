import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { ConflictError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { createAuditLog } from '../../utils/audit.util';
import { buildPaginationMeta } from '../../utils/response.util';
import { assertRegionAccess, getActorScope } from '../../utils/scope-access.util';
import { planLimitService } from '../../services/plan-limit.service';
import type { PaginationParams } from '../../utils/pagination.util';
import type { AuthUser } from '../../shared/types/express';
import type { CreateRegionDto, UpdateRegionDto } from './regions.validation';

function getRegionOrderBy(sortBy?: string, sortOrder?: string): Prisma.RegionOrderByWithRelationInput {
  const field = ['name', 'code', 'createdAt', 'status'].includes(sortBy ?? '') ? (sortBy as 'name' | 'code' | 'createdAt' | 'status') : 'name';
  return { [field]: sortOrder === 'desc' ? 'desc' : 'asc' };
}

async function getScopedRegionWhere(user: AuthUser): Promise<Prisma.RegionWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
      return { id: scope.regionId, tenantId: scope.tenantId };
    case 'district':
      return { id: scope.regionId, tenantId: scope.tenantId };
    case 'assembly':
      return { id: scope.regionId, tenantId: scope.tenantId };
    default:
      return { id: 'NONE' };
  }
}

export class RegionsService {
  async list(
    pagination: PaginationParams,
    filters: { search?: string; status?: string; hasCoordinates?: string; sortBy?: string; sortOrder?: string },
    currentUser: AuthUser,
  ) {
    const scopedWhere = await getScopedRegionWhere(currentUser);

    const filtersWhere: Prisma.RegionWhereInput = {
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { code: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
      ...(filters.hasCoordinates === 'true' && { latitude: { not: null }, longitude: { not: null } }),
      ...(filters.hasCoordinates === 'false' && {
        OR: [{ latitude: null }, { longitude: null }],
      }),
    };
    const where: Prisma.RegionWhereInput = { AND: [scopedWhere, filtersWhere] };

    const [data, total] = await prisma.$transaction([
      prisma.region.findMany({
        where,
        include: { _count: { select: { districts: true } } },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: getRegionOrderBy(filters.sortBy, filters.sortOrder),
      }),
      prisma.region.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    await assertRegionAccess(currentUser, id);

    const region = await prisma.region.findUnique({
      where: { id, deletedAt: null },
      include: {
        districts: {
          where: { deletedAt: null },
          include: { _count: { select: { assemblies: true } } },
        },
        _count: { select: { districts: true } },
      },
    });

    if (!region) throw new NotFoundError('Region');
    return region;
  }

  async create(dto: CreateRegionDto, actorId: string, req: Request, currentUser: AuthUser) {
    const scope = await getActorScope(currentUser);
    // platform/super_admin → utilise le tenantId du user ; sinon tenantId dans le scope
    const tenantId =
      scope.kind === 'platform'
        ? currentUser.tenantId
        : 'tenantId' in scope
        ? (scope as { tenantId: string }).tenantId
        : null;

    if (!tenantId) {
      throw new ForbiddenError("Aucune organisation sélectionnée pour créer une région");
    }

    await planLimitService.assertCanCreateRegion(tenantId);

    const existing = await prisma.region.findFirst({ where: { tenantId, name: dto.name, deletedAt: null } });
    if (existing) throw new ConflictError(`Une région "${dto.name}" existe déjà`);

    const region = await prisma.region.create({
      data: { ...dto, tenantId },
      include: { _count: { select: { districts: true } } },
    });

    await createAuditLog({ actorId, action: 'CREATE', entityType: 'Region', entityId: region.id, newValues: dto, req });
    return region;
  }

  async update(id: string, dto: UpdateRegionDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertRegionAccess(currentUser, id);

    const existing = await prisma.region.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Region');

    const region = await prisma.region.update({
      where: { id },
      data: dto,
      include: { _count: { select: { districts: true } } },
    });

    await createAuditLog({ actorId, action: 'UPDATE', entityType: 'Region', entityId: id, oldValues: existing, newValues: dto, req });
    return region;
  }

  async softDelete(id: string, actorId: string, req: Request, currentUser: AuthUser) {
    await assertRegionAccess(currentUser, id);

    const existing = await prisma.region.findUnique({
      where: { id, deletedAt: null },
      include: { _count: { select: { districts: { where: { deletedAt: null } } } } },
    });
    if (!existing) throw new NotFoundError('Region');
    if ((existing._count?.districts ?? 0) > 0) {
      throw new ConflictError(
        'Impossible de supprimer cette région : des districts y sont encore rattachés. Supprimez ou déplacez d’abord ces districts.',
      );
    }

    await prisma.region.update({ where: { id }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId, action: 'DELETE', entityType: 'Region', entityId: id, req });
  }
}

export const regionsService = new RegionsService();
