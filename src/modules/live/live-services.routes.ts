import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { notifyUsers } from '../../utils/notify.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

// ─── Schémas ─────────────────────────────────────────────────────────────────

const serviceSchema = z.object({
  title:                 z.string().min(2).max(200),
  description:           z.string().max(1000).optional(),
  type:                  z.enum(['SUNDAY_SERVICE','PRAYER','CONFERENCE','SEMINAR','YOUTH','SPECIAL','OTHER']).default('SUNDAY_SERVICE'),
  assemblyId:            z.string().uuid(),
  channelId:             z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  eventId:               z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  visibility:            z.enum(['PUBLIC','MEMBERS_ONLY','ASSEMBLY_ONLY','PRIVATE']).default('PUBLIC'),
  thumbnailUrl:          z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  provider:              z.enum(['YOUTUBE','VIMEO','FACEBOOK','CUSTOM_EMBED','OTHER']).optional(),
  externalLiveId:        z.string().max(200).optional(),
  embedUrl:              z.string().optional().transform(v => v || undefined),
  scheduledStartAt:      z.string().optional().transform(v => v || undefined),
  scheduledEndAt:        z.string().optional().transform(v => v || undefined),
  allowChat:             z.boolean().default(true),
  allowPrayer:           z.boolean().default(true),
  allowDonations:        z.boolean().default(true),
  allowVisitorSignup:    z.boolean().default(true),
  allowSalvationDecision:z.boolean().default(true),
  language:              z.string().optional(),
  tags:                  z.array(z.string()).default([]),
});

const momentSchema = z.object({
  type:        z.enum(['NEW_VISITOR','DONATION','PRAYER','SALVATION_DECISION','EVENT_REGISTRATION','SHARE','CONTACT_REQUEST','CUSTOM']),
  title:       z.string().min(1).max(120),
  message:     z.string().max(500).optional(),
  buttonText:  z.string().max(80).optional(),
  actionUrl:   z.string().optional().transform(v => v || undefined),
  campaignId:  z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  triggerMode: z.enum(['MANUAL','SCHEDULED']).default('MANUAL'),
  scheduledAt: z.string().optional().transform(v => v || undefined),
  durationSec: z.number().int().min(5).max(300).optional(),
});

const chatMessageSchema = z.object({
  content:   z.string().min(1).max(1000),
  guestName: z.string().max(80).optional(),
  parentId:  z.string().uuid().optional(),
});

const prayerRequestSchema = z.object({
  firstName:       z.string().optional(),
  prayerSubject:   z.string().min(5).max(1000),
  phone:           z.string().optional(),
  email:           z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  confidentiality: z.enum(['TEAM','PASTOR','ANONYMOUS']).default('TEAM'),
  wantsContact:    z.boolean().default(false),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function generateServiceSlug(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

async function assertServiceAccess(id: string, tenantId: string | null | undefined) {
  const service = await prisma.liveService.findFirst({
    where: { id, tenantId: tenantId ?? undefined, deletedAt: null },
  });
  if (!service) throw new NotFoundError('Service introuvable');
  return service;
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.LIVE_SERVICES_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

    const { page = 1, limit = 20 } = req.pagination ?? { page: 1, limit: 20 };
    const { status, type, assemblyId, search } = req.query as Record<string, string | undefined>;

    const where: Prisma.LiveServiceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status     ? { status: status as Prisma.EnumLiveServiceStatusFilter }        : {}),
      ...(type       ? { type: type as Prisma.EnumLiveServiceTypeFilter }               : {}),
      ...(assemblyId ? { assemblyId }                                                    : {}),
      ...(search     ? { title: { contains: search, mode: 'insensitive' } }             : {}),
    };

    const [items, total] = await Promise.all([
      prisma.liveService.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { scheduledStartAt: 'desc' },
        include: {
          assembly: { select: { id: true, name: true } },
          channel:  { select: { id: true, name: true, provider: true } },
          _count:   { select: { chatMessages: true, prayerRequests: true, viewerSessions: true } },
        },
      }),
      prisma.liveService.count({ where }),
    ]);

    sendPaginated(res, items, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post('/', requirePermission(PERMISSIONS.LIVE_SERVICES_CREATE), validate(serviceSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const data = req.body as z.infer<typeof serviceSchema>;

    const slug = generateServiceSlug(data.title);
    const service = await prisma.liveService.create({
      data: {
        tenantId,
        createdById: req.user!.id,
        slug,
        title:                  data.title,
        description:            data.description,
        type:                   data.type,
        assemblyId:             data.assemblyId,
        channelId:              data.channelId,
        eventId:                data.eventId,
        visibility:             data.visibility,
        thumbnailUrl:           data.thumbnailUrl,
        provider:               data.provider,
        externalLiveId:         data.externalLiveId,
        embedUrl:               data.embedUrl,
        scheduledStartAt:       data.scheduledStartAt ? new Date(data.scheduledStartAt) : undefined,
        scheduledEndAt:         data.scheduledEndAt   ? new Date(data.scheduledEndAt)   : undefined,
        allowChat:              data.allowChat,
        allowPrayer:            data.allowPrayer,
        allowDonations:         data.allowDonations,
        allowVisitorSignup:     data.allowVisitorSignup,
        allowSalvationDecision: data.allowSalvationDecision,
        language:               data.language,
        tags:                   data.tags,
      },
      include: { assembly: { select: { id: true, name: true } }, channel: { select: { id: true, name: true, provider: true } } },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'LiveService', entityId: service.id, req });
    sendCreated(res, service, 'Service live créé');
  } catch (err) { next(err); }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission(PERMISSIONS.LIVE_SERVICES_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      include: {
        assembly: { select: { id: true, name: true } },
        channel:  { select: { id: true, name: true, provider: true, streamUrl: true, embedCode: true } },
        hosts:    { include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } } },
        moments:  { orderBy: { createdAt: 'desc' } },
        replays:  { where: { deletedAt: null }, select: { id: true, title: true, videoUrl: true, visibility: true } },
        _count:   { select: { chatMessages: true, prayerRequests: true, viewerSessions: true, engagements: true } },
      },
    });
    if (!service) throw new NotFoundError('Service introuvable');
    sendSuccess(res, service);
  } catch (err) { next(err); }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', requirePermission(PERMISSIONS.LIVE_SERVICES_UPDATE), validate(serviceSchema.partial()), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const existing = await assertServiceAccess(req.params.id, tenantId);
    const data = req.body as Partial<z.infer<typeof serviceSchema>>;

    const updated = await prisma.liveService.update({
      where: { id: req.params.id },
      data: {
        title:                  data.title         ?? existing.title,
        description:            data.description   ?? existing.description,
        type:                   data.type          ?? existing.type,
        visibility:             data.visibility    ?? existing.visibility,
        thumbnailUrl:           data.thumbnailUrl  ?? existing.thumbnailUrl,
        channelId:              data.channelId     ?? existing.channelId,
        provider:               data.provider      ?? existing.provider,
        externalLiveId:         data.externalLiveId ?? existing.externalLiveId,
        embedUrl:               data.embedUrl      ?? existing.embedUrl,
        scheduledStartAt:       data.scheduledStartAt ? new Date(data.scheduledStartAt) : existing.scheduledStartAt,
        scheduledEndAt:         data.scheduledEndAt   ? new Date(data.scheduledEndAt)   : existing.scheduledEndAt,
        allowChat:              data.allowChat              ?? existing.allowChat,
        allowPrayer:            data.allowPrayer            ?? existing.allowPrayer,
        allowDonations:         data.allowDonations         ?? existing.allowDonations,
        allowVisitorSignup:     data.allowVisitorSignup     ?? existing.allowVisitorSignup,
        allowSalvationDecision: data.allowSalvationDecision ?? existing.allowSalvationDecision,
        language:               data.language ?? existing.language,
        tags:                   data.tags     ?? existing.tags,
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'LiveService', entityId: updated.id, req });
    sendSuccess(res, updated, 'Service mis à jour');
  } catch (err) { next(err); }
});

// ─── POST /:id/publish ────────────────────────────────────────────────────────
router.post('/:id/publish', requirePermission(PERMISSIONS.LIVE_SERVICES_PUBLISH), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service = await assertServiceAccess(req.params.id, tenantId);

    if (!['DRAFT','SCHEDULED'].includes(service.status)) {
      throw new AppError('Seuls les services en brouillon ou planifiés peuvent être publiés', 409, 'INVALID_STATUS');
    }

    const updated = await prisma.liveService.update({
      where: { id: req.params.id },
      data:  { status: 'SCHEDULED' },
    });

    // Notifier les membres de l'assemblée
    void (async () => {
      try {
        const members = await prisma.userRole.findMany({
          where: { tenantId: tenantId!, role: { level: { gte: 1 } } },
          select: { userId: true },
        });
        await notifyUsers({
          userIds:    members.map(m => m.userId),
          title: `📺 Live planifié : ${service.title}`,
          message: service.scheduledStartAt
            ? `Le culte commence le ${new Date(service.scheduledStartAt).toLocaleString('fr-FR')}`
            : 'Un culte en ligne a été planifié',
          type:       'ANNOUNCEMENT',
          entityType: 'LiveService',
          entityId:   service.id,
        });
      } catch { /* notifications non bloquantes */ }
    })();

    await createAuditLog({ actorId: req.user!.id, action: 'PUBLISH', entityType: 'LiveService', entityId: updated.id, req });
    sendSuccess(res, updated, 'Service publié');
  } catch (err) { next(err); }
});

// ─── POST /:id/start — Démarre le live ───────────────────────────────────────
router.post('/:id/start', requirePermission(PERMISSIONS.LIVE_SERVICES_PUBLISH), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await assertServiceAccess(req.params.id, tenantId);
    if (service.status === 'LIVE') throw new AppError('Le live est déjà en cours', 409, 'ALREADY_LIVE');

    const updated = await prisma.liveService.update({
      where: { id: req.params.id },
      data:  { status: 'LIVE', actualStartAt: new Date() },
    });

    // Notification "Le live a commencé"
    void (async () => {
      try {
        const members = await prisma.userRole.findMany({
          where: { tenantId: tenantId! },
          select: { userId: true },
        });
        await notifyUsers({
          userIds:    members.map(m => m.userId),
          title: `🔴 En direct : ${service.title}`,
          message: 'Le culte en ligne vient de commencer. Rejoignez-nous !',
          type: 'ANNOUNCEMENT',
          entityType: 'LiveService',
          entityId: service.id,
        });
      } catch { /* */ }
    })();

    sendSuccess(res, updated, 'Live démarré');
  } catch (err) { next(err); }
});

// ─── POST /:id/end — Termine le live ─────────────────────────────────────────
router.post('/:id/end', requirePermission(PERMISSIONS.LIVE_SERVICES_PUBLISH), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);

    const updated = await prisma.liveService.update({
      where: { id: req.params.id },
      data:  { status: 'ENDED', actualEndAt: new Date() },
    });

    sendSuccess(res, updated, 'Live terminé');
  } catch (err) { next(err); }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', requirePermission(PERMISSIONS.LIVE_SERVICES_DELETE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    await prisma.liveService.update({ where: { id: req.params.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'LiveService', entityId: req.params.id, req });
    sendSuccess(res, null, 'Service archivé');
  } catch (err) { next(err); }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────

router.get('/:id/chat', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      select: { allowChat: true },
    });
    if (!service) throw new NotFoundError('Service introuvable');
    if (!service.allowChat) { sendSuccess(res, []); return; }

    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const messages = await prisma.liveChatMessage.findMany({
      where: {
        serviceId: req.params.id,
        status: 'ACTIVE',
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take:    100,
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
    });
    sendSuccess(res, messages);
  } catch (err) { next(err); }
});

router.post('/:id/chat', validate(chatMessageSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      select: { allowChat: true, status: true },
    });
    if (!service) throw new NotFoundError('Service introuvable');
    if (!service.allowChat) throw new AppError('Chat désactivé pour ce service', 403, 'CHAT_DISABLED');
    if (!['LIVE','READY'].includes(service.status)) throw new AppError('Le chat n\'est disponible que pendant le live', 409, 'NOT_LIVE');

    const data = req.body as z.infer<typeof chatMessageSchema>;
    const msg  = await prisma.liveChatMessage.create({
      data: {
        serviceId: req.params.id,
        userId:    req.user!.id,
        content:   data.content,
        parentId:  data.parentId,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
    });

    // Enregistre l'engagement
    void prisma.liveEngagementEvent.create({
      data: { serviceId: req.params.id, userId: req.user!.id, type: 'CHAT_MESSAGE' },
    });

    sendCreated(res, msg);
  } catch (err) { next(err); }
});

router.patch('/:id/chat/:msgId/hide', requirePermission(PERMISSIONS.LIVE_CHAT_MODERATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    await prisma.liveChatMessage.update({ where: { id: req.params.msgId }, data: { status: 'HIDDEN' } });
    sendSuccess(res, null, 'Message masqué');
  } catch (err) { next(err); }
});

router.patch('/:id/chat/:msgId/pin', requirePermission(PERMISSIONS.LIVE_CHAT_MODERATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    // Un seul message épinglé à la fois
    await prisma.liveChatMessage.updateMany({ where: { serviceId: req.params.id, isPinned: true }, data: { isPinned: false } });
    await prisma.liveChatMessage.update({ where: { id: req.params.msgId }, data: { isPinned: true } });
    sendSuccess(res, null, 'Message épinglé');
  } catch (err) { next(err); }
});

// ─── PRIÈRES ─────────────────────────────────────────────────────────────────

router.get('/:id/prayer-requests', requirePermission(PERMISSIONS.LIVE_PRAYER_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const { status } = req.query as { status?: string };
    const requests = await prisma.livePrayerRequest.findMany({
      where: {
        serviceId: req.params.id,
        ...(status ? { status: status as Prisma.EnumLivePrayerStatusFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    sendSuccess(res, requests);
  } catch (err) { next(err); }
});

router.patch('/:id/prayer-requests/:reqId', requirePermission(PERMISSIONS.LIVE_PRAYER_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const { status, assignedToId, notes } = req.body as { status?: string; assignedToId?: string; notes?: string };
    const updated = await prisma.livePrayerRequest.update({
      where: { id: req.params.reqId },
      data: {
        ...(status       ? { status: status as never, ...(status === 'ASSIGNED' ? { assignedAt: new Date() } : {}) } : {}),
        ...(assignedToId ? { assignedToId }     : {}),
        ...(notes        ? { notes }             : {}),
        ...(status === 'CLOSED' ? { closedAt: new Date() } : {}),
      },
    });
    sendSuccess(res, updated);
  } catch (err) { next(err); }
});

// ─── MOMENTS ─────────────────────────────────────────────────────────────────

router.get('/:id/moments', requirePermission(PERMISSIONS.LIVE_MOMENTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const moments = await prisma.liveMoment.findMany({
      where: { serviceId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, moments);
  } catch (err) { next(err); }
});

router.post('/:id/moments', requirePermission(PERMISSIONS.LIVE_MOMENTS_MANAGE), validate(momentSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const data = req.body as z.infer<typeof momentSchema>;
    const moment = await prisma.liveMoment.create({
      data: {
        serviceId:   req.params.id,
        type:        data.type,
        title:       data.title,
        message:     data.message,
        buttonText:  data.buttonText,
        actionUrl:   data.actionUrl,
        campaignId:  data.campaignId,
        triggerMode: data.triggerMode,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        durationSec: data.durationSec,
      },
    });
    sendCreated(res, moment);
  } catch (err) { next(err); }
});

// Déclencher un moment manuellement (régie live)
router.post('/:id/moments/:momentId/trigger', requirePermission(PERMISSIONS.LIVE_MOMENTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);

    // Désactive les autres moments actifs
    await prisma.liveMoment.updateMany({ where: { serviceId: req.params.id, isActive: true }, data: { isActive: false, hiddenAt: new Date() } });

    const updated = await prisma.liveMoment.update({
      where: { id: req.params.momentId },
      data:  { isActive: true, displayedAt: new Date(), impressions: { increment: 1 } },
    });
    sendSuccess(res, updated, 'Moment déclenché');
  } catch (err) { next(err); }
});

router.post('/:id/moments/:momentId/hide', requirePermission(PERMISSIONS.LIVE_MOMENTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    await prisma.liveMoment.update({ where: { id: req.params.momentId }, data: { isActive: false, hiddenAt: new Date() } });
    sendSuccess(res, null, 'Moment masqué');
  } catch (err) { next(err); }
});

// ─── SESSIONS VIEWER ─────────────────────────────────────────────────────────

router.post('/:id/join', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      select: { id: true, status: true, viewCount: true },
    });
    if (!service) throw new NotFoundError('Service introuvable');

    const session = await prisma.liveViewerSession.create({
      data: {
        serviceId: req.params.id,
        userId:    req.user!.id,
        device:    req.headers['user-agent']?.slice(0, 200),
        source:    (req.query.source as string) || 'DIRECT',
      },
    });

    await prisma.liveService.update({
      where: { id: req.params.id },
      data:  { viewCount: { increment: 1 } },
    });

    sendCreated(res, { sessionId: session.id });
  } catch (err) { next(err); }
});

router.post('/:id/leave', async (req, res, next) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) { sendSuccess(res, null); return; }

    const session = await prisma.liveViewerSession.findFirst({
      where: { id: sessionId, userId: req.user!.id },
    });
    if (session && !session.leftAt) {
      const durationSec = Math.round((Date.now() - session.enteredAt.getTime()) / 1000);
      await prisma.liveViewerSession.update({
        where: { id: sessionId },
        data:  { leftAt: new Date(), durationSec },
      });
    }
    sendSuccess(res, null);
  } catch (err) { next(err); }
});

// ─── ENGAGEMENT (réactions) ───────────────────────────────────────────────────
router.post('/:id/engage', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      select: { id: true },
    });
    if (!service) throw new NotFoundError('Service introuvable');

    const { type, metadata } = req.body as { type: string; metadata?: Record<string, unknown> };
    const validTypes = ['REACTION_AMEN','REACTION_PRAYER','REACTION_HEART','CTA_CLICK','SHARE'];
    if (!validTypes.includes(type)) throw new AppError('Type d\'engagement invalide', 400, 'INVALID_TYPE');

    await prisma.liveEngagementEvent.create({
      data: {
        serviceId: req.params.id,
        userId:    req.user!.id,
        type:      type as never,
        metadata:  (metadata ?? {}) as Prisma.InputJsonObject,
      },
    });

    sendCreated(res, null);
  } catch (err) { next(err); }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
router.get('/:id/analytics', requirePermission(PERMISSIONS.LIVE_ANALYTICS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const service  = await prisma.liveService.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      include: { _count: { select: { chatMessages: true, prayerRequests: true, viewerSessions: true } } },
    });
    if (!service) throw new NotFoundError('Service introuvable');

    const [engagementByType, viewerStats, prayerStats] = await Promise.all([
      prisma.liveEngagementEvent.groupBy({
        by: ['type'],
        where: { serviceId: req.params.id },
        _count: { type: true },
      }),
      prisma.liveViewerSession.aggregate({
        where: { serviceId: req.params.id },
        _count: { id: true },
        _avg:   { durationSec: true },
        _max:   { durationSec: true },
      }),
      prisma.livePrayerRequest.groupBy({
        by: ['status'],
        where: { serviceId: req.params.id },
        _count: { status: true },
      }),
    ]);

    sendSuccess(res, {
      service: {
        viewCount:      service.viewCount,
        peakViewerCount: service.peakViewerCount,
        actualDurationMin: service.actualStartAt && service.actualEndAt
          ? Math.round((service.actualEndAt.getTime() - service.actualStartAt.getTime()) / 60000)
          : null,
      },
      engagement: {
        totalMessages:  service._count.chatMessages,
        prayerRequests: service._count.prayerRequests,
        viewerSessions: service._count.viewerSessions,
        byType:         engagementByType,
      },
      viewers: {
        total:          viewerStats._count.id,
        avgDurationSec: Math.round(viewerStats._avg.durationSec ?? 0),
        maxDurationSec: viewerStats._max.durationSec ?? 0,
      },
      prayers: prayerStats,
    });
  } catch (err) { next(err); }
});

// ─── HOSTS ────────────────────────────────────────────────────────────────────
router.get('/:id/hosts', requirePermission(PERMISSIONS.LIVE_HOSTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const hosts = await prisma.liveHostAssignment.findMany({
      where: { serviceId: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } } },
    });
    sendSuccess(res, hosts);
  } catch (err) { next(err); }
});

router.post('/:id/hosts', requirePermission(PERMISSIONS.LIVE_HOSTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    const { userId, role } = req.body as { userId: string; role?: string };
    const assignment = await prisma.liveHostAssignment.upsert({
      where: { serviceId_userId: { serviceId: req.params.id, userId } },
      create: { serviceId: req.params.id, userId, role: (role as never) ?? 'MODERATOR' },
      update: { role: (role as never) ?? 'MODERATOR' },
    });
    sendCreated(res, assignment);
  } catch (err) { next(err); }
});

router.delete('/:id/hosts/:userId', requirePermission(PERMISSIONS.LIVE_HOSTS_MANAGE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    await assertServiceAccess(req.params.id, tenantId);
    await prisma.liveHostAssignment.deleteMany({ where: { serviceId: req.params.id, userId: req.params.userId } });
    sendSuccess(res, null, 'Hôte retiré');
  } catch (err) { next(err); }
});

export default router;
export { prayerRequestSchema };
