import { Plan, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../database/prisma';
import { AppError, NotFoundError } from '../middlewares/error.middleware';

type LimitKey =
  | 'maxAssemblies'
  | 'maxMembers'
  | 'maxAdminUsers'
  | 'maxRegions'
  | 'maxDistricts'
  | 'maxPreachingPoints'
  | 'maxMinistries'
  | 'maxGroups';

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];

export class PlanLimitService {
  async getTenantPlan(tenantId: string): Promise<Plan> {
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!subscription) {
      throw new AppError('Aucun abonnement actif pour cette organisation', 402, 'SUBSCRIPTION_REQUIRED');
    }

    return subscription.plan;
  }

  async resolveTenantIdFromAssembly(assemblyId: string): Promise<string> {
    const assembly = await prisma.assembly.findUnique({
      where: { id: assemblyId, deletedAt: null },
      select: {
        district: {
          select: {
            region: { select: { tenantId: true } },
          },
        },
      },
    });

    if (!assembly) throw new NotFoundError('Assemblee');
    return assembly.district.region.tenantId;
  }

  async getTenantUsage(tenantId: string) {
    const tenantWhere = { district: { region: { tenantId } } };

    const [
      regions,
      districts,
      assemblies,
      members,
      preachingPoints,
      ministries,
      groups,
      adminUsers,
    ] = await prisma.$transaction([
      prisma.region.count({ where: { tenantId, deletedAt: null } }),
      prisma.district.count({ where: { region: { tenantId }, deletedAt: null } }),
      prisma.assembly.count({ where: { ...tenantWhere, deletedAt: null } }),
      prisma.member.count({ where: { assembly: tenantWhere, deletedAt: null } }),
      prisma.preachingPoint.count({ where: { assembly: tenantWhere, deletedAt: null } }),
      prisma.ministry.count({ where: { assembly: tenantWhere, deletedAt: null } }),
      prisma.groups.count({ where: { assemblies: tenantWhere, deletedAt: null } }),
      prisma.user.count({
        where: {
          tenantId,
          deletedAt: null,
          userRoles: {
            some: {
              role: { name: { not: 'member' } },
              expiresAt: null,
            },
          },
        },
      }),
    ]);

    return {
      regions,
      districts,
      assemblies,
      members,
      preachingPoints,
      ministries,
      groups,
      adminUsers,
    };
  }

  async assertFeature(tenantId: string, feature: 'allowRegions' | 'allowDistricts' | 'allowAdvancedReports' | 'allowBranding' | 'allowPublicApi') {
    const plan = await this.getTenantPlan(tenantId);
    if (!plan[feature]) {
      throw new AppError('Fonctionnalite indisponible avec votre plan actuel', 402, 'PLAN_FEATURE_LOCKED');
    }
  }

  async assertCanCreate(tenantId: string, limitKey: LimitKey, currentCount: number, label: string) {
    const plan = await this.getTenantPlan(tenantId);
    const limit = plan[limitKey];

    if (limit !== null && limit !== undefined && currentCount >= limit) {
      throw new AppError(
        `Limite du plan atteinte: ${label} (${currentCount}/${limit})`,
        402,
        'PLAN_LIMIT_REACHED',
        [{ limitKey, current: currentCount, limit, plan: plan.code }],
      );
    }
  }

  async assertCanCreateRegion(tenantId: string) {
    await this.assertFeature(tenantId, 'allowRegions');
    const usage = await this.getTenantUsage(tenantId);
    await this.assertCanCreate(tenantId, 'maxRegions', usage.regions, 'regions');
  }

  async assertCanCreateDistrict(tenantId: string) {
    const plan = await this.getTenantPlan(tenantId);
    const usage = await this.getTenantUsage(tenantId);

    if (!plan.allowDistricts && (plan.maxDistricts ?? 0) <= 0) {
      throw new AppError('Les districts sont indisponibles avec votre plan actuel', 402, 'PLAN_FEATURE_LOCKED');
    }

    await this.assertCanCreate(tenantId, 'maxDistricts', usage.districts, 'districts');
  }

  async assertCanCreateAssembly(tenantId: string) {
    const usage = await this.getTenantUsage(tenantId);
    await this.assertCanCreate(tenantId, 'maxAssemblies', usage.assemblies, 'assemblees');
  }

  async assertCanCreateMember(assemblyId: string) {
    const tenantId = await this.resolveTenantIdFromAssembly(assemblyId);
    const usage = await this.getTenantUsage(tenantId);
    await this.assertCanCreate(tenantId, 'maxMembers', usage.members, 'membres');
  }
}

export const planLimitService = new PlanLimitService();
