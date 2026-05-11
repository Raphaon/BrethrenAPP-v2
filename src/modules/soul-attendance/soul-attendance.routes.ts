import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { NotFoundError } from '../../middlewares/error.middleware';
import { getScopedSoulWhere } from '../../utils/scope-access.util';

const router = Router();
router.use(authenticate);

const attendanceSchema = z.object({
  soulId: z.string().uuid(),
  culteDate: z.string(),
  eventId: z.string().uuid().optional(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']).default('PRESENT'),
  absenceReason: z.enum(['TRAVEL', 'ILLNESS', 'WORK', 'TRANSPORT', 'PROMISE_NOT_KEPT', 'UNREACHABLE', 'NO_RETURN', 'OTHER']).optional(),
  promisedToCome: z.boolean().default(false),
  wakeUpCallDone: z.boolean().default(false),
  transportNeeded: z.boolean().default(false),
  transportOffered: z.boolean().default(false),
  notes: z.string().optional(),
});

const batchSchema = z.object({
  culteDate: z.string(),
  eventId: z.string().uuid().optional(),
  records: z.array(z.object({
    soulId: z.string().uuid(),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']).default('PRESENT'),
    absenceReason: z.enum(['TRAVEL', 'ILLNESS', 'WORK', 'TRANSPORT', 'PROMISE_NOT_KEPT', 'UNREACHABLE', 'NO_RETURN', 'OTHER']).optional(),
    promisedToCome: z.boolean().default(false),
    transportNeeded: z.boolean().default(false),
    notes: z.string().optional(),
  })),
});

async function updateSoulAfterAttendance(soulId: string, status: string) {
  const soul = await prisma.newVisitor.findUnique({ where: { id: soulId } });
  if (!soul) return;

  const now = new Date();
  if (status === 'PRESENT' || status === 'LATE') {
    await prisma.newVisitor.update({
      where: { id: soulId },
      data: {
        lastCulteDate: now,
        consecutiveAbsences: 0,
        riskScore: Math.max(0, soul.riskScore - 20),
      },
    });
  } else if (status === 'ABSENT') {
    const newAbsences = soul.consecutiveAbsences + 1;
    const riskIncrease = newAbsences >= 2 ? 20 : 0;
    await prisma.newVisitor.update({
      where: { id: soulId },
      data: {
        consecutiveAbsences: newAbsences,
        riskScore: Math.min(100, soul.riskScore + riskIncrease),
        ...(newAbsences >= 3 ? { status: 'AT_RISK' } : {}),
      },
    });
  }
}

// GET /soul-attendance
router.get('/', requirePermission(PERMISSIONS.SOUL_ATTENDANCE_MANAGE), async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const { soulId, familyId, from, to, status } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {
      ...(soulId && { soulId }),
      ...(status && { status }),
      ...(from || to ? { culteDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(familyId && { soul: { familyOfDisciplesId: familyId } }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.soulCulteAttendance.findMany({
        where: where as any,
        include: { soul: { select: { id: true, firstName: true, lastName: true } }, recordedBy: { select: { id: true, firstName: true, lastName: true } } },
        skip, take: limit, orderBy: { culteDate: 'desc' },
      }),
      prisma.soulCulteAttendance.count({ where: where as any }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// POST /soul-attendance
router.post('/', requirePermission(PERMISSIONS.SOUL_ATTENDANCE_MANAGE), validate(attendanceSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof attendanceSchema>;
    const soul = await prisma.newVisitor.findUnique({ where: { id: dto.soulId, deletedAt: null } });
    if (!soul) throw new NotFoundError('Âme');

    const attendance = await prisma.soulCulteAttendance.upsert({
      where: { soulId_culteDate: { soulId: dto.soulId, culteDate: new Date(dto.culteDate) } },
      create: { ...dto, culteDate: new Date(dto.culteDate), recordedById: req.user!.id },
      update: { ...dto, culteDate: new Date(dto.culteDate), recordedById: req.user!.id },
    });

    await updateSoulAfterAttendance(dto.soulId, dto.status);
    sendCreated(res, attendance, 'Présence enregistrée');
  } catch (err) { next(err); }
});

// POST /soul-attendance/batch
router.post('/batch', requirePermission(PERMISSIONS.SOUL_ATTENDANCE_MANAGE), validate(batchSchema), async (req, res, next) => {
  try {
    const { culteDate, eventId, records } = req.body as z.infer<typeof batchSchema>;
    const parsedDate = new Date(culteDate);

    const results = await prisma.$transaction(
      records.map((r) =>
        prisma.soulCulteAttendance.upsert({
          where: { soulId_culteDate: { soulId: r.soulId, culteDate: parsedDate } },
          create: { ...r, culteDate: parsedDate, eventId, recordedById: req.user!.id },
          update: { ...r, culteDate: parsedDate, eventId, recordedById: req.user!.id },
        })
      )
    );

    await Promise.all(records.map((r) => updateSoulAfterAttendance(r.soulId, r.status)));
    sendSuccess(res, { saved: results.length }, `${results.length} présences enregistrées`);
  } catch (err) { next(err); }
});

// GET /soul-attendance/stats
router.get('/stats', requirePermission(PERMISSIONS.SOUL_ATTENDANCE_MANAGE), async (req, res, next) => {
  try {
    const scopeWhere = await getScopedSoulWhere(req.user!);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, absenceReasons, soulsWithRepeatedAbsences] = await Promise.all([
      prisma.soulCulteAttendance.groupBy({
        by: ['status'],
        _count: { status: true },
        where: { createdAt: { gte: since30d } },
      }),
      prisma.soulCulteAttendance.groupBy({
        by: ['absenceReason'],
        _count: { absenceReason: true },
        where: { status: 'ABSENT', absenceReason: { not: null }, createdAt: { gte: since30d } },
        orderBy: { _count: { absenceReason: 'desc' } },
        take: 10,
      }),
      prisma.newVisitor.count({ where: { ...scopeWhere as any, consecutiveAbsences: { gte: 2 }, deletedAt: null } }),
    ]);

    sendSuccess(res, {
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count.status })),
      absenceReasons: absenceReasons.map((r) => ({ reason: r.absenceReason, count: r._count.absenceReason })),
      soulsWithRepeatedAbsences,
    });
  } catch (err) { next(err); }
});

export default router;
