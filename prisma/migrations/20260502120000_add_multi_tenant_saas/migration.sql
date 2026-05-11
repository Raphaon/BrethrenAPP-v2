-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'DELETED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'STARTER', 'PRO', 'PREMIUM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "country" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Douala',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dateFormat" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    "phoneFormat" TEXT,
    "contactEmail" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "secondaryColor" TEXT NOT NULL DEFAULT '#16a34a',
    "onboardingChecklist" JSONB,
    "notificationPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "maxAssemblies" INTEGER,
    "maxMembers" INTEGER,
    "maxAdminUsers" INTEGER,
    "maxRegions" INTEGER,
    "maxDistricts" INTEGER,
    "maxPreachingPoints" INTEGER,
    "maxMinistries" INTEGER,
    "maxGroups" INTEGER,
    "allowRegions" BOOLEAN NOT NULL DEFAULT false,
    "allowDistricts" BOOLEAN NOT NULL DEFAULT false,
    "allowAdvancedReports" BOOLEAN NOT NULL DEFAULT false,
    "allowBranding" BOOLEAN NOT NULL DEFAULT false,
    "allowPublicApi" BOOLEAN NOT NULL DEFAULT false,
    "supportLevel" TEXT NOT NULL DEFAULT 'community',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "user_roles" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "regions" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "announcements" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "circulars" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "events" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "tenantId" TEXT;

-- Seed platform plans and attach existing mono-tenant data to a default tenant.
INSERT INTO "plans" (
    "id", "code", "name", "description", "monthlyPriceCents", "currency",
    "maxAssemblies", "maxMembers", "maxAdminUsers", "maxRegions", "maxDistricts",
    "maxPreachingPoints", "maxMinistries", "maxGroups", "allowRegions",
    "allowDistricts", "allowAdvancedReports", "allowBranding", "allowPublicApi",
    "supportLevel", "isActive", "createdAt", "updatedAt"
) VALUES
('00000000-0000-0000-0000-0000000000f1', 'FREE', 'Free', 'Plan gratuit pour demarrer une assemblee locale', 0, 'USD', 1, 50, 2, 0, 0, 1, 5, 5, false, false, false, false, false, 'community', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('00000000-0000-0000-0000-0000000000f2', 'STARTER', 'Starter', 'Pour une eglise locale en croissance', 2500, 'USD', 1, 200, 5, 0, 0, 3, 15, 20, false, false, false, false, false, 'email', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('00000000-0000-0000-0000-0000000000f3', 'PRO', 'Pro', 'Planning, rapports et dons avances', 5900, 'USD', 3, 1000, 15, 0, 3, 10, NULL, NULL, false, true, true, true, false, 'priority', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('00000000-0000-0000-0000-0000000000f4', 'PREMIUM', 'Premium', 'Multi-assemblees et rapports consolides', 14900, 'USD', 20, 10000, 50, NULL, NULL, NULL, NULL, NULL, true, true, true, true, true, 'priority', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('00000000-0000-0000-0000-0000000000f5', 'ENTERPRISE', 'Enterprise', 'Pour federations et missions internationales', 0, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true, true, true, true, 'dedicated', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "tenants" (
    "id", "name", "slug", "country", "currency", "language", "timezone",
    "status", "createdAt", "updatedAt"
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Mission du Plein Evangile au Cameroun',
    'mpe-cameroun',
    'CM',
    'XAF',
    'fr',
    'Africa/Douala',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "tenant_settings" (
    "id", "tenantId", "contactEmail", "createdAt", "updatedAt"
) VALUES (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    'admin@mpe-cameroun.org',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "subscriptions" (
    "id", "tenantId", "planId", "status", "createdAt", "updatedAt"
) VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-0000000000f4',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

UPDATE "users"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "user_roles" ur
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
FROM "roles" r
WHERE ur."roleId" = r."id"
  AND r."name" <> 'super_admin'
  AND ur."tenantId" IS NULL;

UPDATE "regions"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "announcements"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "circulars"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "events"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "audit_logs"
SET "tenantId" = '00000000-0000-0000-0000-000000000001'
WHERE "tenantId" IS NULL;

UPDATE "tenants"
SET "ownerId" = (
    SELECT u."id"
    FROM "users" u
    JOIN "user_roles" ur ON ur."userId" = u."id"
    JOIN "roles" r ON r."id" = ur."roleId"
    WHERE r."name" IN ('national_admin', 'super_admin')
    ORDER BY CASE WHEN r."name" = 'national_admin' THEN 0 ELSE 1 END, u."createdAt" ASC
    LIMIT 1
)
WHERE "id" = '00000000-0000-0000-0000-000000000001';

ALTER TABLE "regions" ALTER COLUMN "tenantId" SET NOT NULL;

-- Drop obsolete mono-tenant uniqueness.
DROP INDEX IF EXISTS "regions_name_key";
DROP INDEX IF EXISTS "regions_code_key";
DROP INDEX IF EXISTS "user_roles_userId_roleId_regionId_districtId_assemblyId_ministryId_key";

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");
CREATE INDEX "tenants_status_idx" ON "tenants"("status");
CREATE INDEX "tenants_ownerId_idx" ON "tenants"("ownerId");
CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
CREATE INDEX "plans_isActive_idx" ON "plans"("isActive");
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");
CREATE UNIQUE INDEX "user_roles_userId_roleId_tenantId_regionId_districtId_assemblyId_ministryId_key" ON "user_roles"("userId", "roleId", "tenantId", "regionId", "districtId", "assemblyId", "ministryId");
CREATE INDEX "user_roles_tenantId_idx" ON "user_roles"("tenantId");
CREATE UNIQUE INDEX "regions_tenantId_name_key" ON "regions"("tenantId", "name");
CREATE UNIQUE INDEX "regions_tenantId_code_key" ON "regions"("tenantId", "code");
CREATE INDEX "regions_tenantId_idx" ON "regions"("tenantId");
CREATE INDEX "announcements_tenantId_idx" ON "announcements"("tenantId");
CREATE INDEX "circulars_tenantId_idx" ON "circulars"("tenantId");
CREATE INDEX "events_tenantId_idx" ON "events"("tenantId");
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "regions" ADD CONSTRAINT "regions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "circulars" ADD CONSTRAINT "circulars_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
