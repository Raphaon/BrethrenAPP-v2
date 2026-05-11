import { Router } from 'express';
import { z } from 'zod';
import { DevicePlatform } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { NotFoundError } from '../../middlewares/error.middleware';
import { sendCreated, sendSuccess } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { buildPushPayload } from '../../utils/push.util';
import { PERMISSIONS } from '../../shared/constants/permissions';

const registerPushTokenSchema = z.object({
  token: z.string().min(10),
  platform: z.nativeEnum(DevicePlatform),
  provider: z.string().min(2).max(50).default('expo'),
  appVersion: z.string().max(50).optional(),
  deviceName: z.string().max(120).optional(),
});

const pushPreviewSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  entityType: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  deepLink: z.string().max(255).optional(),
  badge: z.number().int().min(0).max(999).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const router = Router();
router.use(authenticate);

router.get('/push-tokens', async (req, res, next) => {
  try {
    const tokens = await prisma.deviceToken.findMany({
      where: {
        userId: req.user!.id,
        revokedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });

    sendSuccess(res, tokens);
  } catch (err) {
    next(err);
  }
});

router.post('/push-tokens', validate(registerPushTokenSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof registerPushTokenSchema>;

    const token = await prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: {
        userId: req.user!.id,
        platform: dto.platform,
        provider: dto.provider,
        appVersion: dto.appVersion,
        deviceName: dto.deviceName,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
      create: {
        userId: req.user!.id,
        token: dto.token,
        platform: dto.platform,
        provider: dto.provider,
        appVersion: dto.appVersion,
        deviceName: dto.deviceName,
        lastSeenAt: new Date(),
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'UPDATE',
      entityType: 'DeviceToken',
      entityId: token.id,
      metadata: { platform: token.platform, provider: token.provider },
      req,
    });

    sendCreated(res, token, 'Push token enregistre');
  } catch (err) {
    next(err);
  }
});

router.delete('/push-tokens/:id', async (req, res, next) => {
  try {
    const token = await prisma.deviceToken.findFirst({
      where: {
        id: req.params['id'],
        userId: req.user!.id,
        revokedAt: null,
      },
    });

    if (!token) {
      throw new NotFoundError('Push token');
    }

    await prisma.deviceToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'DELETE',
      entityType: 'DeviceToken',
      entityId: token.id,
      req,
    });

    sendSuccess(res, null, 'Push token revoque');
  } catch (err) {
    next(err);
  }
});

router.post(
  '/push-preview',
  requirePermission(PERMISSIONS.NOTIFICATIONS_WRITE),
  validate(pushPreviewSchema),
  async (req, res, next) => {
    try {
      const payload = buildPushPayload(req.body as z.infer<typeof pushPreviewSchema>);
      sendSuccess(res, payload, 'Payload push genere');
    } catch (err) {
      next(err);
    }
  },
);

export default router;
