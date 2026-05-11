import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { PlanCode } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { prisma } from '../../database/prisma';
import { sendSuccess } from '../../utils/response.util';
import { AppError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { planLimitService } from '../../services/plan-limit.service';
import { createAuditLog } from '../../utils/audit.util';
import { isTenantWideAdmin } from '../../middlewares/rbac.middleware';

const router = Router();

function requireBillingAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !isTenantWideAdmin(req.user)) {
    throw new ForbiddenError('Seuls les administrateurs de l’organisation peuvent gérer la formule.');
  }
  next();
}

// ─── GET /billing/plans — liste publique des plans ───────────────────────────

router.get('/plans', async (_req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: 'asc' },
    });
    sendSuccess(res, plans);
  } catch (err) {
    next(err);
  }
});

// ── Routes authentifiées ──────────────────────────────────────────────────────

router.use(authenticate);

// GET /billing/subscription — abonnement du tenant courant
router.get('/subscription', async (req, res, next) => {
  try {
    if (!req.user!.tenantId) throw new ForbiddenError('Aucune organisation associée à votre compte');
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: req.user!.tenantId },
      include: { plan: true },
    });
    sendSuccess(res, subscription);
  } catch (err) {
    next(err);
  }
});

// GET /billing/usage — utilisation actuelle du tenant
router.get('/usage', async (req, res, next) => {
  try {
    if (!req.user!.tenantId) throw new ForbiddenError('Aucune organisation associée à votre compte');
    const [usage, plan] = await Promise.all([
      planLimitService.getTenantUsage(req.user!.tenantId),
      planLimitService.getTenantPlan(req.user!.tenantId),
    ]);
    sendSuccess(res, { usage, plan });
  } catch (err) {
    next(err);
  }
});

// POST /billing/upgrade — changer de plan (upgrade ou downgrade)
const changePlanSchema = z.object({
  planCode: z.nativeEnum(PlanCode),
});

router.post('/upgrade', requireBillingAdmin, validate(changePlanSchema), async (req, res, next) => {
  try {
    if (!req.user!.tenantId) throw new ForbiddenError('Aucune organisation associée à votre compte');

    const { planCode } = req.body as z.infer<typeof changePlanSchema>;

    const newPlan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!newPlan || !newPlan.isActive) throw new NotFoundError('Formule');

    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: req.user!.tenantId },
      include: { plan: true },
    });
    if (!subscription) throw new AppError('Aucune formule active', 402, 'SUBSCRIPTION_REQUIRED');

    if (subscription.plan.code === planCode) {
      throw new AppError('Vous utilisez déjà cette formule', 400, 'SAME_PLAN');
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { planId: newPlan.id },
      include: { plan: true },
    });

    await createAuditLog({
      actorId: req.user!.id,
      tenantId: req.user!.tenantId,
      action: 'UPDATE',
      entityType: 'Subscription',
      entityId: updated.id,
      oldValues: { plan: subscription.plan.code },
      newValues: { plan: planCode },
      req,
    });

    sendSuccess(res, updated, `Formule mise à jour : ${newPlan.name}`);
  } catch (err) {
    next(err);
  }
});

// POST /billing/cancel — annuler l'abonnement (retour au Free)
router.post('/cancel', requireBillingAdmin, async (req, res, next) => {
  try {
    if (!req.user!.tenantId) throw new ForbiddenError('Aucune organisation associée à votre compte');

    const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) throw new AppError('Formule gratuite non configurée', 500, 'PLAN_NOT_CONFIGURED');

    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: req.user!.tenantId },
    });
    if (!subscription) throw new AppError('Aucune formule active', 402, 'SUBSCRIPTION_REQUIRED');

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { planId: freePlan.id, status: 'ACTIVE' },
      include: { plan: true },
    });

    await createAuditLog({
      actorId: req.user!.id,
      tenantId: req.user!.tenantId,
      action: 'UPDATE',
      entityType: 'Subscription',
      entityId: updated.id,
      newValues: { planId: freePlan.id, status: 'ACTIVE' },
      req,
    });

    sendSuccess(res, updated, 'Abonnement annule - retour au forfait gratuit');
  } catch (err) { next(err); }
});

export default router;
