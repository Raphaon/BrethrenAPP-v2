import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'crypto';
import path from 'path';

import { config } from './config';
import { swaggerSpec } from './config/swagger';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { paginationMiddleware } from './middlewares/pagination.middleware';
import { prisma } from './database/prisma';

// Modules
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import roleRoutes from './modules/roles/roles.routes';
import permissionRoutes from './modules/permissions/permissions.routes';
import regionRoutes from './modules/regions/regions.routes';
import districtRoutes from './modules/districts/districts.routes';
import assemblyRoutes from './modules/assemblies/assemblies.routes';
import preachingPointRoutes from './modules/preaching-points/preaching-points.routes';
import memberRoutes from './modules/members/members.routes';
import pastorRoutes from './modules/pastors/pastors.routes';
import newVisitorRoutes from './modules/new-visitors/new-visitors.routes';
import assignmentRoutes from './modules/assignments/assignments.routes';
import ministryRoutes from './modules/ministries/ministries.routes';
import announcementRoutes from './modules/announcements/announcements.routes';
import circularRoutes from './modules/circulars/circulars.routes';
import eventRoutes from './modules/events/events.routes';
import transferRoutes from './modules/transfers/transfers.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import auditLogRoutes from './modules/audit-logs/audit-logs.routes';
import errorLogRoutes from './modules/error-logs/error-logs.routes';
import userReportRoutes from './modules/user-reports/user-reports.routes';
import statisticsRoutes from './modules/statistics/statistics.routes';
import conversationRoutes from './modules/conversations/conversations.routes';
import calendarRoutes from './modules/calendar/calendar.routes';
import uploadRoutes from './modules/upload/upload.routes';
import donationRoutes from './modules/donations/donations.routes';
import deviceRoutes from './modules/devices/devices.routes';
import territoryAccountRoutes from './modules/territory-accounts/territory-accounts.routes';
import shopRoutes from './modules/shop/shop.routes';
import soulsRoutes from './modules/souls/souls.routes';
import fdRoutes from './modules/families-of-disciples/fd.routes';
import dmRoutes from './modules/disciple-makers/dm.routes';
import soulAttendanceRoutes from './modules/soul-attendance/soul-attendance.routes';
import consolidationJourneysRoutes from './modules/consolidation-journeys/cj.routes';
import recoveryCasesRoutes from './modules/recovery-cases/rc.routes';
import followUpTasksRoutes from './modules/follow-up-tasks/fut.routes';
import consolidationReportsRoutes from './modules/consolidation-reports/reports.routes';
import publicRoutes from './modules/public/public.routes';
import publicCampaignRoutes from './modules/public-campaigns/public-campaigns.routes';
import liveChannelRoutes from './modules/live/live-channels.routes';
import liveServiceRoutes from './modules/live/live-services.routes';
import liveReplayRoutes from './modules/live/live-replays.routes';
import livePublicRoutes from './modules/live/live-public.routes';

export function createApp(): Application {
  const app = express();

  // ─── Static files (uploads) — avant helmet/rate-limit pour éviter les comptages inutiles
  app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads'), {
    maxAge: '7d',
    immutable: false,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }));

  // ─── Security ───────────────────────────────────
  app.use(helmet());
  app.set('trust proxy', 1);

  // ─── CORS ────────────────────────────────────────
  const origins = config.CORS_ORIGIN
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o !== 'http://' && o !== 'http://*' && o !== '*');
  app.use(
    cors({
      origin: origins,
      credentials: config.CORS_CREDENTIALS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // ─── Body parsing ────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());

  // ─── Request ID (corrélation des logs + error reporting) ───────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = id;
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });

  // ─── Request timeout (30s) ───────────────────────
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ success: false, message: 'Request timeout', code: 'TIMEOUT' });
      }
    }, 30_000);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  });

  // ─── Logging ─────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          // Authorization header intentionnellement omis des logs
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );

  // ─── Global Rate Limiting ────────────────────────
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Trop de requêtes, réessayez plus tard.' },
    })
  );

  // ─── Validation UUID globale sur tous les :id ────
  // Couvre automatiquement tous les modules sans modifier chaque router
  app.param('id', (_req, res, next, id: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({ success: false, message: 'Identifiant invalide', code: 'INVALID_ID' });
      return;
    }
    next();
  });

  // ─── Pagination ──────────────────────────────────
  app.use(paginationMiddleware);

  // ─── Swagger (désactivé en production) ───────────
  if (config.NODE_ENV !== 'production') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
  }

  // ─── Health ──────────────────────────────────────
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() });
    }
  });

  // ─── API Routes ──────────────────────────────────
  const apiBase = `/api/${config.API_VERSION}`;

  // Routes publiques (sans authentification)
  app.use(`${apiBase}/public`, publicRoutes);
  app.use(`${apiBase}/public/live`, livePublicRoutes);

  app.use(`${apiBase}/auth`, authRoutes);
  app.use(`${apiBase}/users`, userRoutes);
  app.use(`${apiBase}/roles`, roleRoutes);
  app.use(`${apiBase}/permissions`, permissionRoutes);
  app.use(`${apiBase}/regions`, regionRoutes);
  app.use(`${apiBase}/districts`, districtRoutes);
  app.use(`${apiBase}/assemblies`, assemblyRoutes);
  app.use(`${apiBase}/preaching-points`, preachingPointRoutes);
  app.use(`${apiBase}/members`, memberRoutes);
  app.use(`${apiBase}/pastors`, pastorRoutes);
  app.use(`${apiBase}/new-visitors`, newVisitorRoutes);
  app.use(`${apiBase}/assignments`, assignmentRoutes);
  app.use(`${apiBase}/ministries`, ministryRoutes);
  app.use(`${apiBase}/announcements`, announcementRoutes);
  app.use(`${apiBase}/circulars`, circularRoutes);
  app.use(`${apiBase}/events`, eventRoutes);
  app.use(`${apiBase}/calendar`, calendarRoutes);
  app.use(`${apiBase}/transfers`, transferRoutes);
  app.use(`${apiBase}/notifications`, notificationRoutes);
  app.use(`${apiBase}/audit-logs`, auditLogRoutes);
  app.use(`${apiBase}/error-logs`, errorLogRoutes);
  app.use(`${apiBase}/user-reports`, userReportRoutes);
  app.use(`${apiBase}/statistics`, statisticsRoutes);
  app.use(`${apiBase}/conversations`, conversationRoutes);
  app.use(`${apiBase}/upload`, uploadRoutes);
  app.use(`${apiBase}/donations`, donationRoutes);
  app.use(`${apiBase}/devices`, deviceRoutes);
  app.use(`${apiBase}/territory-accounts`, territoryAccountRoutes);
  app.use(`${apiBase}/shop`, shopRoutes);
  app.use(`${apiBase}/souls`, soulsRoutes);
  app.use(`${apiBase}/families-of-disciples`, fdRoutes);
  app.use(`${apiBase}/disciple-makers`, dmRoutes);
  app.use(`${apiBase}/soul-attendance`, soulAttendanceRoutes);
  app.use(`${apiBase}/consolidation-journeys`, consolidationJourneysRoutes);
  app.use(`${apiBase}/recovery-cases`, recoveryCasesRoutes);
  app.use(`${apiBase}/follow-up-tasks`, followUpTasksRoutes);
  app.use(`${apiBase}/consolidation-reports`, consolidationReportsRoutes);
  app.use(`${apiBase}/public-campaigns`, publicCampaignRoutes);
  app.use(`${apiBase}/live/channels`, liveChannelRoutes);
  app.use(`${apiBase}/live/services`, liveServiceRoutes);
  app.use(`${apiBase}/live/replays`, liveReplayRoutes);

  // ─── Error Handling ──────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
