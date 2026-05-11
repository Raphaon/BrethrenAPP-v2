CREATE TYPE "ReportSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ReportStatus"   AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');

CREATE TABLE "user_reports" (
    "id"               TEXT             NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"           TEXT             NOT NULL,
    "tenantId"         TEXT,
    "appModule"        TEXT             NOT NULL,
    "appAction"        TEXT             NOT NULL,
    "pageUrl"          TEXT,
    "userAgent"        TEXT,
    "expectedBehavior" TEXT             NOT NULL,
    "actualBehavior"   TEXT             NOT NULL,
    "additionalInfo"   TEXT,
    "screenshotUrl"    TEXT,
    "severity"         "ReportSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status"           "ReportStatus"   NOT NULL DEFAULT 'OPEN',
    "resolvedAt"       TIMESTAMP(3),
    "resolvedById"     TEXT,
    "resolutionNotes"  TEXT,
    "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_reports_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_reports_status_idx"    ON "user_reports"("status");
CREATE INDEX "user_reports_appModule_idx" ON "user_reports"("appModule");
CREATE INDEX "user_reports_severity_idx"  ON "user_reports"("severity");
CREATE INDEX "user_reports_userId_idx"    ON "user_reports"("userId");
CREATE INDEX "user_reports_tenantId_idx"  ON "user_reports"("tenantId");
CREATE INDEX "user_reports_createdAt_idx" ON "user_reports"("createdAt");
