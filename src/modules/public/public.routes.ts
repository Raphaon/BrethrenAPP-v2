import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { validate } from '../../middlewares/validate.middleware';
import { sendCreated, sendSuccess } from '../../utils/response.util';
import { publicService } from './public.service';
import { signupSchema, type SignupDto } from './public.validation';
import { prisma } from '../../database/prisma';
import { upsertDailyMetric } from '../public-campaigns/public-campaigns.routes';

// Rate limit strict pour la creation de comptes : 5 tentatives/IP/heure
// Protege contre la creation massive d'organisations (spam, abus)
const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives de creation de compte. Reessayez dans une heure.' },
});

const router = Router();

// ─── GET /public/churches ─────────────────────────────────────────────────────
// Endpoint public (sans auth) pour la carte des églises
// Retourne assemblées + points de prédication avec coordonnées
router.get('/churches', async (_req, res, next) => {
  try {
    const [assemblies, preachingPoints] = await Promise.all([
      prisma.assembly.findMany({
        where: { deletedAt: null, latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          phone: true,
          email: true,
          status: true,
          district: {
            select: {
              id: true, name: true,
              region: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.preachingPoint.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          phone: true,
          assembly: { select: { id: true, name: true } },
        },
      }),
    ]);

    const churches = [
      ...assemblies.map((a) => ({
        id: a.id,
        name: a.name,
        type: 'ASSEMBLY' as const,
        address: a.address,
        latitude: a.latitude!,
        longitude: a.longitude!,
        phone: a.phone,
        email: a.email,
        district: a.district?.name,
        region: a.district?.region?.name,
      })),
      ...preachingPoints.map((p) => ({
        id: p.id,
        name: p.name,
        type: 'PREACHING_POINT' as const,
        address: p.address,
        latitude: p.latitude!,
        longitude: p.longitude!,
        phone: p.phone,
        email: null,
        district: null,
        region: null,
        parentAssembly: p.assembly?.name,
      })),
    ];

    sendSuccess(res, churches);
  } catch (err) {
    next(err);
  }
});

router.get('/plans', async (_req, res, next) => {
  try {
    const plans = await publicService.listPlans();
    sendSuccess(res, plans);
  } catch (err) {
    next(err);
  }
});

router.post('/signup', signupRateLimit, validate(signupSchema), async (req, res, next) => {
  try {
    const result = await publicService.signup(req.body as SignupDto, req);
    sendCreated(res, result, 'Espace cree avec succes');
  } catch (err) {
    next(err);
  }
});

// Alias de /signup — meme handler, meme protection
router.post('/create-tenant', signupRateLimit, validate(signupSchema), async (req, res, next) => {
  try {
    const result = await publicService.signup(req.body as SignupDto, req);
    sendCreated(res, result, 'Espace cree avec succes');
  } catch (err) {
    next(err);
  }
});

// ─── Rate limit strict pour les soumissions publiques ─────────────────────────
const submitRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de soumissions. Réessayez dans 15 minutes.' },
});

// ─── GET /public/p/:slug ──────────────────────────────────────────────────────
// Retourne les données de la campagne pour afficher la page publique
router.get('/p/:slug', async (req, res, next) => {
  try {
    const link = await prisma.publicLink.findUnique({
      where: { slug: req.params.slug },
      include: {
        campaign: {
          include: {
            metrics: false,
            links: false,
            submissions: false,
          },
        },
      },
    });

    if (!link) { res.status(404).json({ success: false, message: 'Page introuvable', code: 'NOT_FOUND' }); return; }
    if (!link.isActive) { res.status(410).json({ success: false, message: 'Ce lien est désactivé', code: 'LINK_DISABLED' }); return; }
    if (link.expiresAt && link.expiresAt < new Date()) {
      res.status(410).json({ success: false, message: 'Ce lien a expiré', code: 'LINK_EXPIRED' }); return;
    }
    if (link.campaign.status !== 'ACTIVE') {
      res.status(410).json({ success: false, message: 'Cette campagne est terminée', code: 'CAMPAIGN_INACTIVE' }); return;
    }

    // Incrémente les vues
    await Promise.all([
      prisma.publicLink.update({ where: { id: link.id }, data: { scans: { increment: 1 } } }),
      upsertDailyMetric(link.campaignId, 'views'),
    ]);

    // Récupère info du tenant pour le branding
    const tenant = await prisma.tenant.findUnique({
      where: { id: link.campaign.tenantId },
      select: { name: true, logo: true, country: true, currency: true, language: true },
    });

    sendSuccess(res, {
      campaign: {
        id:          link.campaign.id,
        title:       link.campaign.title,
        description: link.campaign.description,
        type:        link.campaign.type,
        scopeType:   link.campaign.scopeType,
        scopeId:     link.campaign.scopeId,
        settings:    link.campaign.settings,
        endsAt:      link.campaign.endsAt,
      },
      link: {
        slug: link.slug,
        source: link.source,
      },
      tenant,
    });
  } catch (err) { next(err); }
});

// ─── POST /public/p/:slug/submit ──────────────────────────────────────────────
// Traite la soumission du formulaire public (sans auth)
router.post('/p/:slug/submit', submitRateLimit, async (req, res, next) => {
  try {
    const link = await prisma.publicLink.findUnique({
      where: { slug: req.params.slug },
      include: { campaign: true },
    });

    if (!link) { res.status(404).json({ success: false, message: 'Page introuvable' }); return; }
    if (!link.isActive || link.campaign.status !== 'ACTIVE') {
      res.status(410).json({ success: false, message: 'Cette campagne est terminée' }); return;
    }

    const rawIp  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? '';
    const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex');

    const submission = await prisma.publicSubmission.create({
      data: {
        tenantId:       link.campaign.tenantId,
        campaignId:     link.campaignId,
        publicLinkId:   link.id,
        ipHash,
        userAgent:      req.headers['user-agent'] ?? '',
        sourceMetadata: { source: link.source, slug: link.slug },
        payload:        req.body ?? {},
        status:         'RECEIVED',
      },
    });

    // Traitement asynchrone des actions (ne bloque pas la réponse)
    void processSubmissionActions(submission.id, link.campaign.type, link.campaign.tenantId, req.body, link.campaign.settings as Record<string, unknown>);

    await Promise.all([
      prisma.publicLink.update({ where: { id: link.id }, data: { scans: { increment: 1 } } }),
      upsertDailyMetric(link.campaignId, 'submissions'),
    ]);

    sendCreated(res, { submissionId: submission.id }, 'Votre demande a bien été reçue');
  } catch (err) { next(err); }
});

// ─── Traitement des actions post-soumission ───────────────────────────────────
async function processSubmissionActions(
  submissionId: string,
  campaignType: string,
  _tenantId: string,
  payload: Record<string, unknown>,
  _settings: Record<string, unknown>,
) {
  const createAction = async (actionType: string, targetEntityType?: string, targetEntityId?: string) => {
    await prisma.publicSubmissionAction.create({
      data: {
        submissionId,
        actionType: actionType as never,
        targetEntityType,
        targetEntityId,
        status: 'PENDING',
      },
    });
  };

  try {
    if (campaignType === 'VISITOR_REGISTRATION') {
      // Cherche l'assemblée selon le scopeId de la campagne
      const submission = await prisma.publicSubmission.findUnique({ where: { id: submissionId }, include: { campaign: true } });
      const assemblyId = submission?.campaign.scopeId;

      if (assemblyId) {
        const visitor = await prisma.newVisitor.create({
          data: {
            firstName:     String(payload.firstName ?? ''),
            lastName:      String(payload.lastName ?? ''),
            phone:         payload.phone ? String(payload.phone) : null,
            email:         payload.email ? String(payload.email) : null,
            gender:        (payload.gender as 'MALE' | 'FEMALE') ?? 'MALE',
            address:       payload.neighborhood ? String(payload.neighborhood) : null,
            neighborhood:  payload.neighborhood ? String(payload.neighborhood) : null,
            assemblyId,
            notes:         payload.notes ? String(payload.notes) : null,
            source:        'WALK_IN',
            consentToContact: Boolean(payload.consentToContact ?? true),
          },
        });
        await createAction('CREATE_NEW_VISITOR', 'NewVisitor', visitor.id);
      }
    } else if (campaignType === 'DONATION') {
      await createAction('CREATE_DONATION');
    } else if (campaignType === 'PRAYER_REQUEST') {
      await createAction('CREATE_PRAYER_REQUEST');
    } else {
      await createAction('SEND_NOTIFICATION');
    }

    // Marquer la soumission comme traitée
    await prisma.publicSubmission.update({
      where: { id: submissionId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    await upsertDailyMetric(
      (await prisma.publicSubmission.findUnique({ where: { id: submissionId } }))!.campaignId,
      'successfulActions',
    );
  } catch (err) {
    await prisma.publicSubmission.update({
      where: { id: submissionId },
      data: { status: 'FAILED' },
    });
    await createAction('SEND_NOTIFICATION', 'error', String(err));
  }
}

export default router;
