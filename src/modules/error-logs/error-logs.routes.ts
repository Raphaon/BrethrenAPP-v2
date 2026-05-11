import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission, isSuperAdmin } from '../../middlewares/rbac.middleware';
import { prisma } from '../../database/prisma';
import { sendSuccess } from '../../utils/response.util';

const router = Router();

// ─── GET /error-logs ─────────────────────────────────────────────────────────
// Accessible uniquement aux super_admin / national_admin / tenant_owner
router.get(
  '/',
  authenticate,
  requirePermission('error_logs:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const querySchema = z.object({
        page:       z.string().optional().transform(Number).pipe(z.number().min(1)).default('1'),
        limit:      z.string().optional().transform(Number).pipe(z.number().min(1).max(100)).default('50'),
        severity:   z.enum(['WARNING', 'ERROR', 'CRITICAL']).optional(),
        resolved:   z.enum(['true', 'false']).optional(),
        statusCode: z.string().optional().transform(Number).pipe(z.number()).optional(),
        from:       z.string().optional(),
        to:         z.string().optional(),
        search:     z.string().optional(),
      });

      const q = querySchema.parse(req.query);
      const skip = (q.page - 1) * q.limit;

      const where: Record<string, unknown> = {};
      // Non-super-admins voient uniquement les erreurs de leur tenant
      if (!isSuperAdmin(req.user!)) {
        where.tenantId = req.user!.tenantId ?? 'NONE';
      }
      if (q.severity)             where.severity   = q.severity;
      if (q.resolved !== undefined) where.resolved  = q.resolved === 'true';
      if (q.statusCode)           where.statusCode = q.statusCode;
      if (q.from || q.to) {
        where.createdAt = {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to   ? { lte: new Date(q.to)   } : {}),
        };
      }
      if (q.search) {
        where.OR = [
          { message:   { contains: q.search, mode: 'insensitive' } },
          { path:      { contains: q.search, mode: 'insensitive' } },
          { userEmail: { contains: q.search, mode: 'insensitive' } },
          { code:      { contains: q.search, mode: 'insensitive' } },
        ];
      }

      const [total, items] = await Promise.all([
        (prisma as any).errorLog.count({ where }),
        (prisma as any).errorLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: q.limit,
          select: {
            id: true, requestId: true, severity: true,
            method: true, path: true, statusCode: true,
            errorType: true, message: true, stack: true, code: true,
            userId: true, userEmail: true, tenantId: true,
            ip: true, requestBody: true,
            resolved: true, resolvedAt: true, notes: true,
            createdAt: true,
          },
        }),
      ]);

      sendSuccess(res, {
        items,
        pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /error-logs/:id/resolve ───────────────────────────────────────────
router.patch(
  '/:id/resolve',
  authenticate,
  requirePermission('error_logs:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { notes } = z.object({ notes: z.string().optional() }).parse(req.body);

      const updated = await (prisma as any).errorLog.update({
        where: { id },
        data: {
          resolved:   true,
          resolvedAt: new Date(),
          notes:      notes ?? null,
        },
      });
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /error-logs (purge des erreurs résolues) ─────────────────────────
router.delete(
  '/resolved',
  authenticate,
  requirePermission('error_logs:read'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await (prisma as any).errorLog.deleteMany({
        where: { resolved: true },
      });
      sendSuccess(res, { deleted: result.count });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /error-logs/stats ────────────────────────────────────────────────────
router.get(
  '/stats',
  authenticate,
  requirePermission('error_logs:read'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [total, last24h, last7d, bySeverity, byStatusCode, topPaths] = await Promise.all([
        (prisma as any).errorLog.count(),
        (prisma as any).errorLog.count({ where: { createdAt: { gte: since24h } } }),
        (prisma as any).errorLog.count({ where: { createdAt: { gte: since7d } } }),
        (prisma as any).errorLog.groupBy({
          by: ['severity'],
          _count: { severity: true },
          orderBy: { _count: { severity: 'desc' } },
        }),
        (prisma as any).errorLog.groupBy({
          by: ['statusCode'],
          _count: { statusCode: true },
          orderBy: { _count: { statusCode: 'desc' } },
          take: 10,
        }),
        (prisma as any).errorLog.groupBy({
          by: ['path'],
          _count: { path: true },
          orderBy: { _count: { path: 'desc' } },
          take: 10,
          where: { createdAt: { gte: since7d } },
        }),
      ]);

      sendSuccess(res, {
        total,
        last24h,
        last7d,
        bySeverity: bySeverity.map((r: any) => ({ severity: r.severity, count: r._count.severity })),
        byStatusCode: byStatusCode.map((r: any) => ({ statusCode: r.statusCode, count: r._count.statusCode })),
        topPaths: topPaths.map((r: any) => ({ path: r.path, count: r._count.path })),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
