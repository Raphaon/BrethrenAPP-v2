import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { sendSuccess } from '../../utils/response.util';
import { blacklistAccessToken } from '../../utils/token-blacklist';
import type {
  LoginDto,
  RefreshDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './auth.validation';

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Connexion utilisateur
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Connexion réussie
 *       401:
 *         description: Identifiants incorrects
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body as LoginDto, req);
    sendSuccess(res, result, 'Connexion réussie');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rafraîchir le token d'accès
 *     security: []
 */
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.refresh(req.body as RefreshDto, req);
    sendSuccess(res, result, 'Token rafraîchi');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Déconnexion
 */
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };

    // Blacklister immédiatement le token d'accès courant
    const rawAccessToken = req.headers.authorization?.split(' ')[1];
    if (rawAccessToken) blacklistAccessToken(rawAccessToken);

    await authService.logout(refreshToken, req);
    sendSuccess(res, null, 'Déconnexion réussie');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Déconnecter toutes les sessions
 */
export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawAccessToken = req.headers.authorization?.split(' ')[1];
    if (rawAccessToken) blacklistAccessToken(rawAccessToken);

    await authService.logoutAll(req.user!.id, req);
    sendSuccess(res, null, 'Toutes les sessions ont été révoquées');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Demande de réinitialisation du mot de passe
 *     security: []
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.forgotPassword(req.body as ForgotPasswordDto);
    // Toujours répondre 200 pour ne pas révéler les emails existants
    sendSuccess(
      res,
      null,
      'Si cet email existe, un lien de réinitialisation a été envoyé.'
    );
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Réinitialisation du mot de passe
 *     security: []
 */
export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.resetPassword(req.body as ResetPasswordDto, req);
    sendSuccess(res, null, 'Mot de passe réinitialisé avec succès');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Changement de mot de passe (authentifié)
 */
export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.changePassword(req.user!.id, req.body as ChangePasswordDto, req);
    sendSuccess(res, null, 'Mot de passe modifié avec succès');
  } catch (err) {
    next(err);
  }
}

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Profil de l'utilisateur connecté
 */
export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.user!.id);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { firstName, lastName, phone, avatar } = req.body as {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      avatar?: string | null;
    };
    const user = await authService.updateMe(req.user!.id, { firstName, lastName, phone, avatar });
    sendSuccess(res, user, 'Profil mis à jour');
  } catch (err) {
    next(err);
  }
}

export async function sendVerificationEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.sendVerificationEmail(req.user!.id);
    sendSuccess(res, null, 'Email de vérification envoyé');
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.verifyEmail((req.body as { token: string }).token);
    sendSuccess(res, null, 'Email vérifié avec succès');
  } catch (err) {
    next(err);
  }
}
