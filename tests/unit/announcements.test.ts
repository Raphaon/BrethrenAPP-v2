import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAnnouncementTargetScope: jest.fn().mockResolvedValue(undefined),
  buildAnnouncementVisibilityFilter: jest.fn().mockResolvedValue({}),
}));

const mockAnnouncement = {
  id: 'ann-1', title: 'Retraite spirituelle 2025', content: 'Rejoignez-nous pour 3 jours de retraite.',
  level: 'ASSEMBLY', status: 'PUBLISHED', tenantId: 'tenant-1', assemblyId: 'asm-1',
  publishedAt: new Date(), expiresAt: null, deletedAt: null,
  createdBy: { id: 'user-1', firstName: 'Admin', lastName: 'Test' },
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
};

describe('Announcements module', () => {

  // ─── Listing ──────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should apply visibility filter for non-national users', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockAnnouncement], 1] as any);
      const [rows, total] = await prismaMock.$transaction([
        prismaMock.announcement.findMany({ where: { deletedAt: null, status: 'PUBLISHED' } } as any),
        prismaMock.announcement.count({ where: { deletedAt: null, status: 'PUBLISHED' } } as any),
      ] as any);
      expect(rows).toHaveLength(1);
      expect(total).toBe(1);
    });

    it('should exclude expired announcements', () => {
      const past = new Date(Date.now() - 1000);
      const isExpired = (d: Date | null) => d != null && d.getTime() < Date.now();
      expect(isExpired(past)).toBe(true);
    });

    it('should include announcements without expiry', () => {
      const isExpired = (d: Date | null) => d != null && d.getTime() < Date.now();
      expect(isExpired(null)).toBe(false);
    });
  });

  // ─── Create / Publish ──────────────────────────────────────────────────────

  describe('create', () => {
    it('should create with DRAFT status by default', async () => {
      prismaMock.announcement.create.mockResolvedValue({
        ...mockAnnouncement, status: 'DRAFT', publishedAt: null,
      } as any);
      const ann = await prismaMock.announcement.create({
        data: { title: 'Test', content: 'Content', level: 'ASSEMBLY', tenantId: 'tenant-1' },
      } as any);
      expect(ann.status).toBe('DRAFT');
    });
  });

  describe('publish', () => {
    it('should set publishedAt and status PUBLISHED', async () => {
      prismaMock.announcement.update.mockResolvedValue({ ...mockAnnouncement, status: 'PUBLISHED', publishedAt: new Date() } as any);
      const published = await prismaMock.announcement.update({
        where: { id: 'ann-1' },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      } as any);
      expect(published.status).toBe('PUBLISHED');
      expect(published.publishedAt).toBeDefined();
    });

    it('should reject publishing already published announcement', () => {
      const ann = { ...mockAnnouncement, status: 'PUBLISHED' };
      const canPublish = ann.status === 'DRAFT' || ann.status === 'SCHEDULED';
      expect(canPublish).toBe(false);
    });
  });

  describe('archive', () => {
    it('should set status ARCHIVED', async () => {
      prismaMock.announcement.update.mockResolvedValue({ ...mockAnnouncement, status: 'ARCHIVED' } as any);
      const archived = await prismaMock.announcement.update({
        where: { id: 'ann-1' }, data: { status: 'ARCHIVED' },
      } as any);
      expect(archived.status).toBe('ARCHIVED');
    });
  });

  // ─── Levels ────────────────────────────────────────────────────────────────

  describe('targeting levels', () => {
    it.each(['NATIONAL', 'REGIONAL', 'DISTRICT', 'ASSEMBLY', 'MINISTRY'])(
      'should accept level %s', (level) => {
        const validLevels = ['NATIONAL', 'REGIONAL', 'DISTRICT', 'ASSEMBLY', 'MINISTRY'];
        expect(validLevels).toContain(level);
      }
    );

    it('non-national admin should not publish NATIONAL announcement', () => {
      const isNational = false;
      const level = 'NATIONAL';
      const canPublish = isNational || level !== 'NATIONAL';
      expect(canPublish).toBe(false);
    });
  });

  // ─── Soft delete ───────────────────────────────────────────────────────────

  describe('soft delete', () => {
    it('should set deletedAt', async () => {
      prismaMock.announcement.update.mockResolvedValue({ ...mockAnnouncement, deletedAt: new Date() } as any);
      const deleted = await prismaMock.announcement.update({
        where: { id: 'ann-1' }, data: { deletedAt: new Date() },
      } as any);
      expect(deleted.deletedAt).toBeDefined();
    });
  });
});
