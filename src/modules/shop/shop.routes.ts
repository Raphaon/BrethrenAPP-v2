import { Router } from 'express';
import { DeliveryMethod, Prisma, ProductStatus, ProductType, ShopOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { getActorScope } from '../../utils/scope-access.util';
import { PERMISSIONS } from '../../shared/constants/permissions';
import type { AuthUser } from '../../shared/types/express';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createProductSchema = z.object({
  title: z.string().min(2).max(255),
  author: z.string().max(255).optional().nullable(),
  publisher: z.string().max(255).optional().nullable(),
  type: z.nativeEnum(ProductType),
  price: z.coerce.number().positive(),
  currency: z.string().length(3).default('XAF'),
  description: z.string().max(4000).optional().nullable(),
  coverUrl: z.string().url().optional().nullable(),
  stock: z.coerce.number().int().min(0).default(0),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.AVAILABLE),
  assemblyId: z.string().uuid().optional().nullable(),
});

const updateProductSchema = createProductSchema.partial();

const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.coerce.number().int().min(1),
    }),
  ).min(1),
  deliveryMethod: z.nativeEnum(DeliveryMethod).default(DeliveryMethod.PICKUP),
  deliveryAddress: z.string().max(500).optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(ShopOrderStatus),
  notes: z.string().max(500).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAdminUser(user: AuthUser) {
  return user.roles.some((r) => ['super_admin', 'national_admin', 'assembly_pastor', 'assembly_admin'].includes(r.role.name));
}

function serializeProduct(p: any) {
  return { ...p, price: p.price?.toString() };
}

function serializeOrder(o: any) {
  return {
    ...o,
    total: o.total?.toString(),
    items: (o.items ?? []).map((i: any) => ({
      ...i,
      unitPrice: i.unitPrice?.toString(),
      product: i.product ? serializeProduct(i.product) : undefined,
    })),
  };
}

function generateOrderRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /shop/products
router.get('/products', async (req, res, next) => {
  try {
    const { type, status, assemblyId, search } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    // Filtre tenant: isole les produits par organisation
    const scope = await getActorScope(req.user!);
    const tenantFilter: Prisma.ProductWhereInput =
      scope.kind === 'platform' ? {} :
      scope.kind === 'tenant' ? { assembly: { district: { region: { tenantId: scope.tenantId } } } } :
      scope.kind === 'region' ? { assembly: { district: { regionId: scope.regionId } } } :
      scope.kind === 'district' ? { assembly: { districtId: scope.districtId } } :
      scope.kind === 'assembly' ? { assemblyId: scope.assemblyId } :
      { assemblyId: 'NONE' };

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...tenantFilter,
      ...(type && { type: type as ProductType }),
      ...(status && { status: status as ProductStatus }),
      ...(assemblyId && { assemblyId }),
      ...(search && {
        OR: [
          { title: { contains: search } },
          { author: { contains: search } },
          { publisher: { contains: search } },
        ],
      }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        include: { assembly: { select: { id: true, name: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    sendPaginated(res, rows.map(serializeProduct), buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /shop/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    const scope = await getActorScope(req.user!);
    const tenantFilter: Prisma.ProductWhereInput =
      scope.kind === 'platform' ? {} :
      scope.kind === 'tenant' ? { assembly: { district: { region: { tenantId: scope.tenantId } } } } :
      scope.kind === 'region' ? { assembly: { district: { regionId: scope.regionId } } } :
      scope.kind === 'district' ? { assembly: { districtId: scope.districtId } } :
      scope.kind === 'assembly' ? { assemblyId: scope.assemblyId } :
      { assemblyId: 'NONE' };

    const product = await prisma.product.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...tenantFilter },
      include: { assembly: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundError('Produit');
    sendSuccess(res, serializeProduct(product));
  } catch (err) { next(err); }
});

// POST /shop/products (admin only)
router.post('/products', requirePermission(PERMISSIONS.SHOP_WRITE), validate(createProductSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createProductSchema>;
    const product = await prisma.product.create({
      data: { ...dto, price: dto.price },
      include: { assembly: { select: { id: true, name: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Product', entityId: product.id, newValues: product as any, req });
    sendCreated(res, serializeProduct(product), 'Produit créé');
  } catch (err) { next(err); }
});

// PATCH /shop/products/:id (admin only)
router.patch('/products/:id', requirePermission(PERMISSIONS.SHOP_WRITE), validate(updateProductSchema), async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Produit');
    const dto = req.body as z.infer<typeof updateProductSchema>;
    const updated = await prisma.product.update({
      where: { id: req.params['id'] },
      data: dto,
      include: { assembly: { select: { id: true, name: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Product', entityId: updated.id, oldValues: existing as any, newValues: updated as any, req });
    sendSuccess(res, serializeProduct(updated), 'Produit mis à jour');
  } catch (err) { next(err); }
});

// DELETE /shop/products/:id (admin only)
router.delete('/products/:id', requirePermission(PERMISSIONS.SHOP_WRITE), async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Produit');
    await prisma.product.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date(), status: ProductStatus.DISCONTINUED } });
    sendSuccess(res, null, 'Produit supprimé');
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════════════════════════

// GET /shop/orders — admins voient leur perimetre, membres voient leurs propres commandes
router.get('/orders', async (req, res, next) => {
  try {
    const user = req.user!;
    const { status, assemblyId } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const scope = await getActorScope(user);

    // Filtre territorial complet pour eviter les fuites cross-tenant
    const scopeFilter: Prisma.ShopOrderWhereInput = isAdminUser(user)
      ? scope.kind === 'platform' ? {}
      : scope.kind === 'tenant' ? { assembly: { district: { region: { tenantId: scope.tenantId } } } }
      : scope.kind === 'region' ? { assembly: { district: { regionId: (scope as any).regionId, region: { tenantId: scope.tenantId } } } }
      : scope.kind === 'district' ? { assembly: { districtId: (scope as any).districtId, district: { region: { tenantId: scope.tenantId } } } }
      : scope.kind === 'assembly' ? { assemblyId: (scope as any).assemblyId }
      : { assemblyId: 'NONE' }
      : { userId: user.id };

    const where: Prisma.ShopOrderWhereInput = {
      ...scopeFilter,
      ...(status && { status: status as ShopOrderStatus }),
      ...(assemblyId && isAdminUser(user) && { assemblyId }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.shopOrder.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          assembly: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, title: true, type: true } } } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.shopOrder.count({ where }),
    ]);

    sendPaginated(res, rows.map(serializeOrder), buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /shop/orders/:id
router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.shopOrder.findUnique({
      where: { id: req.params['id'] },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        assembly: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, title: true, type: true, author: true, coverUrl: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundError('Commande');
    if (!isAdminUser(req.user!) && order.userId !== req.user!.id) {
      throw new ForbiddenError('Acces refuse');
    }
    // Verifier l'isolation tenant pour les admins
    if (isAdminUser(req.user!) && order.assemblyId) {
      const scope = await getActorScope(req.user!);
      if (scope.kind !== 'platform') {
        const allowed = await prisma.shopOrder.findFirst({
          where: { id: order.id, ...(
            scope.kind === 'tenant' ? { assembly: { district: { region: { tenantId: scope.tenantId } } } } :
            scope.kind === 'region' ? { assembly: { district: { regionId: (scope as any).regionId } } } :
            scope.kind === 'district' ? { assembly: { districtId: (scope as any).districtId } } :
            scope.kind === 'assembly' ? { assemblyId: (scope as any).assemblyId } :
            { assemblyId: 'NONE' }
          )},
          select: { id: true },
        });
        if (!allowed) throw new ForbiddenError('Acces refuse');
      }
    }
    sendSuccess(res, serializeOrder(order));
  } catch (err) { next(err); }
});

// POST /shop/orders — create order from cart
router.post('/orders', validate(createOrderSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createOrderSchema>;
    const user = req.user!;

    // Dédupliquer les productIds (sécurité si le client envoie des doublons)
    const uniqueProductIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: uniqueProductIds }, deletedAt: null },
    });

    if (products.length !== uniqueProductIds.length) {
      throw new NotFoundError('Un ou plusieurs produits introuvables');
    }

    // Agréger les quantités si même produit en double dans la requête
    const aggregated = new Map<string, number>();
    for (const item of dto.items) {
      aggregated.set(item.productId, (aggregated.get(item.productId) ?? 0) + item.quantity);
    }
    const resolvedItems = [...aggregated.entries()].map(([productId, quantity]) => ({ productId, quantity }));

    // Pré-calcul du total et des lignes de commande (hors transaction, lecture non critique)
    let total = 0;
    const orderItems: Array<{ productId: string; quantity: number; unitPrice: number }> = [];

    for (const cartItem of resolvedItems) {
      const product = products.find((p) => p.id === cartItem.productId)!;
      if (product.status !== ProductStatus.AVAILABLE) {
        throw new ForbiddenError(`${product.title} n'est plus disponible`);
      }
      // Vérification préliminaire (optimiste) — la vérification atomique a lieu dans la transaction
      if (product.stock < cartItem.quantity) {
        throw new ForbiddenError(`Stock insuffisant pour "${product.title}" (disponible: ${product.stock})`);
      }
      const unitPrice = Number(product.price);
      total += unitPrice * cartItem.quantity;
      orderItems.push({ productId: cartItem.productId, quantity: cartItem.quantity, unitPrice });
    }

    // Create order + atomic stock decrement inside transaction
    const order = await prisma.$transaction(async (tx) => {
      // Décrémenter le stock de façon atomique : échoue si stock insuffisant
      for (const item of orderItems) {
        const affected = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity }, deletedAt: null },
          data: { stock: { decrement: item.quantity } },
        });
        if (affected.count === 0) {
          // Stock épuisé entre la lecture préliminaire et la transaction (concurrence)
          const p = products.find((pr) => pr.id === item.productId)!;
          throw new ForbiddenError(`Stock insuffisant pour "${p.title}" — réessayez`);
        }
      }

      const created = await tx.shopOrder.create({
        data: {
          reference: generateOrderRef(),
          userId: user.id,
          assemblyId: dto.assemblyId,
          total,
          currency: 'XAF',
          deliveryMethod: dto.deliveryMethod,
          deliveryAddress: dto.deliveryAddress,
          notes: dto.notes,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: { include: { product: { select: { id: true, title: true, type: true } } } },
          assembly: { select: { id: true, name: true } },
        },
      });

      return created;
    });

    await createAuditLog({ actorId: user.id, action: 'CREATE', entityType: 'ShopOrder', entityId: order.id, newValues: { reference: order.reference, total }, req });
    sendCreated(res, serializeOrder(order), `Commande ${order.reference} créée`);
  } catch (err) { next(err); }
});

// Transitions de statut valides pour les commandes
const ORDER_TRANSITIONS: Record<string, ShopOrderStatus[]> = {
  PENDING: [ShopOrderStatus.CONFIRMED, ShopOrderStatus.CANCELLED],
  CONFIRMED: [ShopOrderStatus.SHIPPED, ShopOrderStatus.CANCELLED],
  SHIPPED: [ShopOrderStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
};

// PATCH /shop/orders/:id/status (admin only)
router.patch('/orders/:id/status', requirePermission(PERMISSIONS.SHOP_ORDERS_WRITE), validate(updateOrderStatusSchema), async (req, res, next) => {
  try {
    const existing = await prisma.shopOrder.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Commande');

    const { status, notes } = req.body as z.infer<typeof updateOrderStatusSchema>;

    const allowed = ORDER_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ForbiddenError(
        `Transition invalide : ${existing.status} → ${status}. Transitions permises : ${allowed.join(', ') || 'aucune'}`,
      );
    }

    const updated = await prisma.shopOrder.update({
      where: { id: req.params['id'] },
      data: { status, ...(notes && { notes }) },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'ShopOrder', entityId: updated.id, oldValues: { status: existing.status }, newValues: { status }, req });
    sendSuccess(res, serializeOrder(updated), 'Statut de commande mis à jour');
  } catch (err) { next(err); }
});

// GET /shop/stats (admin)
router.get('/stats', requirePermission(PERMISSIONS.SHOP_ORDERS_READ), async (_req, res, next) => {
  try {
    const [totalProducts, totalOrders, pendingOrders, confirmedOrders] = await prisma.$transaction([
      prisma.product.count({ where: { deletedAt: null, status: ProductStatus.AVAILABLE } }),
      prisma.shopOrder.count(),
      prisma.shopOrder.count({ where: { status: ShopOrderStatus.PENDING } }),
      prisma.shopOrder.count({ where: { status: ShopOrderStatus.CONFIRMED } }),
    ]);
    sendSuccess(res, { totalProducts, totalOrders, pendingOrders, confirmedOrders });
  } catch (err) { next(err); }
});

export default router;
