import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  login,
  refresh,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from './auth.controller';
import { authService } from './auth.service';
import { blacklistAccessToken } from '../../utils/token-blacklist';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from './auth.validation';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../database/prisma';
import { hashPassword } from '../../utils/password.util';
import { AppError } from '../../middlewares/error.middleware';
import { sendSuccess } from '../../utils/response.util';
import { signAccessToken, signRefreshToken, getRefreshTokenExpiryDate } from '../../utils/jwt.util';

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requis'),
});

const updateMeSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  phone: z.string().max(20).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
}).strict();

const router = Router();

// Login: only failed attempts count (skipSuccessfulRequests prevents punishing valid users)
const authRateLimit = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// forgotPassword always returns 200, so skipSuccessfulRequests must NOT be used here
const forgotPasswordRateLimit = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshRateLimit = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 10,
  message: { success: false, message: 'Trop de rafraîchissements. Réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  password: z.string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caracteres')
    .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
    .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
});

// Routes publiques
router.post('/login', authRateLimit, validate(loginSchema), login);
router.post('/refresh', refreshRateLimit, validate(refreshSchema), refresh);
router.post('/forgot-password', forgotPasswordRateLimit, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authRateLimit, validate(resetPasswordSchema), resetPassword);
router.post('/verify-email', authRateLimit, validate(z.object({ token: z.string().min(1) })), verifyEmail);

router.post('/invitations/accept', authRateLimit, validate(acceptInviteSchema), async (req, res, next) => {
  try {
    const { token, firstName, lastName, password } = req.body as z.infer<typeof acceptInviteSchema>;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Pre-validate existence (non-blocking, data fetched for use in transaction)
    const invitationCheck = await prisma.invitationToken.findUnique({
      where: { token: tokenHash },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!invitationCheck || invitationCheck.acceptedAt || invitationCheck.expiresAt < new Date()) {
      throw new AppError('Invitation invalide ou expirée', 400, 'INVALID_INVITATION');
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent request can mark acceptedAt
      const claimed = await tx.invitationToken.updateMany({
        where: { id: invitationCheck.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppError('Invitation invalide ou expirée', 400, 'INVALID_INVITATION');
      }
      const invitation = invitationCheck;
      const created = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          firstName,
          lastName,
          password: hashedPassword,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });

      if (invitation.roleId) {
        await tx.userRole.create({
          data: {
            userId: created.id,
            roleId: invitation.roleId,
            tenantId: invitation.tenantId,
            assemblyId: invitation.assemblyId ?? null,
            assignedBy: invitation.invitedBy,
          },
        });
      }

      const refreshTokenRecord = await tx.refreshToken.create({
        data: {
          token: crypto.randomUUID(),
          userId: created.id,
          expiresAt: getRefreshTokenExpiryDate(),
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        },
      });

      return { user: created, refreshTokenId: refreshTokenRecord.id, tenantId: invitation.tenantId };
    });

    const accessToken = signAccessToken(user.user.id, user.user.email);
    const refreshToken = signRefreshToken(user.user.id, user.refreshTokenId);

    sendSuccess(res, {
      accessToken,
      refreshToken,
      user: { id: user.user.id, email: user.user.email, firstName, lastName, tenantId: user.tenantId },
    }, 'Invitation acceptee - bienvenue sur BrethrenApp');
  } catch (err) { next(err); }
});

// Routes protégées
router.use(authenticate);

router.post('/logout', validate(logoutSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof logoutSchema>;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) blacklistAccessToken(token);
    await authService.logout(refreshToken, req);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/logout-all', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) blacklistAccessToken(token);
    await authService.logoutAll(req.user!.id, req);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/me', async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user!.id);
    sendSuccess(res, user);
  } catch (err) { next(err); }
});

router.patch('/me', validate(updateMeSchema), async (req, res, next) => {
  try {
    const user = await authService.updateMe(req.user!.id, req.body);
    sendSuccess(res, user, 'Profil mis a jour');
  } catch (err) { next(err); }
});

router.post('/change-password', validate(changePasswordSchema), async (req, res, next) => {
  try {
    await authService.changePassword(req.user!.id, req.body, req);
    // Immediately revoke the current access token so the old credential cannot be reused
    const token = req.headers.authorization?.split(' ')[1];
    if (token) blacklistAccessToken(token);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/send-verification-email', async (req, res, next) => {
  try {
    await authService.sendVerificationEmail(req.user!.id);
    sendSuccess(res, null, 'Email de verification envoye');
  } catch (err) { next(err); }
});

export default router;
