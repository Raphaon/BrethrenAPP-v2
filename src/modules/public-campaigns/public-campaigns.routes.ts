import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

// ─── Validation schemas ───────────────────────────────────────────────────────

const campaignCreateSchema = z.object({
  title:       z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['DONATION','VISITOR_REGISTRATION','PRAYER_REQUEST','EVENT_REGISTRATION',
                 'VOLUNTEER_SIGNUP','MINISTRY_JOIN','CONTACT_REQUEST','CHECKIN','CUSTOM']),
  scopeType:   z.enum(['TENANT','REGION','DISTRICT','ASSEMBLY','EVENT','MINISTRY']).default('ASSEMBLY'),
  scopeId:     z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  settings:    z.record(z.unknown()).default({}),
  startsAt:    z.string().optional().transform(v => v || undefined),
  endsAt:      z.string().optional().transform(v => v || undefined),
});

const campaignUpdateSchema = campaignCreateSchema.partial();

const linkCreateSchema = z.object({
  source: z.enum(['DEFAULT','YOUTUBE','FACEBOOK','INSTAGRAM','POSTER','WHATSAPP','EMAIL','WEBSITE','EVENT_SCREEN','OTHER']).default('DEFAULT'),
  label:    z.string().max(80).optional(),
  expiresAt: z.string().datetime().optional(),
});

const qrGenerateSchema = z.object({
  format:          z.enum(['PNG','SVG']).default('PNG'),
  label:           z.string().max(80).optional(),
  foregroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  width:           z.number().int().min(100).max(800).default(300),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPublicUrl(slug: string): string {
  const base = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  return `${base}/p/${slug}`;
}

function generateSlug(tenantSlug?: string): string {
  const rand = crypto.randomBytes(5).toString('hex');
  return tenantSlug ? `${tenantSlug}-${rand}` : rand;
}

async function upsertDailyMetric(campaignId: string, field: 'views' | 'scans' | 'submissions' | 'successfulActions') {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.publicCampaignMetric.upsert({
    where: { campaignId_date: { campaignId, date: today } },
    create: { campaignId, date: today, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
}

// ─── GET /public-campaigns ────────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

    const { page = 1, limit = 20 } = req.pagination ?? { page: 1, limit: 20 };
    const { type, status, search } = req.query as Record<string, string | undefined>;

    const where: Prisma.PublicCampaignWhereInput = {
      tenantId,
      deletedAt: null,
      ...(type   ? { type:   type   as Prisma.EnumCampaignTypeFilter } : {}),
      ...(status ? { status: status as Prisma.EnumCampaignStatusFilter } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.publicCampaign.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { submissions: true, links: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.publicCampaign.count({ where }),
    ]);

    sendPaginated(res, items, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ─── GET /public-campaigns/stats/overview — BEFORE /:id to avoid param conflict
router.get('/stats/overview', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [activeCampaigns, totalCampaigns, todayMetrics, monthSubmissions, topCampaigns] = await Promise.all([
      prisma.publicCampaign.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      prisma.publicCampaign.count({ where: { tenantId, deletedAt: null } }),
      prisma.publicCampaignMetric.aggregate({
        where: { campaign: { tenantId }, date: today },
        _sum: { views: true, scans: true, submissions: true },
      }),
      prisma.publicSubmission.count({ where: { tenantId, submittedAt: { gte: monthStart } } }),
      prisma.publicCampaign.findMany({
        where: { tenantId, deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { submissions: true } } },
      }),
    ]);

    sendSuccess(res, {
      activeCampaigns,
      totalCampaigns,
      todayViews:       todayMetrics._sum.views       ?? 0,
      todayScans:       todayMetrics._sum.scans       ?? 0,
      todaySubmissions: todayMetrics._sum.submissions ?? 0,
      monthSubmissions,
      topCampaigns,
    });
  } catch (err) { next(err); }
});

// ─── POST /public-campaigns ───────────────────────────────────────────────────
router.post('/', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_CREATE),
  validate(campaignCreateSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

      const data = req.body as z.infer<typeof campaignCreateSchema>;
      const campaign = await prisma.publicCampaign.create({
        data: {
          tenantId,
          createdById: req.user!.id,
          title:       data.title,
          description: data.description,
          type:        data.type,
          scopeType:   data.scopeType,
          scopeId:     data.scopeId,
          settings:    (data.settings ?? {}) as Prisma.InputJsonObject,
          startsAt:    data.startsAt ? new Date(data.startsAt) : undefined,
          endsAt:      data.endsAt   ? new Date(data.endsAt)   : undefined,
        },
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      });

      await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'PublicCampaign', entityId: campaign.id, req });
      sendCreated(res, campaign, 'Campagne créée');
    } catch (err) { next(err); }
  }
);

// ─── GET /public-campaigns/:id ────────────────────────────────────────────────
router.get('/:id', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const campaign = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        links: {
          include: { qrCodes: true, _count: { select: { submissions: true } } },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { submissions: true } },
      },
    });
    if (!campaign) throw new NotFoundError('Campagne introuvable');
    sendSuccess(res, campaign);
  } catch (err) { next(err); }
});

// ─── PATCH /public-campaigns/:id ─────────────────────────────────────────────
router.patch('/:id', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_UPDATE),
  validate(campaignUpdateSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const existing = await prisma.publicCampaign.findFirst({
        where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Campagne introuvable');

      const data = req.body as z.infer<typeof campaignUpdateSchema>;
      const updated = await prisma.publicCampaign.update({
        where: { id: req.params.id },
        data: {
          title:       data.title       ?? existing.title,
          description: data.description ?? existing.description,
          type:        data.type        ?? existing.type,
          scopeType:   data.scopeType   ?? existing.scopeType,
          scopeId:     data.scopeId     ?? existing.scopeId,
          settings:    data.settings ? (data.settings as Prisma.InputJsonObject) : (existing.settings as Prisma.InputJsonObject),
          startsAt:    data.startsAt ? new Date(data.startsAt) : existing.startsAt,
          endsAt:      data.endsAt   ? new Date(data.endsAt)   : existing.endsAt,
        },
      });

      await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'PublicCampaign', entityId: updated.id, req });
      sendSuccess(res, updated, 'Campagne mise à jour');
    } catch (err) { next(err); }
  }
);

// ─── POST /public-campaigns/:id/activate ─────────────────────────────────────
router.post('/:id/activate', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_ACTIVATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const existing = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Campagne introuvable');
    if (existing.status === 'ARCHIVED') throw new AppError("Impossible d'activer une campagne archivée", 409, 'CAMPAIGN_ARCHIVED');

    const newStatus = existing.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const updated = await prisma.publicCampaign.update({ where: { id: req.params.id }, data: { status: newStatus } });
    sendSuccess(res, updated, `Campagne ${newStatus === 'ACTIVE' ? 'activée' : 'suspendue'}`);
  } catch (err) { next(err); }
});

// ─── DELETE /public-campaigns/:id ─────────────────────────────────────────────
router.delete('/:id', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_DELETE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const existing = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Campagne introuvable');

    await prisma.publicCampaign.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'PublicCampaign', entityId: req.params.id, req });
    sendSuccess(res, null, 'Campagne archivée');
  } catch (err) { next(err); }
});

// ─── Duplicate ────────────────────────────────────────────────────────────────
router.post('/:id/duplicate', requirePermission(PERMISSIONS.PUBLIC_CAMPAIGNS_CREATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

    const existing = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Campagne introuvable');

    const copy = await prisma.publicCampaign.create({
      data: {
        tenantId,
        createdById: req.user!.id,
        title:       `${existing.title} (copie)`,
        description: existing.description,
        type:        existing.type,
        scopeType:   existing.scopeType,
        scopeId:     existing.scopeId,
        settings:    existing.settings as Prisma.InputJsonObject,
        status:      'DRAFT',
      },
    });
    sendCreated(res, copy, 'Campagne dupliquée');
  } catch (err) { next(err); }
});

// ─── Liens ────────────────────────────────────────────────────────────────────

router.get('/:id/links', requirePermission(PERMISSIONS.PUBLIC_LINKS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const campaign = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
    });
    if (!campaign) throw new NotFoundError('Campagne introuvable');

    const links = await prisma.publicLink.findMany({
      where: { campaignId: req.params.id },
      include: { qrCodes: true, _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, links);
  } catch (err) { next(err); }
});

router.post('/:id/links', requirePermission(PERMISSIONS.PUBLIC_LINKS_CREATE),
  validate(linkCreateSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');

      const campaign = await prisma.publicCampaign.findFirst({
        where: { id: req.params.id, tenantId, deletedAt: null },
      });
      if (!campaign) throw new NotFoundError('Campagne introuvable');

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const data   = req.body as z.infer<typeof linkCreateSchema>;
      const slug   = generateSlug(tenant?.slug);

      const link = await prisma.publicLink.create({
        data: {
          campaignId: req.params.id,
          slug,
          source:    data.source ?? 'DEFAULT',
          label:     data.label,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        },
      });

      sendCreated(res, { ...link, url: buildPublicUrl(slug) }, 'Lien créé');
    } catch (err) { next(err); }
  }
);

router.patch('/:id/links/:linkId', requirePermission(PERMISSIONS.PUBLIC_LINKS_CREATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const campaign = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
    });
    if (!campaign) throw new NotFoundError('Campagne introuvable');

    const link = await prisma.publicLink.findFirst({
      where: { id: req.params.linkId, campaignId: req.params.id },
    });
    if (!link) throw new NotFoundError('Lien introuvable');

    const updated = await prisma.publicLink.update({
      where: { id: req.params.linkId },
      data: {
        isActive:  req.body.isActive  !== undefined ? Boolean(req.body.isActive)  : link.isActive,
        label:     req.body.label     !== undefined ? String(req.body.label)      : link.label,
        expiresAt: req.body.expiresAt !== undefined ? new Date(req.body.expiresAt) : link.expiresAt,
      },
    });
    sendSuccess(res, updated);
  } catch (err) { next(err); }
});

// ─── QR Code generation ───────────────────────────────────────────────────────
router.post('/:id/links/:linkId/qr', requirePermission(PERMISSIONS.PUBLIC_QR_CODES_GENERATE),
  validate(qrGenerateSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const campaign = await prisma.publicCampaign.findFirst({
        where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      });
      if (!campaign) throw new NotFoundError('Campagne introuvable');

      const link = await prisma.publicLink.findFirst({
        where: { id: req.params.linkId, campaignId: req.params.id },
      });
      if (!link) throw new NotFoundError('Lien introuvable');

      const data = req.body as z.infer<typeof qrGenerateSchema>;
      const url  = buildPublicUrl(link.slug);

      let fileUrl: string;
      if (data.format === 'SVG') {
        const svgString = await QRCode.toString(url, {
          type: 'svg',
          color: { dark: data.foregroundColor, light: data.backgroundColor },
          width: data.width,
          margin: 2,
        });
        fileUrl = `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
      } else {
        fileUrl = await QRCode.toDataURL(url, {
          type: 'image/png',
          color: { dark: data.foregroundColor, light: data.backgroundColor },
          width: data.width,
          margin: 2,
        });
      }

      const qrAsset = await prisma.qrCodeAsset.create({
        data: {
          publicLinkId: link.id,
          format: data.format,
          fileUrl,
          label: data.label,
          designOptions: {
            foregroundColor: data.foregroundColor,
            backgroundColor: data.backgroundColor,
            width: data.width,
          } as Prisma.InputJsonObject,
        },
      });

      sendCreated(res, { ...qrAsset, url }, 'QR Code généré');
    } catch (err) { next(err); }
  }
);

// ─── Soumissions ──────────────────────────────────────────────────────────────

router.get('/:id/submissions', requirePermission(PERMISSIONS.PUBLIC_SUBMISSIONS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const campaign = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
    });
    if (!campaign) throw new NotFoundError('Campagne introuvable');

    const { page = 1, limit = 20 } = req.pagination ?? { page: 1, limit: 20 };
    const { status } = req.query as { status?: string };

    const where: Prisma.PublicSubmissionWhereInput = {
      campaignId: req.params.id,
      ...(status ? { status: status as Prisma.EnumSubmissionStatusFilter } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.publicSubmission.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { submittedAt: 'desc' },
        include: {
          actions:    { orderBy: { createdAt: 'desc' } },
          publicLink: { select: { slug: true, source: true, label: true } },
        },
      }),
      prisma.publicSubmission.count({ where }),
    ]);

    sendPaginated(res, items, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get('/:id/analytics', requirePermission(PERMISSIONS.PUBLIC_ANALYTICS_READ), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    const campaign = await prisma.publicCampaign.findFirst({
      where: { id: req.params.id, tenantId: tenantId ?? undefined, deletedAt: null },
      include: { _count: { select: { submissions: true } } },
    });
    if (!campaign) throw new NotFoundError('Campagne introuvable');

    const [metrics, bySource, recentSubmissions] = await Promise.all([
      prisma.publicCampaignMetric.findMany({
        where: { campaignId: req.params.id },
        orderBy: { date: 'asc' },
        take: 30,
      }),
      prisma.publicLink.findMany({
        where: { campaignId: req.params.id },
        include: { _count: { select: { submissions: true } } },
        orderBy: { scans: 'desc' },
      }),
      prisma.publicSubmission.findMany({
        where: { campaignId: req.params.id },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        include: { publicLink: { select: { source: true, label: true } } },
      }),
    ]);

    const totalViews       = metrics.reduce((s, m) => s + m.views, 0);
    const totalScans       = metrics.reduce((s, m) => s + m.scans, 0);
    const totalSubmissions = campaign._count.submissions;
    const conversionRate   = totalViews > 0 ? Math.round((totalSubmissions / totalViews) * 100) : 0;

    sendSuccess(res, {
      metrics,
      bySource,
      recentSubmissions,
      kpis: { totalViews, totalScans, totalSubmissions, conversionRate },
    });
  } catch (err) { next(err); }
});

export default router;
export { upsertDailyMetric };
