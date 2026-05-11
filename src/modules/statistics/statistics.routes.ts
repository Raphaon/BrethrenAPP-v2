import { Prisma, DonationStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { AppError } from '../../middlewares/error.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import type { AuthUser } from '../../shared/types/express';
import { buildPaginationMeta, sendPaginated, sendSuccess } from '../../utils/response.util';
import { assertAssemblyAccess, assertDistrictAccess, assertRegionAccess, getActorScope } from '../../utils/scope-access.util';
import type { ActorScope } from '../../utils/scope-access.util';

const router = Router();

router.use(authenticate);

function scopeRegionWhere(scope: ActorScope): Prisma.RegionWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
    case 'district':
    case 'assembly':
      return { id: scope.regionId, tenantId: scope.tenantId };
    default:
      return { id: 'NONE' };
  }
}

function scopeDistrictWhere(scope: ActorScope): Prisma.DistrictWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { region: { tenantId: scope.tenantId } };
    case 'region':
      return { regionId: scope.regionId, region: { tenantId: scope.tenantId } };
    case 'district':
    case 'assembly':
      return { id: scope.districtId, region: { tenantId: scope.tenantId } };
    default:
      return { id: 'NONE' };
  }
}

function scopeAssemblyWhere(scope: ActorScope): Prisma.AssemblyWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { district: { region: { tenantId: scope.tenantId } } };
    case 'region':
      return { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } };
    case 'district':
      return { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } };
    case 'assembly':
      return { id: scope.assemblyId, district: { region: { tenantId: scope.tenantId } } };
    default:
      return { id: 'NONE' };
  }
}

function scopeMinistryWhere(scope: ActorScope): Prisma.MinistryWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':
      return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
    case 'district':
      return { assembly: { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } } };
    case 'assembly':
      return { assemblyId: scope.assemblyId, assembly: { district: { region: { tenantId: scope.tenantId } } } };
    default:
      return { id: 'NONE' };
  }
}

function scopeMemberWhere(scope: ActorScope): Prisma.MemberWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':
      return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
    case 'district':
      return { assembly: { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } } };
    case 'assembly':
      return { assemblyId: scope.assemblyId, assembly: { district: { region: { tenantId: scope.tenantId } } } };
    default:
      return { id: 'NONE' };
  }
}

function scopePreachingPointWhere(scope: ActorScope): Prisma.PreachingPointWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':
      return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
    case 'district':
      return { assembly: { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } } };
    case 'assembly':
      return { assemblyId: scope.assemblyId, assembly: { district: { region: { tenantId: scope.tenantId } } } };
    default:
      return { id: 'NONE' };
  }
}

function scopeTransferWhere(scope: ActorScope): Prisma.TransferWhereInput {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return {
        OR: [
          { fromAssembly: { district: { region: { tenantId: scope.tenantId } } } },
          { toAssembly: { district: { region: { tenantId: scope.tenantId } } } },
        ],
      };
    case 'region':
      return {
        OR: [
          { fromAssembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } },
          { toAssembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } },
        ],
      };
    case 'district':
      return {
        OR: [
          { fromAssembly: { districtId: scope.districtId } },
          { toAssembly: { districtId: scope.districtId } },
        ],
      };
    case 'assembly':
      return {
        OR: [{ fromAssemblyId: scope.assemblyId }, { toAssemblyId: scope.assemblyId }],
      };
    default:
      return { id: 'NONE' };
  }
}

async function assertStatsFilters(
  scope: ActorScope,
  options: { regionId?: string; districtId?: string; assemblyId?: string },
  user: AuthUser,
): Promise<void> {
  if (options.regionId) await assertRegionAccess(user, options.regionId);
  if (options.districtId) await assertDistrictAccess(user, options.districtId);
  if (options.assemblyId) await assertAssemblyAccess(user, options.assemblyId);

  if (scope.kind === 'none') {
    throw new AppError('Aucun perimetre statistique disponible', 403, 'SCOPE_DENIED');
  }
}

router.get(
  '/dashboard',
  requireAnyPermission(
    PERMISSIONS.STATISTICS_READ,
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.REGIONS_READ,
    PERMISSIONS.ASSEMBLIES_READ,
    PERMISSIONS.TERRITORY_ACCOUNTS_READ,
  ),
  async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const memberWhere = { deletedAt: null, ...scopeMemberWhere(scope) };
    const assemblyWhere = { deletedAt: null, ...scopeAssemblyWhere(scope) };
    const preachingPointWhere = { deletedAt: null, ...scopePreachingPointWhere(scope) };
    const ministryWhere = { deletedAt: null, ...scopeMinistryWhere(scope) };
    const transferWhere = scopeTransferWhere(scope);

    const [
      totalMembers,
      maleCount,
      femaleCount,
      activeMembers,
      inactiveMembers,
      transferredMembers,
      totalAssemblies,
      totalPreachingPoints,
      totalMinistries,
      recentTransfers,
      pendingTransfers,
      totalRegions,
      totalDistricts,
    ] = await Promise.all([
      prisma.member.count({ where: memberWhere }),
      prisma.member.count({ where: { ...memberWhere, gender: 'MALE' } }),
      prisma.member.count({ where: { ...memberWhere, gender: 'FEMALE' } }),
      prisma.member.count({ where: { ...memberWhere, status: 'ACTIVE' } }),
      prisma.member.count({ where: { ...memberWhere, status: 'INACTIVE' } }),
      prisma.member.count({ where: { ...memberWhere, status: 'TRANSFERRED' } }),
      prisma.assembly.count({ where: assemblyWhere }),
      prisma.preachingPoint.count({ where: preachingPointWhere }),
      prisma.ministry.count({ where: ministryWhere }),
      prisma.transfer.count({
        where: {
          ...transferWhere,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.transfer.count({ where: { ...transferWhere, status: 'PENDING' } }),
      prisma.region.count({ where: { deletedAt: null, ...scopeRegionWhere(scope) } }),
      prisma.district.count({ where: { deletedAt: null, ...scopeDistrictWhere(scope) } }),
    ]);

    sendSuccess(res, {
      members: {
        total: totalMembers,
        male: maleCount,
        female: femaleCount,
        active: activeMembers,
        inactive: inactiveMembers,
        transferred: transferredMembers,
      },
      geography: {
        regions: totalRegions,
        districts: totalDistricts,
        assemblies: totalAssemblies,
        preachingPoints: totalPreachingPoints,
        ministries: totalMinistries,
      },
      transfers: {
        recent: recentTransfers,
        pending: pendingTransfers,
      },
    });
  } catch (err) {
    next(err);
  }
  },
);

router.get('/members-by-region', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { regionId } = req.query as { regionId?: string };

    await assertStatsFilters(scope, { regionId }, user);

    const where: Prisma.RegionWhereInput = {
      deletedAt: null,
      ...scopeRegionWhere(scope),
      ...(regionId && { id: regionId }),
    };

    const regions = await prisma.region.findMany({
      where,
      select: {
        id: true,
        name: true,
        _count: { select: { districts: { where: { deletedAt: null } } } },
        districts: {
          where: { deletedAt: null },
          select: {
            assemblies: {
              where: { deletedAt: null },
              select: { _count: { select: { members: { where: { deletedAt: null } } } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 100,
    });

    const result = regions.map((region) => {
      const assemblies = region.districts.flatMap((district) => district.assemblies);
      return {
        regionId: region.id,
        regionName: region.name,
        districtCount: region._count.districts,
        assemblyCount: assemblies.length,
        memberCount: assemblies.reduce((sum, assembly) => sum + assembly._count.members, 0),
      };
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/members-by-district', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { regionId } = req.query as { regionId?: string };
    const { page, limit, skip } = req.pagination!;

    await assertStatsFilters(scope, { regionId }, user);

    const where: Prisma.DistrictWhereInput = {
      deletedAt: null,
      ...scopeDistrictWhere(scope),
      ...(regionId && { regionId }),
    };

    const [districts, total] = await prisma.$transaction([
      prisma.district.findMany({
        where,
        select: {
          id: true,
          name: true,
          region: { select: { id: true, name: true } },
          _count: { select: { assemblies: { where: { deletedAt: null } } } },
          assemblies: {
            where: { deletedAt: null },
            select: { _count: { select: { members: { where: { deletedAt: null } } } } },
          },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.district.count({ where }),
    ]);

    const result = districts.map((district) => ({
      districtId: district.id,
      districtName: district.name,
      regionName: district.region.name,
      assemblyCount: district._count.assemblies,
      memberCount: district.assemblies.reduce((sum, assembly) => sum + assembly._count.members, 0),
    }));

    sendPaginated(res, result, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/members-by-assembly', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { districtId } = req.query as { districtId?: string };
    const { page, limit, skip } = req.pagination!;

    await assertStatsFilters(scope, { districtId }, user);

    const where: Prisma.AssemblyWhereInput = {
      deletedAt: null,
      ...scopeAssemblyWhere(scope),
      ...(districtId && { districtId }),
    };

    const [assemblies, total] = await prisma.$transaction([
      prisma.assembly.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
          _count: {
            select: {
              members: { where: { deletedAt: null } },
              ministries: { where: { deletedAt: null } },
              preachingPoints: { where: { deletedAt: null } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.assembly.count({ where }),
    ]);

    sendPaginated(res, assemblies, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/members-by-ministry', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { assemblyId } = req.query as { assemblyId?: string };
    const { page, limit, skip } = req.pagination!;

    await assertStatsFilters(scope, { assemblyId }, user);

    const where: Prisma.MinistryWhereInput = {
      deletedAt: null,
      ...scopeMinistryWhere(scope),
      ...(assemblyId && { assemblyId }),
    };

    const [ministries, total] = await prisma.$transaction([
      prisma.ministry.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          assembly: { select: { id: true, name: true } },
          _count: { select: { members: { where: { status: 'ACTIVE' } } } },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.ministry.count({ where }),
    ]);

    const result = ministries.map((ministry) => ({
      ministryId: ministry.id,
      ministryName: ministry.name,
      type: ministry.type,
      assemblyName: ministry.assembly.name,
      memberCount: ministry._count.members,
    }));

    sendPaginated(res, result, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/members-evolution', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { from, to, assemblyId } = req.query as Record<string, string | undefined>;

    await assertStatsFilters(scope, { assemblyId }, user);

    const startDate = from ? new Date(from) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const endDate = to ? new Date(to) : new Date();

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new AppError('Dates invalides', 400, 'INVALID_DATE');
    }
    if (endDate < startDate) {
      throw new AppError('La date de fin doit etre apres la date de debut', 400, 'INVALID_DATE_RANGE');
    }
    if (endDate.getTime() - startDate.getTime() > 3 * 365 * 24 * 60 * 60 * 1000) {
      throw new AppError('Plage de dates trop large (maximum 3 ans)', 400, 'DATE_RANGE_TOO_LARGE');
    }

    const rows = await prisma.member.findMany({
      where: {
        deletedAt: null,
        memberSince: { gte: startDate, lte: endDate },
        ...scopeMemberWhere(scope),
        ...(assemblyId && { assemblyId }),
      },
      select: {
        memberSince: true,
        gender: true,
      },
      orderBy: { memberSince: 'asc' },
    });

    const buckets = new Map<string, { total: number; male: number; female: number }>();
    for (const row of rows) {
      if (!row.memberSince) continue;
      const month = row.memberSince.toISOString().slice(0, 7);
      const bucket = buckets.get(month) ?? { total: 0, male: 0, female: 0 };
      bucket.total += 1;
      if (row.gender === 'MALE') bucket.male += 1;
      if (row.gender === 'FEMALE') bucket.female += 1;
      buckets.set(month, bucket);
    }

    sendSuccess(
      res,
      Array.from(buckets.entries()).map(([month, values]) => ({ month, ...values })),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/geolocalized', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const scope = await getActorScope(req.user!);
    const { type } = req.query as { type?: string };
    const limit = 1000;
    const hasCoords = { latitude: { not: null as null }, longitude: { not: null as null } };

    const [assemblies, preachingPoints, districts, regions] = await Promise.all([
      !type || type === 'assembly'
        ? prisma.assembly.findMany({
            where: { deletedAt: null, ...hasCoords, ...scopeAssemblyWhere(scope) },
            select: { id: true, name: true, latitude: true, longitude: true, address: true },
            take: limit,
          })
        : Promise.resolve([]),
      !type || type === 'preachingPoint'
        ? prisma.preachingPoint.findMany({
            where: { deletedAt: null, ...hasCoords, ...scopePreachingPointWhere(scope) },
            select: { id: true, name: true, latitude: true, longitude: true, address: true },
            take: limit,
          })
        : Promise.resolve([]),
      !type || type === 'district'
        ? prisma.district.findMany({
            where: { deletedAt: null, ...hasCoords, ...scopeDistrictWhere(scope) },
            select: { id: true, name: true, latitude: true, longitude: true },
            take: limit,
          })
        : Promise.resolve([]),
      !type || type === 'region'
        ? prisma.region.findMany({
            where: { deletedAt: null, ...hasCoords, ...scopeRegionWhere(scope) },
            select: { id: true, name: true, latitude: true, longitude: true },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    sendSuccess(res, { regions, districts, assemblies, preachingPoints });
  } catch (err) {
    next(err);
  }
});

router.get('/donations', requirePermission(PERMISSIONS.STATISTICS_READ), async (req, res, next) => {
  try {
    const user = req.user!;
    const scope = await getActorScope(user);
    const { from, to, assemblyId } = req.query as Record<string, string | undefined>;

    if (assemblyId) await assertAssemblyAccess(user, assemblyId);

    const baseWhere: Prisma.DonationWhereInput = {
      deletedAt: null,
      ...(from && { createdAt: { gte: new Date(from) } }),
      ...(to && { createdAt: { lte: new Date(to) } }),
      ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    };

    const scopeWhere: Prisma.DonationWhereInput = (() => {
      if (assemblyId) return { assemblyId };
      switch (scope.kind) {
        case 'platform':
          return {};
        case 'tenant':
          return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
        case 'region':
          return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
        case 'district':
          return { assembly: { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } } };
        case 'assembly':
          return { assemblyId: scope.assemblyId, assembly: { district: { region: { tenantId: scope.tenantId } } } };
        default:
          return { userId: user.id };
      }
    })();

    const where: Prisma.DonationWhereInput = { AND: [baseWhere, scopeWhere] };

    const [total, byStatus, byMethod, confirmed] = await Promise.all([
      prisma.donation.count({ where }),
      prisma.donation.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
        _sum: { amount: true },
      }),
      prisma.donation.groupBy({
        by: ['method'],
        where: { ...where, status: DonationStatus.CONFIRMED },
        _count: { method: true },
        _sum: { amount: true },
      }),
      prisma.donation.aggregate({
        where: { ...where, status: DonationStatus.CONFIRMED },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    sendSuccess(res, {
      total,
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count.status,
        amount: r._sum.amount?.toString() ?? '0',
      })),
      byMethod: byMethod.map((r) => ({
        method: r.method,
        count: r._count.method,
        amount: r._sum.amount?.toString() ?? '0',
      })),
      confirmed: {
        count: confirmed._count,
        total: confirmed._sum.amount?.toString() ?? '0',
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
