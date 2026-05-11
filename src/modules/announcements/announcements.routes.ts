import { Router } from 'express';
import { Prisma, AnnouncementLevel, AnnouncementStatus } from '@prisma/client';
import { z } from 'zod';
import { flexDateOptional } from '../../utils/zod.util';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { notifyUsers } from '../../utils/notify.util';
import { createCommentsRouter } from '../comments/comments.routes';
import {
  assertAnnouncementTargetScope,
  assertEntityMatchesScope,
  buildAnnouncementVisibilityFilter,
} from '../../utils/scope-access.util';

const createAnnouncementSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(10),
  level: z.nativeEnum(AnnouncementLevel),
  regionId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable(),
  ministryId: z.string().uuid().optional().nullable(),
  expiresAt: flexDateOptional,
  scheduledAt: flexDateOptional,
  attachments: z.array(z.string()).optional(),
});

const updateAnnouncementSchema = z.object({
  title: z.string().min(3).optional(),
  content: z.string().min(10).optional(),
  expiresAt: flexDateOptional,
  scheduledAt: flexDateOptional,
  attachments: z.array(z.string()).optional(),
}).strict();

const router = Router();
router.use(authenticate);
router.use('/:id/comments', requirePermission(PERMISSIONS.ANNOUNCEMENTS_READ), createCommentsRouter('announcement'));

router.get('/', requirePermission(PERMISSIONS.ANNOUNCEMENTS_READ), async (req, res, next) => {
  try {
    const { search, level, status, assemblyId, districtId, regionId } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);

    const where: Prisma.AnnouncementWhereInput = {
      deletedAt: null,
      ...(level && { level: level as AnnouncementLevel }),
      ...(status && { status: status as AnnouncementStatus }),
      ...(assemblyId && { assemblyId }),
      ...(districtId && { districtId }),
      ...(regionId && { regionId }),
      AND: [
        visibilityWhere,
        ...(search
          ? [{
              OR: [
                { title: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { content: { contains: search, mode: Prisma.QueryMode.insensitive } },
              ],
            }]
          : []),
      ],
    };

    const [data, total] = await prisma.$transaction([
      prisma.announcement.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          region: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
          assembly: { select: { id: true, name: true } },
          ministry: { select: { id: true, name: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.announcement.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.ANNOUNCEMENTS_READ), async (req, res, next) => {
  try {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);
    const announcement = await prisma.announcement.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...visibilityWhere },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        region: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        assembly: { select: { id: true, name: true } },
        ministry: { select: { id: true, name: true } },
      },
    });
    if (!announcement) throw new NotFoundError('Annonce');
    sendSuccess(res, announcement);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.ANNOUNCEMENTS_WRITE), validate(createAnnouncementSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createAnnouncementSchema>;
    assertEntityMatchesScope(dto);
    await assertAnnouncementTargetScope(req.user!, dto);

    const announcement = await prisma.announcement.create({
      data: {
        ...dto,
        tenantId: req.user!.tenantId,
        authorId: req.user!.id,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt as string) : null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt as string) : null,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Announcement', entityId: announcement.id, req });
    sendCreated(res, announcement, 'Annonce creee');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.ANNOUNCEMENTS_WRITE), validate(updateAnnouncementSchema), async (req, res, next) => {
  try {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);
    const existing = await prisma.announcement.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Annonce');
    if (existing.status === 'ARCHIVED') throw new AppError('Impossible de modifier une annonce archivee', 400, 'ARCHIVED');

    await assertAnnouncementTargetScope(req.user!, existing);

    const dto = req.body as z.infer<typeof updateAnnouncementSchema>;
    const announcement = await prisma.announcement.update({
      where: { id: req.params['id'] },
      data: {
        ...dto,
        expiresAt: dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt as string) : null) : undefined,
        scheduledAt: dto.scheduledAt !== undefined ? (dto.scheduledAt ? new Date(dto.scheduledAt as string) : null) : undefined,
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Announcement', entityId: announcement.id, req });
    sendSuccess(res, announcement, 'Annonce mise a jour');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', requirePermission(PERMISSIONS.ANNOUNCEMENTS_PUBLISH), async (req, res, next) => {
  try {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);
    const existing = await prisma.announcement.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Annonce');
    if (existing.status !== 'DRAFT') throw new AppError('Seules les annonces en brouillon peuvent etre publiees', 400, 'INVALID_STATUS');

    await assertAnnouncementTargetScope(req.user!, existing);

    const announcement = await prisma.announcement.update({
      where: { id: req.params['id'] },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'PUBLISH', entityType: 'Announcement', entityId: announcement.id, req });

    void notifyUsers({
      title: `Nouvelle annonce : ${existing.title}`,
      message: existing.content.slice(0, 120),
      type: 'ANNOUNCEMENT',
      entityType: 'Announcement',
      entityId: existing.id,
      scope: {
        assemblyId: existing.assemblyId ?? undefined,
        districtId: existing.districtId ?? undefined,
        regionId: existing.regionId ?? undefined,
      },
    });

    sendSuccess(res, announcement, 'Annonce publiee');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', requirePermission(PERMISSIONS.ANNOUNCEMENTS_WRITE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);
    const existing = await prisma.announcement.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Annonce');

    await assertAnnouncementTargetScope(req.user!, existing);

    const announcement = await prisma.announcement.update({
      where: { id: req.params['id'] },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'ARCHIVE', entityType: 'Announcement', entityId: announcement.id, req });
    sendSuccess(res, announcement, 'Annonce archivee');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.ANNOUNCEMENTS_DELETE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildAnnouncementVisibilityFilter(req.user!);
    const existing = await prisma.announcement.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Annonce');

    await assertAnnouncementTargetScope(req.user!, existing);

    await prisma.announcement.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Annonce supprimee');
  } catch (err) {
    next(err);
  }
});

export default router;
