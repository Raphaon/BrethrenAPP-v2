import { prisma } from '../database/prisma';
import { buildPushPayload } from './push.util';
import { logger } from './logger';

interface NotifyUsersOptions {
  title: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: any;
  entityType?: string;
  entityId?: string;
  scope?: {
    assemblyId?: string;
    districtId?: string;
    regionId?: string;
  };
  userIds?: string[];
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  badge: number;
  data: Record<string, unknown>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  // Send in chunks of 100 (Expo limit)
  for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Expo push API non-200');
      }
    } catch (err) {
      logger.warn({ err }, 'Expo push send failed');
    }
  }
}

export async function notifyUsers(opts: NotifyUsersOptions): Promise<void> {
  try {
    let ids: string[] = [];

    if (opts.userIds && opts.userIds.length > 0) {
      ids = opts.userIds;
    } else {
      const roleWhere = opts.scope ? buildRoleWhere(opts.scope) : {};
      const userRoles = await prisma.userRole.findMany({
        where: roleWhere,
        select: { userId: true },
        distinct: ['userId'],
      });
      ids = userRoles.map((ur) => ur.userId);

      if (!opts.scope && ids.length === 0) {
        const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
        ids = users.map((u) => u.id);
      }
    }

    if (ids.length === 0) return;

    // 1. Persist in-app notifications
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        title: opts.title,
        message: opts.message,
        type: opts.type,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        status: 'UNREAD',
      })),
      skipDuplicates: true,
    });

    // 2. Send Expo push to active device tokens
    const deviceTokens = await prisma.deviceToken.findMany({
      where: {
        userId: { in: ids },
        revokedAt: null,
        provider: 'expo',
      },
      select: { token: true },
    });

    if (deviceTokens.length === 0) return;

    const payload = buildPushPayload({
      title: opts.title,
      body: opts.message,
      entityType: opts.entityType,
      entityId: opts.entityId,
    });

    const messages: ExpoPushMessage[] = deviceTokens
      .filter((dt) => dt.token.startsWith('ExponentPushToken['))
      .map((dt) => ({ to: dt.token, ...payload }));

    if (messages.length > 0) {
      void sendExpoPush(messages);
    }
  } catch {
    // Non-critical — swallow
  }
}

function buildRoleWhere(scope: { assemblyId?: string; districtId?: string; regionId?: string }) {
  const OR: object[] = [];
  if (scope.assemblyId) OR.push({ assemblyId: scope.assemblyId });
  if (scope.districtId) OR.push({ districtId: scope.districtId });
  if (scope.regionId) OR.push({ regionId: scope.regionId });
  return OR.length > 0 ? { OR } : {};
}
