import { Router } from 'express';
import { BaptismStatus, JourneyContactType, JourneyStatus, MemberStatus, Prisma, VisitorProfileType, SpiritualNeed, NewcomerSource } from '@prisma/client';
import { z } from 'zod';
import { flexDateOptional, optionalEmail } from '../../utils/zod.util';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { createAuditLog } from '../../utils/audit.util';
import { assertAssemblyAccess, getScopedAssemblyWhere } from '../../utils/scope-access.util';

// ─── Génération de matricule ──────────────────────────────────────────────────
// Utilise count+1 comme base, mais le appelant doit gérer un retry sur erreur P2002
// pour éviter les collisions en cas de requêtes concurrentes.
async function generateMatricule(assemblyId: string, tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>, attempt = 0): Promise<string> {
  const assembly = await tx.assembly.findUnique({ where: { id: assemblyId }, select: { code: true } });
  const code = (assembly?.code ?? 'ASM').toUpperCase();
  const year = new Date().getFullYear();
  const count = await tx.member.count({ where: { assemblyId } });
  // Décalage aléatoire en cas de retry pour éviter la même collision en boucle
  const seq = String(count + 1 + attempt).padStart(4, '0');
  return `${code}-${year}-${seq}`;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createVisitorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']),
  phone: z.string().optional().nullable(),
  email: optionalEmail,
  address: z.string().optional().nullable(),
  birthDate: flexDateOptional,
  firstVisitDate: flexDateOptional,
  assemblyId: z.string().uuid(),
  source: z.nativeEnum(NewcomerSource).optional(),
  notes: z.string().optional().nullable(),
});

// source est déjà dans createVisitorSchema — partial() + omit(assemblyId) le conserve
const updateVisitorSchema = createVisitorSchema.partial().omit({ assemblyId: true });

// Mise à jour d'une étape du parcours
const updateStepSchema = z.object({
  // Étape 1 — Accueillir
  welcomeCallMade: z.boolean().optional(),
  welcomeCallDate: flexDateOptional,
  giftGiven: z.boolean().optional(),

  // Étape 2 — Évaluer
  profileType: z.nativeEnum(VisitorProfileType).optional(),
  spiritualNeed: z.nativeEnum(SpiritualNeed).optional(),
  orientedDepartment: z.string().max(100).optional().nullable(),
  profileDiagnosed: z.boolean().optional(),
  diagnosisDate: flexDateOptional,

  // Étape 3 — Mentor
  mentorId: z.string().uuid().optional().nullable(),

  // Étape 4 — Enseigner
  courseEnrolled: z.boolean().optional(),
  courseEnrolledDate: flexDateOptional,
  cellGroupId: z.string().uuid().optional().nullable(),
  cellGroupAssigned: z.boolean().optional(),
  baptismStatus: z.nativeEnum(BaptismStatus).optional(),
  baptismDate: flexDateOptional,

  // Étape 5 — Engager
  ministryId: z.string().uuid().optional().nullable(),
  ministryAssigned: z.boolean().optional(),
  integrationScore: z.coerce.number().int().min(0).max(100).optional(),

  // Avancement automatique
  currentStep: z.coerce.number().int().min(1).max(5).optional(),
  journeyStatus: z.nativeEnum(JourneyStatus).optional(),
}).strict();

const closeJourneySchema = z.object({
  journeyStatus: z.enum([
    JourneyStatus.INTEGRATED,
    JourneyStatus.RELAUNCHED,
    JourneyStatus.TRANSFERRED,
    JourneyStatus.CLOSED,
  ]),
  integrationScore: z.coerce.number().int().min(0).max(100).optional(),
  closureReason: z.string().max(500).optional(),
});

const interactionSchema = z.object({
  type: z.nativeEnum(JourneyContactType),
  date: flexDateOptional,
  notes: z.string().min(1).max(2000),
});

// Legacy contact schema (backward compat)
const contactSchema = z.object({
  contactType: z.enum(['FIRST_CALL', 'SECOND_CALL', 'THIRD_CALL', 'OTHER_CALL', 'VISIT', 'WELCOME_MESSAGE', 'OTHER']),
  contactDate: flexDateOptional,
  notes: z.string().optional().nullable(),
  contactedBy: z.string().optional().nullable(),
});

// ─── Includes réutilisables ───────────────────────────────────────────────────

const visitorInclude = {
  assembly: { select: { id: true, name: true } },
  contacts: { orderBy: { contactDate: 'desc' as const }, take: 1 },
} satisfies Prisma.NewVisitorInclude;

const visitorIncludeFull = {
  assembly: { select: { id: true, name: true } },
  contacts: { orderBy: { contactDate: 'desc' as const } },
} satisfies Prisma.NewVisitorInclude;

// ─── Intégration (extrait pour permettre le retry sur P2002) ─────────────────

type ExistingVisitor = Awaited<ReturnType<typeof prisma.newVisitor.findUnique>> & NonNullable<unknown>;
type CloseDto = { journeyStatus: JourneyStatus; integrationScore?: number; closureReason?: string };

async function runIntegration(existing: ExistingVisitor, dto: CloseDto, attempt: number) {
  return prisma.$transaction(async (tx) => {
    const matricule = await generateMatricule(existing.assemblyId, tx, attempt);

    const alreadyBaptized =
      existing.baptismStatus === BaptismStatus.ALREADY_BAPTIZED ||
      existing.baptismStatus === BaptismStatus.BAPTIZED_HERE;

    const member = await tx.member.create({
      data: {
        matricule,
        firstName: existing.firstName,
        lastName: existing.lastName,
        gender: existing.gender,
        phone: existing.phone ?? undefined,
        email: existing.email ?? undefined,
        address: existing.address ?? undefined,
        birthDate: existing.birthDate ?? undefined,
        assemblyId: existing.assemblyId,
        isBaptized: alreadyBaptized,
        baptismDate: existing.baptismDate ?? undefined,
        memberSince: new Date(),
        status: MemberStatus.ACTIVE,
        notes: `Converti depuis le parcours nouveaux (visiteur #${existing.id})`,
      },
    });

    const visitor = await tx.newVisitor.update({
      where: { id: existing.id },
      data: {
        journeyStatus: JourneyStatus.INTEGRATED,
        integrationScore: dto.integrationScore,
        closureReason: dto.closureReason,
        closedAt: new Date(),
        currentStep: 5,
        status: 'INTEGRATED',
        convertedMemberId: member.id,
      },
      include: {
        ...visitorInclude,
        convertedMember: { select: { id: true, matricule: true, firstName: true, lastName: true, status: true } },
      },
    });

    return { visitor, member };
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// ══════════════════════════════════════════════════════════════════════════════
// CRUD DE BASE
// ══════════════════════════════════════════════════════════════════════════════

// GET / — liste avec filtres avancés
// Par défaut : exclut les visiteurs INTEGRATED et INACTIVE.
// Passer ?archived=true pour les voir aussi.
// Passer ?status=INTEGRATED pour cibler un statut précis.
router.get('/', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const { search, assemblyId, status, currentStep, mentorId, archived, dateFrom, dateTo } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    // Scope territorial : restreint automatiquement aux assemblées accessibles
    const scopedAssemblyFilter = await getScopedAssemblyWhere(req.user!);

    // Filtre par défaut : parcours actifs seulement (status existant avant migration)
    let statusFilter: Prisma.NewVisitorWhereInput = {};
    if (status) {
      statusFilter = { status: status as any };
    } else if (archived !== 'true') {
      statusFilter = { status: { notIn: ['INTEGRATED', 'INACTIVE'] as any[] } };
    }

    const parsedDateFrom = dateFrom ? new Date(dateFrom) : undefined;
    const parsedDateTo = dateTo ? new Date(dateTo) : undefined;
    if (parsedDateTo) parsedDateTo.setHours(23, 59, 59, 999);

    const where: Prisma.NewVisitorWhereInput = {
      deletedAt: null,
      ...statusFilter,
      // Le filtre de scope s'applique via la relation assembly
      assembly: scopedAssemblyFilter,
      // Si un assemblyId explicite est passé, on l'applique en plus (mais le scope peut le bloquer)
      ...(assemblyId && { assemblyId }),
      ...(currentStep && { currentStep: Number(currentStep) }),
      ...(mentorId && { mentorId }),
      ...((parsedDateFrom || parsedDateTo) && {
        firstVisitDate: {
          ...(parsedDateFrom && { gte: parsedDateFrom }),
          ...(parsedDateTo && { lte: parsedDateTo }),
        },
      }),
      ...(search && {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { phone: { contains: search } },
          { email: { contains: search } },
        ],
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.newVisitor.findMany({
        where,
        include: visitorInclude,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.newVisitor.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /:id — détail complet
router.get('/:id', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const visitor = await prisma.newVisitor.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: visitorIncludeFull,
    });
    if (!visitor) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, visitor.assemblyId);
    sendSuccess(res, visitor);
  } catch (err) { next(err); }
});

// POST / — créer un nouveau visiteur
router.post('/', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(createVisitorSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createVisitorSchema>;
    // Vérifie que l'acteur a accès à l'assemblée cible
    await assertAssemblyAccess(req.user!, dto.assemblyId);
    const visitor = await prisma.newVisitor.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        notes: dto.notes,
        source: dto.source,
        assemblyId: dto.assemblyId,
        birthDate: dto.birthDate ? new Date(dto.birthDate as string) : null,
        firstVisitDate: dto.firstVisitDate ? new Date(dto.firstVisitDate as string) : new Date(),
      },
      include: visitorInclude,
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'NewVisitor', entityId: visitor.id, newValues: visitor as any, req });
    sendCreated(res, visitor, 'Visiteur enregistré');
  } catch (err) { next(err); }
});

// PATCH /:id — mise à jour des infos de base
router.patch('/:id', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(updateVisitorSchema), async (req, res, next) => {
  try {
    const existing = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    const dto = req.body as z.infer<typeof updateVisitorSchema>;
    const visitor = await prisma.newVisitor.update({
      where: { id: req.params['id'] },
      data: {
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate as string) : undefined,
        firstVisitDate: dto.firstVisitDate ? new Date(dto.firstVisitDate as string) : undefined,
      },
      include: visitorInclude,
    });
    sendSuccess(res, visitor, 'Visiteur mis à jour');
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', requirePermission(PERMISSIONS.MEMBERS_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    await prisma.newVisitor.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Visiteur supprimé');
  } catch (err) { next(err); }
});

// ── Guard migration ──────────────────────────────────────────────────────────
// Les routes ci-dessous utilisent des colonnes ajoutées par la migration
// add_shop_and_journey. Si la migration n'a pas encore été appliquée,
// elles retournent 503 avec un message explicite.
async function requireJourneyMigration(_req: any, res: any, next: any) {
  try {
    // Teste l'existence de la colonne currentStep
    await prisma.$queryRaw`SELECT "currentStep" FROM "new_visitors" LIMIT 1`;
    next();
  } catch {
    res.status(503).json({
      success: false,
      message: 'Migration requise. Lance : npx prisma migrate dev --name add_shop_and_journey',
      code: 'MIGRATION_PENDING',
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PARCOURS — GESTION DES ÉTAPES (disponibles après migration)
// ══════════════════════════════════════════════════════════════════════════════

// PATCH /:id/step — mettre à jour les données d'une étape et avancer si nécessaire
router.patch('/:id/step', requirePermission(PERMISSIONS.MEMBERS_WRITE), requireJourneyMigration, validate(updateStepSchema), async (req, res, next) => {
  try {
    const existing = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, existing.assemblyId);

    const dto = req.body as z.infer<typeof updateStepSchema>;

    // Calculer automatiquement l'avancement si les checkpoints de l'étape actuelle sont remplis
    let nextStep = existing.currentStep;
    const merged = { ...existing, ...dto };

    if (dto.currentStep) {
      nextStep = dto.currentStep;
    } else {
      // Auto-avance basée sur les checkpoints
      if (nextStep === 1 && merged.welcomeCallMade && merged.giftGiven) nextStep = 2;
      else if (nextStep === 2 && merged.profileDiagnosed) nextStep = 3;
      else if (nextStep === 3 && merged.mentorId) nextStep = 4;
      else if (nextStep === 4 && merged.courseEnrolled && merged.cellGroupAssigned) nextStep = 5;
    }

    const data: Prisma.NewVisitorUpdateInput = {
      ...dto,
      currentStep: nextStep,
      welcomeCallDate: dto.welcomeCallDate ? new Date(dto.welcomeCallDate as string) : undefined,
      diagnosisDate: dto.diagnosisDate ? new Date(dto.diagnosisDate as string) : undefined,
      courseEnrolledDate: dto.courseEnrolledDate ? new Date(dto.courseEnrolledDate as string) : undefined,
      baptismDate: dto.baptismDate ? new Date(dto.baptismDate as string) : undefined,
      ...(dto.mentorId !== undefined && { mentorAssignedDate: dto.mentorId ? new Date() : null }),
    };

    const visitor = await prisma.newVisitor.update({
      where: { id: req.params['id'] },
      data,
      include: visitorIncludeFull,
    });

    const stepName = ['', 'Accueillir', 'Évaluer', 'Assigner un mentor', 'Enseigner', 'Engager'][nextStep] ?? '';
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'NewVisitor', entityId: visitor.id, oldValues: { step: existing.currentStep }, newValues: { step: nextStep }, req });
    sendSuccess(res, visitor, `Étape ${nextStep} — ${stepName}`);
  } catch (err) { next(err); }
});

// POST /:id/close — clôturer ; si INTEGRATED → crée automatiquement le membre
router.post('/:id/close', requirePermission(PERMISSIONS.MEMBERS_WRITE), requireJourneyMigration, validate(closeJourneySchema), async (req, res, next) => {
  try {
    const existing = await prisma.newVisitor.findUnique({
      where: { id: req.params['id'], deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    const dto = req.body as z.infer<typeof closeJourneySchema>;

    // ── Intégration → conversion automatique en membre ──────────────────────
    if (dto.journeyStatus === JourneyStatus.INTEGRATED) {
      if (existing.convertedMemberId) {
        throw new ForbiddenError('Ce visiteur est déjà converti en membre (id: ' + existing.convertedMemberId + ')');
      }

      // Retry jusqu'à 5 fois en cas de collision @unique sur matricule (P2002)
      let result!: Awaited<ReturnType<typeof runIntegration>>;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          result = await runIntegration(existing, dto, attempt);
          break;
        } catch (err: any) {
          if (err?.code === 'P2002' && err?.meta?.target?.includes('matricule') && attempt < 4) continue;
          throw err;
        }
      }

      await createAuditLog({
        actorId: req.user!.id,
        action: 'CREATE',
        entityType: 'Member',
        entityId: result.member.id,
        newValues: { source: 'newcomer_journey', visitorId: existing.id, matricule: result.member.matricule },
        req,
      });

      sendSuccess(res, result, `Intégration complète — Matricule ${result.member.matricule} attribué ✓`);
      return;
    }

    // ── Autres statuts (RELAUNCHED, TRANSFERRED, CLOSED) ────────────────────
    const visitor = await prisma.newVisitor.update({
      where: { id: req.params['id'] },
      data: {
        journeyStatus: dto.journeyStatus,
        integrationScore: dto.integrationScore,
        closureReason: dto.closureReason,
        closedAt: new Date(),
      },
      include: visitorInclude,
    });

    const labels: Record<string, string> = {
      RELAUNCHED: 'Parcours relancé — Suivi réactivé',
      TRANSFERRED: 'Parcours clôturé — Membre transféré',
      CLOSED: 'Parcours clôturé',
    };
    sendSuccess(res, { visitor }, labels[dto.journeyStatus] ?? 'Parcours mis à jour');
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// INTERACTIONS — JOURNAL DE SUIVI
// ══════════════════════════════════════════════════════════════════════════════

// GET /:id/interactions — historique complet
router.get('/:id/interactions', requirePermission(PERMISSIONS.MEMBERS_READ), requireJourneyMigration, async (req, res, next) => {
  try {
    const visitor = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!visitor) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, visitor.assemblyId);
    const interactions = await prisma.journeyInteraction.findMany({
      where: { visitorId: req.params['id'] },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { date: 'desc' },
    });
    sendSuccess(res, interactions);
  } catch (err) { next(err); }
});

// POST /:id/interactions — ajouter une interaction au journal
router.post('/:id/interactions', requirePermission(PERMISSIONS.MEMBERS_WRITE), requireJourneyMigration, validate(interactionSchema), async (req, res, next) => {
  try {
    const visitor = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!visitor) throw new NotFoundError('Visiteur');
    await assertAssemblyAccess(req.user!, visitor.assemblyId);
    const dto = req.body as z.infer<typeof interactionSchema>;
    const interaction = await prisma.journeyInteraction.create({
      data: {
        visitorId: req.params['id'],
        authorId: req.user!.id,
        type: dto.type,
        date: dto.date ? new Date(dto.date as string) : new Date(),
        notes: dto.notes,
      },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    sendCreated(res, interaction, 'Interaction enregistrée');
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATISTIQUES — ENTONNOIR DU PARCOURS
// ══════════════════════════════════════════════════════════════════════════════

// GET /stats — statistiques du funnel par assemblée
router.get('/stats/funnel', requirePermission(PERMISSIONS.MEMBERS_READ), requireJourneyMigration, async (req, res, next) => {
  try {
    const { assemblyId } = req.query as Record<string, string>;
    const baseWhere: Prisma.NewVisitorWhereInput = {
      deletedAt: null,
      ...(assemblyId && { assemblyId }),
    };

    const [
      total,
      step1, step2, step3, step4, step5,
      integrated, relaunched, transferred, closed,
      welcomeCallDone, baptizedHere, ministryActive,
    ] = await prisma.$transaction([
      prisma.newVisitor.count({ where: baseWhere }),
      prisma.newVisitor.count({ where: { ...baseWhere, currentStep: 1 } }),
      prisma.newVisitor.count({ where: { ...baseWhere, currentStep: 2 } }),
      prisma.newVisitor.count({ where: { ...baseWhere, currentStep: 3 } }),
      prisma.newVisitor.count({ where: { ...baseWhere, currentStep: 4 } }),
      prisma.newVisitor.count({ where: { ...baseWhere, currentStep: 5 } }),
      prisma.newVisitor.count({ where: { ...baseWhere, journeyStatus: JourneyStatus.INTEGRATED } }),
      prisma.newVisitor.count({ where: { ...baseWhere, journeyStatus: JourneyStatus.RELAUNCHED } }),
      prisma.newVisitor.count({ where: { ...baseWhere, journeyStatus: JourneyStatus.TRANSFERRED } }),
      prisma.newVisitor.count({ where: { ...baseWhere, journeyStatus: JourneyStatus.CLOSED } }),
      prisma.newVisitor.count({ where: { ...baseWhere, welcomeCallMade: true } }),
      prisma.newVisitor.count({ where: { ...baseWhere, baptismStatus: BaptismStatus.BAPTIZED_HERE } }),
      prisma.newVisitor.count({ where: { ...baseWhere, ministryAssigned: true } }),
    ]);

    sendSuccess(res, {
      total,
      funnel: { step1, step2, step3, step4, step5 },
      status: { integrated, relaunched, transferred, closed, active: total - integrated - closed },
      kpi: {
        welcomeCallRate: total ? Math.round((welcomeCallDone / total) * 100) : 0,
        baptismRate: total ? Math.round((baptizedHere / total) * 100) : 0,
        ministryRate: total ? Math.round((ministryActive / total) * 100) : 0,
        integrationRate: total ? Math.round((integrated / total) * 100) : 0,
      },
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTACTS (backward compat)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:id/contacts', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(contactSchema), async (req, res, next) => {
  try {
    const visitor = await prisma.newVisitor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!visitor) throw new NotFoundError('Visiteur');
    const dto = req.body as z.infer<typeof contactSchema>;
    const contact = await prisma.newVisitorContact.create({
      data: {
        newVisitorId: req.params['id'],
        ...dto,
        contactDate: dto.contactDate ? new Date(dto.contactDate as string) : new Date(),
        contactedBy: dto.contactedBy ?? req.user!.id,
      },
    });
    sendCreated(res, contact, 'Contact enregistré');
  } catch (err) { next(err); }
});

router.delete('/:id/contacts/:contactId', requirePermission(PERMISSIONS.MEMBERS_WRITE), async (req, res, next) => {
  try {
    await prisma.newVisitorContact.delete({ where: { id: req.params['contactId'] } });
    sendSuccess(res, null, 'Contact supprimé');
  } catch (err) { next(err); }
});

export default router;
