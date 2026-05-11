import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hashPassword } from '../../src/utils/password.util';
import { signAccessToken } from '../../src/utils/jwt.util';

const app = createApp();

describe('Shop E2E', () => {
  let adminToken: string;
  let memberToken: string;
  let adminUserId: string;
  let memberUserId: string;
  let tenantId: string;
  let assemblyId: string;
  let productId: string;
  let createdOrderId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!tenant) throw new Error('Seed manquant');
    tenantId = tenant.id;

    const assembly = await prisma.assembly.findFirst({
      where: { district: { region: { tenantId } }, deletedAt: null },
    });
    assemblyId = assembly!.id;

    const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
    const memberRole = await prisma.role.findUnique({ where: { name: 'member' } });
    const pw = await hashPassword('Test@E2E2025!');

    // Admin
    const admin = await prisma.user.create({
      data: { email: `e2e_shop_admin_${Date.now()}@test.com`, firstName: 'Shop', lastName: 'Admin', password: pw, status: 'ACTIVE', tenantId },
    });
    adminUserId = admin.id;
    if (superAdminRole) await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole.id, tenantId, assignedBy: admin.id } });
    adminToken = signAccessToken(admin.id, admin.email);

    // Membre ordinaire
    const member = await prisma.user.create({
      data: { email: `e2e_shop_member_${Date.now()}@test.com`, firstName: 'Shop', lastName: 'Member', password: pw, status: 'ACTIVE', tenantId },
    });
    memberUserId = member.id;
    if (memberRole) await prisma.userRole.create({ data: { userId: member.id, roleId: memberRole.id, tenantId, assignedBy: admin.id } });
    memberToken = signAccessToken(member.id, member.email);

    // Produit de test
    const product = await prisma.product.create({
      data: {
        title: `E2E Bible ${Date.now()}`, type: 'BOOK', price: 10000, currency: 'XAF',
        stock: 5, status: 'AVAILABLE', assemblyId,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (createdOrderId) {
      await prisma.shopOrderItem.deleteMany({ where: { orderId: createdOrderId } });
      await prisma.shopOrder.delete({ where: { id: createdOrderId } }).catch(() => {});
    }
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    for (const uid of [adminUserId, memberUserId]) {
      await prisma.userRole.deleteMany({ where: { userId: uid } });
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
  });

  // ─── Products ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/shop/products', () => {
    it('should return 401 without token', async () => {
      expect((await request(app).get('/api/v1/shop/products')).status).toBe(401);
    });

    it('should list products', async () => {
      const res = await request(app)
        .get('/api/v1/shop/products')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should find specific product by id', async () => {
      const res = await request(app)
        .get(`/api/v1/shop/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(productId);
    });

    it('should return 404 for deleted product', async () => {
      const res = await request(app)
        .get('/api/v1/shop/products/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Orders ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/shop/orders', () => {
    it('should reject order with invalid productId', async () => {
      const res = await request(app)
        .post('/api/v1/shop/orders')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }] });
      expect([404, 422]).toContain(res.status);
    });

    it('should create order successfully', async () => {
      const res = await request(app)
        .post('/api/v1/shop/orders')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          items: [{ productId, quantity: 1 }],
          deliveryMethod: 'PICKUP',
          assemblyId,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.reference).toMatch(/^ORD-/);
      expect(res.body.data.total).toBeDefined();
      createdOrderId = res.body.data.id;
    });

    it('should decrement stock after order', async () => {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product?.stock).toBe(4); // Était 5, décrémenté de 1
    });

    it('should reject order when stock is insufficient', async () => {
      const res = await request(app)
        .post('/api/v1/shop/orders')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ items: [{ productId, quantity: 999 }], deliveryMethod: 'PICKUP' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/shop/orders', () => {
    it('should return orders for member (own orders only)', async () => {
      const res = await request(app)
        .get('/api/v1/shop/orders')
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      // Un membre ne voit que ses propres commandes
      const orders = res.body.data as any[];
      const foreign = orders.filter((o: any) => o.userId !== memberUserId);
      expect(foreign).toHaveLength(0);
    });

    it('admin should see all orders', async () => {
      const res = await request(app)
        .get('/api/v1/shop/orders')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ─── Order status ─────────────────────────────────────────────────────────

  describe('PATCH /api/v1/shop/orders/:id/status', () => {
    it('should confirm order (PENDING → CONFIRMED)', async () => {
      const res = await request(app)
        .patch(`/api/v1/shop/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CONFIRMED' });
      expect(res.status).toBe(200);
    });

    it('should reject invalid transition (CONFIRMED → PENDING)', async () => {
      const res = await request(app)
        .patch(`/api/v1/shop/orders/${createdOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PENDING' });
      expect(res.status).toBe(403);
    });
  });

  // ─── Shop stats ───────────────────────────────────────────────────────────

  describe('GET /api/v1/shop/stats', () => {
    it('should return shop statistics', async () => {
      const res = await request(app)
        .get('/api/v1/shop/stats')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.totalProducts).toBeDefined();
      expect(res.body.data.totalOrders).toBeDefined();
      expect(res.body.data.pendingOrders).toBeDefined();
    });
  });
});
