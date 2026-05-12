import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import {
  assertOptionalAssemblyAccess,
  getScopedLiveChannelWhere,
} from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

const channelSchema = z.object({
  name:        z.string().min(2).max(120),
  provider:    z.enum(['YOUTUBE','VIMEO','FACEBOOK','CUSTOM_EMBED','OTHER']),
  assemblyId:  z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  streamUrl:   z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  externalId:  z.string().max(200).optional(),
  embedCode:   z.string().max(2000).optional(),
  isDefault:   z.boolean().default(false),
  isActive:    z.boolean().default(true),
  settings:    z.record(z.unknown()).default({}),
});

// GET /
router.get('/', requirePermission(PERMISSIONS.LIVE_CHANNELS_READ), async (req, res, next) => {
  try {
    const scopeWhere = await getScopedLiveChannelWhere(req.user!);

    const channels = await prisma.liveChannel.findMany({
      where: { isActive: true, AND: [scopeWhere] },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: {
        assembly: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { services: true } },
      },
    });
    sendSuccess(res, channels);
  } catch (err) { next(err); }
});

// POST /
router.post('/', requirePermission(PERMISSIONS.LIVE_CHANNELS_CREATE), validate(channelSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const data = req.body as z.infer<typeof channelSchema>;
    await assertOptionalAssemblyAccess(req.user!, data.assemblyId, 'Source live');

    // S'il est marqué par défaut, on enlève l'ancien default
    if (data.isDefault) {
      await prisma.liveChannel.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
    }

    const channel = await prisma.liveChannel.create({
      data: {
        tenantId,
        createdById: req.user!.id,
        name:        data.name,
        provider:    data.provider,
        assemblyId:  data.assemblyId,
        streamUrl:   data.streamUrl,
        externalId:  data.externalId,
        embedCode:   data.embedCode,
        isDefault:   data.isDefault,
        isActive:    data.isActive,
        settings:    (data.settings ?? {}) as Prisma.InputJsonObject,
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'LiveChannel', entityId: channel.id, req });
    sendCreated(res, channel, 'Source de diffusion créée');
  } catch (err) { next(err); }
});

// GET /:id
router.get('/:id', requirePermission(PERMISSIONS.LIVE_CHANNELS_READ), async (req, res, next) => {
  try {
    const channel = await prisma.liveChannel.findFirst({
      where: { id: req.params.id, AND: [await getScopedLiveChannelWhere(req.user!)] },
      include: {
        assembly: { select: { id: true, name: true } },
        services: { where: { deletedAt: null }, orderBy: { scheduledStartAt: 'desc' }, take: 5 },
      },
    });
    if (!channel) throw new NotFoundError('Source introuvable');
    sendSuccess(res, channel);
  } catch (err) { next(err); }
});

// PATCH /:id
router.patch('/:id', requirePermission(PERMISSIONS.LIVE_CHANNELS_UPDATE), validate(channelSchema.partial()), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const existing = await prisma.liveChannel.findFirst({ where: { id: req.params.id, tenantId: tenantId ?? undefined } });
    if (!existing) throw new NotFoundError('Source introuvable');
    await assertOptionalAssemblyAccess(req.user!, existing.assemblyId, 'Source live');

    const data = req.body as Partial<z.infer<typeof channelSchema>>;
    if ('assemblyId' in data) await assertOptionalAssemblyAccess(req.user!, data.assemblyId, 'Source live');
    if (data.isDefault) {
      await prisma.liveChannel.updateMany({ where: { tenantId: existing.tenantId, isDefault: true }, data: { isDefault: false } });
    }

    const updated = await prisma.liveChannel.update({ where: { id: req.params.id }, data: { ...data, settings: (data.settings ?? existing.settings) as Prisma.InputJsonObject } });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'LiveChannel', entityId: updated.id, req });
    sendSuccess(res, updated, 'Source mise à jour');
  } catch (err) { next(err); }
});

// DELETE /:id (soft disable)
router.delete('/:id', requirePermission(PERMISSIONS.LIVE_CHANNELS_DELETE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const existing = await prisma.liveChannel.findFirst({ where: { id: req.params.id, tenantId: tenantId ?? undefined } });
    if (!existing) throw new NotFoundError('Source introuvable');
    await assertOptionalAssemblyAccess(req.user!, existing.assemblyId, 'Source live');
    await prisma.liveChannel.update({ where: { id: req.params.id }, data: { isActive: false } });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'LiveChannel', entityId: req.params.id, req });
    sendSuccess(res, null, 'Source désactivée');
  } catch (err) { next(err); }
});

export default router;
