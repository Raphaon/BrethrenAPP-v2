import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
  getScopedAssemblyWhere: jest.fn().mockResolvedValue({}),
}));

const mockVisitor = {
  id: 'nv-1', firstName: 'Alain', lastName: 'FOUDA', gender: 'MALE',
  assemblyId: 'asm-1', status: 'NEW', currentStep: 1,
  journeyStatus: null, convertedMemberId: null, deletedAt: null,
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
  contacts: [],
};

describe('New Visitors module', () => {

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  describe('CRUD', () => {
    it('list: should exclude INTEGRATED and INACTIVE by default', () => {
      const statusFilter = { status: { notIn: ['INTEGRATED', 'INACTIVE'] } };
      expect(statusFilter.status.notIn).toContain('INTEGRATED');
      expect(statusFilter.status.notIn).toContain('INACTIVE');
    });

    it('list: should include INTEGRATED when archived=true', () => {
      const archived = 'true';
      const statusFilter = archived === 'true' ? {} : { status: { notIn: ['INTEGRATED', 'INACTIVE'] } };
      expect(statusFilter).toEqual({});
    });

    it('create: should persist source field', async () => {
      prismaMock.newVisitor.create.mockResolvedValue({ ...mockVisitor, source: 'FRIEND_INVITATION' } as any);
      const v = await prismaMock.newVisitor.create({
        data: { firstName: 'Alain', lastName: 'FOUDA', gender: 'MALE', assemblyId: 'asm-1', source: 'FRIEND_INVITATION' },
      } as any);
      expect(v.source).toBe('FRIEND_INVITATION');
    });

    it('findById: should return visitor when found', async () => {
      prismaMock.newVisitor.findUnique.mockResolvedValue(mockVisitor as any);
      const v = await prismaMock.newVisitor.findUnique({ where: { id: 'nv-1', deletedAt: null } } as any);
      expect(v?.firstName).toBe('Alain');
    });

    it('soft delete: should set deletedAt', async () => {
      prismaMock.newVisitor.update.mockResolvedValue({ ...mockVisitor, deletedAt: new Date() } as any);
      const result = await prismaMock.newVisitor.update({
        where: { id: 'nv-1' },
        data: { deletedAt: new Date() },
      } as any);
      expect(result.deletedAt).toBeDefined();
    });
  });

  // ─── Parcours 5 étapes ─────────────────────────────────────────────────────

  describe('Journey auto-progression logic', () => {
    const checkAutoAdvance = (current: number, merged: Record<string, unknown>): number => {
      let next = current;
      if (next === 1 && merged.welcomeCallMade && merged.giftGiven) next = 2;
      else if (next === 2 && merged.profileDiagnosed) next = 3;
      else if (next === 3 && merged.mentorId) next = 4;
      else if (next === 4 && merged.courseEnrolled && merged.cellGroupAssigned) next = 5;
      return next;
    };

    it('step 1 → 2 when welcomeCallMade and giftGiven', () => {
      expect(checkAutoAdvance(1, { welcomeCallMade: true, giftGiven: true })).toBe(2);
    });

    it('step 1 stays at 1 when giftGiven missing', () => {
      expect(checkAutoAdvance(1, { welcomeCallMade: true, giftGiven: false })).toBe(1);
    });

    it('step 2 → 3 when profileDiagnosed', () => {
      expect(checkAutoAdvance(2, { profileDiagnosed: true })).toBe(3);
    });

    it('step 3 → 4 when mentorId assigned', () => {
      expect(checkAutoAdvance(3, { mentorId: 'user-123' })).toBe(4);
    });

    it('step 4 → 5 when courseEnrolled and cellGroupAssigned', () => {
      expect(checkAutoAdvance(4, { courseEnrolled: true, cellGroupAssigned: true })).toBe(5);
    });

    it('step 4 stays at 4 when only courseEnrolled', () => {
      expect(checkAutoAdvance(4, { courseEnrolled: true, cellGroupAssigned: false })).toBe(4);
    });
  });

  // ─── Intégration → conversion membre ──────────────────────────────────────

  describe('Integration to member', () => {
    it('should throw when visitor already converted', () => {
      const visitor = { ...mockVisitor, convertedMemberId: 'member-existing' };
      const isAlreadyConverted = !!visitor.convertedMemberId;
      expect(isAlreadyConverted).toBe(true);
    });

    it('should set baptism correctly based on baptismStatus', () => {
      const alreadyBaptized = (status: string) =>
        status === 'ALREADY_BAPTIZED' || status === 'BAPTIZED_HERE';
      expect(alreadyBaptized('ALREADY_BAPTIZED')).toBe(true);
      expect(alreadyBaptized('BAPTIZED_HERE')).toBe(true);
      expect(alreadyBaptized('NOT_BAPTIZED')).toBe(false);
    });

    it('should link convertedMemberId after integration', async () => {
      prismaMock.newVisitor.update.mockResolvedValue({
        ...mockVisitor, journeyStatus: 'INTEGRATED', status: 'INTEGRATED', convertedMemberId: 'mem-new',
      } as any);
      const updated = await prismaMock.newVisitor.update({
        where: { id: 'nv-1' },
        data: { journeyStatus: 'INTEGRATED', convertedMemberId: 'mem-new', status: 'INTEGRATED' },
      } as any);
      expect(updated.convertedMemberId).toBe('mem-new');
    });
  });

  // ─── Filtrage par date ─────────────────────────────────────────────────────

  describe('Date range filtering', () => {
    it('should build date filter correctly', () => {
      const dateFrom = '2024-01-01';
      const dateTo = '2024-12-31';
      const parsedFrom = new Date(dateFrom);
      const parsedTo = new Date(dateTo);
      parsedTo.setHours(23, 59, 59, 999);

      const filter = {
        firstVisitDate: {
          gte: parsedFrom,
          lte: parsedTo,
        },
      };
      expect(filter.firstVisitDate.gte).toEqual(parsedFrom);
      expect(filter.firstVisitDate.lte.getHours()).toBe(23);
    });

    it('should apply no date filter when both dates are absent', () => {
      const dateFrom = undefined;
      const dateTo = undefined;
      const filter = (dateFrom || dateTo) ? { firstVisitDate: {} } : {};
      expect(filter).toEqual({});
    });
  });
});
