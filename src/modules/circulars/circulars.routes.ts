import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { generateCircularReference } from '../../utils/matricule.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { createCommentsRouter } from '../comments/comments.routes';
import {
  assertCircularTargetScope,
  assertEntityMatchesScope,
  buildCircularVisibilityFilter,
} from '../../utils/scope-access.util';

const createCircularSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(10),
  level: z.enum(['NATIONAL', 'REGIONAL', 'DISTRICT']),
  regionId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  attachments: z.array(z.string()).optional(),
});

const router = Router();
router.use(authenticate);
router.use('/:id/comments', requirePermission(PERMISSIONS.CIRCULARS_READ), createCommentsRouter('circular'));

router.get('/', requirePermission(PERMISSIONS.CIRCULARS_READ), async (req, res, next) => {
  try {
    const { search, level, status, regionId, districtId } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const visibilityWhere = await buildCircularVisibilityFilter(req.user!);

    const where: Prisma.CircularWhereInput = {
      deletedAt: null,
      ...(level && { level }),
      ...(status && { status }),
      ...(regionId && { regionId }),
      ...(districtId && { districtId }),
      AND: [
        visibilityWhere,
        ...(search
          ? [{
              OR: [
                { title: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { reference: { contains: search, mode: Prisma.QueryMode.insensitive } },
              ],
            }]
          : []),
      ],
    };

    const [data, total] = await prisma.$transaction([
      prisma.circular.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          region: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.circular.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.CIRCULARS_READ), async (req, res, next) => {
  try {
    const visibilityWhere = await buildCircularVisibilityFilter(req.user!);
    const circular = await prisma.circular.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...visibilityWhere },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        region: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
      },
    });
    if (!circular) throw new NotFoundError('Circulaire');
    sendSuccess(res, circular);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.CIRCULARS_WRITE), validate(createCircularSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createCircularSchema>;
    assertEntityMatchesScope(dto);
    await assertCircularTargetScope(req.user!, dto);
    const reference = await generateCircularReference();

    const circular = await prisma.circular.create({
      data: { ...dto, tenantId: req.user!.tenantId, reference, authorId: req.user!.id },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Circular', entityId: circular.id, req });
    sendCreated(res, circular, 'Circulaire creee');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', requirePermission(PERMISSIONS.CIRCULARS_PUBLISH), async (req, res, next) => {
  try {
    const visibilityWhere = await buildCircularVisibilityFilter(req.user!);
    const existing = await prisma.circular.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Circulaire');
    if (existing.status !== 'DRAFT') throw new AppError('Seules les circulaires en brouillon peuvent etre publiees', 400, 'INVALID_STATUS');

    await assertCircularTargetScope(req.user!, existing);

    const circular = await prisma.circular.update({
      where: { id: req.params['id'] },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'PUBLISH', entityType: 'Circular', entityId: circular.id, req });
    sendSuccess(res, circular, 'Circulaire publiee');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.CIRCULARS_DELETE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildCircularVisibilityFilter(req.user!);
    const existing = await prisma.circular.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Circulaire');

    await assertCircularTargetScope(req.user!, existing);

    await prisma.circular.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Circulaire supprimee');
  } catch (err) {
    next(err);
  }
});

export default router;
