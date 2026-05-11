import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';
import { signAccessToken } from '../../src/utils/jwt.util';

const app = createApp();

describe('Attendance E2E', () => {
  let adminToken: string;
  let adminUserId: string;
  let tenantId: string;
  let groupId: string;
  let memberIds: string[];

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    tenantId = tenant!.id;

    // Trouver un groupe existant (seed obligatoire)
    const group = await prisma.group.findFirst({
      where: { assembly: { district: { region: { tenantId } } }, deletedAt: null },
      include: { assembly: { select: { id: true } } },
    });
    if (!group) throw new Error('Aucun groupe trouvé — lancez le seed');
    groupId = group.id;

    // Prendre des membres de la même assemblée
    const members = await prisma.member.findMany({
      where: { assemblyId: group.assembly.id, deletedAt: null },
      take: 3,
    });
    memberIds = members.map((m) => m.id);

    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    if (!superAdminRole) throw new Error('Rôle super_admin manquant — lancez le seed');
    const pw = await hashPassword('Test@E2E2025!');
    const admin = await prisma.user.create({
      data: { email: `e2e_att_${Date.now()}@test.com`, firstName: 'Att', lastName: 'Admin', password: pw, status: 'ACTIVE', tenantId },
    });
    adminUserId = admin.id;
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole.id, tenantId, assignedBy: admin.id } });
    adminToken = signAccessToken(admin.id, admin.email);
  });

  afterAll(async () => {
    // Nettoyage présences créées par les tests
    await prisma.attendance.deleteMany({ where: { takenById: adminUserId } });
    await prisma.userRole.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  });

  // ─── POST /attendance ─────────────────────────────────────────────────────

  describe('POST /api/v1/attendance', () => {
    it('should return 401 without token', async () => {
      expect((await request(app).post('/api/v1/attendance')).status).toBe(401);
    });

    it('should reject without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ entityType: 'GROUP' });
      expect(res.status).toBe(422);
    });

    it('should record attendance for a group session', async () => {
      const records = memberIds.map((id, i) => ({
        memberId: id,
        isPresent: i % 2 === 0,
      }));

      const res = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          entityType: 'GROUP',
          entityId: groupId,
          sessionDate: '2025-05-09',
          records,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.count).toBe(memberIds.length);
    });

    it('should replace existing records for same session (idempotent)', async () => {
      const records = memberIds.map((id) => ({ memberId: id, isPresent: true }));

      const res = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          entityType: 'GROUP',
          entityId: groupId,
          sessionDate: '2025-05-09',
          records,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.count).toBe(memberIds.length);
    });
  });

  // ─── GET /attendance ──────────────────────────────────────────────────────

  describe('GET /api/v1/attendance', () => {
    it('should return paginated attendance records', async () => {
      const res = await request(app)
        .get(`/api/v1/attendance?entityType=GROUP&entityId=${groupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThan(0);
    });
  });

  // ─── GET /attendance/summary ──────────────────────────────────────────────

  describe('GET /api/v1/attendance/summary', () => {
    it('should return summary with attendance rate', async () => {
      const res = await request(app)
        .get(`/api/v1/attendance/summary?entityType=GROUP&entityId=${groupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBeGreaterThan(0);
      expect(typeof res.body.data.attendanceRate).toBe('number');
      expect(res.body.data.present + res.body.data.absent).toBe(res.body.data.total);
    });

    it('should return 0% for unknown entity', async () => {
      const res = await request(app)
        .get('/api/v1/attendance/summary?entityType=GROUP&entityId=00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.attendanceRate).toBe(0);
    });
  });
});
