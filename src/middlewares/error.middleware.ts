import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { prisma } from '../database/prisma';
import { emailService } from '../services/email.service';
import { config } from '../config';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public code?: string,
    public errors?: unknown[]
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Ressource') {
    super(`${resource} introuvable`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Accès refusé') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Non authentifié') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

// ─── Helper : body anonymisé (sans passwords ni tokens) ──────────────────────
function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined;
  const sensitive = ['password', 'token', 'secret', 'accessToken', 'refreshToken', 'pin', 'cvv', 'cardNumber'];
  const sanitized = { ...(body as Record<string, unknown>) };
  for (const key of sensitive) {
    if (key in sanitized) sanitized[key] = '[REDACTED]';
  }
  return sanitized;
}

// ─── Persister l'erreur en base (fire-and-forget) ────────────────────────────
async function persistErrorLog(req: Request, err: Error, statusCode: number, code?: string): Promise<void> {
  try {
    await (prisma as any).errorLog.create({
      data: {
        requestId:   req.requestId,
        severity:    statusCode >= 500 ? 'CRITICAL' : 'WARNING',
        method:      req.method,
        path:        req.path,
        statusCode,
        errorType:   err.constructor.name,
        message:     err.message,
        stack:       err.stack,
        code:        code ?? 'UNKNOWN',
        userId:      req.user?.id,
        userEmail:   req.user?.email,
        tenantId:    req.user?.tenantId,
        ip:          req.ip ?? req.socket?.remoteAddress,
        userAgent:   req.headers['user-agent'],
        requestBody: req.method !== 'GET' ? sanitizeBody(req.body) : undefined,
      },
    });
  } catch (dbErr) {
    logger.warn({ dbErr }, "Impossible de persister l'erreur en base");
  }
}

// ─── Email d'alerte pour les erreurs 500 ─────────────────────────────────────
async function sendErrorAlert(req: Request, err: Error): Promise<void> {
  const adminEmail = config.ADMIN_ERROR_EMAIL ?? config.SMTP_FROM;
  if (!adminEmail || config.NODE_ENV !== 'production') return;
  try {
    await emailService.sendRaw({
      to:      adminEmail,
      subject: `🚨 [BrethrenApp] Erreur 500 — ${req.method} ${req.path}`,
      html: `
        <h2 style="color:#dc2626">Erreur interne détectée</h2>
        <table style="border-collapse:collapse;font-family:monospace;font-size:13px">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Request ID</td><td><strong>${req.requestId ?? 'N/A'}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Route</td><td><strong>${req.method} ${req.path}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Utilisateur</td><td>${req.user?.email ?? 'Non connecté'} (${req.user?.id ?? '-'})</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Tenant</td><td>${req.user?.tenantId ?? '-'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">IP</td><td>${req.ip}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Date</td><td>${new Date().toISOString()}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Erreur</td><td style="color:#dc2626"><strong>${err.name}: ${err.message}</strong></td></tr>
        </table>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;margin-top:12px">${err.stack ?? 'Pas de stack trace'}</pre>
      `,
      text: `Erreur 500 sur ${req.method} ${req.path}\n\n${err.stack}`,
    });
  } catch (emailErr) {
    logger.warn({ emailErr }, "Impossible d'envoyer l'email d'alerte erreur");
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {

  // ── Zod validation error (422) ─────────────────────────────────────────────
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
    logger.warn({ requestId: req.requestId, path: req.path, method: req.method, errors }, 'Validation error');
    res.status(422).json({ success: false, message: 'Données de requête invalides', code: 'VALIDATION_ERROR', errors });
    return;
  }

  // ── AppError ────────────────────────────────────────────────────────────────
  if (err instanceof AppError) {
    const level = err.statusCode >= 500 ? 'error' : 'warn';
    logger[level]({ requestId: req.requestId, path: req.path, statusCode: err.statusCode, code: err.code }, err.message);
    if (err.statusCode >= 500) {
      void persistErrorLog(req, err, err.statusCode, err.code);
      void sendErrorAlert(req, err);
    }
    res.status(err.statusCode).json({ success: false, message: err.message, code: err.code, errors: err.errors });
    return;
  }

  // ── Prisma unique constraint (409) ─────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[]) ?? [];
      logger.warn({ requestId: req.requestId, prismaCode: err.code, fields }, 'Duplicate entry');
      res.status(409).json({ success: false, message: `Un enregistrement avec ces données existe déjà (${fields.join(', ')})`, code: 'DUPLICATE_ENTRY' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Enregistrement introuvable', code: 'NOT_FOUND' });
      return;
    }
    logger.error({ requestId: req.requestId, prismaCode: err.code, err }, 'Prisma error');
    void persistErrorLog(req, err, 500, `PRISMA_${err.code}`);
    void sendErrorAlert(req, err);
    res.status(500).json({ success: false, message: 'Erreur de base de données', code: 'DATABASE_ERROR' });
    return;
  }

  // ── Erreur inconnue (500) ──────────────────────────────────────────────────
  logger.error({ requestId: req.requestId, path: req.path, method: req.method, err }, 'Unhandled error');
  void persistErrorLog(req, err, 500, 'INTERNAL_SERVER_ERROR');
  void sendErrorAlert(req, err);
  res.status(500).json({ success: false, message: 'Erreur interne du serveur', code: 'INTERNAL_SERVER_ERROR' });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} introuvable`, code: 'ROUTE_NOT_FOUND' });
}
