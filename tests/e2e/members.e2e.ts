import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';
import { signAccessToken } from '../../src/utils/jwt.util';

const app = createApp();

describe('Members CRUD E2E', () => {
  let superAdminToken: string;
  let adminUserId: string;
  let tenantId: string;
  let assemblyId: string;
  let createdMemberId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!tenant) throw new Error('Aucun tenant — lancez le seed');
    tenantId = tenant.id;

    const assembly = await prisma.assembly.findFirst({
      where: { district: { region: { tenantId } }, deletedAt: null },
    });
    if (!assembly) throw new Error('Aucune assemblée — lancez le seed');
    assemblyId = assembly.id;

    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    if (!superAdminRole) throw new Error('Rôle super_admin manquant — lancez le seed');

    const password = await hashPassword('Test@E2E2025!');
    const adminUser = await prisma.user.create({
      data: {
        email: `e2e_members_admin_${Date.now()}@test.com`,
        firstName: 'Members', lastName: 'E2E', password, status: 'ACTIVE', tenantId,
      },
    });
    adminUserId = adminUser.id;

    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: superAdminRole.id, tenantId, assignedBy: adminUser.id },
    });

    superAdminToken = signAccessToken(adminUser.id, adminUser.email);
  });

  afterAll(async () => {
    if (createdMemberId) {
      await prisma.member.deleteMany({ where: { id: createdMemberId } }).catch(() => {});
    }
    if (adminUserId) {
      await prisma.userRole.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
    }
  });

  describe('POST /api/v1/members', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).post('/api/v1/members').send({});
      expect(res.status).toBe(401);
    });

    it('should return 422 when required fields missing', async () => {
      const res = await request(app)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ firstName: 'Test' });

      expect(res.status).toBe(422);
    });

    it('should create member with auto-generated matricule', async () => {
      const res = await request(app)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName: 'Jean',
          lastName: 'DUPONT',
          gender: 'MALE',
          assemblyId,
          phone: '+237677111000',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.matricule).toBeDefined();
      expect(res.body.data.firstName).toBe('Jean');
      createdMemberId = res.body.data.id;
    });
  });

  describe('GET /api/v1/members', () => {
    it('should return paginated list', async () => {
      const res = await request(app)
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .query({ assemblyId });

      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should filter by gender', async () => {
      const res = await request(app)
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .query({ assemblyId, gender: 'MALE' });

      expect(res.status).toBe(200);
      expect(res.body.data.every((m: any) => m.gender === 'MALE')).toBe(true);
    });
  });

  describe('GET /api/v1/members/:id', () => {
    it('should return 404 for unknown id', async () => {
      const res = await request(app)
        .get('/api/v1/members/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(404);
    });

    it('should return member detail', async () => {
      const res = await request(app)
        .get(`/api/v1/members/${createdMemberId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdMemberId);
    });
  });

  describe('PATCH /api/v1/members/:id', () => {
    it('should update member phone', async () => {
      const res = await request(app)
        .patch(`/api/v1/members/${createdMemberId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ phone: '+237677222333' });

      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe('+237677222333');
    });
  });

  describe('DELETE /api/v1/members/:id', () => {
    it('should soft-delete member', async () => {
      const res = await request(app)
        .delete(`/api/v1/members/${createdMemberId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);

      const getRes = await request(app)
        .get(`/api/v1/members/${createdMemberId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(getRes.status).toBe(404);
      createdMemberId = '';
    });
  });
});
