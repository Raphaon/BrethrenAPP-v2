CREATE TYPE "ErrorSeverity" AS ENUM ('WARNING', 'ERROR', 'CRITICAL');

CREATE TABLE "error_logs" (
    "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "requestId"   TEXT,
    "severity"    "ErrorSeverity" NOT NULL DEFAULT 'ERROR',
    "method"      TEXT,
    "path"        TEXT,
    "statusCode"  INTEGER,
    "errorType"   TEXT,
    "message"     TEXT NOT NULL,
    "stack"       TEXT,
    "code"        TEXT,
    "userId"      TEXT,
    "userEmail"   TEXT,
    "tenantId"    TEXT,
    "ip"          TEXT,
    "userAgent"   TEXT,
    "requestBody" JSONB,
    "resolved"    BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt"  TIMESTAMP(3),
    "notes"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "error_logs_severity_idx"   ON "error_logs"("severity");
CREATE INDEX "error_logs_statusCode_idx" ON "error_logs"("statusCode");
CREATE INDEX "error_logs_createdAt_idx"  ON "error_logs"("createdAt");
CREATE INDEX "error_logs_userId_idx"     ON "error_logs"("userId");
CREATE INDEX "error_logs_tenantId_idx"   ON "error_logs"("tenantId");
CREATE INDEX "error_logs_resolved_idx"   ON "error_logs"("resolved");
