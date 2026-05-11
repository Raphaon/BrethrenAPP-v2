import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { getScopedTerritoryAccountWhere, assertTerritoryAccountAccess } from '../../utils/scope-access.util';


const createSchema = z.object({
  accountName: z.string().min(2),
  accountNumber: z.string().optional(),
  bankName: z.string().optional(),
  mobileMoneyNumber: z.string().optional(),
  currency: z.string().default('XAF'),
  regionId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
}).refine((d) => d.regionId ?? d.districtId ?? d.assemblyId, {
  message: 'Au moins un territoire (région, district ou assemblée) est requis',
});

const updateSchema = z.object({
  accountName: z.string().min(2).optional(),
  accountNumber: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  mobileMoneyNumber: z.string().optional().nullable(),
  currency: z.string().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
}).strict();

const adjustBalanceSchema = z.object({
  amount: z.number(),
  notes: z.string().optional(),
});

const territoryInclude = {
  region: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  assembly: { select: { id: true, name: true } },
};

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_READ), async (req, res, next) => {
  try {
    const { regionId, districtId, assemblyId, isActive } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const scopeWhere = await getScopedTerritoryAccountWhere(req.user!);

    const where = {
      ...scopeWhere,
      deletedAt: null,
      ...(regionId && { regionId }),
      ...(districtId && { districtId }),
      ...(assemblyId && { assemblyId }),
      ...(isActive !== undefined && { isActive: isActive === 'true' }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.territoryAccount.findMany({ where, include: territoryInclude, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.territoryAccount.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_READ), async (req, res, next) => {
  try {
    const account = await prisma.territoryAccount.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: territoryInclude,
    });
    if (!account) throw new NotFoundError('Compte territoire');
    await assertTerritoryAccountAccess(req.user!, account);
    sendSuccess(res, account);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_WRITE), validate(createSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createSchema>;
    const account = await prisma.territoryAccount.create({ data: dto, include: territoryInclude });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'TerritoryAccount', entityId: account.id, req });
    sendCreated(res, account, 'Compte créé');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_WRITE), validate(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.territoryAccount.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Compte territoire');
    const account = await prisma.territoryAccount.update({ where: { id: req.params['id'] }, data: req.body });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'TerritoryAccount', entityId: account.id, req });
    sendSuccess(res, account, 'Compte mis à jour');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/adjust', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_WRITE), validate(adjustBalanceSchema), async (req, res, next) => {
  try {
    const existing = await prisma.territoryAccount.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Compte territoire');
    const { amount } = req.body as z.infer<typeof adjustBalanceSchema>;
    const newBalance = Number(existing.balance) + amount;
    if (newBalance < 0) throw new AppError('Solde insuffisant', 400, 'INSUFFICIENT_BALANCE');
    const account = await prisma.territoryAccount.update({ where: { id: req.params['id'] }, data: { balance: newBalance } });
    await createAuditLog({
      actorId: req.user!.id,
      action: 'UPDATE',
      entityType: 'TerritoryAccount',
      entityId: account.id,
      oldValues: { balance: existing.balance },
      newValues: { balance: account.balance, adjustment: amount },
      req,
    });
    sendSuccess(res, account, 'Solde ajusté');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.TERRITORY_ACCOUNTS_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.territoryAccount.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Compte territoire');
    await prisma.territoryAccount.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Compte supprimé');
  } catch (err) {
    next(err);
  }
});

export default router;
