import { Router } from 'express';
import { Prisma, AuditAction } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { isSuperAdmin, requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendPaginated, buildPaginationMeta } from '../../utils/response.util';

const router = Router();
router.use(authenticate, requirePermission(PERMISSIONS.AUDIT_LOGS_READ));

router.get('/', async (req, res, next) => {
  try {
    const { actorId, action, entityType, entityId, from, to } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    // Isolation tenant : seul un super_admin voit les logs de toute la plateforme
    // Les autres admins sont limites a leur propre tenant
    const tenantFilter: Prisma.AuditLogWhereInput = isSuperAdmin(req.user!)
      ? {}
      : req.user!.tenantId
      ? { tenantId: req.user!.tenantId }
      : { actorId: req.user!.id }; // utilisateur sans tenant : ses propres actions seulement

    const where: Prisma.AuditLogWhereInput = {
      ...tenantFilter,
      ...(actorId && { actorId }),
      ...(action && { action: action as AuditAction }),
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      // Plage de dates (combinee si les deux sont presents)
      ...(from && to
        ? { createdAt: { gte: new Date(from), lte: new Date(to) } }
        : from
        ? { createdAt: { gte: new Date(from) } }
        : to
        ? { createdAt: { lte: new Date(to) } }
        : {}),
    };

    const [data, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

export default router;
