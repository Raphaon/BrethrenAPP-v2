import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  soulId: z.string().uuid(),
  assignedToId: z.string().uuid(),
  type: z.enum(['CALL', 'VISIT', 'WAKE_UP_CALL', 'REMINDER', 'LESSON', 'FD_INVITE', 'OTHER']).default('CALL'),
  dueAt: z.string(),
  notes: z.string().optional(),
});

const taskInclude = {
  soul: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

// GET /follow-up-tasks
router.get('/', requirePermission(PERMISSIONS.FOLLOWUPS_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { soulId, assignedToId, status, overdue } = req.query as Record<string, string>;
    const tenantId = req.user!.tenantId;

    const where: Record<string, unknown> = {
      ...(tenantId && { tenantId }),
      ...(soulId && { soulId }),
      ...(status && { status }),
      ...(assignedToId && { assignedToId }),
      ...(overdue === 'true' ? { dueAt: { lt: new Date() }, status: { in: ['PENDING', 'IN_PROGRESS'] } } : {}),
    };

    // Non-admins see only their own tasks
    const adminRoles = ['super_admin', 'tenant_admin', 'assembly_pastor', 'assembly_admin'];
    const isAdmin = req.user!.roles?.some((ur) => adminRoles.includes(ur.role.name));
    if (!isAdmin) {
      where['assignedToId'] = req.user!.id;
    }

    const [data, total] = await prisma.$transaction([
      prisma.followUpTask.findMany({ where: where as any, include: taskInclude, skip, take: limit, orderBy: { dueAt: 'asc' } }),
      prisma.followUpTask.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// POST /follow-up-tasks
router.post('/', requirePermission(PERMISSIONS.FOLLOWUPS_WRITE), validate(createSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const dto = req.body as z.infer<typeof createSchema>;
    const soul = await prisma.newVisitor.findUnique({ where: { id: dto.soulId, deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');

    const task = await prisma.followUpTask.create({
      data: { ...dto, tenantId, dueAt: new Date(dto.dueAt), createdById: req.user!.id },
      include: taskInclude,
    });
    sendCreated(res, task, 'Tâche créée');
  } catch (err) { next(err); }
});

// PATCH /follow-up-tasks/:id/complete
router.patch('/:id/complete', requirePermission(PERMISSIONS.FOLLOWUPS_WRITE), async (req, res, next) => {
  try {
    const task = await prisma.followUpTask.findUnique({ where: { id: req.params['id'] } });
    if (!task) throw new NotFoundError('Tâche');
    const { notes } = z.object({ notes: z.string().optional() }).parse(req.body);
    const updated = await prisma.followUpTask.update({
      where: { id: req.params['id'] },
      data: { status: 'DONE', completedAt: new Date(), ...(notes ? { notes } : {}) },
      include: taskInclude,
    });
    sendSuccess(res, updated, 'Tâche terminée');
  } catch (err) { next(err); }
});

// DELETE /follow-up-tasks/:id
router.delete('/:id', requirePermission(PERMISSIONS.FOLLOWUPS_WRITE), async (req, res, next) => {
  try {
    const task = await prisma.followUpTask.findUnique({ where: { id: req.params['id'] } });
    if (!task) throw new NotFoundError('Tâche');
    await prisma.followUpTask.update({ where: { id: req.params['id'] }, data: { status: 'CANCELLED' } });
    sendSuccess(res, null, 'Tâche annulée');
  } catch (err) { next(err); }
});

export default router;
