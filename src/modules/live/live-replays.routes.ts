import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import {
  assertAssemblyAccess,
  assertOptionalAssemblyAccess,
  getScopedMediaReplayWhere,
} from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

const replaySchema = z.object({
  title:        z.string().min(2).max(200),
  description:  z.string().max(1000).optional(),
  assemblyId:   z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  serviceId:    z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  thumbnailUrl: z.string().optional().transform(v => v || undefined),
  videoUrl:     z.string().min(1),
  provider:     z.enum(['YOUTUBE','VIMEO','FACEBOOK','CUSTOM_EMBED','OTHER']).optional(),
  externalId:   z.string().max(200).optional(),
  preacher:     z.string().max(200).optional(),
  series:       z.string().max(200).optional(),
  tags:         z.array(z.string()).default([]),
  verseRefs:    z.array(z.string()).default([]),
  durationSec:  z.number().int().min(0).optional(),
  visibility:   z.enum(['PUBLIC','MEMBERS_ONLY','ASSEMBLY_ONLY','PRIVATE']).default('MEMBERS_ONLY'),
  notes:        z.string().optional(),
});

// GET /
router.get('/', requirePermission(PERMISSIONS.LIVE_REPLAYS_MANAGE), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.pagination ?? { page: 1, limit: 20 };
    const { assemblyId, visibility, search, series } = req.query as Record<string, string | undefined>;
    if (assemblyId) await assertAssemblyAccess(req.user!, assemblyId);
    const scopeWhere = await getScopedMediaReplayWhere(req.user!);

    const where: Prisma.MediaReplayWhereInput = {
      deletedAt: null,
      AND: [scopeWhere],
      ...(assemblyId ? { assemblyId }                                                        : {}),
      ...(visibility ? { visibility: visibility as Prisma.EnumReplayVisibilityFilter }       : {}),
      ...(series     ? { series: { contains: series, mode: 'insensitive' } }                 : {}),
      ...(search     ? { title: { contains: search, mode: 'insensitive' } }                  : {}),
    };

    const [items, total] = await Promise.all([
      prisma.mediaReplay.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: {
          assembly:  { select: { id: true, name: true } },
          service:   { select: { id: true, title: true, slug: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.mediaReplay.count({ where }),
    ]);

    sendPaginated(res, items, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// POST /
router.post('/', requirePermission(PERMISSIONS.LIVE_REPLAYS_MANAGE), validate(replaySchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const data = req.body as z.infer<typeof replaySchema>;
    let assemblyId = data.assemblyId;
    if (data.serviceId) {
      const service = await prisma.liveService.findFirst({
        where: { id: data.serviceId, tenantId, deletedAt: null },
        select: { assemblyId: true },
      });
      if (!service) throw new NotFoundError('Service live');
      await assertAssemblyAccess(req.user!, service.assemblyId);
      if (assemblyId && assemblyId !== service.assemblyId) {
        throw new AppError('Le replay doit cibler la meme assemblee que le service live', 400, 'INVALID_SCOPE');
      }
      assemblyId = service.assemblyId;
    } else {
      await assertOptionalAssemblyAccess(req.user!, assemblyId, 'Replay');
    }

    const replay = await prisma.mediaReplay.create({
      data: {
        tenantId,
        createdById:  req.user!.id,
        title:        data.title,
        description:  data.description,
        assemblyId,
        serviceId:    data.serviceId,
        thumbnailUrl: data.thumbnailUrl,
        videoUrl:     data.videoUrl,
        provider:     data.provider,
        externalId:   data.externalId,
        preacher:     data.preacher,
        series:       data.series,
        tags:         data.tags,
        verseRefs:    data.verseRefs,
        durationSec:  data.durationSec,
        visibility:   data.visibility,
        notes:        data.notes,
        publishedAt:  new Date(),
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'MediaReplay', entityId: replay.id, req });
    sendCreated(res, replay, 'Replay créé');
  } catch (err) { next(err); }
});

// GET /:id
router.get('/:id', requirePermission(PERMISSIONS.LIVE_REPLAYS_MANAGE), async (req, res, next) => {
  try {
    const replay = await prisma.mediaReplay.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await getScopedMediaReplayWhere(req.user!)] },
      include: {
        assembly:  { select: { id: true, name: true } },
        service:   { select: { id: true, title: true, slug: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!replay) throw new NotFoundError('Replay introuvable');

    // Incrément silencieux des vues
    void prisma.mediaReplay.update({ where: { id: replay.id }, data: { viewCount: { increment: 1 } } });

    sendSuccess(res, replay);
  } catch (err) { next(err); }
});

// PATCH /:id
router.patch('/:id', requirePermission(PERMISSIONS.LIVE_REPLAYS_MANAGE), validate(replaySchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.mediaReplay.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await getScopedMediaReplayWhere(req.user!)] },
    });
    if (!existing) throw new NotFoundError('Replay introuvable');

    const data = req.body as Partial<z.infer<typeof replaySchema>>;
    const updated = await prisma.mediaReplay.update({
      where: { id: req.params.id },
      data: {
        title:        data.title        ?? existing.title,
        description:  data.description  ?? existing.description,
        thumbnailUrl: data.thumbnailUrl ?? existing.thumbnailUrl,
        videoUrl:     data.videoUrl     ?? existing.videoUrl,
        provider:     data.provider     ?? existing.provider,
        preacher:     data.preacher     ?? existing.preacher,
        series:       data.series       ?? existing.series,
        tags:         data.tags         ?? existing.tags,
        verseRefs:    data.verseRefs    ?? existing.verseRefs,
        durationSec:  data.durationSec  ?? existing.durationSec,
        visibility:   data.visibility   ?? existing.visibility,
        notes:        data.notes        ?? existing.notes,
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'MediaReplay', entityId: updated.id, req });
    sendSuccess(res, updated, 'Replay mis à jour');
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', requirePermission(PERMISSIONS.LIVE_REPLAYS_MANAGE), async (req, res, next) => {
  try {
    const existing = await prisma.mediaReplay.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await getScopedMediaReplayWhere(req.user!)] },
    });
    if (!existing) throw new NotFoundError('Replay introuvable');

    await prisma.mediaReplay.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'MediaReplay', entityId: req.params.id, req });
    sendSuccess(res, null, 'Replay supprimé');
  } catch (err) { next(err); }
});

export default router;
