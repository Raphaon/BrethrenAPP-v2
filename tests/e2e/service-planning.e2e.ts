import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';
import { signAccessToken } from '../../src/utils/jwt.util';

const app = createApp();

describe('Service Planning E2E', () => {
  let adminToken: string;
  let memberToken: string;
  let adminUserId: string;
  let memberUserId: string;
  let tenantId: string;
  let assemblyId: string;
  let planId: string;
  let assignmentId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    tenantId = tenant!.id;

    const assembly = await prisma.assembly.findFirst({
      where: { district: { region: { tenantId } }, deletedAt: null },
    });
    assemblyId = assembly!.id;

    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    const memberRole = await prisma.role.findUnique({ where: { name: 'member' } });
    const pw = await hashPassword('Test@E2E2025!');

    const admin = await prisma.user.create({
      data: { email: `e2e_sp_admin_${Date.now()}@test.com`, firstName: 'SP', lastName: 'Admin', password: pw, status: 'ACTIVE', tenantId },
    });
    adminUserId = admin.id;
    if (superAdminRole) await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole.id, tenantId, assignedBy: admin.id } });
    adminToken = signAccessToken(admin.id, admin.email);

    const member = await prisma.user.create({
      data: { email: `e2e_sp_member_${Date.now()}@test.com`, firstName: 'SP', lastName: 'Member', password: pw, status: 'ACTIVE', tenantId },
    });
    memberUserId = member.id;
    if (memberRole) await prisma.userRole.create({ data: { userId: member.id, roleId: memberRole.id, tenantId, assignedBy: admin.id } });
    memberToken = signAccessToken(member.id, member.email);
  });

  afterAll(async () => {
    if (assignmentId) await prisma.serviceAssignment.deleteMany({ where: { servicePlanId: planId } }).catch(() => {});
    if (planId) await prisma.servicePlan.deleteMany({ where: { id: planId } }).catch(() => {});
    for (const uid of [adminUserId, memberUserId]) {
      await prisma.userRole.deleteMany({ where: { userId: uid } });
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
  });

  // ─── GET /service-planning ────────────────────────────────────────────────

  describe('GET /api/v1/service-planning', () => {
    it('should return 401 without token', async () => {
      expect((await request(app).get('/api/v1/service-planning')).status).toBe(401);
    });

    it('should return paginated plans', async () => {
      const res = await request(app)
        .get('/api/v1/service-planning')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── POST /service-planning ───────────────────────────────────────────────

  describe('POST /api/v1/service-planning', () => {
    it('should reject without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/service-planning')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Manque date' });
      expect(res.status).toBe(422);
    });

    it('should create plan successfully', async () => {
      const nextSunday = new Date();
      nextSunday.setDate(nextSunday.getDate() + 7);

      const res = await request(app)
        .post('/api/v1/service-planning')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'E2E Culte Test',
          assemblyId,
          date: nextSunday.toISOString(),
          startTime: '09:00',
          endTime: '12:00',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('E2E Culte Test');
      expect(res.body.data.status).toBe('DRAFT');
      planId = res.body.data.id;
    });
  });

  // ─── POST /:id/assignments ────────────────────────────────────────────────

  describe('POST /api/v1/service-planning/:id/assignments', () => {
    it('should assign user to role', async () => {
      const res = await request(app)
        .post(`/api/v1/service-planning/${planId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: memberUserId, role: 'Prédicateur' });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      assignmentId = res.body.data.id;
    });

    it('should upsert if same user+role already assigned', async () => {
      const res = await request(app)
        .post(`/api/v1/service-planning/${planId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: memberUserId, role: 'Prédicateur' });

      expect(res.status).toBe(201);
    });
  });

  // ─── PATCH /assignments/:id/respond ──────────────────────────────────────

  describe('PATCH /api/v1/service-planning/assignments/:id/respond', () => {
    it('should confirm assignment as the assigned user', async () => {
      const res = await request(app)
        .patch(`/api/v1/service-planning/assignments/${assignmentId}/respond`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ status: 'CONFIRMED' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CONFIRMED');
    });

    it('should reject if another user tries to respond', async () => {
      const res = await request(app)
        .patch(`/api/v1/service-planning/assignments/${assignmentId}/respond`)
        .set('Authorization', `Bearer ${adminToken}`) // mauvais user
        .send({ status: 'DECLINED' });

      expect(res.status).toBe(403);
    });
  });

  // ─── POST /:id/publish ────────────────────────────────────────────────────

  describe('POST /api/v1/service-planning/:id/publish', () => {
    it('should publish DRAFT plan', async () => {
      // Remettre en DRAFT d'abord
      await prisma.servicePlan.update({ where: { id: planId }, data: { status: 'DRAFT' } });

      const res = await request(app)
        .post(`/api/v1/service-planning/${planId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PUBLISHED');
    });

    it('should reject publish if already PUBLISHED', async () => {
      const res = await request(app)
        .post(`/api/v1/service-planning/${planId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /my/assignments ──────────────────────────────────────────────────

  describe('GET /api/v1/service-planning/my/assignments', () => {
    it('should return assignments for current user', async () => {
      const res = await request(app)
        .get('/api/v1/service-planning/my/assignments')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── DELETE /:id/assignments/:aId ────────────────────────────────────────

  describe('DELETE /api/v1/service-planning/:id/assignments/:aId', () => {
    it('should remove assignment', async () => {
      const res = await request(app)
        .delete(`/api/v1/service-planning/${planId}/assignments/${assignmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      assignmentId = '';
    });
  });
});
