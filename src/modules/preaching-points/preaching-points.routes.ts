import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { requireAssemblyScope } from '../../middlewares/scope.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError } from '../../middlewares/error.middleware';
import {
  createPreachingPointSchema,
  updatePreachingPointSchema,
  CreatePreachingPointDto,
  UpdatePreachingPointDto,
} from './preaching-points.validation';
import {
  assertAssemblyAccess,
  getScopedPreachingPointWhere,
} from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.PREACHING_POINTS_READ), async (req, res, next) => {
  try {
    const { search, assemblyId, status, hasCoordinates } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const scopeWhere = await getScopedPreachingPointWhere(req.user!);

    const where: Prisma.PreachingPointWhereInput = {
      deletedAt: null,
      ...scopeWhere,
      ...(assemblyId && { assemblyId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(hasCoordinates === 'true' && { latitude: { not: null }, longitude: { not: null } }),
      ...(hasCoordinates === 'false' && { OR: [{ latitude: null }, { longitude: null }] }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.preachingPoint.findMany({
        where,
        include: { assembly: { select: { id: true, name: true } }, _count: { select: { members: true } } },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.preachingPoint.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.PREACHING_POINTS_READ), async (req, res, next) => {
  try {
    const pp = await prisma.preachingPoint.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        assembly: { select: { id: true, name: true } },
        members: { select: { id: true, firstName: true, lastName: true, matricule: true } },
      },
    });
    if (!pp) throw new NotFoundError('Point de preche');
    await assertAssemblyAccess(req.user!, pp.assemblyId);
    sendSuccess(res, pp);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.PREACHING_POINTS_WRITE), requireAssemblyScope, validate(createPreachingPointSchema), async (req, res, next) => {
  try {
    const dto = req.body as CreatePreachingPointDto;
    const assembly = await prisma.assembly.findUnique({ where: { id: dto.assemblyId, deletedAt: null } });
    if (!assembly) throw new NotFoundError('Assemblee');

    const pp = await prisma.preachingPoint.create({
      data: { ...dto, foundedAt: dto.foundedAt ? new Date(dto.foundedAt) : null },
      include: { assembly: { select: { id: true, name: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'PreachingPoint', entityId: pp.id, req });
    sendCreated(res, pp, 'Point de preche cree');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.PREACHING_POINTS_WRITE), validate(updatePreachingPointSchema), async (req, res, next) => {
  try {
    const dto = req.body as UpdatePreachingPointDto;
    const existing = await prisma.preachingPoint.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Point de preche');
    await assertAssemblyAccess(req.user!, existing.assemblyId);

    const pp = await prisma.preachingPoint.update({
      where: { id: req.params['id'] },
      data: { ...dto, foundedAt: dto.foundedAt ? new Date(dto.foundedAt) : undefined },
      include: { assembly: { select: { id: true, name: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'PreachingPoint', entityId: pp.id, req });
    sendSuccess(res, pp, 'Point de preche mis a jour');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.PREACHING_POINTS_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.preachingPoint.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Point de preche');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    await prisma.preachingPoint.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'PreachingPoint', entityId: req.params['id'], req });
    sendSuccess(res, null, 'Point de preche supprime');
  } catch (err) {
    next(err);
  }
});

export default router;
