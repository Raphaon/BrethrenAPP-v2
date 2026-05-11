import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';

const app = createApp();

/**
 * Tests de contrôle d'accès hiérarchique
 */
describe('Access Control E2E', () => {
  let superAdminToken: string;
  let memberToken: string;
  let regionId: string;

  beforeAll(async () => {
    const password = await hashPassword('Test@12345');

    // Créer un super admin
    const superAdmin = await prisma.user.create({
      data: { email: `e2e_superadmin_${Date.now()}@test.com`, firstName: 'Super', lastName: 'Admin', password, status: 'ACTIVE' },
    });
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    if (superAdminRole) {
      await prisma.userRole.create({ data: { userId: superAdmin.id, roleId: superAdminRole.id } });
    }

    // Créer un membre sans permissions
    const memberUser = await prisma.user.create({
      data: { email: `e2e_member_${Date.now()}@test.com`, firstName: 'Regular', lastName: 'Member', password, status: 'ACTIVE' },
    });
    const memberRole = await prisma.role.findUnique({ where: { name: 'member' } });
    if (memberRole) {
      await prisma.userRole.create({ data: { userId: memberUser.id, roleId: memberRole.id } });
    }

    // Login
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdmin.email, password: 'Test@12345' });
    superAdminToken = adminLogin.body.data.accessToken;

    const memberLogin = await request(app).post('/api/v1/auth/login').send({ email: memberUser.email, password: 'Test@12345' });
    memberToken = memberLogin.body.data.accessToken;

    // Créer une région pour les tests
    const regionRes = await request(app)
      .post('/api/v1/regions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: `Test Region ${Date.now()}` });
    regionId = regionRes.body.data?.id;
  });

  afterAll(async () => {
    if (regionId) {
      await prisma.region.delete({ where: { id: regionId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Super Admin access', () => {
    it('should access all regions', async () => {
      const res = await request(app)
        .get('/api/v1/regions')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should access audit logs', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Regular member access control', () => {
    it('should be denied to create regions (403)', async () => {
      const res = await request(app)
        .post('/api/v1/regions')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Unauthorized Region' });

      expect(res.status).toBe(403);
    });

    it('should be denied to delete users (403)', async () => {
      const res = await request(app)
        .delete('/api/v1/users/some-id')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });

    it('should be denied to access audit logs (403)', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Unauthenticated access', () => {
    it('should be denied without token (401)', async () => {
      const res = await request(app).get('/api/v1/members');
      expect(res.status).toBe(401);
    });

    it('should be denied with invalid token (401)', async () => {
      const res = await request(app)
        .get('/api/v1/members')
        .set('Authorization', 'Bearer invalid_token_here');

      expect(res.status).toBe(401);
    });
  });
});
