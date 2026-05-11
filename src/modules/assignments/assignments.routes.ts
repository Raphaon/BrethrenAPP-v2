import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { flexDate } from '../../utils/zod.util';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { getScopedAssignmentWhere, assertAssignmentAccess, assertAssemblyAccess } from '../../utils/scope-access.util';

const createAssignmentSchema = z.object({
  pastorId: z.string().uuid(),
  entityType: z.enum(['assembly', 'district', 'region', 'preachingPoint']),
  assemblyId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  regionId: z.string().uuid().optional().nullable(),
  role: z.enum(['PASTEUR_PRINCIPAL', 'PASTEUR_ASSISTANT', 'PASTEUR_STAGIAIRE', 'ADMINISTRATEUR_REGIONAL', 'AUTRE']).optional(),
  startDate: flexDate,
  notes: z.string().optional(),
});

const closeAssignmentSchema = z.object({
  endDate: flexDate,
  notes: z.string().optional(),
});

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.ASSIGNMENTS_READ), async (req, res, next) => {
  try {
    const { pastorId, assemblyId, status, entityType } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const scopeWhere = await getScopedAssignmentWhere(req.user!);

    const where: Prisma.AssignmentWhereInput = {
      ...scopeWhere,
      ...(pastorId && { pastorId }),
      ...(assemblyId && { assemblyId }),
      ...(status && { status: status as any }),
      ...(entityType && { entityType }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.assignment.findMany({
        where,
        include: {
          pastor: {
            include: {
              member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
            },
          },
          assembly: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
          region: { select: { id: true, name: true } },
        },
        skip, take: limit, orderBy: { startDate: 'desc' },
      }),
      prisma.assignment.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission(PERMISSIONS.ASSIGNMENTS_READ), async (req, res, next) => {
  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params['id'] },
      include: {
        pastor: { include: { member: { select: { id: true, firstName: true, lastName: true, matricule: true } } } },
        assembly: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
      },
    });
    if (!assignment) throw new NotFoundError('Affectation');
    await assertAssignmentAccess(req.user!, assignment);
    sendSuccess(res, assignment);
  } catch (err) { next(err); }
});

router.post('/', requirePermission(PERMISSIONS.ASSIGNMENTS_WRITE), validate(createAssignmentSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createAssignmentSchema>;

    const pastor = await prisma.pastor.findUnique({ where: { id: dto.pastorId, deletedAt: null } });
    if (!pastor) throw new NotFoundError('Pasteur');

    // Vérifier que l'affectation cible un territoire accessible par l'utilisateur
    if (dto.assemblyId) await assertAssemblyAccess(req.user!, dto.assemblyId);

    // Clôturer l'affectation active sur la même entité si existe
    if (dto.assemblyId) {
      await prisma.assignment.updateMany({
        where: { pastorId: dto.pastorId, assemblyId: dto.assemblyId, status: 'ACTIVE' },
        data: { status: 'CLOSED', endDate: new Date() },
      });
    }

    const assignment = await prisma.assignment.create({
      data: { ...dto, startDate: new Date(dto.startDate) },
      include: {
        pastor: { include: { member: { select: { id: true, firstName: true, lastName: true } } } },
        assembly: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Assignment', entityId: assignment.id, req });
    sendCreated(res, assignment, 'Affectation créée');
  } catch (err) { next(err); }
});

router.post('/:id/close', requirePermission(PERMISSIONS.ASSIGNMENTS_WRITE), validate(closeAssignmentSchema), async (req, res, next) => {
  try {
    const existing = await prisma.assignment.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Affectation');
    await assertAssignmentAccess(req.user!, existing);
    if (existing.status === 'CLOSED') throw new AppError('Affectation déjà clôturée', 400, 'ALREADY_CLOSED');

    const dto = req.body as z.infer<typeof closeAssignmentSchema>;
    const assignment = await prisma.assignment.update({
      where: { id: req.params['id'] },
      data: { status: 'CLOSED', endDate: new Date(dto.endDate), notes: dto.notes },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Assignment', entityId: assignment.id, newValues: { status: 'CLOSED' }, req });
    sendSuccess(res, assignment, 'Affectation clôturée');
  } catch (err) { next(err); }
});

export default router;
