import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError, ConflictError } from '../../middlewares/error.middleware';
import { buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { planLimitService } from '../../services/plan-limit.service';
import type { CreateDistrictDto, UpdateDistrictDto } from './districts.validation';
import type { PaginationParams } from '../../utils/pagination.util';
import { Request } from 'express';
import { AuthUser } from '../../shared/types/express';
import { assertDistrictAccess, assertRegionAccess, getScopedDistrictWhere } from '../../utils/scope-access.util';

export class DistrictsService {
  async list(
    pagination: PaginationParams,
    filters: { search?: string; regionId?: string; status?: string; hasCoordinates?: string; sortBy?: string; sortOrder?: string },
    currentUser: AuthUser,
  ) {
    const scopeWhere = await getScopedDistrictWhere(currentUser);

    const filtersWhere: Prisma.DistrictWhereInput = {
      deletedAt: null,
      ...(filters.regionId && { regionId: filters.regionId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { code: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
      ...(filters.hasCoordinates === 'true' && { latitude: { not: null }, longitude: { not: null } }),
      ...(filters.hasCoordinates === 'false' && { OR: [{ latitude: null }, { longitude: null }] }),
    };
    const where: Prisma.DistrictWhereInput = { AND: [scopeWhere, filtersWhere] };

    const [data, total] = await prisma.$transaction([
      prisma.district.findMany({
        where,
        include: {
          region: { select: { id: true, name: true } },
          _count: { select: { assemblies: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: {
          [['name', 'code', 'createdAt', 'status'].includes(filters.sortBy ?? '') ? filters.sortBy! : 'name']:
            filters.sortOrder ?? 'asc',
        },
      }),
      prisma.district.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    await assertDistrictAccess(currentUser, id);

    const district = await prisma.district.findUnique({
      where: { id, deletedAt: null },
      include: {
        region: { select: { id: true, name: true } },
        assemblies: {
          where: { deletedAt: null },
          include: { _count: { select: { members: true } } },
        },
        _count: { select: { assemblies: true } },
      },
    });
    if (!district) throw new NotFoundError('District');
    return district;
  }

  async create(dto: CreateDistrictDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertRegionAccess(currentUser, dto.regionId);

    const region = await prisma.region.findUnique({ where: { id: dto.regionId, deletedAt: null }, select: { id: true, tenantId: true } });
    if (!region) throw new NotFoundError('Region');

    await planLimitService.assertCanCreateDistrict(region.tenantId);

    const existing = await prisma.district.findFirst({
      where: { name: dto.name, regionId: dto.regionId, deletedAt: null },
    });
    if (existing) throw new ConflictError(`Un district "${dto.name}" existe deja dans cette region`);

    const district = await prisma.district.create({
      data: dto,
      include: { region: { select: { id: true, name: true } } },
    });

    await createAuditLog({ actorId, action: 'CREATE', entityType: 'District', entityId: district.id, newValues: dto, req });
    return district;
  }

  async update(id: string, dto: UpdateDistrictDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertDistrictAccess(currentUser, id);

    const existing = await prisma.district.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('District');

    const district = await prisma.district.update({
      where: { id },
      data: dto,
      include: { region: { select: { id: true, name: true } } },
    });

    await createAuditLog({ actorId, action: 'UPDATE', entityType: 'District', entityId: id, oldValues: existing, newValues: dto, req });
    return district;
  }

  async softDelete(id: string, actorId: string, req: Request, currentUser: AuthUser) {
    await assertDistrictAccess(currentUser, id);

    const existing = await prisma.district.findUnique({
      where: { id, deletedAt: null },
      include: { _count: { select: { assemblies: { where: { deletedAt: null } } } } },
    });
    if (!existing) throw new NotFoundError('District');
    if ((existing._count?.assemblies ?? 0) > 0) {
      throw new ConflictError(
        'Impossible de supprimer ce district : des assemblées y sont encore rattachées. Supprimez ou déplacez d’abord ces assemblées.',
      );
    }

    await prisma.district.update({ where: { id }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId, action: 'DELETE', entityType: 'District', entityId: id, req });
  }
}

export const districtsService = new DistrictsService();
