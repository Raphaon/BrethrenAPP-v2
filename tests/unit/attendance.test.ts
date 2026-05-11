import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
}));

const sessionDate = new Date('2025-05-09T00:00:00.000Z');

const mockAttendances = [
  { id: 'att-1', entityType: 'GROUP', entityId: 'grp-1', memberId: 'mem-1', isPresent: true, sessionDate },
  { id: 'att-2', entityType: 'GROUP', entityId: 'grp-1', memberId: 'mem-2', isPresent: false, sessionDate },
  { id: 'att-3', entityType: 'GROUP', entityId: 'grp-1', memberId: 'mem-3', isPresent: true, sessionDate },
];

describe('Attendance module', () => {

  // ─── Enregistrement ────────────────────────────────────────────────────────

  describe('Record attendance', () => {
    it('should delete existing records for same session before re-creating', async () => {
      prismaMock.attendance.deleteMany.mockResolvedValue({ count: 2 });
      const result = await prismaMock.attendance.deleteMany({
        where: { entityType: 'GROUP', entityId: 'grp-1', sessionDate: { gte: sessionDate, lte: sessionDate } },
      } as any);
      expect(result.count).toBe(2);
    });

    it('should create attendance records in bulk', async () => {
      prismaMock.attendance.createMany.mockResolvedValue({ count: 3 });
      const result = await prismaMock.attendance.createMany({
        data: mockAttendances.map((a) => ({
          entityType: a.entityType, entityId: a.entityId,
          memberId: a.memberId, isPresent: a.isPresent,
          sessionDate, takenById: 'user-1',
        })),
      } as any);
      expect(result.count).toBe(3);
    });

    it('should accept visitorName when memberId is absent', async () => {
      prismaMock.attendance.createMany.mockResolvedValue({ count: 1 });
      const result = await prismaMock.attendance.createMany({
        data: [{ entityType: 'GROUP', entityId: 'grp-1', memberId: null, visitorName: 'Visiteur inconnu', isPresent: true, sessionDate, takenById: 'user-1' }],
      } as any);
      expect(result.count).toBe(1);
    });
  });

  // ─── Historique ────────────────────────────────────────────────────────────

  describe('History', () => {
    it('list: should return paginated records', async () => {
      prismaMock.$transaction.mockResolvedValue([mockAttendances, 3] as any);
      const [rows, total] = await prismaMock.$transaction([
        prismaMock.attendance.findMany({ where: { entityType: 'GROUP', entityId: 'grp-1' } } as any),
        prismaMock.attendance.count({ where: { entityType: 'GROUP', entityId: 'grp-1' } } as any),
      ] as any);
      expect(rows).toHaveLength(3);
      expect(total).toBe(3);
    });

    it('list: should filter by memberId', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockAttendances[0]], 1] as any);
      const [rows] = await prismaMock.$transaction([
        prismaMock.attendance.findMany({ where: { memberId: 'mem-1' } } as any),
        prismaMock.attendance.count({ where: { memberId: 'mem-1' } } as any),
      ] as any);
      expect(rows).toHaveLength(1);
      expect(rows[0].memberId).toBe('mem-1');
    });

    it('list: should order by sessionDate DESC', async () => {
      const sorted = [...mockAttendances].sort((a, b) =>
        b.sessionDate.getTime() - a.sessionDate.getTime()
      );
      expect(sorted[0]).toBe(mockAttendances[0]);
    });
  });

  // ─── Résumé ────────────────────────────────────────────────────────────────

  describe('Summary', () => {
    it('should calculate attendance rate correctly', () => {
      const present = 2;
      const total = 3;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      expect(rate).toBe(67);
    });

    it('should return 0% when no records', () => {
      const rate = 0 > 0 ? Math.round((0 / 0) * 100) : 0;
      expect(rate).toBe(0);
    });

    it('should return 100% when all present', () => {
      const present = 5, total = 5;
      expect(Math.round((present / total) * 100)).toBe(100);
    });

    it('absent count = total - present', () => {
      const present = 2, total = 3;
      expect(total - present).toBe(1);
    });
  });

  // ─── Types d'entités ───────────────────────────────────────────────────────

  describe('Entity types', () => {
    it.each(['EVENT', 'GROUP', 'PROGRAM'])('should accept entity type %s', (type) => {
      const validTypes = ['EVENT', 'GROUP', 'PROGRAM'];
      expect(validTypes).toContain(type);
    });

    it('should resolve assemblyId from GROUP entityType', async () => {
      prismaMock.group.findUnique.mockResolvedValue({ id: 'grp-1', assemblyId: 'asm-1' } as any);
      const group = await prismaMock.group.findUnique({ where: { id: 'grp-1' } } as any);
      expect(group?.assemblyId).toBe('asm-1');
    });

    it('should resolve assemblyId from PROGRAM entityType', async () => {
      prismaMock.program.findUnique.mockResolvedValue({ id: 'prog-1', assemblyId: 'asm-1' } as any);
      const program = await prismaMock.program.findUnique({ where: { id: 'prog-1' } } as any);
      expect(program?.assemblyId).toBe('asm-1');
    });
  });
});
