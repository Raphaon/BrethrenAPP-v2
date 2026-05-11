import crypto from 'crypto';
import { Router } from 'express';
import { AttendanceEntityType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { NotFoundError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { assertAssemblyAccess } from '../../utils/scope-access.util';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const recordAttendanceSchema = z.object({
  entityType: z.nativeEnum(AttendanceEntityType),
  entityId: z.string().uuid(),
  sessionDate: z.string().date(),
  records: z.array(z.object({
    memberId: z.string().uuid().optional().nullable(),
    visitorName: z.string().max(150).optional().nullable(),
    isPresent: z.boolean().default(true),
    notes: z.string().max(500).optional().nullable(),
  })).min(1),
});

// ─── Helper : résoudre l'assemblyId depuis une entité ────────────────────────

async function resolveAssemblyId(entityType: AttendanceEntityType, entityId: string): Promise<string> {
  switch (entityType) {
    case AttendanceEntityType.EVENT: {
      const e = await prisma.event.findUnique({ where: { id: entityId }, select: { assemblyId: true } });
      if (!e?.assemblyId) throw new NotFoundError('Événement');
      return e.assemblyId;
    }
    case AttendanceEntityType.GROUP: {
      const g = await prisma.groups.findUnique({ where: { id: entityId }, select: { assemblyId: true } });
      if (!g) throw new NotFoundError('Groupe');
      return g.assemblyId;
    }
    case AttendanceEntityType.PROGRAM: {
      const p = await prisma.programs.findUnique({ where: { id: entityId }, select: { assemblyId: true } });
      if (!p) throw new NotFoundError('Programme');
      return p.assemblyId;
    }
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// POST / — enregistrer les présences pour une session
router.post('/', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(recordAttendanceSchema), async (req, res, next) => {
  try {
    const { entityType, entityId, sessionDate, records } = req.body as z.infer<typeof recordAttendanceSchema>;

    const assemblyId = await resolveAssemblyId(entityType, entityId);
    await assertAssemblyAccess(req.user!, assemblyId);

    const date = new Date(sessionDate);

    // Supprimer les présences existantes pour cette session/entité avant de réinscrire
    await prisma.attendances.deleteMany({
      where: { entityType, entityId, sessionDate: { gte: new Date(date.setHours(0, 0, 0, 0)), lte: new Date(date.setHours(23, 59, 59, 999)) } },
    });

    const created = await prisma.attendances.createMany({
      data: records.map((r) => ({
        id: crypto.randomUUID(),
        entityType,
        entityId,
        memberId: r.memberId ?? null,
        visitorName: r.visitorName ?? null,
        isPresent: r.isPresent,
        notes: r.notes ?? null,
        takenById: req.user!.id,
        sessionDate: new Date(sessionDate),
      })),
    });

    sendCreated(res, { count: created.count }, `${created.count} présence(s) enregistrée(s)`);
  } catch (err) { next(err); }
});

// GET / — historique des présences
router.get('/', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const { entityType, entityId, memberId, from, to } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const where: Prisma.attendancesWhereInput = {
      ...(entityType && { entityType: entityType as AttendanceEntityType }),
      ...(entityId && { entityId }),
      ...(memberId && { memberId }),
      ...((from || to) && {
        sessionDate: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.attendances.findMany({
        where,
        include: {
          members: { select: { id: true, firstName: true, lastName: true, matricule: true } },
          users: { select: { id: true, firstName: true, lastName: true } },
        },
        skip,
        take: limit,
        orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.attendances.count({ where }),
    ]);

    sendPaginated(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /summary — résumé d'assiduité par entité et période
router.get('/summary', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const { entityType, entityId, from, to } = req.query as Record<string, string>;

    const where: Prisma.attendancesWhereInput = {
      ...(entityType && { entityType: entityType as AttendanceEntityType }),
      ...(entityId && { entityId }),
      ...((from || to) && {
        sessionDate: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [total, present, sessions] = await prisma.$transaction([
      prisma.attendances.count({ where }),
      prisma.attendances.count({ where: { ...where, isPresent: true } }),
      prisma.attendances.groupBy({
        by: ['sessionDate'],
        where,
        _count: { _all: true },
        orderBy: { sessionDate: 'asc' },
      }),
    ]);

    sendSuccess(res, {
      total,
      present,
      absent: total - present,
      attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
      sessions: sessions.map((s) => ({
        date: s.sessionDate,
        count: typeof s._count === 'object' && s._count !== null ? (s._count as any)._all ?? 0 : 0,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
