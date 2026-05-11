import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError, ConflictError } from '../../middlewares/error.middleware';
import { buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { planLimitService } from '../../services/plan-limit.service';
import type { CreateAssemblyDto, UpdateAssemblyDto } from './assemblies.validation';
import type { PaginationParams } from '../../utils/pagination.util';
import { Request } from 'express';
import { AuthUser } from '../../shared/types/express';
import { assertAssemblyAccess, assertDistrictAccess, getScopedAssemblyWhere } from '../../utils/scope-access.util';

export class AssembliesService {
  async list(
    pagination: PaginationParams,
    filters: {
      search?: string;
      districtId?: string;
      regionId?: string;
      status?: string;
      hasCoordinates?: string;
      sortBy?: string;
      sortOrder?: string;
    },
    currentUser: AuthUser,
  ) {
    const scopeWhere = await getScopedAssemblyWhere(currentUser);

    const filtersWhere: Prisma.AssemblyWhereInput = {
      deletedAt: null,
      ...(filters.districtId && { districtId: filters.districtId }),
      ...(filters.regionId && { district: { regionId: filters.regionId } }),
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { code: { contains: filters.search, mode: 'insensitive' } },
          { address: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
      ...(filters.hasCoordinates === 'true' && { latitude: { not: null }, longitude: { not: null } }),
      ...(filters.hasCoordinates === 'false' && { OR: [{ latitude: null }, { longitude: null }] }),
    };
    const where: Prisma.AssemblyWhereInput = { AND: [scopeWhere, filtersWhere] };

    const [data, total] = await prisma.$transaction([
      prisma.assembly.findMany({
        where,
        include: {
          district: {
            select: {
              id: true,
              name: true,
              region: { select: { id: true, name: true } },
            },
          },
          _count: { select: { members: true, preachingPoints: true, ministries: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: {
          [['name', 'code', 'createdAt', 'status', 'foundedAt'].includes(filters.sortBy ?? '') ? filters.sortBy! : 'name']:
            filters.sortOrder ?? 'asc',
        },
      }),
      prisma.assembly.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    await assertAssemblyAccess(currentUser, id);

    const assembly = await prisma.assembly.findUnique({
      where: { id, deletedAt: null },
      include: {
        district: {
          select: {
            id: true,
            name: true,
            region: { select: { id: true, name: true } },
          },
        },
        preachingPoints: { where: { deletedAt: null } },
        ministries: { where: { deletedAt: null } },
        pastors: {
          where: { deletedAt: null },
          include: { member: { select: { id: true, firstName: true, lastName: true, matricule: true } } },
        },
        _count: { select: { members: true, preachingPoints: true, ministries: true } },
      },
    });
    if (!assembly) throw new NotFoundError('Assemblee');
    return assembly;
  }

  async create(dto: CreateAssemblyDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertDistrictAccess(currentUser, dto.districtId);

    const district = await prisma.district.findUnique({
      where: { id: dto.districtId, deletedAt: null },
      select: { id: true, region: { select: { tenantId: true } } },
    });
    if (!district) throw new NotFoundError('District');

    await planLimitService.assertCanCreateAssembly(district.region.tenantId);

    const existing = await prisma.assembly.findFirst({
      where: { name: dto.name, districtId: dto.districtId, deletedAt: null },
    });
    if (existing) throw new ConflictError(`Une assemblee "${dto.name}" existe deja dans ce district`);

    const assembly = await prisma.assembly.create({
      data: { ...dto, foundedAt: dto.foundedAt ? new Date(dto.foundedAt) : null },
      include: {
        district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
      },
    });

    await createAuditLog({ actorId, action: 'CREATE', entityType: 'Assembly', entityId: assembly.id, newValues: dto, req });
    return assembly;
  }

  async update(id: string, dto: UpdateAssemblyDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertAssemblyAccess(currentUser, id);

    const existing = await prisma.assembly.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Assemblee');

    const assembly = await prisma.assembly.update({
      where: { id },
      data: { ...dto, foundedAt: dto.foundedAt ? new Date(dto.foundedAt) : undefined },
      include: {
        district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
      },
    });

    await createAuditLog({ actorId, action: 'UPDATE', entityType: 'Assembly', entityId: id, oldValues: existing, newValues: dto, req });
    return assembly;
  }

  async softDelete(id: string, actorId: string, req: Request, currentUser: AuthUser) {
    await assertAssemblyAccess(currentUser, id);

    const existing = await prisma.assembly.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Assemblee');

    await prisma.assembly.update({ where: { id }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId, action: 'DELETE', entityType: 'Assembly', entityId: id, req });
  }
}

export const assembliesService = new AssembliesService();
