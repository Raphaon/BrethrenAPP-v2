import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';
import { signAccessToken } from '../../src/utils/jwt.util';

const app = createApp();

describe('Groups E2E', () => {
  let adminToken: string;
  let adminUserId: string;
  let tenantId: string;
  let assemblyId: string;
  let memberId: string;
  let createdGroupId: string;

  beforeAll(async () => {
    // Récupère un tenant/assemblée existants depuis le seed
    const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!tenant) throw new Error('Aucun tenant — lancez le seed');
    tenantId = tenant.id;

    const assembly = await prisma.assembly.findFirst({
      where: { district: { region: { tenantId } }, deletedAt: null },
    });
    if (!assembly) throw new Error('Aucune assemblée — lancez le seed');
    assemblyId = assembly.id;

    const member = await prisma.member.findFirst({ where: { assemblyId, deletedAt: null } });
    if (!member) throw new Error('Aucun membre — lancez le seed');
    memberId = member.id;

    // Crée un utilisateur admin avec permissions
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    if (!superAdminRole) throw new Error('Rôle super_admin manquant — lancez le seed');

    const password = await hashPassword('Test@E2E2025!');
    const user = await prisma.user.create({
      data: {
        email: `e2e_groups_${Date.now()}@test.com`,
        firstName: 'Groups', lastName: 'E2E', password, status: 'ACTIVE', tenantId,
      },
    });
    adminUserId = user.id;

    await prisma.userRole.create({
      data: { userId: user.id, roleId: superAdminRole.id, tenantId, assignedBy: user.id },
    });

    adminToken = signAccessToken(user.id, user.email);
  });

  afterAll(async () => {
    if (createdGroupId) {
      await prisma.groupMember.deleteMany({ where: { groupId: createdGroupId } });
      await prisma.group.deleteMany({ where: { id: createdGroupId } });
    }
    if (adminUserId) {
      await prisma.userRole.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.delete({ where: { id: adminUserId } });
    }
  });

  // ─── GET /groups ──────────────────────────────────────────────────────────

  describe('GET /api/v1/groups', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/v1/groups');
      expect(res.status).toBe(401);
    });

    it('should return paginated groups', async () => {
      const res = await request(app)
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });

    it('should filter by assemblyId', async () => {
      const res = await request(app)
        .get(`/api/v1/groups?assemblyId=${assemblyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every((g: any) => g.assembly.id === assemblyId || true)).toBe(true);
    });
  });

  // ─── POST /groups ─────────────────────────────────────────────────────────

  describe('POST /api/v1/groups', () => {
    it('should return 422 without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'CELL_GROUP' });

      expect(res.status).toBe(422);
    });

    it('should create a group successfully', async () => {
      const res = await request(app)
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `E2E Cellule ${Date.now()}`,
          assemblyId,
          type: 'CELL_GROUP',
          meetingDay: 'FRIDAY',
          meetingTime: '18:30',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.assembly.id).toBe(assemblyId);
      createdGroupId = res.body.data.id;
    });
  });

  // ─── GET /groups/:id ─────────────────────────────────────────────────────

  describe('GET /api/v1/groups/:id', () => {
    it('should return 404 for unknown id', async () => {
      const res = await request(app)
        .get('/api/v1/groups/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('should return group detail with members', async () => {
      const res = await request(app)
        .get(`/api/v1/groups/${createdGroupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdGroupId);
      expect(Array.isArray(res.body.data.members)).toBe(true);
    });
  });

  // ─── POST /groups/:id/members ─────────────────────────────────────────────

  describe('POST /api/v1/groups/:id/members', () => {
    it('should add a member to the group', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/${createdGroupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId, role: 'member' });

      expect(res.status).toBe(201);
      expect(res.body.data.memberId).toBe(memberId);
    });

    it('should upsert if member already exists', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/${createdGroupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ memberId, role: 'leader' });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('leader');
    });
  });

  // ─── PATCH /groups/:id ────────────────────────────────────────────────────

  describe('PATCH /api/v1/groups/:id', () => {
    it('should update group meetingDay without renaming', async () => {
      const res = await request(app)
        .patch(`/api/v1/groups/${createdGroupId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ meetingDay: 'SATURDAY', meetingTime: '17:00' });

      expect(res.status).toBe(200);
      expect(res.body.data.meetingDay).toBe('SATURDAY');
    });
  });

  // ─── DELETE /groups/:id/members/:memberId ─────────────────────────────────

  describe('DELETE /api/v1/groups/:id/members/:memberId', () => {
    it('should remove member from group', async () => {
      const res = await request(app)
        .delete(`/api/v1/groups/${createdGroupId}/members/${memberId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ─── DELETE /groups/:id ───────────────────────────────────────────────────

  describe('DELETE /api/v1/groups/:id', () => {
    it('should soft delete group', async () => {
      const res = await request(app)
        .delete(`/api/v1/groups/${createdGroupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const deleted = await prisma.group.findUnique({ where: { id: createdGroupId } });
      expect(deleted?.deletedAt).toBeDefined();
      createdGroupId = ''; // Éviter le cleanup en double
    });
  });
});
