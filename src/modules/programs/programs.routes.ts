import crypto from 'crypto';
import { Router } from 'express';
import { ProgramFrequency, ProgramStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { NotFoundError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { assertAssemblyAccess, getScopedAssemblyWhere } from '../../utils/scope-access.util';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

const createProgramSchema = z.object({
  name: z.string().min(2).max(150),
  assemblyId: z.string().uuid(),
  ministryId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  frequency: z.nativeEnum(ProgramFrequency).default(ProgramFrequency.WEEKLY),
  dayOfWeek: z.enum(DAYS).optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  leaderId: z.string().uuid().optional().nullable(),
});

const updateProgramSchema = createProgramSchema.partial().omit({ assemblyId: true });

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// GET / — liste des programmes
router.get('/', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const { assemblyId, ministryId, frequency, status, search } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const scopedAssembly = await getScopedAssemblyWhere(req.user!);

    const where: Prisma.programsWhereInput = {
      deletedAt: null,
      assemblies: scopedAssembly,
      ...(assemblyId && { assemblyId }),
      ...(ministryId && { ministryId }),
      ...(frequency && { frequency: frequency as ProgramFrequency }),
      ...(status && { status: status as ProgramStatus }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.programs.findMany({
        where,
        include: {
          assemblies: { select: { id: true, name: true } },
          ministries: { select: { id: true, name: true } },
          users: { select: { id: true, firstName: true, lastName: true } },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.programs.count({ where }),
    ]);

    sendPaginated(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /:id — détail
router.get('/:id', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const program = await prisma.programs.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        assemblies: { select: { id: true, name: true } },
        ministries: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!program) throw new NotFoundError('Programme');
    await assertAssemblyAccess(req.user!, program.assemblyId);
    sendSuccess(res, program);
  } catch (err) { next(err); }
});

// POST / — créer
router.post('/', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(createProgramSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createProgramSchema>;
    await assertAssemblyAccess(req.user!, dto.assemblyId);
    const program = await prisma.programs.create({
      data: { id: crypto.randomUUID(), updatedAt: new Date(), ...dto },
      include: {
        assemblies: { select: { id: true, name: true } },
        ministries: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Program', entityId: program.id, newValues: program as any, req });
    sendCreated(res, program, 'Programme créé');
  } catch (err) { next(err); }
});

// PATCH /:id — modifier
router.patch('/:id', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(updateProgramSchema), async (req, res, next) => {
  try {
    const existing = await prisma.programs.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Programme');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    const program = await prisma.programs.update({
      where: { id: req.params['id'] },
      data: { updatedAt: new Date(), ...(req.body as z.infer<typeof updateProgramSchema>) },
      include: {
        assemblies: { select: { id: true, name: true } },
        ministries: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    sendSuccess(res, program, 'Programme mis à jour');
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', requirePermission(PERMISSIONS.EVENTS_WRITE), async (req, res, next) => {
  try {
    const existing = await prisma.programs.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Programme');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    await prisma.programs.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date(), status: ProgramStatus.ARCHIVED } });
    sendSuccess(res, null, 'Programme supprimé');
  } catch (err) { next(err); }
});

export default router;
