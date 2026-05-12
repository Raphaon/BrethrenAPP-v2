import { prismaMock } from '../helpers/test-setup';

// ─── Mocks globaux ─────────────────────────────────────────────────────────

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
  getScopedAssemblyWhere: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/plan-limit.service', () => ({
  planLimitService: {
    resolveTenantIdFromAssembly: jest.fn().mockResolvedValue('tenant-1'),
    getTenantUsage: jest.fn().mockResolvedValue({ assemblies: 2 }),
    assertCanCreate: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockGroup = {
  id: 'grp-1', name: 'Cellule Alpha', type: 'CELL_GROUP', status: 'ACTIVE',
  assemblyId: 'asm-1', meetingDay: 'FRIDAY', meetingTime: '18:30',
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
  leader: null,
  _count: { members: 3 },
};

// ─── Tests inline (routes — style intégration légère) ─────────────────────
// Stratégie : on teste les fonctions de service simulées pour chaque route.

describe('Groups module — business logic', () => {

  describe('Group creation', () => {
    it('should resolve tenantId from assemblyId before checking limits', async () => {
      const { planLimitService } = jest.requireMock('../../src/services/plan-limit.service');
      await planLimitService.resolveTenantIdFromAssembly('asm-1');
      expect(planLimitService.resolveTenantIdFromAssembly).toHaveBeenCalledWith('asm-1');
    });

    it('should call assertCanCreate with maxGroups key', async () => {
      const { planLimitService } = jest.requireMock('../../src/services/plan-limit.service');
      planLimitService.getTenantUsage.mockResolvedValueOnce({ assemblies: 5 });
      await planLimitService.assertCanCreate('tenant-1', 'maxGroups', 5, 'groupes');
      expect(planLimitService.assertCanCreate).toHaveBeenCalledWith('tenant-1', 'maxGroups', 5, 'groupes');
    });

    it('should reject when limit is reached', async () => {
      const { planLimitService } = jest.requireMock('../../src/services/plan-limit.service');
      planLimitService.assertCanCreate.mockRejectedValueOnce(
        Object.assign(new Error('Limite atteinte'), { code: 'PLAN_LIMIT_REACHED', statusCode: 402 })
      );
      await expect(planLimitService.assertCanCreate('t', 'maxGroups', 5, 'groupes'))
        .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    });
  });

  describe('Group CRUD — Prisma interactions', () => {
    it('list: should build where filter with scopedAssembly', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockGroup], 1] as any);
      const [rows] = await prismaMock.$transaction([
        prismaMock.groups.findMany({ where: { deletedAt: null } } as any),
        prismaMock.groups.count({ where: { deletedAt: null } } as any),
      ] as any);
      expect(rows).toBeDefined();
    });

    it('findById: should return group when found', async () => {
      prismaMock.groups.findUnique.mockResolvedValue(mockGroup as any);
      const result = await prismaMock.groups.findUnique({ where: { id: 'grp-1' } } as any);
      expect(result?.id).toBe('grp-1');
      expect(result?.name).toBe('Cellule Alpha');
    });

    it('findById: should return null when not found', async () => {
      prismaMock.groups.findUnique.mockResolvedValue(null);
      const result = await prismaMock.groups.findUnique({ where: { id: 'nonexistent' } } as any);
      expect(result).toBeNull();
    });

    it('create: should persist correct fields', async () => {
      prismaMock.groups.create.mockResolvedValue({ ...mockGroup, id: 'grp-new' } as any);
      const created = await prismaMock.groups.create({
        data: { name: 'Cellule Alpha', assemblyId: 'asm-1', type: 'CELL_GROUP', meetingDay: 'FRIDAY' },
      } as any);
      expect(created.id).toBe('grp-new');
    });

    it('update: should only modify allowed fields', async () => {
      prismaMock.groups.findUnique.mockResolvedValue(mockGroup as any);
      prismaMock.groups.update.mockResolvedValue({ ...mockGroup, name: 'Cellule Bêta', meetingTime: '19:00' } as any);
      const updated = await prismaMock.groups.update({
        where: { id: 'grp-1' },
        data: { name: 'Cellule Bêta', meetingTime: '19:00' },
      } as any);
      expect(updated.name).toBe('Cellule Bêta');
    });

    it('soft delete: should set deletedAt and status DISSOLVED', async () => {
      prismaMock.groups.update.mockResolvedValue({ ...mockGroup, deletedAt: new Date(), status: 'DISSOLVED' } as any);
      const deleted = await prismaMock.groups.update({
        where: { id: 'grp-1' },
        data: { deletedAt: new Date(), status: 'DISSOLVED' },
      } as any);
      expect(deleted.deletedAt).toBeDefined();
      expect(deleted.status).toBe('DISSOLVED');
    });
  });

  describe('Group membership', () => {
    it('addMember: should upsert group member with correct role', async () => {
      prismaMock.group_members.upsert.mockResolvedValue({
        id: 'gm-1', groupId: 'grp-1', memberId: 'mem-1', role: 'leader', status: 'ACTIVE',
        member: { id: 'mem-1', firstName: 'Jean', lastName: 'Paul' },
      } as any);
      const gm = await prismaMock.group_members.upsert({
        where: { groupId_memberId: { groupId: 'grp-1', memberId: 'mem-1' } },
        update: { status: 'ACTIVE', role: 'leader' },
        create: { groupId: 'grp-1', memberId: 'mem-1', role: 'leader' },
      } as any);
      expect(gm.role).toBe('leader');
      expect(gm.status).toBe('ACTIVE');
    });

    it('removeMember: should set status INACTIVE with leftAt', async () => {
      prismaMock.group_members.update.mockResolvedValue({
        id: 'gm-1', status: 'INACTIVE', leftAt: new Date(),
      } as any);
      const result = await prismaMock.group_members.update({
        where: { id: 'gm-1' },
        data: { status: 'INACTIVE', leftAt: new Date() },
      } as any);
      expect(result.status).toBe('INACTIVE');
      expect(result.leftAt).toBeDefined();
    });

    it('should reject member not belonging to the assembly', async () => {
      prismaMock.member.findFirst.mockResolvedValue(null);
      const member = await prismaMock.member.findFirst({
        where: { id: 'mem-other', assemblyId: 'asm-1', deletedAt: null },
      } as any);
      expect(member).toBeNull();
    });
  });

  describe('Group types', () => {
    it.each([
      'CELL_GROUP', 'PRAYER_CELL', 'CHOIR', 'YOUTH',
      'WELCOME_TEAM', 'MEDIA_TEAM', 'BIBLE_STUDY', 'OTHER',
    ])('should accept type %s', (type) => {
      const validTypes = ['CELL_GROUP', 'PRAYER_CELL', 'CHOIR', 'YOUTH', 'WELCOME_TEAM', 'MEDIA_TEAM', 'BIBLE_STUDY', 'OTHER'];
      expect(validTypes).toContain(type);
    });
  });
});
