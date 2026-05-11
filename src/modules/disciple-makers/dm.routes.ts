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
import { getScopedDiscipleMakerWhere } from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  memberId: z.string().uuid(),
  familyId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
  maxLoad: z.number().int().min(1).max(30).default(10),
});

const updateSchema = z.object({
  familyId: z.string().uuid().optional().nullable(),
  partnerId: z.string().uuid().optional().nullable(),
  maxLoad: z.number().int().min(1).max(30).optional(),
  isActive: z.boolean().optional(),
}).strict();

const makerInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true, photo: true } },
  family: { select: { id: true, name: true } },
  partner: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { primarySouls: true, secondarySouls: true } },
};

// GET /disciple-makers
router.get('/', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { familyId, isActive } = req.query as Record<string, string>;
    const scopeWhere = await getScopedDiscipleMakerWhere(req.user!);

    const where = {
      ...scopeWhere,
      ...(familyId && { familyId }),
      ...(isActive !== undefined && { isActive: isActive === 'true' }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.discipleMakerProfile.findMany({ where: where as any, include: makerInclude, skip, take: limit, orderBy: { startedAt: 'desc' } }),
      prisma.discipleMakerProfile.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /disciple-makers/:id
router.get('/:id', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), async (req, res, next) => {
  try {
    const maker = await prisma.discipleMakerProfile.findUnique({ where: { id: req.params['id'] }, include: makerInclude });
    if (!maker) throw new NotFoundError('Faiseur de disciples');
    sendSuccess(res, maker);
  } catch (err) { next(err); }
});

// POST /disciple-makers
router.post('/', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), validate(createSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const dto = req.body as z.infer<typeof createSchema>;
    const maker = await prisma.discipleMakerProfile.create({ data: { ...dto, tenantId }, include: makerInclude });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'DiscipleMakerProfile', entityId: maker.id, req });
    sendCreated(res, maker, 'Profil faiseur créé');
  } catch (err) { next(err); }
});

// PATCH /disciple-makers/:id
router.patch('/:id', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), validate(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.discipleMakerProfile.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Faiseur de disciples');
    const maker = await prisma.discipleMakerProfile.update({ where: { id: req.params['id'] }, data: req.body, include: makerInclude });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'DiscipleMakerProfile', entityId: maker.id, req });
    sendSuccess(res, maker, 'Profil mis à jour');
  } catch (err) { next(err); }
});

// GET /disciple-makers/:id/souls
router.get('/:id/souls', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const maker = await prisma.discipleMakerProfile.findUnique({ where: { id: req.params['id'] } });
    if (!maker) throw new NotFoundError('Faiseur de disciples');
    const [data, total] = await prisma.$transaction([
      prisma.newVisitor.findMany({
        where: { OR: [{ primaryMakerProfileId: req.params['id'] }, { secondaryMakerProfileId: req.params['id'] }], deletedAt: null },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      prisma.newVisitor.count({ where: { OR: [{ primaryMakerProfileId: req.params['id'] }, { secondaryMakerProfileId: req.params['id'] }], deletedAt: null } }),
    ]);
    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /disciple-makers/:id/kpis
router.get('/:id/kpis', requirePermission(PERMISSIONS.DISCIPLE_MAKERS_MANAGE), async (req, res, next) => {
  try {
    const maker = await prisma.discipleMakerProfile.findUnique({ where: { id: req.params['id'] } });
    if (!maker) throw new NotFoundError('Faiseur de disciples');

    const [primary, secondary, atRisk, consolidated] = await Promise.all([
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['id'], deletedAt: null } }),
      prisma.newVisitor.count({ where: { secondaryMakerProfileId: req.params['id'], deletedAt: null } }),
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['id'], status: 'AT_RISK', deletedAt: null } }),
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['id'], status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER'] }, deletedAt: null } }),
    ]);

    sendSuccess(res, {
      primarySouls: primary,
      secondarySouls: secondary,
      totalLoad: primary + secondary,
      maxLoad: maker.maxLoad,
      loadPercentage: maker.maxLoad > 0 ? ((primary / maker.maxLoad) * 100).toFixed(1) : 0,
      atRisk,
      consolidated,
    });
  } catch (err) { next(err); }
});

export default router;
