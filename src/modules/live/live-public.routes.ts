import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.middleware';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated } from '../../utils/response.util';
import { notifyUsers } from '../../utils/notify.util';
import { prayerRequestSchema } from './live-services.routes';

const router = Router();

const submitRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

const visitorSignupSchema = z.object({
  firstName:        z.string().min(1),
  lastName:         z.string().min(1),
  gender:           z.enum(['MALE','FEMALE']).default('MALE'),
  phone:            z.string().optional(),
  email:            z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  neighborhood:     z.string().optional(),
  heardAbout:       z.string().optional(),
  wantsContact:     z.boolean().default(true),
  consentToContact: z.boolean().default(true),
});

const salvationSchema = z.object({
  firstName:    z.string().min(1),
  lastName:     z.string().optional(),
  phone:        z.string().optional(),
  email:        z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  declaration:  z.string().optional(),
  wantsContact: z.boolean().default(true),
});

// ─── GET /live/:slug — Données de la salle publique ──────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null, visibility: { in: ['PUBLIC', 'MEMBERS_ONLY'] } },
      include: {
        assembly: { select: { id: true, name: true } },
        channel:  { select: { provider: true, streamUrl: true, embedCode: true } },
        moments:  { where: { isActive: true }, take: 1 },
        replays:  { where: { deletedAt: null, visibility: { in: ['PUBLIC', 'MEMBERS_ONLY'] } }, take: 1, orderBy: { publishedAt: 'desc' } },
        _count:   { select: { viewerSessions: true, chatMessages: true } },
      },
    });

    if (!service) {
      res.status(404).json({ success: false, message: 'Service introuvable', code: 'NOT_FOUND' }); return;
    }

    // Branding tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: service.tenantId },
      select: { name: true, logo: true, currency: true },
    });

    // On ne retourne pas l'embed URL si le service n'est pas en mode LIVE, READY ou ENDED
    const showEmbed = ['LIVE','READY','ENDED'].includes(service.status);

    sendSuccess(res, {
      id:             service.id,
      title:          service.title,
      description:    service.description,
      type:           service.type,
      status:         service.status,
      thumbnailUrl:   service.thumbnailUrl,
      scheduledStartAt: service.scheduledStartAt,
      actualStartAt:  service.actualStartAt,
      actualEndAt:    service.actualEndAt,
      allowChat:      service.allowChat,
      allowPrayer:    service.allowPrayer,
      allowDonations: service.allowDonations,
      allowVisitorSignup: service.allowVisitorSignup,
      allowSalvationDecision: service.allowSalvationDecision,
      embedUrl:       showEmbed ? service.embedUrl : null,
      provider:       showEmbed ? (service.channel?.provider ?? service.provider) : null,
      embedCode:      showEmbed ? service.channel?.embedCode : null,
      viewerCount:    service._count.viewerSessions,
      chatCount:      service._count.chatMessages,
      activeMoment:   service.moments[0] ?? null,
      replay:         service.status === 'ENDED' ? (service.replays[0] ?? null) : null,
      assembly:       service.assembly,
      tenant,
    });
  } catch (err) { next(err); }
});

// ─── GET /live/:slug/chat — Polling chat public ───────────────────────────────
router.get('/:slug/chat', async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, allowChat: true, status: true },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Service introuvable' }); return; }

    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const messages = await prisma.liveChatMessage.findMany({
      where: {
        serviceId: service.id,
        status: 'ACTIVE',
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take:    50,
      select: {
        id: true,
        content: true,
        guestName: true,
        isPinned: true,
        isSystem: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    sendSuccess(res, messages);
  } catch (err) { next(err); }
});

// ─── POST /live/:slug/chat — Message chat visiteur/membre ────────────────────
router.post('/:slug/chat', submitRateLimit, async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, allowChat: true, status: true, tenantId: true },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Service introuvable' }); return; }
    if (!service.allowChat || !['LIVE','READY'].includes(service.status)) {
      res.status(409).json({ success: false, message: 'Chat non disponible' }); return;
    }

    const { content, guestName } = req.body as { content: string; guestName?: string };
    if (!content?.trim()) { res.status(400).json({ success: false, message: 'Message vide' }); return; }

    const msg = await prisma.liveChatMessage.create({
      data: {
        serviceId: service.id,
        content:   content.slice(0, 1000),
        guestName: guestName?.slice(0, 80),
      },
      select: { id: true, content: true, guestName: true, createdAt: true },
    });

    sendCreated(res, msg);
  } catch (err) { next(err); }
});

// ─── POST /live/:slug/prayer — Demande de prière publique ────────────────────
router.post('/:slug/prayer', submitRateLimit, validate(prayerRequestSchema), async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, allowPrayer: true, tenantId: true, title: true },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Service introuvable' }); return; }
    if (!service.allowPrayer) { res.status(409).json({ success: false, message: 'Prière désactivée' }); return; }

    const data = req.body as z.infer<typeof prayerRequestSchema>;
    const request = await prisma.livePrayerRequest.create({
      data: {
        serviceId:       service.id,
        tenantId:        service.tenantId,
        firstName:       data.firstName,
        prayerSubject:   data.prayerSubject,
        phone:           data.phone,
        email:           data.email,
        confidentiality: data.confidentiality,
        wantsContact:    data.wantsContact,
      },
    });

    // Notifier les responsables
    void (async () => {
      try {
        const hosts = await prisma.liveHostAssignment.findMany({
          where: { serviceId: service.id },
          select: { userId: true },
        });
        if (hosts.length) {
          await notifyUsers({
            userIds:    hosts.map(h => h.userId),
            title: '🙏 Nouvelle demande de prière',
            message: `Pendant "${service.title}"`,
            type: 'ROLE_ASSIGNED',
            entityType: 'LivePrayerRequest',
            entityId: request.id,
          });
        }
      } catch { /* */ }
    })();

    sendCreated(res, { id: request.id }, 'Demande de prière reçue');
  } catch (err) { next(err); }
});

// ─── POST /live/:slug/visitor — Capture visiteur en ligne ────────────────────
router.post('/:slug/visitor', submitRateLimit, validate(visitorSignupSchema), async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, allowVisitorSignup: true, tenantId: true, assemblyId: true, title: true },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Service introuvable' }); return; }
    if (!service.allowVisitorSignup) { res.status(409).json({ success: false, message: 'Inscription visiteur désactivée' }); return; }

    const data = req.body as z.infer<typeof visitorSignupSchema>;
    const visitor = await prisma.newVisitor.create({
      data: {
        firstName:        data.firstName,
        lastName:         data.lastName,
        gender:           data.gender,
        phone:            data.phone,
        email:            data.email,
        neighborhood:     data.neighborhood,
        assemblyId:       service.assemblyId,
        source:           'WALK_IN',
        consentToContact: data.consentToContact,
        notes:            `Visiteur en ligne — ${service.title}`,
      },
    });

    // Engagement event
    void prisma.liveEngagementEvent.create({
      data: { serviceId: service.id, type: 'VISITOR_SIGNUP', metadata: { visitorId: visitor.id } as never },
    });

    sendCreated(res, { id: visitor.id }, 'Bienvenue ! Votre inscription a été enregistrée.');
  } catch (err) { next(err); }
});

// ─── POST /live/:slug/salvation — Décision spirituelle ───────────────────────
router.post('/:slug/salvation', submitRateLimit, validate(salvationSchema), async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, allowSalvationDecision: true, tenantId: true, assemblyId: true, title: true },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Service introuvable' }); return; }
    if (!service.allowSalvationDecision) { res.status(409).json({ success: false, message: 'Module désactivé' }); return; }

    const data = req.body as z.infer<typeof salvationSchema>;

    // Crée un nouveau visiteur avec statut spécial + note
    const ipHash = crypto.createHash('sha256').update(crypto.randomBytes(8)).digest('hex');
    const visitor = await prisma.newVisitor.create({
      data: {
        firstName:        data.firstName,
        lastName:         data.lastName ?? 'Décision spirituelle',
        gender:           'MALE',
        phone:            data.phone,
        email:            data.email,
        assemblyId:       service.assemblyId,
        source:           'WALK_IN',
        consentToContact: data.wantsContact,
        notes:            `DÉCISION SPIRITUELLE — Via live "${service.title}". ${data.declaration ?? ''}`.trim(),
        prayerNeeded:     true,
      },
    });

    void prisma.liveEngagementEvent.create({
      data: { serviceId: service.id, type: 'SALVATION_DECISION', metadata: { visitorId: visitor.id, ipHash } as never },
    });

    // Notifier les responsables
    void (async () => {
      try {
        const hosts = await prisma.liveHostAssignment.findMany({
          where: { serviceId: service.id, role: { in: ['HOST', 'PASTOR'] } },
          select: { userId: true },
        });
        if (hosts.length) {
          await notifyUsers({
            userIds:    hosts.map(h => h.userId),
            title: '🎉 Décision spirituelle !',
            message: `${data.firstName} a pris une décision pendant "${service.title}"`,
            type: 'ROLE_ASSIGNED',
            entityType: 'NewVisitor',
            entityId: visitor.id,
          });
        }
      } catch { /* */ }
    })();

    sendCreated(res, { id: visitor.id }, 'Votre décision a été enregistrée. Dieu vous bénisse !');
  } catch (err) { next(err); }
});

// ─── POST /live/:slug/moment/:momentId/click — Track CTA click ───────────────
router.post('/:slug/moment/:momentId/click', async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true },
    });
    if (!service) { res.status(404).json({ success: false }); return; }

    await Promise.all([
      prisma.liveMoment.update({ where: { id: req.params.momentId }, data: { clicks: { increment: 1 } } }),
      prisma.liveEngagementEvent.create({ data: { serviceId: service.id, type: 'CTA_CLICK', metadata: { momentId: req.params.momentId } as never } }),
    ]);

    sendSuccess(res, null);
  } catch (err) { next(err); }
});

// ─── GET /live/:slug/replay — Page replay publique ───────────────────────────
router.get('/:slug/replay', async (req, res, next) => {
  try {
    const service = await prisma.liveService.findFirst({
      where: { slug: req.params.slug, status: 'ENDED', deletedAt: null },
      select: { id: true, title: true, assembly: { select: { id: true, name: true } } },
    });
    if (!service) { res.status(404).json({ success: false, message: 'Replay introuvable' }); return; }

    const replay = await prisma.mediaReplay.findFirst({
      where: { serviceId: service.id, deletedAt: null, visibility: { in: ['PUBLIC', 'MEMBERS_ONLY'] } },
      orderBy: { publishedAt: 'desc' },
    });

    if (!replay) { res.status(404).json({ success: false, message: 'Replay non disponible', code: 'NO_REPLAY' }); return; }

    void prisma.mediaReplay.update({ where: { id: replay.id }, data: { viewCount: { increment: 1 } } });

    sendSuccess(res, { service: { title: service.title, assembly: service.assembly }, replay });
  } catch (err) { next(err); }
});

export default router;
