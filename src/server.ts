import 'dotenv/config';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './database/prisma';
import { logger } from './utils/logger';
import { config } from './config';

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    logger.info('✅ Database connected');

    const app = createApp();

    const server = app.listen(config.PORT, config.HOST, () => {
      logger.info(`🚀 ${config.APP_NAME} running on port ${config.PORT}`);
      logger.info(`📖 Swagger UI: http://localhost:${config.PORT}/api-docs`);
      logger.info(`🌍 Environment: ${config.NODE_ENV}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);

      // Arrêter d'accepter de nouvelles connexions
      server.close(async () => {
        logger.info('HTTP server closed — disconnecting DB');
        await disconnectDatabase();
        logger.info('Shutdown complete');
        process.exit(0);
      });

      // Fermer les connexions keep-alive inactives (Node.js >= 18.2)
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      // Fermer toutes les connexions restantes après 5s
      setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }, 5_000);

      // Forcer la sortie après 10s si des requêtes traînent
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.fatal({ err }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled rejection');
      process.exit(1);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
