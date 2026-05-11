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
import { getScopedFamilyWhere } from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  assemblyId: z.string().uuid(),
  name: z.string().min(2),
  description: z.string().optional(),
  leaderId: z.string().uuid(),
  deputyLeaderId: z.string().uuid().optional(),
  supervisorId: z.string().uuid().optional(),
  goal: z.number().int().min(1).default(10),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  leaderId: z.string().uuid().optional(),
  deputyLeaderId: z.string().uuid().optional().nullable(),
  supervisorId: z.string().uuid().optional().nullable(),
  goal: z.number().int().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISSOLVED']).optional(),
}).strict();

const fdInclude = {
  assembly: { select: { id: true, name: true } },
  leader: { select: { id: true, firstName: true, lastName: true } },
  deputy: { select: { id: true, firstName: true, lastName: true } },
  supervisor: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { souls: true, makers: true } },
};

// GET /families-of-disciples
router.get('/', requirePermission(PERMISSIONS.FD_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { assemblyId, status } = req.query as Record<string, string>;
    const scopeWhere = await getScopedFamilyWhere(req.user!);

    const where = {
      ...scopeWhere,
      deletedAt: null,
      ...(assemblyId && { assemblyId }),
      ...(status && { status }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.familyOfDisciples.findMany({ where: where as any, include: fdInclude, skip, take: limit, orderBy: { name: 'asc' } }),
      prisma.familyOfDisciples.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /families-of-disciples/:id
router.get('/:id', requirePermission(PERMISSIONS.FD_READ), async (req, res, next) => {
  try {
    const fd = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null }, include: fdInclude });
    if (!fd) throw new NotFoundError('Famille de disciples');
    sendSuccess(res, fd);
  } catch (err) { next(err); }
});

// POST /families-of-disciples
router.post('/', requirePermission(PERMISSIONS.FD_WRITE), validate(createSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const dto = req.body as z.infer<typeof createSchema>;
    const fd = await prisma.familyOfDisciples.create({ data: { ...dto, tenantId }, include: fdInclude });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'FamilyOfDisciples', entityId: fd.id, req });
    sendCreated(res, fd, 'Famille de disciples créée');
  } catch (err) { next(err); }
});

// PATCH /families-of-disciples/:id
router.patch('/:id', requirePermission(PERMISSIONS.FD_WRITE), validate(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Famille de disciples');
    const fd = await prisma.familyOfDisciples.update({ where: { id: req.params['id'] }, data: req.body, include: fdInclude });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'FamilyOfDisciples', entityId: fd.id, req });
    sendSuccess(res, fd, 'Famille mise à jour');
  } catch (err) { next(err); }
});

// DELETE /families-of-disciples/:id
router.delete('/:id', requirePermission(PERMISSIONS.FD_MANAGE), async (req, res, next) => {
  try {
    const existing = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Famille de disciples');
    await prisma.familyOfDisciples.update({ where: { id: req.params['id'] }, data: { status: 'DISSOLVED', deletedAt: new Date() } });
    sendSuccess(res, null, 'Famille archivée');
  } catch (err) { next(err); }
});

// GET /families-of-disciples/:id/souls
router.get('/:id/souls', requirePermission(PERMISSIONS.FD_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const fd = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!fd) throw new NotFoundError('Famille de disciples');
    const [data, total] = await prisma.$transaction([
      prisma.newVisitor.findMany({ where: { familyOfDisciplesId: req.params['id'], deletedAt: null }, skip, take: limit, orderBy: { lastName: 'asc' } }),
      prisma.newVisitor.count({ where: { familyOfDisciplesId: req.params['id'], deletedAt: null } }),
    ]);
    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /families-of-disciples/:id/makers
router.get('/:id/makers', requirePermission(PERMISSIONS.FD_READ), async (req, res, next) => {
  try {
    const fd = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!fd) throw new NotFoundError('Famille de disciples');
    const makers = await prisma.discipleMakerProfile.findMany({
      where: { familyId: req.params['id'] },
      include: { member: { select: { id: true, firstName: true, lastName: true, phone: true } }, _count: { select: { primarySouls: true } } },
    });
    sendSuccess(res, makers);
  } catch (err) { next(err); }
});

// GET /families-of-disciples/:id/kpis
router.get('/:id/kpis', requirePermission(PERMISSIONS.FD_READ), async (req, res, next) => {
  try {
    const fd = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!fd) throw new NotFoundError('Famille de disciples');

    const [totalSouls, atRisk, consolidated, makers] = await Promise.all([
      prisma.newVisitor.count({ where: { familyOfDisciplesId: req.params['id'], deletedAt: null } }),
      prisma.newVisitor.count({ where: { familyOfDisciplesId: req.params['id'], status: 'AT_RISK', deletedAt: null } }),
      prisma.newVisitor.count({ where: { familyOfDisciplesId: req.params['id'], status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER'] }, deletedAt: null } }),
      prisma.discipleMakerProfile.count({ where: { familyId: req.params['id'], isActive: true } }),
    ]);

    sendSuccess(res, {
      totalSouls,
      atRisk,
      consolidated,
      makers,
      retentionRate: totalSouls > 0 ? ((totalSouls - atRisk) / totalSouls * 100).toFixed(1) : 0,
      goal: fd.goal,
      goalProgress: fd.goal > 0 ? (totalSouls / fd.goal * 100).toFixed(1) : 0,
    });
  } catch (err) { next(err); }
});

export default router;
