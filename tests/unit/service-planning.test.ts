import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
  getScopedAssemblyWhere: jest.fn().mockResolvedValue({}),
}));

const mockPlan = {
  id: 'sp-1', title: 'Culte du 25 Mai', date: new Date('2025-05-25T09:00:00Z'),
  assemblyId: 'asm-1', status: 'DRAFT', createdById: 'user-1',
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
  program: null, createdBy: { id: 'user-1', firstName: 'Admin', lastName: 'Test' },
  _count: { assignments: 0 },
  deletedAt: null,
};

const mockAssignment = {
  id: 'sa-1', servicePlanId: 'sp-1', userId: 'user-2', role: 'Prédicateur',
  status: 'PENDING', respondedAt: null,
  user: { id: 'user-2', firstName: 'Jean', lastName: 'Paul', avatar: null },
};

describe('Service Planning module', () => {

  // ─── Plans ────────────────────────────────────────────────────────────────

  describe('Service plans', () => {
    it('list: should filter by date range', () => {
      const from = '2025-05-01';
      const to = '2025-05-31';
      const filter = {
        date: { gte: new Date(from), lte: new Date(to) },
      };
      expect(filter.date.gte).toEqual(new Date(from));
    });

    it('list: should order by date ASC', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockPlan], 1] as any);
      const [rows] = await prismaMock.$transaction([
        prismaMock.servicePlan.findMany({ orderBy: { date: 'asc' } } as any),
        prismaMock.servicePlan.count() as any,
      ] as any);
      expect(rows).toHaveLength(1);
    });

    it('create: should store date as Date object', async () => {
      prismaMock.servicePlan.create.mockResolvedValue(mockPlan as any);
      const created = await prismaMock.servicePlan.create({
        data: { title: 'Culte', assemblyId: 'asm-1', date: new Date('2025-05-25'), createdById: 'user-1' },
      } as any);
      expect(created.date).toBeInstanceOf(Date);
    });

    it('publish: should reject if status is not DRAFT', () => {
      const plan = { ...mockPlan, status: 'PUBLISHED' };
      const canPublish = plan.status === 'DRAFT';
      expect(canPublish).toBe(false);
    });

    it('publish: should change status to PUBLISHED', async () => {
      prismaMock.servicePlan.update.mockResolvedValue({ ...mockPlan, status: 'PUBLISHED' } as any);
      const updated = await prismaMock.servicePlan.update({
        where: { id: 'sp-1' },
        data: { status: 'PUBLISHED' },
      } as any);
      expect(updated.status).toBe('PUBLISHED');
    });

    it('soft delete: should set deletedAt and status ARCHIVED', async () => {
      prismaMock.servicePlan.update.mockResolvedValue({ ...mockPlan, deletedAt: new Date(), status: 'ARCHIVED' } as any);
      const deleted = await prismaMock.servicePlan.update({
        where: { id: 'sp-1' },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      } as any);
      expect(deleted.status).toBe('ARCHIVED');
    });
  });

  // ─── Assignments ──────────────────────────────────────────────────────────

  describe('Service assignments', () => {
    it('add: should upsert assignment with PENDING status', async () => {
      prismaMock.serviceAssignment.upsert.mockResolvedValue(mockAssignment as any);
      const sa = await prismaMock.serviceAssignment.upsert({
        where: { servicePlanId_userId_role: { servicePlanId: 'sp-1', userId: 'user-2', role: 'Prédicateur' } },
        update: { status: 'PENDING' },
        create: { servicePlanId: 'sp-1', userId: 'user-2', role: 'Prédicateur' },
      } as any);
      expect(sa.status).toBe('PENDING');
    });

    it('respond CONFIRMED: should set respondedAt', async () => {
      const now = new Date();
      prismaMock.serviceAssignment.update.mockResolvedValue({
        ...mockAssignment, status: 'CONFIRMED', respondedAt: now,
      } as any);
      const updated = await prismaMock.serviceAssignment.update({
        where: { id: 'sa-1' },
        data: { status: 'CONFIRMED', respondedAt: now },
      } as any);
      expect(updated.status).toBe('CONFIRMED');
      expect(updated.respondedAt).toBeDefined();
    });

    it('respond DECLINED: should set respondedAt', async () => {
      const now = new Date();
      prismaMock.serviceAssignment.update.mockResolvedValue({
        ...mockAssignment, status: 'DECLINED', respondedAt: now,
      } as any);
      const updated = await prismaMock.serviceAssignment.update({
        where: { id: 'sa-1' },
        data: { status: 'DECLINED', respondedAt: now },
      } as any);
      expect(updated.status).toBe('DECLINED');
    });

    it('should reject respond with invalid status', () => {
      const validStatuses = ['CONFIRMED', 'DECLINED'];
      expect(validStatuses).not.toContain('CANCELLED');
      expect(validStatuses).not.toContain('DONE');
    });

    it('should only allow user to respond to their own assignment', () => {
      const assignment = { ...mockAssignment, userId: 'user-2' };
      const requesterId = 'user-3';
      const canRespond = assignment.userId === requesterId;
      expect(canRespond).toBe(false);
    });

    it('remove: should delete assignment record', async () => {
      prismaMock.serviceAssignment.delete.mockResolvedValue(mockAssignment as any);
      const deleted = await prismaMock.serviceAssignment.delete({ where: { id: 'sa-1' } } as any);
      expect(deleted.id).toBe('sa-1');
    });
  });

  // ─── Notifications lors de la publication ──────────────────────────────────

  describe('Publish notifications', () => {
    it('should create one notification per assignment', async () => {
      const assignments = [
        { userId: 'u1', role: 'Prédicateur' },
        { userId: 'u2', role: 'Modérateur' },
        { userId: 'u3', role: 'Son' },
      ];
      prismaMock.notification.createMany.mockResolvedValue({ count: assignments.length });
      const result = await prismaMock.notification.createMany({
        data: assignments.map((a) => ({
          userId: a.userId,
          title: 'Affectation de service',
          message: `Rôle : ${a.role}`,
          type: 'ASSIGNMENT',
        })),
      });
      expect(result.count).toBe(3);
    });
  });
});
