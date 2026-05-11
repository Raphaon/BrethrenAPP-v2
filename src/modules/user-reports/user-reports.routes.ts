import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission, isSuperAdmin } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { NotFoundError } from '../../middlewares/error.middleware';
import { createAuditLog } from '../../utils/audit.util';
import { emailService } from '../../services/email.service';
import { config } from '../../config';

// ─── Local enum types (mirrors prisma schema — avoids regeneration requirement) ─

type ReportSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type ReportStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createReportSchema = z.object({
  appModule:        z.string().min(1).max(80),
  appAction:        z.string().min(1).max(80),
  pageUrl:          z.string().url().optional().nullable(),
  expectedBehavior: z.string().min(10, 'Decrivez le comportement attendu (min 10 caracteres)').max(2000),
  actualBehavior:   z.string().min(10, 'Decrivez le comportement constate (min 10 caracteres)').max(2000),
  additionalInfo:   z.string().max(1000).optional().nullable(),
  screenshotUrl:    z.string().url().optional().nullable(),
  severity:         z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).default('MEDIUM'),
});

const resolveReportSchema = z.object({
  status:          z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'] as const),
  resolutionNotes: z.string().max(2000).optional().nullable(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_LABELS: Record<ReportSeverity, string> = {
  LOW:      'Mineur',
  MEDIUM:   'Modere',
  HIGH:     'Important',
  CRITICAL: 'Bloquant',
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN:        'Ouvert',
  IN_PROGRESS: 'En cours',
  RESOLVED:    'Resolu',
  WONT_FIX:   'Non corrige',
};

async function sendReportAlertEmail(
  report: { id: string; appModule: string; appAction: string; severity: ReportSeverity; expectedBehavior: string; actualBehavior: string; pageUrl: string | null },
  reporter: { firstName: string; lastName: string; email: string }
): Promise<void> {
  const adminEmail = (config as any).ADMIN_ERROR_EMAIL ?? (config as any).SMTP_FROM;
  if (!adminEmail || (config as any).NODE_ENV !== 'production') return;

  const severityColors: Record<ReportSeverity, string> = {
    LOW: '#6b7280', MEDIUM: '#2563eb', HIGH: '#d97706', CRITICAL: '#dc2626',
  };
  const color = severityColors[report.severity];

  try {
    await (emailService as any).sendRaw({
      to:      adminEmail,
      subject: `[BrethrenApp] Signalement ${SEVERITY_LABELS[report.severity]} — ${report.appModule} / ${report.appAction}`,
      html: `
        <h2 style="color:#1a1a1a">Nouveau signalement utilisateur</h2>
        <table style="border-collapse:collapse;font-family:monospace;font-size:13px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Utilisateur</td><td><strong>${reporter.firstName} ${reporter.lastName}</strong> (${reporter.email})</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Module</td><td><strong>${report.appModule}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Action</td><td>${report.appAction}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Severite</td><td><span style="color:${color};font-weight:700">${SEVERITY_LABELS[report.severity]}</span></td></tr>
          ${report.pageUrl ? `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">Page</td><td>${report.pageUrl}</td></tr>` : ''}
        </table>
        <h3 style="margin-top:16px;color:#1a1a1a">Comportement attendu</h3>
        <p style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px">${report.expectedBehavior}</p>
        <h3 style="margin-top:16px;color:#1a1a1a">Comportement constate</h3>
        <p style="background:#fef2f2;padding:12px;border-radius:6px;font-size:13px;border-left:3px solid ${color}">${report.actualBehavior}</p>
      `,
      text: `Nouveau signalement\n\nModule: ${report.appModule}\nAction: ${report.appAction}\nSeverite: ${SEVERITY_LABELS[report.severity]}\n\nAttendu:\n${report.expectedBehavior}\n\nConstate:\n${report.actualBehavior}`,
    });
  } catch {
    // Non bloquant — l'email est un bonus
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// ── POST / — Creer un signalement (tout utilisateur connecte) ─────────────────
router.post('/', validate(createReportSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createReportSchema>;
    const user = req.user!;

    const report = await (prisma as any).userReport.create({
      data: {
        userId:           user.id,
        tenantId:         user.tenantId ?? null,
        appModule:        dto.appModule,
        appAction:        dto.appAction,
        pageUrl:          dto.pageUrl ?? null,
        userAgent:        req.headers['user-agent'] ?? null,
        expectedBehavior: dto.expectedBehavior,
        actualBehavior:   dto.actualBehavior,
        additionalInfo:   dto.additionalInfo ?? null,
        screenshotUrl:    dto.screenshotUrl ?? null,
        severity:         dto.severity,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    void sendReportAlertEmail(report, report.user);

    await createAuditLog({
      actorId:    user.id,
      tenantId:   user.tenantId ?? undefined,
      action:     'CREATE',
      entityType: 'UserReport',
      entityId:   report.id,
      newValues:  { appModule: dto.appModule, appAction: dto.appAction, severity: dto.severity },
      req,
    });

    sendCreated(res, report, 'Signalement envoye avec succes. Merci pour votre retour !');
  } catch (err) { next(err); }
});

// ── GET / — Liste des signalements (super_admin seulement) ───────────────────
router.get('/', requirePermission(PERMISSIONS.USER_REPORTS_READ), async (req, res, next) => {
  try {
    const { status, severity, appModule, search } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    // Isolation: super_admin voit tout, sinon uniquement le tenant
    const scopeFilter = isSuperAdmin(req.user!)
      ? {}
      : req.user!.tenantId
      ? { tenantId: req.user!.tenantId }
      : { userId: req.user!.id };

    const where: Record<string, unknown> = {
      ...scopeFilter,
      ...(status    && { status }),
      ...(severity  && { severity }),
      ...(appModule && { appModule }),
      ...(search && {
        OR: [
          { expectedBehavior: { contains: search, mode: 'insensitive' } },
          { actualBehavior:   { contains: search, mode: 'insensitive' } },
          { user: { OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName:  { contains: search, mode: 'insensitive' } },
            { email:     { contains: search, mode: 'insensitive' } },
          ]}},
        ],
      }),
    };

    const [data, total] = await prisma.$transaction([
      (prisma as any).userReport.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, tenantId: true } },
        },
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      (prisma as any).userReport.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ── GET /stats — Statistiques (super_admin) ───────────────────────────────────
router.get('/stats', requirePermission(PERMISSIONS.USER_REPORTS_READ), async (_req, res, next) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

    const [total, open, last24hCount, last7dCount, bySeverity, byModule] = await Promise.all([
      (prisma as any).userReport.count(),
      (prisma as any).userReport.count({ where: { status: 'OPEN' } }),
      (prisma as any).userReport.count({ where: { createdAt: { gte: last24h } } }),
      (prisma as any).userReport.count({ where: { createdAt: { gte: last7d } } }),
      (prisma as any).userReport.groupBy({ by: ['severity'], _count: { id: true }, orderBy: { severity: 'asc' } }),
      (prisma as any).userReport.groupBy({ by: ['appModule'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 5 }),
    ]);

    sendSuccess(res, {
      total,
      open,
      last24h: last24hCount,
      last7d:  last7dCount,
      bySeverity: bySeverity.map((r: any) => ({
        severity: r.severity,
        label:    SEVERITY_LABELS[r.severity as ReportSeverity] ?? r.severity,
        count:    r._count.id,
      })),
      topModules: byModule.map((r: any) => ({ module: r.appModule, count: r._count.id })),
    });
  } catch (err) { next(err); }
});

// ── GET /:id — Detail d'un signalement (super_admin) ─────────────────────────
router.get('/:id', requirePermission(PERMISSIONS.USER_REPORTS_READ), async (req, res, next) => {
  try {
    const report = await (prisma as any).userReport.findUnique({
      where: { id: req.params['id'] },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!report) throw new NotFoundError('Signalement');
    sendSuccess(res, report);
  } catch (err) { next(err); }
});

// ── PATCH /:id — Mettre a jour le statut / resolution ────────────────────────
router.patch('/:id', requirePermission(PERMISSIONS.USER_REPORTS_READ), validate(resolveReportSchema), async (req, res, next) => {
  try {
    const { status, resolutionNotes } = req.body as z.infer<typeof resolveReportSchema>;

    const existing = await (prisma as any).userReport.findUnique({ where: { id: req.params['id'] } });
    if (!existing) throw new NotFoundError('Signalement');

    const isResolving = ['RESOLVED', 'WONT_FIX'].includes(status) && !['RESOLVED', 'WONT_FIX'].includes(existing.status);

    const updated = await (prisma as any).userReport.update({
      where: { id: req.params['id'] },
      data: {
        status,
        resolutionNotes: resolutionNotes ?? existing.resolutionNotes,
        ...(isResolving && { resolvedAt: new Date(), resolvedById: req.user!.id }),
        ...(status === 'OPEN' && { resolvedAt: null, resolvedById: null }),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await createAuditLog({
      actorId:    req.user!.id,
      action:     'UPDATE',
      entityType: 'UserReport',
      entityId:   updated.id,
      oldValues:  { status: existing.status },
      newValues:  { status },
      req,
    });
    sendSuccess(res, updated, `Signalement marque : ${STATUS_LABELS[status as ReportStatus] ?? status}`);
  } catch (err) { next(err); }
});

export default router;
