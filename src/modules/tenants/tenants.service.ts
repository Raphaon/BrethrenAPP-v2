import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { isSuperAdmin, isTenantWideAdmin } from '../../middlewares/rbac.middleware';
import { planLimitService } from '../../services/plan-limit.service';
import type { AuthUser } from '../../shared/types/express';
import type { UpdateTenantDto, UpdateTenantSettingsDto } from './tenants.validation';

function requireTenantId(user: AuthUser): string {
  if (!user.tenantId) {
    throw new ForbiddenError('Aucune organisation associée à votre compte');
  }
  return user.tenantId;
}

export class TenantsService {
  async getCurrentTenant(user: AuthUser) {
    const tenantId = requireTenantId(user);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId, deletedAt: null },
      include: {
        tenantSettings: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });

    if (!tenant) throw new NotFoundError('Tenant');

    return {
      ...tenant,
      subscription: (tenant as any).subscriptions?.[0] ?? null,
      subscriptions: undefined,
    };
  }

  async getUsage(user: AuthUser) {
    const tenantId = requireTenantId(user);
    const [plan, usage] = await Promise.all([
      planLimitService.getTenantPlan(tenantId),
      planLimitService.getTenantUsage(tenantId),
    ]);

    return {
      plan,
      usage,
      limits: {
        assemblies: plan.maxAssemblies,
        members: plan.maxMembers,
        adminUsers: plan.maxAdminUsers,
        regions: plan.maxRegions,
        districts: plan.maxDistricts,
        preachingPoints: plan.maxPreachingPoints,
        ministries: plan.maxMinistries,
        groups: plan.maxGroups,
      },
      features: {
        regions: plan.allowRegions,
        districts: plan.allowDistricts,
        advancedReports: plan.allowAdvancedReports,
        branding: plan.allowBranding,
        publicApi: plan.allowPublicApi,
      },
    };
  }

  async updateCurrentTenant(user: AuthUser, dto: UpdateTenantDto) {
    if (!isTenantWideAdmin(user)) {
      throw new ForbiddenError('Seul un administrateur du tenant peut modifier l organisation');
    }

    const tenantId = requireTenantId(user);
    return prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
    });
  }

  async getSettings(user: AuthUser) {
    const tenantId = requireTenantId(user);
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {},
      create: { id: crypto.randomUUID(), updatedAt: new Date(), tenantId },
    });
  }

  async updateSettings(user: AuthUser, dto: UpdateTenantSettingsDto) {
    if (!isTenantWideAdmin(user)) {
      throw new ForbiddenError('Seul un administrateur du tenant peut modifier les parametres');
    }

    const tenantId = requireTenantId(user);
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      update: dto as Prisma.TenantSettingsUpdateInput,
      create: {
        id: crypto.randomUUID(),
        updatedAt: new Date(),
        tenantId,
        dateFormat: dto.dateFormat,
        phoneFormat: dto.phoneFormat,
        contactEmail: dto.contactEmail,
        primaryColor: dto.primaryColor,
        secondaryColor: dto.secondaryColor,
        notificationPreferences: dto.notificationPreferences as Prisma.InputJsonValue | undefined,
        onboardingChecklist: dto.onboardingChecklist as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listForPlatformAdmin(user: AuthUser) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenError('Reserve au Super Admin plateforme');
    }

    return prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          take: 1,
          include: { plan: true },
        },
        _count: { select: { users: true, regions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const tenantsService = new TenantsService();
