import { MemberStatus } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.util';
import { prisma } from '../database/prisma';
import { sendError } from '../utils/response.util';
import { isAccessTokenBlacklisted } from '../utils/token-blacklist';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 'Token d\'authentification manquant', 401, 'UNAUTHORIZED');
    return;
  }

  const token = authHeader.split(' ')[1];

  if (isAccessTokenBlacklisted(token)) {
    sendError(res, 'Token révoqué', 401, 'TOKEN_REVOKED');
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIALING'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { plan: { select: { code: true, name: true } } },
            },
          },
        },
        member: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      sendError(res, 'Utilisateur introuvable', 401, 'USER_NOT_FOUND');
      return;
    }

    if (user.status !== 'ACTIVE') {
      sendError(res, 'Compte inactif ou suspendu', 403, 'ACCOUNT_INACTIVE');
      return;
    }

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      sendError(res, 'Organisation inactive ou suspendue', 403, 'TENANT_INACTIVE');
      return;
    }

    if (user.member?.deletedAt || (user.member && user.member.status !== MemberStatus.ACTIVE)) {
      sendError(res, 'Compte membre inactif', 403, 'MEMBER_INACTIVE');
      return;
    }

    req.user = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      tenant: user.tenant
        ? {
            id: user.tenant.id,
            name: user.tenant.name,
            slug: user.tenant.slug,
            status: user.tenant.status,
            plan: user.tenant.subscriptions[0]?.plan ?? null,
          }
        : null,
      roles: user.userRoles,
    };

    next();
  } catch {
    sendError(res, 'Token invalide ou expiré', 401, 'INVALID_TOKEN');
  }
}

// Middleware optionnel — ne bloque pas si pas de token
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIALING'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { plan: { select: { code: true, name: true } } },
            },
          },
        },
        member: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (
      user &&
      user.status === 'ACTIVE' &&
      (!user.tenant || user.tenant.status === 'ACTIVE') &&
      !user.member?.deletedAt &&
      (!user.member || user.member.status === MemberStatus.ACTIVE)
    ) {
      req.user = {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              slug: user.tenant.slug,
              status: user.tenant.status,
              plan: user.tenant.subscriptions[0]?.plan ?? null,
            }
          : null,
        roles: user.userRoles,
      };
    }
  } catch {
    // Ignore invalid token in optional auth
  }

  next();
}
