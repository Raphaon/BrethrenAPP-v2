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
import { getScopedSoulWhere } from '../../utils/scope-access.util';

function differenceInDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

const router = Router();
router.use(authenticate);

const soulCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  phone2: z.string().optional(),
  email: z.string().email().optional(),
  gender: z.enum(['MALE', 'FEMALE']),
  address: z.string().optional(),
  neighborhood: z.string().optional(),
  birthDate: z.string().optional(),
  assemblyId: z.string().uuid(),
  soulType: z.enum(['NA', 'NC']).default('NA'),
  ageRange: z.enum(['CHILD', 'TEEN', 'YOUNG_ADULT', 'ADULT', 'MIDDLE', 'SENIOR']).optional(),
  source: z.enum(['WORD_OF_MOUTH', 'INVITED_BY_MEMBER', 'SOCIAL_MEDIA', 'EVENT', 'WALK_IN', 'OTHER']).optional(),
  arrivalEventId: z.string().uuid().optional(),
  invitedByMemberId: z.string().uuid().optional(),
  inviterType: z.enum(['DISCIPLE_MAKER', 'MEMBER', 'CAMPAIGN', 'EXTERNAL']).optional(),
  consentToContact: z.boolean().default(true),
  transportNeeded: z.boolean().default(false),
  prayerNeeded: z.boolean().default(false),
  language: z.string().optional(),
  notes: z.string().optional(),
  profileType: z.enum(['VISITOR', 'NEW_CONVERT', 'ESTABLISHED_CHRISTIAN', 'RETURNING_MEMBER', 'SEEKER']).optional(),
  spiritualNeed: z.enum(['SPIRITUAL', 'SOCIAL', 'MATERIAL', 'FAMILY', 'INTEGRATION']).optional(),
});

const soulUpdateSchema = soulCreateSchema.partial().omit({ assemblyId: true });

const assignSchema = z.object({
  discipleMakerId: z.string().uuid(),
  familyId: z.string().uuid().optional(),
  isPrimary: z.boolean().default(true),
  reason: z.string().optional(),
});

const statusChangeSchema = z.object({
  status: z.enum([
    'NEW', 'CONTACTED', 'FOLLOWING_UP', 'INTEGRATED', 'INACTIVE',
    'ASSIGNED', 'VISITED', 'RETURNED_ONCE', 'RETURNED_TWICE', 'IN_FD',
    'IN_FOUNDATION', 'CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING',
    'DISCIPLE_MAKER_TRAINEE', 'DISCIPLE_MAKER', 'AT_RISK', 'TASK_FORCE', 'LOST', 'ARCHIVED',
  ]),
  notes: z.string().optional(),
});

const followupSchema = z.object({
  contactType: z.enum(['CALL', 'MESSAGE', 'VISIT', 'PRAYER', 'MEETING', 'OTHER']),
  notes: z.string().optional(),
  contactDate: z.string().optional(),
});

function computeRiskScore(soul: {
  lastContactDate: Date | null;
  lastCulteDate: Date | null;
  consecutiveAbsences: number;
  familyOfDisciplesId: string | null;
  status: string;
  firstVisitDate: Date;
}): number {
  let score = 0;
  const now = new Date();
  const daysSinceArrival = differenceInDays(now, soul.firstVisitDate);
  const daysSinceContact = soul.lastContactDate ? differenceInDays(now, soul.lastContactDate) : daysSinceArrival;

  if (!soul.lastContactDate && daysSinceArrival > 1) score += 20;
  if (daysSinceContact > 7 && soul.status !== 'VISITED') score += 15;
  if (soul.consecutiveAbsences >= 2) score += 20;
  if (!soul.lastCulteDate && daysSinceArrival > 14) score += 20;
  if (!soul.familyOfDisciplesId && daysSinceArrival > 14) score += 15;
  if (daysSinceContact > 7 && soul.status === 'AT_RISK') score += 25;

  return Math.min(score, 100);
}

const soulInclude = {
  assembly: { select: { id: true, name: true } },
  familyOfDisciples: { select: { id: true, name: true } },
  primaryMaker: { select: { id: true, member: { select: { id: true, firstName: true, lastName: true } } } },
  secondaryMaker: { select: { id: true, member: { select: { id: true, firstName: true, lastName: true } } } },
  mentor: { select: { id: true, firstName: true, lastName: true } },
};

// GET /souls
router.get('/', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { status, familyId, makerId, riskMin, riskMax, soulType, assemblyId, search } = req.query as Record<string, string>;

    const scopeWhere = await getScopedSoulWhere(req.user!);

    const where: Record<string, unknown> = {
      ...scopeWhere,
      deletedAt: null,
      ...(status && { status }),
      ...(soulType && { soulType }),
      ...(familyId && { familyOfDisciplesId: familyId }),
      ...(makerId && { OR: [{ primaryMakerProfileId: makerId }, { secondaryMakerProfileId: makerId }] }),
      ...(assemblyId && { assemblyId }),
      ...(riskMin || riskMax ? {
        riskScore: {
          ...(riskMin ? { gte: parseInt(riskMin) } : {}),
          ...(riskMax ? { lte: parseInt(riskMax) } : {}),
        },
      } : {}),
      ...(search ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [data, total] = await prisma.$transaction([
      prisma.newVisitor.findMany({ where: where as any, include: soulInclude, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.newVisitor.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /souls/stats/kpis
router.get('/stats/kpis', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const scopeWhere = await getScopedSoulWhere(req.user!);
    const base = { ...scopeWhere, deletedAt: null } as any;
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total, newLast7d, atRisk, inFd, consolidated, unassigned] = await Promise.all([
      prisma.newVisitor.count({ where: base }),
      prisma.newVisitor.count({ where: { ...base, createdAt: { gte: since7d } } }),
      prisma.newVisitor.count({ where: { ...base, status: 'AT_RISK' } }),
      prisma.newVisitor.count({ where: { ...base, status: 'IN_FD' } }),
      prisma.newVisitor.count({ where: { ...base, status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER'] } } }),
      prisma.newVisitor.count({ where: { ...base, familyOfDisciplesId: null, createdAt: { lte: since30d } } }),
    ]);

    sendSuccess(res, { total, newLast7d, atRisk, inFd, consolidated, unassigned });
  } catch (err) { next(err); }
});

// GET /souls/stats/alerts
router.get('/stats/alerts', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const scopeWhere = await getScopedSoulWhere(req.user!);
    const base = { ...scopeWhere, deletedAt: null } as any;

    const alerts = await prisma.newVisitor.findMany({
      where: { ...base, riskScore: { gte: 40 } },
      select: { id: true, firstName: true, lastName: true, riskScore: true, status: true, consecutiveAbsences: true, lastContactDate: true, assembly: { select: { id: true, name: true } } },
      orderBy: { riskScore: 'desc' },
      take: 50,
    });

    sendSuccess(res, alerts);
  } catch (err) { next(err); }
});

// GET /souls/:id
router.get('/:id', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        ...soulInclude,
        interactions: { orderBy: { createdAt: 'desc' }, take: 10 },
        assignments: { include: { discipleMaker: { include: { member: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { assignedAt: 'desc' } },
        recoveryCases: { orderBy: { openedAt: 'desc' }, take: 5 },
        followUpTasks: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, orderBy: { dueAt: 'asc' } },
      },
    });
    if (!soul) throw new NotFoundError('Âme');
    sendSuccess(res, soul);
  } catch (err) { next(err); }
});

// POST /souls
router.post('/', requirePermission(PERMISSIONS.SOULS_WRITE), validate(soulCreateSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof soulCreateSchema>;
    const soul = await prisma.newVisitor.create({
      data: { ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined },
      include: soulInclude,
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Soul', entityId: soul.id, req });
    sendCreated(res, soul, 'Âme créée');
  } catch (err) { next(err); }
});

// PATCH /souls/:id
router.patch('/:id', requirePermission(PERMISSIONS.SOULS_WRITE), validate(soulUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Âme');
    const dto = req.body as z.infer<typeof soulUpdateSchema>;
    const soul = await prisma.newVisitor.update({
      where: { id: req.params['id'] },
      data: { ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined },
      include: soulInclude,
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Soul', entityId: soul.id, req });
    sendSuccess(res, soul, 'Âme mise à jour');
  } catch (err) { next(err); }
});

// POST /souls/:id/assign
router.post('/:id/assign', requirePermission(PERMISSIONS.SOULS_ASSIGN), validate(assignSchema), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const dto = req.body as z.infer<typeof assignSchema>;

    const maker = await prisma.discipleMakerProfile.findUnique({ where: { id: dto.discipleMakerId }, include: { _count: { select: { primarySouls: true } } } });
    if (!maker) throw new NotFoundError('Faiseur de disciples');
    if (maker._count.primarySouls >= maker.maxLoad) throw new AppError(`Ce faiseur a atteint sa capacité maximale (${maker.maxLoad})`, 400, 'MAKER_OVERLOADED');

    await prisma.$transaction([
      prisma.soulAssignment.create({
        data: { soulId: soul.id, discipleMakerId: dto.discipleMakerId, assignedById: req.user!.id, familyId: dto.familyId, isPrimary: dto.isPrimary },
      }),
      prisma.newVisitor.update({
        where: { id: soul.id },
        data: {
          status: 'ASSIGNED',
          ...(dto.isPrimary ? { primaryMakerProfileId: dto.discipleMakerId } : { secondaryMakerProfileId: dto.discipleMakerId }),
          ...(dto.familyId ? { familyOfDisciplesId: dto.familyId, status: 'IN_FD' } : {}),
        },
      }),
    ]);

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Soul', entityId: soul.id, newValues: dto, req });
    sendSuccess(res, null, 'Âme affectée');
  } catch (err) { next(err); }
});

// POST /souls/:id/status
router.post('/:id/status', requirePermission(PERMISSIONS.SOULS_WRITE), validate(statusChangeSchema), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const { status, notes } = req.body as z.infer<typeof statusChangeSchema>;
    const updated = await prisma.newVisitor.update({ where: { id: req.params['id'] }, data: { status, notes: notes ?? soul.notes } });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Soul', entityId: soul.id, oldValues: { status: soul.status }, newValues: { status }, req });
    sendSuccess(res, updated, 'Statut mis à jour');
  } catch (err) { next(err); }
});

// POST /souls/:id/archive
router.post('/:id/archive', requirePermission(PERMISSIONS.SOULS_ARCHIVE), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    await prisma.newVisitor.update({ where: { id: req.params['id'] }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    sendSuccess(res, null, 'Âme archivée');
  } catch (err) { next(err); }
});

// GET /souls/:id/followups
router.get('/:id/followups', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const [data, total] = await prisma.$transaction([
      prisma.journeyInteraction.findMany({ where: { visitorId: req.params['id'] }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.journeyInteraction.count({ where: { visitorId: req.params['id'] } }),
    ]);
    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// POST /souls/:id/followups
router.post('/:id/followups', requirePermission(PERMISSIONS.SOULS_WRITE), validate(followupSchema), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const dto = req.body as z.infer<typeof followupSchema>;

    const interaction = await prisma.journeyInteraction.create({
      data: {
        visitorId: req.params['id'],
        authorId: req.user!.id,
        type: dto.contactType as any,
        notes: dto.notes ?? '',
        date: dto.contactDate ? new Date(dto.contactDate) : new Date(),
      },
    });

    const newRisk = computeRiskScore({ ...soul, lastContactDate: new Date() });
    await prisma.newVisitor.update({ where: { id: soul.id }, data: { lastContactDate: new Date(), riskScore: newRisk } });

    sendCreated(res, interaction, 'Suivi ajouté');
  } catch (err) { next(err); }
});

// GET /souls/:id/attendance
router.get('/:id/attendance', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const [data, total] = await prisma.$transaction([
      prisma.soulCulteAttendance.findMany({ where: { soulId: req.params['id'] }, orderBy: { culteDate: 'desc' }, skip, take: limit }),
      prisma.soulCulteAttendance.count({ where: { soulId: req.params['id'] } }),
    ]);
    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /souls/:id/journey
router.get('/:id/journey', requirePermission(PERMISSIONS.SOULS_READ), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const journeys = await prisma.soulConsolidationJourney.findMany({
      where: { soulId: req.params['id'] },
      include: {
        template: true,
        steps: { include: { stepTemplate: true }, orderBy: { stepTemplate: { order: 'asc' } } },
      },
    });
    sendSuccess(res, journeys);
  } catch (err) { next(err); }
});

// POST /souls/:id/journey/start
router.post('/:id/journey/start', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), async (req, res, next) => {
  try {
    const soul = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');
    const { templateId } = z.object({ templateId: z.string().uuid() }).parse(req.body);

    const template = await prisma.consolidationJourneyTemplate.findUnique({ where: { id: templateId }, include: { steps: true } });
    if (!template) throw new NotFoundError('Template de parcours');

    const existing = await prisma.soulConsolidationJourney.findUnique({ where: { soulId_templateId: { soulId: soul.id, templateId } } });
    if (existing && existing.status === 'IN_PROGRESS') throw new AppError('Un parcours de ce type est déjà en cours', 409, 'JOURNEY_ALREADY_ACTIVE');

    const journey = await prisma.$transaction(async (tx) => {
      const j = await tx.soulConsolidationJourney.create({ data: { soulId: soul.id, templateId, status: 'IN_PROGRESS' } });
      await tx.soulJourneyStepProgress.createMany({
        data: template.steps.map((s) => ({ journeyId: j.id, stepTemplateId: s.id, status: 'PENDING' })),
      });
      return j;
    });

    sendCreated(res, journey, 'Parcours démarré');
  } catch (err) { next(err); }
});

export default router;
