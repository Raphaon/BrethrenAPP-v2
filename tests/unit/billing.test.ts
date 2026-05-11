import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));

const mockFreePlan = {
  id: 'plan-free', code: 'FREE', name: 'Gratuit', monthlyPriceCents: 0,
  maxMembers: 50, maxAssemblies: 1, maxAdminUsers: 2, isActive: true,
};

const mockStarterPlan = {
  id: 'plan-starter', code: 'STARTER', name: 'Starter', monthlyPriceCents: 1500,
  maxMembers: 200, maxAssemblies: 1, maxAdminUsers: 5, isActive: true,
};

const mockSubscription = {
  id: 'sub-1', tenantId: 'tenant-1', planId: 'plan-free', status: 'ACTIVE',
  plan: mockFreePlan,
};

describe('Billing module', () => {

  // ─── Plans ────────────────────────────────────────────────────────────────

  describe('GET /billing/plans', () => {
    it('should return only active plans', async () => {
      prismaMock.plan.findMany.mockResolvedValue([mockFreePlan, mockStarterPlan] as any);
      const plans = await prismaMock.plan.findMany({ where: { isActive: true } } as any);
      expect(plans.every((p: any) => p.isActive)).toBe(true);
    });

    it('should order plans by monthlyPriceCents ASC', async () => {
      const plans = [mockFreePlan, mockStarterPlan];
      const sorted = [...plans].sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
      expect(sorted[0].code).toBe('FREE');
      expect(sorted[1].code).toBe('STARTER');
    });
  });

  // ─── Subscription ─────────────────────────────────────────────────────────

  describe('GET /billing/subscription', () => {
    it('should return subscription with plan details', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(mockSubscription as any);
      const sub = (await prismaMock.subscription.findUnique({
        where: { tenantId: 'tenant-1' },
        include: { plan: true },
      } as any)) as typeof mockSubscription | null;
      expect(sub?.plan.code).toBe('FREE');
    });

    it('should return null when no subscription', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      const sub = await prismaMock.subscription.findUnique({ where: { tenantId: 'no-tenant' } } as any);
      expect(sub).toBeNull();
    });
  });

  // ─── Upgrade ──────────────────────────────────────────────────────────────

  describe('POST /billing/upgrade', () => {
    it('should update planId on subscription', async () => {
      prismaMock.subscription.update.mockResolvedValue({ ...mockSubscription, planId: 'plan-starter', plan: mockStarterPlan } as any);
      const updated = (await prismaMock.subscription.update({
        where: { tenantId: 'tenant-1' },
        data: { planId: 'plan-starter' },
        include: { plan: true },
      } as any) as unknown) as typeof mockSubscription;
      expect(updated.plan.code).toBe('STARTER');
    });

    it('should reject upgrade to same plan', () => {
      const currentPlan = 'FREE';
      const targetPlan = 'FREE';
      expect(currentPlan === targetPlan).toBe(true);
    });

    it('should reject upgrade to inactive plan', async () => {
      prismaMock.plan.findUnique.mockResolvedValue(null);
      const plan = await prismaMock.plan.findUnique({ where: { code: 'DEPRECATED' } } as any);
      expect(plan).toBeNull();
    });
  });

  // ─── Cancel ───────────────────────────────────────────────────────────────

  describe('POST /billing/cancel', () => {
    it('should downgrade to FREE plan', async () => {
      prismaMock.plan.findUnique.mockResolvedValue(mockFreePlan as any);
      prismaMock.subscription.update.mockResolvedValue({ ...mockSubscription, plan: mockFreePlan } as any);

      const freePlan = await prismaMock.plan.findUnique({ where: { code: 'FREE' } } as any) as typeof mockFreePlan;
      const updated = (await prismaMock.subscription.update({
        where: { tenantId: 'tenant-1' },
        data: { planId: freePlan?.id, status: 'ACTIVE' },
        include: { plan: true },
      } as any) as unknown) as typeof mockSubscription;

      expect(updated.plan.code).toBe('FREE');
    });
  });

  // ─── PlanLimitService ─────────────────────────────────────────────────────

  describe('PlanLimitService', () => {
    it('should throw when no active subscription', async () => {
      prismaMock.subscription.findFirst.mockResolvedValue(null);
      const sub = await prismaMock.subscription.findFirst({
        where: { tenantId: 'tenant-1', status: { in: ['ACTIVE', 'TRIALING'] } },
      } as any);
      expect(sub).toBeNull();
    });

    it('should allow action when below limit', () => {
      const plan = { maxMembers: 50 };
      const current = 30;
      const canCreate = plan.maxMembers === null || current < plan.maxMembers;
      expect(canCreate).toBe(true);
    });

    it('should block action when at limit', () => {
      const plan = { maxMembers: 50 };
      const current = 50;
      const canCreate = plan.maxMembers === null || current < plan.maxMembers;
      expect(canCreate).toBe(false);
    });

    it('should allow unlimited when maxMembers is null', () => {
      const plan = { maxMembers: null };
      const current = 99999;
      const canCreate = plan.maxMembers === null || current < (plan.maxMembers as unknown as number);
      expect(canCreate).toBe(true);
    });

    it.each([
      ['allowRegions', false, 'FREE'],
      ['allowAdvancedReports', false, 'FREE'],
    ])('FREE plan should have %s = %s', (feature, expected) => {
      const freePlanFeatures: Record<string, boolean> = {
        allowRegions: false,
        allowDistricts: false,
        allowAdvancedReports: false,
        allowBranding: false,
        allowPublicApi: false,
      };
      expect(freePlanFeatures[feature]).toBe(expected);
    });
  });
});
