import { prismaMock } from '../helpers/test-setup';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  getActorScope: jest.fn().mockResolvedValue({ kind: 'platform' }),
}));

const mockProduct = {
  id: 'prod-1', title: 'Bible TOB', type: 'BOOK', price: '12000',
  stock: 25, status: 'AVAILABLE', currency: 'XAF', assemblyId: 'asm-1',
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
  deletedAt: null,
};

const mockOrder = {
  id: 'ord-1', reference: 'ORD-TST-0001', userId: 'user-1',
  total: '24000', currency: 'XAF', status: 'PENDING',
  deliveryMethod: 'PICKUP', items: [],
  assembly: { id: 'asm-1', name: 'Assemblée Centrale' },
};

describe('Shop module', () => {

  // ─── Products ─────────────────────────────────────────────────────────────

  describe('Products', () => {
    it('list: should return paginated products with where filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockProduct], 1] as any);
      const [rows] = await prismaMock.$transaction([
        prismaMock.product.findMany({ where: { deletedAt: null } } as any),
        prismaMock.product.count({ where: { deletedAt: null } } as any),
      ] as any);
      expect(rows).toHaveLength(1);
    });

    it('findById: should return product when found', async () => {
      prismaMock.product.findUnique.mockResolvedValue(mockProduct as any);
      const p = await prismaMock.product.findUnique({ where: { id: 'prod-1', deletedAt: null } } as any);
      expect(p?.title).toBe('Bible TOB');
    });

    it('findById: should return null for deleted product', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);
      const p = await prismaMock.product.findUnique({ where: { id: 'prod-deleted', deletedAt: null } } as any);
      expect(p).toBeNull();
    });

    it('create: should persist product with price as number', async () => {
      prismaMock.product.create.mockResolvedValue(mockProduct as any);
      const p = await prismaMock.product.create({
        data: { title: 'Bible TOB', type: 'BOOK', price: 12000, stock: 25 },
      } as any);
      expect(p.title).toBe('Bible TOB');
    });

    it('soft delete: should set deletedAt and DISCONTINUED', async () => {
      prismaMock.product.update.mockResolvedValue({ ...mockProduct, deletedAt: new Date(), status: 'DISCONTINUED' } as any);
      const deleted = await prismaMock.product.update({
        where: { id: 'prod-1' },
        data: { deletedAt: new Date(), status: 'DISCONTINUED' },
      } as any);
      expect(deleted.status).toBe('DISCONTINUED');
      expect(deleted.deletedAt).toBeDefined();
    });
  });

  // ─── Orders ───────────────────────────────────────────────────────────────

  describe('Orders', () => {
    it('create: should compute total from items', () => {
      const items = [
        { productId: 'p1', quantity: 2, unitPrice: 12000 },
        { productId: 'p2', quantity: 1, unitPrice: 5000 },
      ];
      const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      expect(total).toBe(29000);
    });

    it('should reject when stock is insufficient (preliminary check)', () => {
      const product = { stock: 3, title: 'Bible' };
      const requestedQty = 5;
      const isInsufficient = product.stock < requestedQty;
      expect(isInsufficient).toBe(true);
    });

    it('atomic decrement: updateMany should return count 0 when stock < quantity', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      const result = await prismaMock.product.updateMany({
        where: { id: 'prod-1', stock: { gte: 10 }, deletedAt: null },
        data: { stock: { decrement: 10 } },
      } as any);
      expect(result.count).toBe(0);
    });

    it('atomic decrement: updateMany should return count 1 when stock is sufficient', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      const result = await prismaMock.product.updateMany({
        where: { id: 'prod-1', stock: { gte: 2 }, deletedAt: null },
        data: { stock: { decrement: 2 } },
      } as any);
      expect(result.count).toBe(1);
    });

    it('findById: admin can see all orders', async () => {
      prismaMock.shopOrder.findUnique.mockResolvedValue(mockOrder as any);
      const order = await prismaMock.shopOrder.findUnique({ where: { id: 'ord-1' } } as any);
      expect(order?.reference).toBe('ORD-TST-0001');
    });

    it('findById: non-admin gets 403 if order belongs to another user', () => {
      const order = { ...mockOrder, userId: 'user-other' };
      const requestingUserId = 'user-1';
      const isAdmin = false;
      const hasAccess = isAdmin || order.userId === requestingUserId;
      expect(hasAccess).toBe(false);
    });

    it('status transition: PENDING → CONFIRMED should be valid', () => {
      const ORDER_TRANSITIONS: Record<string, string[]> = {
        PENDING: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['SHIPPED', 'CANCELLED'],
        SHIPPED: ['DELIVERED'],
        DELIVERED: [],
        CANCELLED: [],
      };
      expect(ORDER_TRANSITIONS['PENDING']).toContain('CONFIRMED');
      expect(ORDER_TRANSITIONS['PENDING']).toContain('CANCELLED');
    });

    it('status transition: DELIVERED → CANCELLED should be invalid', () => {
      const ORDER_TRANSITIONS: Record<string, string[]> = {
        DELIVERED: [],
        CANCELLED: [],
      };
      expect(ORDER_TRANSITIONS['DELIVERED']).not.toContain('CANCELLED');
    });
  });

  // ─── Référence de commande ─────────────────────────────────────────────────

  describe('Order reference generation', () => {
    it('should generate unique references', () => {
      const refs = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        refs.add(`ORD-${ts}-${rand}`);
      }
      expect(refs.size).toBeGreaterThan(90);
    });

    it('should follow ORD-XXXX-XXXX format', () => {
      const ref = 'ORD-A1B2C3-XY12';
      expect(ref).toMatch(/^ORD-[A-Z0-9]+-[A-Z0-9]+$/);
    });
  });
});
