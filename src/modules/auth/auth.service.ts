import crypto from 'crypto';
import { MemberStatus, UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { verifyPassword, hashPassword } from '../../utils/password.util';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiryDate,
} from '../../utils/jwt.util';

// Pre-computed once at startup — used to constant-time the login path when
// the email does not exist, preventing timing-based email enumeration.
const DUMMY_HASH_PROMISE = hashPassword('DUMMY_TIMING_PROTECTION_NOT_A_REAL_PASSWORD');
import { createAuditLog } from '../../utils/audit.util';
import { AppError, NotFoundError } from '../../middlewares/error.middleware';
import { emailService } from '../../services/email.service';
import type {
  LoginDto,
  RefreshDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './auth.validation';
import { Request } from 'express';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: {
    id: string;
    tenantId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    tenant?: {
      id: string;
      name: string;
      slug: string;
      status: string;
      plan?: { code: string; name: string } | null;
    } | null;
    roles: Array<{ name: string; level: number }>;
  };
}

type ScopedRoleSummary = { name: string; level: number };

function mapRoleSummaries(
  userRoles: Array<{
    role: {
      name: string;
      level: number;
    };
  }>
): ScopedRoleSummary[] {
  return userRoles.map((userRole) => ({
    name: userRole.role.name,
    level: userRole.role.level,
  }));
}

function ensureAccountCanAuthenticate(user: {
  status: UserStatus;
  member?: { status: MemberStatus; deletedAt?: Date | null } | null;
}) {
  if (user.status === UserStatus.SUSPENDED) {
    throw new AppError('Compte suspendu. Contactez un administrateur.', 403, 'ACCOUNT_SUSPENDED');
  }

  if (user.status === UserStatus.INACTIVE) {
    throw new AppError('Compte inactif. Contactez un administrateur.', 403, 'ACCOUNT_INACTIVE');
  }

  if (user.status === UserStatus.PENDING) {
    throw new AppError('Compte en attente d\'activation.', 403, 'ACCOUNT_PENDING');
  }

  if (user.member?.deletedAt) {
    throw new AppError('Compte membre inactif. Contactez un administrateur.', 403, 'MEMBER_INACTIVE');
  }

  if (user.member && user.member.status !== MemberStatus.ACTIVE) {
    throw new AppError('Compte membre inactif. Contactez un administrateur.', 403, 'MEMBER_INACTIVE');
  }
}

export class AuthService {
  async login(dto: LoginDto, req: Request): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
      include: {
        member: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
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
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      // Dummy verify to equalise response time regardless of whether the email exists
      await verifyPassword(await DUMMY_HASH_PROMISE, dto.password).catch(() => {});
      throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
    }

    ensureAccountCanAuthenticate(user);

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      throw new AppError('Organisation inactive ou suspendue.', 403, 'TENANT_INACTIVE');
    }

    const isValid = await verifyPassword(user.password, dto.password);
    if (!isValid) {
      await createAuditLog({
        actorId: user.id,
        action: 'LOGIN',
        metadata: { success: false, reason: 'wrong_password' },
        req,
      });
      throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
    }

    // Générer les tokens
    const refreshTokenRecord = await this.createRefreshToken(user.id, req);
    const accessToken = signAccessToken(user.id, user.email);
    const refreshToken = signRefreshToken(user.id, refreshTokenRecord.id);

    // Mettre à jour lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await createAuditLog({
      actorId: user.id,
      action: 'LOGIN',
      metadata: { success: true },
      req,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 min en secondes
      user: {
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
        roles: mapRoleSummaries(user.userRoles),
      },
    };
  }

  async refresh(dto: RefreshDto, req: Request): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(dto.refreshToken);
    } catch {
      throw new AppError('Refresh token invalide ou expiré', 401, 'INVALID_REFRESH_TOKEN');
    }

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { id: payload.tokenId },
      include: {
        user: {
          include: {
            tenant: {
              select: {
                status: true,
              },
            },
            member: {
              select: {
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!tokenRecord || tokenRecord.revokedAt !== null) {
      throw new AppError('Refresh token révoqué', 401, 'TOKEN_REVOKED');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new AppError('Refresh token expiré', 401, 'TOKEN_EXPIRED');
    }

    if (tokenRecord.userId !== payload.sub) {
      throw new AppError('Token invalide', 401, 'INVALID_TOKEN');
    }

    const user = tokenRecord.user;

    if (user.deletedAt !== null) {
      throw new AppError('Compte inactif', 403, 'ACCOUNT_INACTIVE');
    }

    ensureAccountCanAuthenticate(user);

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      throw new AppError('Organisation inactive ou suspendue.', 403, 'TENANT_INACTIVE');
    }

    // Rotation du refresh token
    await prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    const newRefreshTokenRecord = await this.createRefreshToken(user.id, req);
    const accessToken = signAccessToken(user.id, user.email);
    const refreshToken = signRefreshToken(user.id, newRefreshTokenRecord.id);

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  async logout(refreshToken: string, req: Request): Promise<void> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      // Ignorer les tokens invalides lors du logout
      return;
    }

    await prisma.refreshToken.updateMany({
      where: { id: payload.tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      actorId: payload.sub,
      action: 'LOGOUT',
      req,
    });
  }

  async logoutAll(userId: string, req: Request): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      actorId: userId,
      action: 'LOGOUT',
      metadata: { allSessions: true },
      req,
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    });

    // Ne pas révéler si l'email existe ou non (security best practice)
    if (!user) return;

    // Invalider les anciens tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    // Stocker uniquement le hash SHA-256 — le token brut n'est jamais persisté
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await prisma.passwordResetToken.create({
      data: {
        token: tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    await emailService.sendPasswordReset(user.email, rawToken, user.firstName);
  }

  async resetPassword(dto: ResetPasswordDto, req: Request): Promise<void> {
    // Reconstituer le hash pour lookup — le token brut n'est jamais stocké
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.usedAt !== null) {
      throw new AppError('Token de réinitialisation invalide', 400, 'INVALID_RESET_TOKEN');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new AppError('Token de réinitialisation expiré', 400, 'EXPIRED_RESET_TOKEN');
    }

    const hashedPassword = await hashPassword(dto.password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
      // Révoquer tous les refresh tokens existants
      prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      actorId: tokenRecord.userId,
      action: 'PASSWORD_RESET',
      req,
    });
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    req: Request
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) throw new NotFoundError('Utilisateur');

    const isValid = await verifyPassword(user.password, dto.currentPassword);
    if (!isValid) {
      throw new AppError('Mot de passe actuel incorrect', 400, 'WRONG_PASSWORD');
    }

    const hashedPassword = await hashPassword(dto.newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Révoquer tous les refresh tokens sauf le courant
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      actorId: userId,
      action: 'PASSWORD_CHANGE',
      req,
    });
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        avatar: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            country: true,
            currency: true,
            language: true,
            timezone: true,
            status: true,
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIALING'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { plan: true },
            },
          },
        },
        member: {
          select: {
            id: true,
            matricule: true,
            assemblyId: true,
            assembly: {
              select: {
                id: true,
                name: true,
                district: {
                  select: {
                    id: true,
                    name: true,
                    region: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        userRoles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
                level: true,
                rolePermissions: { select: { permission: { select: { id: true, name: true } } } },
              },
            },
            tenant: { select: { id: true, name: true, slug: true } },
            region: { select: { id: true, name: true } },
            district: { select: { id: true, name: true } },
            assembly: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundError('Utilisateur');
    return {
      ...user,
      tenant: user.tenant
        ? {
            ...user.tenant,
            subscription: user.tenant.subscriptions[0] ?? null,
            subscriptions: undefined,
          }
        : null,
      roles: mapRoleSummaries(user.userRoles),
    };
  }

  async updateMe(userId: string, dto: { firstName?: string; lastName?: string; phone?: string | null; avatar?: string | null }) {
    return prisma.user.update({
      where: { id: userId },
      data: dto,
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, avatar: true, status: true },
    });
  }

  async sendVerificationEmail(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.emailVerifiedAt) return;

    await prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.emailVerificationToken.create({
      data: { id: crypto.randomUUID(), token: tokenHash, userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });

    await emailService.sendEmailVerification(user.email, rawToken, user.firstName);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await prisma.emailVerificationToken.findUnique({ where: { token: tokenHash }, include: { user: true } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError('Lien de vérification invalide ou expiré', 400, 'INVALID_TOKEN');
    }

    // Only activate PENDING accounts; never override SUSPENDED or other statuses.
    const shouldActivate = record.user.status === UserStatus.PENDING;

    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          ...(shouldActivate ? { status: UserStatus.ACTIVE } : {}),
        },
      }),
    ]);
  }

  private async createRefreshToken(userId: string, req: Request) {
    return prisma.refreshToken.create({
      data: {
        token: crypto.randomUUID(),
        userId,
        expiresAt: getRefreshTokenExpiryDate(),
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      },
    });
  }
}

export const authService = new AuthService();
