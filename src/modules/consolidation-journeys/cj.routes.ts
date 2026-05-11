import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

const templateCreateSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  durationDays: z.number().int().min(1).default(30),
  isDefault: z.boolean().default(false),
  steps: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    dueAfterDays: z.number().int().min(0),
    order: z.number().int().min(1),
    isRequired: z.boolean().default(true),
    stepType: z.enum(['WELCOME_CALL', 'VISIT', 'LESSON', 'FD_INTEGRATION', 'BAPTISM_PREP', 'REVIEW', 'OTHER']).default('OTHER'),
  })).optional().default([]),
});

const templateUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  durationDays: z.number().int().min(1).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();

const stepUpdateSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']),
  notes: z.string().optional(),
});

const templateInclude = {
  steps: { orderBy: { order: 'asc' as const } },
  _count: { select: { journeys: true } },
};

// GET /consolidation-journeys/templates
router.get('/templates', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), async (req, res, next) => {
  try {
    const { tenantId } = req.query as Record<string, string>;
    const templates = await prisma.consolidationJourneyTemplate.findMany({
      where: { ...(tenantId && { tenantId }), isActive: true },
      include: templateInclude,
      orderBy: { isDefault: 'desc' },
    });
    sendSuccess(res, templates);
  } catch (err) { next(err); }
});

// GET /consolidation-journeys/templates/:id
router.get('/templates/:id', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), async (req, res, next) => {
  try {
    const template = await prisma.consolidationJourneyTemplate.findUnique({ where: { id: req.params['id'] }, include: templateInclude });
    if (!template) throw new NotFoundError('Template de parcours');
    sendSuccess(res, template);
  } catch (err) { next(err); }
});

// POST /consolidation-journeys/templates
router.post('/templates', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), validate(templateCreateSchema), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Tenant requis', 400, 'TENANT_REQUIRED');
    const { steps, ...dto } = req.body as z.infer<typeof templateCreateSchema>;

    if (dto.isDefault) {
      await prisma.consolidationJourneyTemplate.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
    }

    const template = await prisma.consolidationJourneyTemplate.create({
      data: {
        ...dto,
        tenantId,
        steps: { createMany: { data: steps } },
      },
      include: templateInclude,
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'ConsolidationJourneyTemplate', entityId: template.id, req });
    sendCreated(res, template, 'Template créé');
  } catch (err) { next(err); }
});

// PATCH /consolidation-journeys/templates/:id
router.patch('/templates/:id', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), validate(templateUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.consolidationJourneyTemplate.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Template de parcours');

    const dto = req.body as z.infer<typeof templateUpdateSchema>;
    if (dto.isDefault) {
      await prisma.consolidationJourneyTemplate.updateMany({ where: { tenantId: existing.tenantId, isDefault: true }, data: { isDefault: false } });
    }

    const template = await prisma.consolidationJourneyTemplate.update({ where: { id: req.params['id'] }, data: dto, include: templateInclude });
    sendSuccess(res, template, 'Template mis à jour');
  } catch (err) { next(err); }
});

// DELETE /consolidation-journeys/templates/:id
router.delete('/templates/:id', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), async (req, res, next) => {
  try {
    const existing = await prisma.consolidationJourneyTemplate.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Template de parcours');
    await prisma.consolidationJourneyTemplate.update({ where: { id: req.params['id'] }, data: { isActive: false } });
    sendSuccess(res, null, 'Template désactivé');
  } catch (err) { next(err); }
});

// PATCH /consolidation-journeys/:journeyId/steps/:stepId
router.patch('/:journeyId/steps/:stepId', requirePermission(PERMISSIONS.CONSOLIDATION_JOURNEYS_MANAGE), validate(stepUpdateSchema), async (req, res, next) => {
  try {
    const journey = await prisma.soulConsolidationJourney.findUnique({ where: { id: req.params['journeyId'] } });
    if (!journey) throw new NotFoundError('Parcours');

    const step = await prisma.soulJourneyStepProgress.findUnique({
      where: { journeyId_stepTemplateId: { journeyId: req.params['journeyId'], stepTemplateId: req.params['stepId'] } },
    });
    if (!step) throw new NotFoundError('Étape');

    const { status, notes } = req.body as z.infer<typeof stepUpdateSchema>;
    const updated = await prisma.soulJourneyStepProgress.update({
      where: { journeyId_stepTemplateId: { journeyId: req.params['journeyId'], stepTemplateId: req.params['stepId'] } },
      data: {
        status,
        notes,
        ...(status === 'COMPLETED' ? { completedAt: new Date(), completedById: req.user!.id } : {}),
      },
    });

    // Check if all required steps are completed
    if (status === 'COMPLETED') {
      const allSteps = await prisma.soulJourneyStepProgress.findMany({
        where: { journeyId: req.params['journeyId'] },
        include: { stepTemplate: { select: { isRequired: true } } },
      });
      const allRequiredDone = allSteps.filter((s) => s.stepTemplate.isRequired).every((s) => s.status === 'COMPLETED');
      if (allRequiredDone) {
        await prisma.soulConsolidationJourney.update({ where: { id: req.params['journeyId'] }, data: { status: 'COMPLETED', completedAt: new Date() } });
      }
    }

    sendSuccess(res, updated, 'Étape mise à jour');
  } catch (err) { next(err); }
});

export default router;
