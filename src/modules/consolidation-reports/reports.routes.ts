import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess } from '../../utils/response.util';
import { getScopedSoulWhere } from '../../utils/scope-access.util';
import { NotFoundError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

async function buildSoulBase(req: any) {
  const scopeWhere = await getScopedSoulWhere(req.user!);
  return { ...scopeWhere, deletedAt: null } as any;
}

// GET /consolidation-reports/weekly
router.get('/weekly', requirePermission(PERMISSIONS.CONSOLIDATION_REPORTS_READ), async (req, res, next) => {
  try {
    const base = await buildSoulBase(req);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [newSouls, newContacted, newInFd, newConsolidated, atRisk, totalActive, byStatus] = await Promise.all([
      prisma.newVisitor.count({ where: { ...base, createdAt: { gte: since7d } } }),
      prisma.newVisitor.count({ where: { ...base, lastContactDate: { gte: since7d } } }),
      prisma.newVisitor.count({ where: { ...base, familyOfDisciplesId: { not: null }, updatedAt: { gte: since7d } } }),
      prisma.newVisitor.count({ where: { ...base, status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER'] }, updatedAt: { gte: since7d } } }),
      prisma.newVisitor.count({ where: { ...base, riskScore: { gte: 40 } } }),
      prisma.newVisitor.count({ where: { ...base, status: { notIn: ['LOST', 'ARCHIVED'] } } }),
      prisma.newVisitor.groupBy({ by: ['status'], _count: { status: true }, where: base }),
    ]);

    // Contacts under 24h rate
    const newSoulsLast24h = await prisma.newVisitor.count({ where: { ...base, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    const contactedLast24h = await prisma.newVisitor.count({ where: { ...base, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, lastContactDate: { not: null } } });

    sendSuccess(res, {
      period: { from: since7d.toISOString(), to: new Date().toISOString() },
      newSouls,
      newContacted,
      newInFd,
      newConsolidated,
      atRisk,
      totalActive,
      contactRate24h: newSoulsLast24h > 0 ? ((contactedLast24h / newSoulsLast24h) * 100).toFixed(1) : 0,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count.status })),
    });
  } catch (err) { next(err); }
});

// GET /consolidation-reports/by-fd/:fdId
router.get('/by-fd/:fdId', requirePermission(PERMISSIONS.CONSOLIDATION_REPORTS_READ), async (req, res, next) => {
  try {
    const fd = await prisma.familyOfDisciples.findUnique({ where: { id: req.params['fdId'], deletedAt: null } });
    if (!fd) throw new NotFoundError('Famille de disciples');

    const base = { familyOfDisciplesId: req.params['fdId'], deletedAt: null } as any;
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalSouls, atRisk, consolidated, byStatus, recentAttendance, makers] = await Promise.all([
      prisma.newVisitor.count({ where: base }),
      prisma.newVisitor.count({ where: { ...base, status: 'AT_RISK' } }),
      prisma.newVisitor.count({ where: { ...base, status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER'] } } }),
      prisma.newVisitor.groupBy({ by: ['status'], _count: { status: true }, where: base }),
      prisma.soulCulteAttendance.count({ where: { soul: base, createdAt: { gte: since30d }, status: 'PRESENT' } }),
      prisma.discipleMakerProfile.count({ where: { familyId: req.params['fdId'], isActive: true } }),
    ]);

    sendSuccess(res, {
      fd: { id: fd.id, name: fd.name, goal: fd.goal },
      totalSouls,
      atRisk,
      consolidated,
      makers,
      recentAttendance,
      goalProgress: fd.goal > 0 ? (totalSouls / fd.goal * 100).toFixed(1) : 0,
      retentionRate: totalSouls > 0 ? (((totalSouls - atRisk) / totalSouls) * 100).toFixed(1) : 0,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count.status })),
    });
  } catch (err) { next(err); }
});

// GET /consolidation-reports/by-maker/:makerId
router.get('/by-maker/:makerId', requirePermission(PERMISSIONS.CONSOLIDATION_REPORTS_READ), async (req, res, next) => {
  try {
    const maker = await prisma.discipleMakerProfile.findUnique({ where: { id: req.params['makerId'] } });
    if (!maker) throw new NotFoundError('Faiseur de disciples');

    const [primary, secondary, atRisk, consolidated, byStatus] = await Promise.all([
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['makerId'], deletedAt: null } }),
      prisma.newVisitor.count({ where: { secondaryMakerProfileId: req.params['makerId'], deletedAt: null } }),
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['makerId'], status: 'AT_RISK', deletedAt: null } }),
      prisma.newVisitor.count({ where: { primaryMakerProfileId: req.params['makerId'], status: { in: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER'] }, deletedAt: null } }),
      prisma.newVisitor.groupBy({ by: ['status'], _count: { status: true }, where: { primaryMakerProfileId: req.params['makerId'], deletedAt: null } }),
    ]);

    sendSuccess(res, {
      makerId: req.params['makerId'],
      primarySouls: primary,
      secondarySouls: secondary,
      totalLoad: primary + secondary,
      maxLoad: maker.maxLoad,
      atRisk,
      consolidated,
      successRate: primary > 0 ? ((consolidated / primary) * 100).toFixed(1) : 0,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count.status })),
    });
  } catch (err) { next(err); }
});

// GET /consolidation-reports/growth
router.get('/growth', requirePermission(PERMISSIONS.CONSOLIDATION_REPORTS_READ), async (req, res, next) => {
  try {
    const base = await buildSoulBase(req);
    const statusGroups = [
      { label: 'Nouveaux arrivants', statuses: ['NEW', 'CONTACTED', 'FOLLOWING_UP', 'ASSIGNED', 'VISITED'] },
      { label: 'En intégration', statuses: ['IN_FD', 'IN_FOUNDATION', 'RETURNED_ONCE', 'RETURNED_TWICE'] },
      { label: 'Consolidés', statuses: ['CONSOLIDATED', 'ACTIVE_MEMBER', 'SERVING', 'DISCIPLE_MAKER_TRAINEE', 'DISCIPLE_MAKER'] },
      { label: 'À risque', statuses: ['AT_RISK', 'TASK_FORCE'] },
      { label: 'Perdus', statuses: ['LOST', 'ARCHIVED'] },
    ];

    const pipeline = await Promise.all(
      statusGroups.map(async (group) => ({
        label: group.label,
        count: await prisma.newVisitor.count({ where: { ...base, status: { in: group.statuses } } }),
        statuses: group.statuses,
      }))
    );

    sendSuccess(res, { pipeline });
  } catch (err) { next(err); }
});

// GET /consolidation-reports/losses
router.get('/losses', requirePermission(PERMISSIONS.CONSOLIDATION_REPORTS_READ), async (req, res, next) => {
  try {
    const base = await buildSoulBase(req);
    const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [byAbsenceReason, lostSouls, taskForceClosed] = await Promise.all([
      prisma.soulCulteAttendance.groupBy({
        by: ['absenceReason'],
        _count: { absenceReason: true },
        where: { status: 'ABSENT', absenceReason: { not: null }, createdAt: { gte: since90d } },
        orderBy: { _count: { absenceReason: 'desc' } },
      }),
      prisma.newVisitor.count({ where: { ...base, status: 'LOST' } }),
      prisma.recoveryCase.count({ where: { status: 'CLOSED', decision: 'REMOVED', closedAt: { gte: since90d } } }),
    ]);

    sendSuccess(res, {
      period: '90j',
      lostSouls,
      taskForceClosed,
      absenceReasons: byAbsenceReason.map((r) => ({ reason: r.absenceReason, count: r._count.absenceReason })),
    });
  } catch (err) { next(err); }
});

export default router;
