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
  reason: z.string().min(5),
  assignedToId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  assignedToId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
}).strict();

const closeSchema = z.object({
  decision: z.enum(['REINTEGRATED', 'EXTENDED', 'LONG_TERM', 'REMOVED']),
  notes: z.string().optional(),
});

const caseInclude = {
  soul: { select: { id: true, firstName: true, lastName: true, status: true } },
  openedBy: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  closedBy: { select: { id: true, firstName: true, lastName: true } },
};

// GET /recovery-cases
router.get('/', requirePermission(PERMISSIONS.TASK_FORCE_MANAGE), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { status, soulId } = req.query as Record<string, string>;
    const tenantId = req.user!.tenantId;

    const where: Record<string, unknown> = {
      ...(tenantId && { tenantId }),
      ...(status && { status }),
      ...(soulId && { soulId }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.recoveryCase.findMany({ where: where as any, include: caseInclude, skip, take: limit, orderBy: { openedAt: 'desc' } }),
      prisma.recoveryCase.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// POST /recovery-cases
router.post('/', requirePermission(PERMISSIONS.TASK_FORCE_MANAGE), validate(createSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createSchema>;
    const soul = await prisma.newVisitor.findUnique({ where: { id: dto.soulId, deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');

    const openCase = await prisma.recoveryCase.findFirst({ where: { soulId: dto.soulId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (openCase) throw new AppError('Un cas est déjà ouvert pour cette âme', 409, 'CASE_ALREADY_OPEN');

    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const newCase = await prisma.recoveryCase.create({
      data: { ...dto, tenantId, openedById: req.user!.id },
      include: caseInclude,
    });

    await prisma.newVisitor.update({ where: { id: dto.soulId }, data: { status: 'TASK_FORCE' } });
    sendCreated(res, newCase, 'Cas ouvert');
  } catch (err) { next(err); }
});

// PATCH /recovery-cases/:id
router.patch('/:id', requirePermission(PERMISSIONS.TASK_FORCE_MANAGE), validate(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.recoveryCase.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Cas');
    if (existing.status === 'CLOSED') throw new AppError('Ce cas est déjà clôturé', 400, 'CASE_CLOSED');
    const updated = await prisma.recoveryCase.update({ where: { id: req.params['id'] }, data: req.body, include: caseInclude });
    sendSuccess(res, updated, 'Cas mis à jour');
  } catch (err) { next(err); }
});

// POST /recovery-cases/:id/close
router.post('/:id/close', requirePermission(PERMISSIONS.TASK_FORCE_MANAGE), validate(closeSchema), async (req, res, next) => {
  try {
    const existing = await prisma.recoveryCase.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Cas');
    if (existing.status === 'CLOSED') throw new AppError('Ce cas est déjà clôturé', 400, 'CASE_CLOSED');

    const { decision, notes } = req.body as z.infer<typeof closeSchema>;
    const newCase = await prisma.recoveryCase.update({
      where: { id: req.params['id'] },
      data: { status: 'CLOSED', decision, notes, closedAt: new Date(), closedById: req.user!.id },
      include: caseInclude,
    });

    const newStatus = decision === 'REINTEGRATED' ? 'RETURNED_ONCE' : decision === 'REMOVED' ? 'LOST' : 'AT_RISK';
    await prisma.newVisitor.update({ where: { id: existing.soulId }, data: { status: newStatus } });

    sendSuccess(res, newCase, 'Cas clôturé');
  } catch (err) { next(err); }
});

export default router;
