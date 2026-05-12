import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  API_VERSION: z.string().default('v1'),
  APP_NAME: z.string().default('Brethren API'),
  HOST: z.string().default('localhost'),
  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.string().transform(Number).default('7'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: z.string().transform((v) => v === 'true').default('true'),

  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX: z.string().transform(Number).default('1000'),
  AUTH_RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  AUTH_RATE_LIMIT_MAX: z.string().transform(Number).default('5'),

  BASE_URL: z.string().min(1, 'BASE_URL requis').default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),

  DEFAULT_PAGE_SIZE: z.string().transform(Number).default('20'),
  MAX_PAGE_SIZE: z.string().transform(Number).default('100'),

  // ─── Email SMTP (requis en production pour reset mot de passe) ────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_SECURE: z.string().transform((v) => v === 'true').default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  ADMIN_ERROR_EMAIL: z.string().optional(),
  FRONTEND_URL: z.string().optional(),

  // ─── Stockage fichiers S3 (optionnel — local disk par défaut) ─────
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  if (process.env['NODE_ENV'] === 'test') {
    throw new Error(`❌ Invalid environment variables: ${JSON.stringify(errors)}`);
  }
  console.error('❌ Invalid environment variables:');
  console.error(errors);
  process.exit(1);
}

export const config = parsed.data;

// ─── Validation & avertissements production ───────────────────────────
if (config.NODE_ENV === 'production') {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    warnings.push('SMTP_HOST, SMTP_USER, SMTP_PASS non configurés — le reset de mot de passe ne fonctionnera pas');
  }
  if (!config.SMTP_FROM) {
    warnings.push('SMTP_FROM non configuré — les emails utiliseront un expéditeur par défaut');
  }
  if (!config.FRONTEND_URL) {
    warnings.push('FRONTEND_URL non configuré — les liens de reset pointeront vers BASE_URL');
  }
  if (!config.S3_BUCKET) {
    warnings.push('S3_BUCKET non configuré — les fichiers sont stockés localement (non recommandé en production)');
  }

  const dangerousOrigins = config.CORS_ORIGIN.split(',').filter((o) => {
    const trimmed = o.trim();
    return trimmed === 'http://*' || trimmed === '*' || trimmed.includes('localhost') || trimmed === 'http://';
  });
  if (dangerousOrigins.length > 0) {
    errors.push(`CORS_ORIGIN contient des origines non sécurisées: ${dangerousOrigins.join(', ')}`);
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('❌ Erreurs de configuration bloquantes en production:');
    // eslint-disable-next-line no-console
    errors.forEach((e) => console.error(`   • ${e}`));
    process.exit(1);
  }
  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  Avertissements de configuration production:');
    // eslint-disable-next-line no-console
    warnings.forEach((w) => console.warn(`   • ${w}`));
  }
}

export type Config = typeof config;
