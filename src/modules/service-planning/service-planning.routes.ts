import crypto from 'crypto';
import { Router } from 'express';
import { Prisma, ServiceAssignmentStatus, ServicePlanStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { assertAssemblyAccess, getScopedAssemblyWhere } from '../../utils/scope-access.util';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createPlanSchema = z.object({
  title: z.string().min(2).max(200),
  assemblyId: z.string().uuid(),
  programId: z.string().uuid().optional().nullable(),
  date: z.string().datetime({ offset: true }).or(z.string().date()),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updatePlanSchema = createPlanSchema.partial().omit({ assemblyId: true });

const addAssignmentSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().min(1).max(100),
  notes: z.string().max(500).optional().nullable(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// ══════════════════════════════════════════════════════════════════════════════
// PLANS DE SERVICE
// ══════════════════════════════════════════════════════════════════════════════

// GET / — liste des plans de service
router.get('/', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const { assemblyId, status, from, to } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const scopedAssembly = await getScopedAssemblyWhere(req.user!);

    const where: Prisma.service_plansWhereInput = {
      deletedAt: null,
      assemblies: scopedAssembly,
      ...(assemblyId && { assemblyId }),
      ...(status && { status: status as ServicePlanStatus }),
      ...((from || to) && {
        date: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.service_plans.findMany({
        where,
        include: {
          assemblies: { select: { id: true, name: true } },
          programs: { select: { id: true, name: true } },
          users: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { service_assignments: true } },
        },
        skip,
        take: limit,
        orderBy: { date: 'asc' },
      }),
      prisma.service_plans.count({ where }),
    ]);

    sendPaginated(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/assignable-users', requirePermission(PERMISSIONS.EVENTS_WRITE), async (req, res, next) => {
  try {
    const { search } = req.query as { search?: string };
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      ...(req.user!.tenantId && { tenantId: req.user!.tenantId }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { firstName: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { lastName: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }),
    };

    const users = await prisma.user.findMany({
      where,
      select: { id: true, email: true, firstName: true, lastName: true, avatar: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 25,
    });

    sendSuccess(res, users);
  } catch (err) { next(err); }
});

// GET /:id — détail complet avec affectations
router.get('/:id', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const plan = await prisma.service_plans.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        assemblies: { select: { id: true, name: true } },
        programs: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
        service_assignments: {
          include: {
            users: { select: { id: true, email: true, firstName: true, lastName: true, avatar: true } },
          },
          orderBy: { role: 'asc' },
        },
      },
    });
    if (!plan) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, plan.assemblyId);
    sendSuccess(res, plan);
  } catch (err) { next(err); }
});

// POST / — créer un plan de service
router.post('/', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(createPlanSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createPlanSchema>;
    await assertAssemblyAccess(req.user!, dto.assemblyId);

    const plan = await prisma.service_plans.create({
      data: { id: crypto.randomUUID(), updatedAt: new Date(), ...dto, date: new Date(dto.date), createdById: req.user!.id },
      include: {
        assemblies: { select: { id: true, name: true } },
        programs: { select: { id: true, name: true } },
      },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'ServicePlan', entityId: plan.id, newValues: plan as any, req });
    sendCreated(res, plan, 'Plan de service créé');
  } catch (err) { next(err); }
});

// PATCH /:id — modifier
router.patch('/:id', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(updatePlanSchema), async (req, res, next) => {
  try {
    const existing = await prisma.service_plans.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, existing.assemblyId);

    const dto = req.body as z.infer<typeof updatePlanSchema>;
    const plan = await prisma.service_plans.update({
      where: { id: req.params['id'] },
      data: { updatedAt: new Date(), ...dto, ...(dto.date && { date: new Date(dto.date) }) },
      include: { assemblies: { select: { id: true, name: true } } },
    });
    sendSuccess(res, plan, 'Plan de service mis à jour');
  } catch (err) { next(err); }
});

// POST /:id/publish — publier (notifie les intervenants)
router.post('/:id/publish', requirePermission(PERMISSIONS.EVENTS_WRITE), async (req, res, next) => {
  try {
    const existing = await prisma.service_plans.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: { service_assignments: { include: { users: true } } },
    });
    if (!existing) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    if (existing.status !== ServicePlanStatus.DRAFT) throw new ForbiddenError('Seul un brouillon peut être publié');

    const plan = await prisma.service_plans.update({
      where: { id: existing.id },
      data: { status: ServicePlanStatus.PUBLISHED, updatedAt: new Date() },
    });

    // Créer une notification pour chaque intervenant
    const notifications = existing.service_assignments.map((a: { userId: string; role: string }) => ({
      userId: a.userId,
      title: 'Affectation de service',
      message: `Vous avez été affecté(e) au rôle "${a.role}" pour le service du ${existing.date.toLocaleDateString('fr-FR')}`,
      type: 'ASSIGNMENT' as const,
    }));

    if (notifications.length > 0) {
      await prisma.notification.createMany({ data: notifications });
    }

    sendSuccess(res, plan, `Plan publié — ${notifications.length} intervenant(s) notifié(s)`);
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', requirePermission(PERMISSIONS.EVENTS_WRITE), async (req, res, next) => {
  try {
    const existing = await prisma.service_plans.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    await prisma.service_plans.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date(), status: ServicePlanStatus.ARCHIVED } });
    sendSuccess(res, null, 'Plan de service supprimé');
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// AFFECTATIONS
// ══════════════════════════════════════════════════════════════════════════════

// POST /:id/assignments — affecter un intervenant
router.post('/:id/assignments', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(addAssignmentSchema), async (req, res, next) => {
  try {
    const plan = await prisma.service_plans.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!plan) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, plan.assemblyId);

    const { userId, role, notes } = req.body as z.infer<typeof addAssignmentSchema>;

    const user = await prisma.user.findFirst({ where: { id: userId, tenantId: req.user!.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundError('Utilisateur');

    const assignment = await prisma.service_assignments.upsert({
      where: { servicePlanId_userId_role: { servicePlanId: plan.id, userId, role } },
      update: { status: ServiceAssignmentStatus.PENDING, notes: notes ?? null, updatedAt: new Date() },
      create: { id: crypto.randomUUID(), updatedAt: new Date(), servicePlanId: plan.id, userId, role, notes: notes ?? null },
      include: { users: { select: { id: true, firstName: true, lastName: true } } },
    });

    sendCreated(res, assignment, 'Intervenant affecté');
  } catch (err) { next(err); }
});

// DELETE /:id/assignments/:assignmentId — retirer une affectation
router.delete('/:id/assignments/:assignmentId', requirePermission(PERMISSIONS.EVENTS_WRITE), async (req, res, next) => {
  try {
    const plan = await prisma.service_plans.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!plan) throw new NotFoundError('Plan de service');
    await assertAssemblyAccess(req.user!, plan.assemblyId);

    await prisma.service_assignments.delete({ where: { id: req.params['assignmentId'] } });
    sendSuccess(res, null, 'Affectation retirée');
  } catch (err) { next(err); }
});

// PATCH /assignments/:assignmentId/respond — confirmer ou refuser sa propre affectation
router.patch('/assignments/:assignmentId/respond', async (req, res, next) => {
  try {
    const { status } = req.body as { status: 'CONFIRMED' | 'DECLINED' };
    if (!['CONFIRMED', 'DECLINED'].includes(status)) throw new ForbiddenError('Statut invalide');

    const assignment = await prisma.service_assignments.findUnique({
      where: { id: req.params['assignmentId'] },
      include: { service_plans: true },
    });
    if (!assignment) throw new NotFoundError('Affectation');
    if (assignment.userId !== req.user!.id) throw new ForbiddenError('Vous ne pouvez répondre qu\'à vos propres affectations');

    const updated = await prisma.service_assignments.update({
      where: { id: assignment.id },
      data: { status: status as ServiceAssignmentStatus },
    });

    sendSuccess(res, updated, 'Statut mis a jour');
  } catch (err) { next(err); }
});

export default router;
