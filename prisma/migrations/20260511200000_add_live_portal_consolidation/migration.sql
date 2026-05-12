-- =============================================================================
-- Migration : 20260511200000_add_live_portal_consolidation
-- Contenu   : Tables Live, Portal/Campagnes, Consolidation (FD / Âmes)
--             + leurs enums et index
--
-- Pré-requis déjà appliqués par les migrations précédentes sur ce VPS :
--   20260511170000 → CREATE TYPE "SoulType" + ALTER TABLE new_visitors soulType
--   20260511180000 → CREATE TYPE "AgeRange","InviterType" + autres colonnes FD
--                    sur new_visitors (phone2, neighborhood, ageRange, etc.)
--
-- Cette migration N'ajoute PAS ces colonnes new_visitors (déjà présentes).
-- Elle ajoute les FK sur ces colonnes APRÈS avoir créé les tables référencées.
--
-- Aucune opération destructive : pas de DROP, TRUNCATE, DELETE ni ALTER destructif.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — Enums consolidation (non créés par les migrations précédentes)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums pour les nouvelles tables (FDStatus → families_of_disciples, etc.)
-- Ces enums ne correspondent PAS à des colonnes new_visitors → absents des migrations VPS

CREATE TYPE "FDStatus"               AS ENUM ('ACTIVE', 'INACTIVE', 'DISSOLVED');
CREATE TYPE "SoulAttendanceStatus"   AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');
CREATE TYPE "AbsenceReason"          AS ENUM ('TRAVEL', 'ILLNESS', 'WORK', 'TRANSPORT', 'PROMISE_NOT_KEPT', 'UNREACHABLE', 'NO_RETURN', 'OTHER');
CREATE TYPE "JourneyStepType"        AS ENUM ('WELCOME_CALL', 'VISIT', 'LESSON', 'FD_INTEGRATION', 'BAPTISM_PREP', 'REVIEW', 'OTHER');
CREATE TYPE "JourneyInstanceStatus"  AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'PAUSED');
CREATE TYPE "StepStatus"             AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
CREATE TYPE "RecoveryCaseStatus"     AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "RecoveryDecision"       AS ENUM ('REINTEGRATED', 'EXTENDED', 'LONG_TERM', 'REMOVED');
CREATE TYPE "TaskType"               AS ENUM ('CALL', 'VISIT', 'WAKE_UP_CALL', 'REMINDER', 'LESSON', 'FD_INVITE', 'OTHER');
CREATE TYPE "TaskStatus"             AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Enums Portal / Campagnes publiques
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "CampaignType" AS ENUM (
  'DONATION', 'VISITOR_REGISTRATION', 'PRAYER_REQUEST', 'EVENT_REGISTRATION',
  'VOLUNTEER_SIGNUP', 'MINISTRY_JOIN', 'CONTACT_REQUEST', 'CHECKIN', 'CUSTOM'
);
CREATE TYPE "CampaignStatus"         AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "CampaignScopeType"      AS ENUM ('TENANT', 'REGION', 'DISTRICT', 'ASSEMBLY', 'EVENT', 'MINISTRY');
CREATE TYPE "LinkSource"             AS ENUM ('DEFAULT', 'YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'POSTER', 'WHATSAPP', 'EMAIL', 'WEBSITE', 'EVENT_SCREEN', 'OTHER');
CREATE TYPE "QrFormat"               AS ENUM ('PNG', 'SVG');
CREATE TYPE "SubmissionStatus"       AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SPAM');
CREATE TYPE "SubmissionActionType"   AS ENUM ('CREATE_DONATION', 'CREATE_NEW_VISITOR', 'CREATE_PRAYER_REQUEST', 'CREATE_EVENT_REGISTRATION', 'SEND_NOTIFICATION', 'CREATE_CONVERSATION', 'CREATE_FOLLOW_UP_TASK', 'UPDATE_MEMBER');
CREATE TYPE "SubmissionActionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Enums Live & Médias
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "LiveProvider"            AS ENUM ('YOUTUBE', 'VIMEO', 'FACEBOOK', 'CUSTOM_EMBED', 'OTHER');
CREATE TYPE "LiveServiceStatus"       AS ENUM ('DRAFT', 'SCHEDULED', 'READY', 'LIVE', 'ENDED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "LiveServiceType"         AS ENUM ('SUNDAY_SERVICE', 'PRAYER', 'CONFERENCE', 'SEMINAR', 'YOUTH', 'SPECIAL', 'OTHER');
CREATE TYPE "LiveVisibility"          AS ENUM ('PUBLIC', 'MEMBERS_ONLY', 'ASSEMBLY_ONLY', 'PRIVATE');
CREATE TYPE "LiveMomentType"          AS ENUM ('NEW_VISITOR', 'DONATION', 'PRAYER', 'SALVATION_DECISION', 'EVENT_REGISTRATION', 'SHARE', 'CONTACT_REQUEST', 'CUSTOM');
CREATE TYPE "LiveMomentTrigger"       AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "LivePrayerStatus"        AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED', 'FOLLOW_UP_REQUIRED');
CREATE TYPE "LiveChatMessageStatus"   AS ENUM ('ACTIVE', 'HIDDEN', 'DELETED', 'FLAGGED');
CREATE TYPE "LiveHostRole"            AS ENUM ('HOST', 'MODERATOR', 'PASTOR');
CREATE TYPE "ReplayVisibility"        AS ENUM ('PUBLIC', 'MEMBERS_ONLY', 'ASSEMBLY_ONLY', 'PRIVATE');
CREATE TYPE "LiveEngagementEventType" AS ENUM ('REACTION_AMEN', 'REACTION_PRAYER', 'REACTION_HEART', 'CTA_CLICK', 'DONATION_INITIATED', 'VISITOR_SIGNUP', 'SALVATION_DECISION', 'PRAYER_REQUEST', 'SHARE', 'CHAT_MESSAGE');

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — Sécurisation des enums potentiellement déjà créés sur le VPS
-- (SoulType, AgeRange, InviterType créés par 20260511170000 / 20260511180000)
-- Ces blocs sont des no-ops si les types existent déjà.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "SoulType" AS ENUM ('NA', 'NC');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgeRange" AS ENUM ('CHILD', 'TEEN', 'YOUNG_ADULT', 'ADULT', 'MIDDLE', 'SENIOR');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InviterType" AS ENUM ('DISCIPLE_MAKER', 'MEMBER', 'CAMPAIGN', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — Index sur new_visitors (colonnes déjà présentes)
-- Les colonnes ont été ajoutées par les migrations VPS, mais les index manquent peut-être.
-- CREATE INDEX IF NOT EXISTS → no-op si l'index existe déjà.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "new_visitors_soulType_idx"                ON "new_visitors"("soulType");
CREATE INDEX IF NOT EXISTS "new_visitors_riskScore_idx"               ON "new_visitors"("riskScore");
CREATE INDEX IF NOT EXISTS "new_visitors_familyOfDisciplesId_idx"     ON "new_visitors"("familyOfDisciplesId");
CREATE INDEX IF NOT EXISTS "new_visitors_primaryMakerProfileId_idx"   ON "new_visitors"("primaryMakerProfileId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — FK sur new_visitors vers tables existantes (events, members)
-- Les colonnes existent déjà. Les contraintes FK manquent car les migrations VPS
-- étaient des hot-fixes rapides sans FK. Utilise DO $$ pour éviter double-contrainte.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "new_visitors"
    ADD CONSTRAINT "new_visitors_arrivalEventId_fkey"
      FOREIGN KEY ("arrivalEventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "new_visitors"
    ADD CONSTRAINT "new_visitors_invitedByMemberId_fkey"
      FOREIGN KEY ("invitedByMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — Table : families_of_disciples
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "families_of_disciples" (
    "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"       TEXT        NOT NULL,
    "assemblyId"     TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    "description"    TEXT,
    "status"         "FDStatus"  NOT NULL DEFAULT 'ACTIVE',
    "leaderId"       TEXT        NOT NULL,
    "deputyLeaderId" TEXT,
    "supervisorId"   TEXT,
    "goal"           INTEGER     NOT NULL DEFAULT 10,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"      TIMESTAMP(3),

    CONSTRAINT "families_of_disciples_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "families_of_disciples_name_assemblyId_key"
        UNIQUE ("name", "assemblyId"),
    CONSTRAINT "families_of_disciples_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "families_of_disciples_assemblyId_fkey"
        FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "families_of_disciples_leaderId_fkey"
        FOREIGN KEY ("leaderId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "families_of_disciples_deputyLeaderId_fkey"
        FOREIGN KEY ("deputyLeaderId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "families_of_disciples_supervisorId_fkey"
        FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "families_of_disciples_tenantId_idx"   ON "families_of_disciples"("tenantId");
CREATE INDEX "families_of_disciples_assemblyId_idx" ON "families_of_disciples"("assemblyId");
CREATE INDEX "families_of_disciples_status_idx"     ON "families_of_disciples"("status");
CREATE INDEX "families_of_disciples_deletedAt_idx"  ON "families_of_disciples"("deletedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8 — Table : disciple_maker_profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "disciple_maker_profiles" (
    "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"  TEXT        NOT NULL,
    "memberId"  TEXT        NOT NULL,
    "familyId"  TEXT,
    "partnerId" TEXT,
    "maxLoad"   INTEGER     NOT NULL DEFAULT 10,
    "isActive"  BOOLEAN     NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disciple_maker_profiles_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "disciple_maker_profiles_memberId_key"
        UNIQUE ("memberId"),
    CONSTRAINT "disciple_maker_profiles_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "disciple_maker_profiles_memberId_fkey"
        FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "disciple_maker_profiles_familyId_fkey"
        FOREIGN KEY ("familyId") REFERENCES "families_of_disciples"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "disciple_maker_profiles_partnerId_fkey"
        FOREIGN KEY ("partnerId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "disciple_maker_profiles_tenantId_idx" ON "disciple_maker_profiles"("tenantId");
CREATE INDEX "disciple_maker_profiles_familyId_idx" ON "disciple_maker_profiles"("familyId");
CREATE INDEX "disciple_maker_profiles_isActive_idx" ON "disciple_maker_profiles"("isActive");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9 — FK sur new_visitors vers les tables qu'on vient de créer
-- Les colonnes (familyOfDisciplesId, primaryMakerProfileId, secondaryMakerProfileId)
-- ont été ajoutées par 20260511180000 SANS FK car les tables n'existaient pas encore.
-- Utilise DO $$ pour sécurité si la migration est rejouée.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "new_visitors"
    ADD CONSTRAINT "new_visitors_familyOfDisciplesId_fkey"
      FOREIGN KEY ("familyOfDisciplesId") REFERENCES "families_of_disciples"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "new_visitors"
    ADD CONSTRAINT "new_visitors_primaryMakerProfileId_fkey"
      FOREIGN KEY ("primaryMakerProfileId") REFERENCES "disciple_maker_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "new_visitors"
    ADD CONSTRAINT "new_visitors_secondaryMakerProfileId_fkey"
      FOREIGN KEY ("secondaryMakerProfileId") REFERENCES "disciple_maker_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10 — Table : soul_assignments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "soul_assignments" (
    "id"              TEXT     NOT NULL DEFAULT gen_random_uuid()::text,
    "soulId"          TEXT     NOT NULL,
    "discipleMakerId" TEXT     NOT NULL,
    "assignedById"    TEXT     NOT NULL,
    "familyId"        TEXT,
    "assignedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"         TIMESTAMP(3),
    "reason"          TEXT,
    "isPrimary"       BOOLEAN  NOT NULL DEFAULT true,

    CONSTRAINT "soul_assignments_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "soul_assignments_soulId_fkey"
        FOREIGN KEY ("soulId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_assignments_discipleMakerId_fkey"
        FOREIGN KEY ("discipleMakerId") REFERENCES "disciple_maker_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_assignments_assignedById_fkey"
        FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_assignments_familyId_fkey"
        FOREIGN KEY ("familyId") REFERENCES "families_of_disciples"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "soul_assignments_soulId_idx"          ON "soul_assignments"("soulId");
CREATE INDEX "soul_assignments_discipleMakerId_idx"  ON "soul_assignments"("discipleMakerId");
CREATE INDEX "soul_assignments_familyId_idx"         ON "soul_assignments"("familyId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 11 — Table : soul_culte_attendances
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "soul_culte_attendances" (
    "id"               TEXT                   NOT NULL DEFAULT gen_random_uuid()::text,
    "soulId"           TEXT                   NOT NULL,
    "culteDate"        DATE                   NOT NULL,
    "eventId"          TEXT,
    "status"           "SoulAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "absenceReason"    "AbsenceReason",
    "promisedToCome"   BOOLEAN                NOT NULL DEFAULT false,
    "wakeUpCallDone"   BOOLEAN                NOT NULL DEFAULT false,
    "transportNeeded"  BOOLEAN                NOT NULL DEFAULT false,
    "transportOffered" BOOLEAN                NOT NULL DEFAULT false,
    "notes"            TEXT,
    "recordedById"     TEXT                   NOT NULL,
    "createdAt"        TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_culte_attendances_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "soul_culte_attendances_soulId_culteDate_key"
        UNIQUE ("soulId", "culteDate"),
    CONSTRAINT "soul_culte_attendances_soulId_fkey"
        FOREIGN KEY ("soulId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_culte_attendances_eventId_fkey"
        FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "soul_culte_attendances_recordedById_fkey"
        FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "soul_culte_attendances_soulId_idx"    ON "soul_culte_attendances"("soulId");
CREATE INDEX "soul_culte_attendances_culteDate_idx" ON "soul_culte_attendances"("culteDate");
CREATE INDEX "soul_culte_attendances_eventId_idx"   ON "soul_culte_attendances"("eventId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 12 — Tables : parcours consolidation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "consolidation_journey_templates" (
    "id"           TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT    NOT NULL,
    "name"         TEXT    NOT NULL,
    "description"  TEXT,
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "isDefault"    BOOLEAN NOT NULL DEFAULT false,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_journey_templates_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "consolidation_journey_templates_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "consolidation_journey_templates_tenantId_idx" ON "consolidation_journey_templates"("tenantId");

CREATE TABLE "consolidation_step_templates" (
    "id"           TEXT              NOT NULL DEFAULT gen_random_uuid()::text,
    "templateId"   TEXT              NOT NULL,
    "title"        TEXT              NOT NULL,
    "description"  TEXT,
    "dueAfterDays" INTEGER           NOT NULL,
    "order"        INTEGER           NOT NULL,
    "isRequired"   BOOLEAN           NOT NULL DEFAULT true,
    "stepType"     "JourneyStepType" NOT NULL DEFAULT 'OTHER',

    CONSTRAINT "consolidation_step_templates_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "consolidation_step_templates_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "consolidation_journey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "consolidation_step_templates_templateId_idx" ON "consolidation_step_templates"("templateId");

CREATE TABLE "soul_consolidation_journeys" (
    "id"          TEXT                    NOT NULL DEFAULT gen_random_uuid()::text,
    "soulId"      TEXT                    NOT NULL,
    "templateId"  TEXT                    NOT NULL,
    "status"      "JourneyInstanceStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes"       TEXT,

    CONSTRAINT "soul_consolidation_journeys_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "soul_consolidation_journeys_soulId_templateId_key"
        UNIQUE ("soulId", "templateId"),
    CONSTRAINT "soul_consolidation_journeys_soulId_fkey"
        FOREIGN KEY ("soulId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_consolidation_journeys_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "consolidation_journey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "soul_consolidation_journeys_soulId_idx" ON "soul_consolidation_journeys"("soulId");
CREATE INDEX "soul_consolidation_journeys_status_idx" ON "soul_consolidation_journeys"("status");

CREATE TABLE "soul_journey_step_progress" (
    "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "journeyId"      TEXT         NOT NULL,
    "stepTemplateId" TEXT         NOT NULL,
    "status"         "StepStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt"    TIMESTAMP(3),
    "completedById"  TEXT,
    "notes"          TEXT,

    CONSTRAINT "soul_journey_step_progress_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "soul_journey_step_progress_journeyId_stepTemplateId_key"
        UNIQUE ("journeyId", "stepTemplateId"),
    CONSTRAINT "soul_journey_step_progress_journeyId_fkey"
        FOREIGN KEY ("journeyId") REFERENCES "soul_consolidation_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_journey_step_progress_stepTemplateId_fkey"
        FOREIGN KEY ("stepTemplateId") REFERENCES "consolidation_step_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "soul_journey_step_progress_completedById_fkey"
        FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13 — Table : recovery_cases
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "recovery_cases" (
    "id"           TEXT                 NOT NULL DEFAULT gen_random_uuid()::text,
    "soulId"       TEXT                 NOT NULL,
    "tenantId"     TEXT                 NOT NULL,
    "reason"       TEXT                 NOT NULL,
    "openedAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById"   TEXT                 NOT NULL,
    "assignedToId" TEXT,
    "status"       "RecoveryCaseStatus" NOT NULL DEFAULT 'OPEN',
    "decision"     "RecoveryDecision",
    "closedAt"     TIMESTAMP(3),
    "closedById"   TEXT,
    "notes"        TEXT,

    CONSTRAINT "recovery_cases_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "recovery_cases_soulId_fkey"
        FOREIGN KEY ("soulId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recovery_cases_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recovery_cases_openedById_fkey"
        FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recovery_cases_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "recovery_cases_closedById_fkey"
        FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "recovery_cases_tenantId_idx" ON "recovery_cases"("tenantId");
CREATE INDEX "recovery_cases_soulId_idx"   ON "recovery_cases"("soulId");
CREATE INDEX "recovery_cases_status_idx"   ON "recovery_cases"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 14 — Table : follow_up_tasks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "follow_up_tasks" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT         NOT NULL,
    "soulId"       TEXT         NOT NULL,
    "assignedToId" TEXT         NOT NULL,
    "type"         "TaskType"   NOT NULL DEFAULT 'CALL',
    "dueAt"        TIMESTAMP(3) NOT NULL,
    "status"       "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt"  TIMESTAMP(3),
    "notes"        TEXT,
    "createdById"  TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_tasks_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_tasks_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "follow_up_tasks_soulId_fkey"
        FOREIGN KEY ("soulId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "follow_up_tasks_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "follow_up_tasks_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "follow_up_tasks_tenantId_idx"     ON "follow_up_tasks"("tenantId");
CREATE INDEX "follow_up_tasks_soulId_idx"       ON "follow_up_tasks"("soulId");
CREATE INDEX "follow_up_tasks_assignedToId_idx" ON "follow_up_tasks"("assignedToId");
CREATE INDEX "follow_up_tasks_dueAt_idx"        ON "follow_up_tasks"("dueAt");
CREATE INDEX "follow_up_tasks_status_idx"       ON "follow_up_tasks"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 15 — Tables Portal / Campagnes publiques
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "public_campaigns" (
    "id"          TEXT                NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"    TEXT                NOT NULL,
    "title"       TEXT                NOT NULL,
    "description" TEXT,
    "type"        "CampaignType"      NOT NULL,
    "status"      "CampaignStatus"    NOT NULL DEFAULT 'DRAFT',
    "scopeType"   "CampaignScopeType" NOT NULL DEFAULT 'ASSEMBLY',
    "scopeId"     TEXT,
    "settings"    JSONB               NOT NULL DEFAULT '{}',
    "startsAt"    TIMESTAMP(3),
    "endsAt"      TIMESTAMP(3),
    "createdById" TEXT                NOT NULL,
    "createdAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"   TIMESTAMP(3),

    CONSTRAINT "public_campaigns_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "public_campaigns_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "public_campaigns_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "public_campaigns_tenantId_status_idx" ON "public_campaigns"("tenantId", "status");
CREATE INDEX "public_campaigns_tenantId_type_idx"   ON "public_campaigns"("tenantId", "type");
CREATE INDEX "public_campaigns_deletedAt_idx"       ON "public_campaigns"("deletedAt");

CREATE TABLE "public_links" (
    "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "campaignId" TEXT         NOT NULL,
    "slug"       TEXT         NOT NULL,
    "source"     "LinkSource" NOT NULL DEFAULT 'DEFAULT',
    "label"      TEXT,
    "isActive"   BOOLEAN      NOT NULL DEFAULT true,
    "expiresAt"  TIMESTAMP(3),
    "scans"      INTEGER      NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_links_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "public_links_slug_key"
        UNIQUE ("slug"),
    CONSTRAINT "public_links_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "public_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "public_links_campaignId_idx" ON "public_links"("campaignId");
CREATE INDEX "public_links_slug_idx"       ON "public_links"("slug");

CREATE TABLE "qr_code_assets" (
    "id"            TEXT       NOT NULL DEFAULT gen_random_uuid()::text,
    "publicLinkId"  TEXT       NOT NULL,
    "format"        "QrFormat" NOT NULL DEFAULT 'PNG',
    "fileUrl"       TEXT       NOT NULL,
    "label"         TEXT,
    "designOptions" JSONB      NOT NULL DEFAULT '{}',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_code_assets_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "qr_code_assets_publicLinkId_fkey"
        FOREIGN KEY ("publicLinkId") REFERENCES "public_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "qr_code_assets_publicLinkId_idx" ON "qr_code_assets"("publicLinkId");

CREATE TABLE "public_submissions" (
    "id"             TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"       TEXT               NOT NULL,
    "campaignId"     TEXT               NOT NULL,
    "publicLinkId"   TEXT,
    "submittedAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash"         TEXT,
    "userAgent"      TEXT,
    "sourceMetadata" JSONB              NOT NULL DEFAULT '{}',
    "payload"        JSONB              NOT NULL,
    "status"         "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt"    TIMESTAMP(3),

    CONSTRAINT "public_submissions_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "public_submissions_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "public_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "public_submissions_publicLinkId_fkey"
        FOREIGN KEY ("publicLinkId") REFERENCES "public_links"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "public_submissions_tenantId_campaignId_idx" ON "public_submissions"("tenantId", "campaignId");
CREATE INDEX "public_submissions_tenantId_status_idx"     ON "public_submissions"("tenantId", "status");
CREATE INDEX "public_submissions_submittedAt_idx"         ON "public_submissions"("submittedAt");

CREATE TABLE "public_submission_actions" (
    "id"               TEXT                     NOT NULL DEFAULT gen_random_uuid()::text,
    "submissionId"     TEXT                     NOT NULL,
    "actionType"       "SubmissionActionType"   NOT NULL,
    "targetEntityType" TEXT,
    "targetEntityId"   TEXT,
    "status"           "SubmissionActionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage"     TEXT,
    "createdAt"        TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_submission_actions_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "public_submission_actions_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "public_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "public_submission_actions_submissionId_idx" ON "public_submission_actions"("submissionId");

CREATE TABLE "public_campaign_metrics" (
    "id"                TEXT     NOT NULL DEFAULT gen_random_uuid()::text,
    "campaignId"        TEXT     NOT NULL,
    "date"              DATE     NOT NULL,
    "views"             INTEGER  NOT NULL DEFAULT 0,
    "scans"             INTEGER  NOT NULL DEFAULT 0,
    "submissions"       INTEGER  NOT NULL DEFAULT 0,
    "successfulActions" INTEGER  NOT NULL DEFAULT 0,
    "completedPayments" INTEGER  NOT NULL DEFAULT 0,
    "totalAmount"       DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "public_campaign_metrics_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "public_campaign_metrics_campaignId_date_key"
        UNIQUE ("campaignId", "date"),
    CONSTRAINT "public_campaign_metrics_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "public_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "public_campaign_metrics_campaignId_idx" ON "public_campaign_metrics"("campaignId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 16 — Table : live_channels
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "live_channels" (
    "id"          TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"    TEXT           NOT NULL,
    "assemblyId"  TEXT,
    "name"        TEXT           NOT NULL,
    "provider"    "LiveProvider" NOT NULL,
    "streamUrl"   TEXT,
    "externalId"  TEXT,
    "embedCode"   TEXT,
    "isDefault"   BOOLEAN        NOT NULL DEFAULT false,
    "isActive"    BOOLEAN        NOT NULL DEFAULT true,
    "settings"    JSONB          NOT NULL DEFAULT '{}',
    "createdById" TEXT           NOT NULL,
    "createdAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_channels_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_channels_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_channels_assemblyId_fkey"
        FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "live_channels_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "live_channels_tenantId_isActive_idx" ON "live_channels"("tenantId", "isActive");
CREATE INDEX "live_channels_assemblyId_idx"         ON "live_channels"("assemblyId");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 17 — Table : live_services
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "live_services" (
    "id"                      TEXT                NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"                TEXT                NOT NULL,
    "assemblyId"              TEXT                NOT NULL,
    "channelId"               TEXT,
    "eventId"                 TEXT,
    "title"                   TEXT                NOT NULL,
    "description"             TEXT,
    "type"                    "LiveServiceType"   NOT NULL DEFAULT 'SUNDAY_SERVICE',
    "status"                  "LiveServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility"              "LiveVisibility"    NOT NULL DEFAULT 'PUBLIC',
    "slug"                    TEXT                NOT NULL,
    "thumbnailUrl"            TEXT,
    "provider"                "LiveProvider",
    "externalLiveId"          TEXT,
    "embedUrl"                TEXT,
    "scheduledStartAt"        TIMESTAMP(3),
    "scheduledEndAt"          TIMESTAMP(3),
    "actualStartAt"           TIMESTAMP(3),
    "actualEndAt"             TIMESTAMP(3),
    "allowChat"               BOOLEAN             NOT NULL DEFAULT true,
    "allowPrayer"             BOOLEAN             NOT NULL DEFAULT true,
    "allowDonations"          BOOLEAN             NOT NULL DEFAULT true,
    "allowVisitorSignup"      BOOLEAN             NOT NULL DEFAULT true,
    "allowSalvationDecision"  BOOLEAN             NOT NULL DEFAULT true,
    "viewCount"               INTEGER             NOT NULL DEFAULT 0,
    "peakViewerCount"         INTEGER             NOT NULL DEFAULT 0,
    "language"                TEXT,
    "tags"                    TEXT[]              NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdById"             TEXT                NOT NULL,
    "createdAt"               TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"               TIMESTAMP(3),

    CONSTRAINT "live_services_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_services_slug_key"
        UNIQUE ("slug"),
    CONSTRAINT "live_services_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_services_assemblyId_fkey"
        FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_services_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "live_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "live_services_eventId_fkey"
        FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "live_services_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "live_services_tenantId_status_idx"   ON "live_services"("tenantId", "status");
CREATE INDEX "live_services_assemblyId_status_idx" ON "live_services"("assemblyId", "status");
CREATE INDEX "live_services_scheduledStartAt_idx"  ON "live_services"("scheduledStartAt");
CREATE INDEX "live_services_deletedAt_idx"         ON "live_services"("deletedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 18 — Tables Live secondaires
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "live_host_assignments" (
    "id"         TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId"  TEXT           NOT NULL,
    "userId"     TEXT           NOT NULL,
    "role"       "LiveHostRole" NOT NULL DEFAULT 'MODERATOR',
    "assignedAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_host_assignments_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_host_assignments_serviceId_userId_key"
        UNIQUE ("serviceId", "userId"),
    CONSTRAINT "live_host_assignments_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_host_assignments_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "live_host_assignments_serviceId_idx" ON "live_host_assignments"("serviceId");

CREATE TABLE "live_chat_messages" (
    "id"        TEXT                    NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId" TEXT                    NOT NULL,
    "userId"    TEXT,
    "guestName" TEXT,
    "content"   TEXT                    NOT NULL,
    "status"    "LiveChatMessageStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPinned"  BOOLEAN                 NOT NULL DEFAULT false,
    "isSystem"  BOOLEAN                 NOT NULL DEFAULT false,
    "parentId"  TEXT,
    "createdAt" TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "live_chat_messages_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_chat_messages_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_chat_messages_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "live_chat_messages_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "live_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "live_chat_messages_serviceId_createdAt_idx" ON "live_chat_messages"("serviceId", "createdAt");
CREATE INDEX "live_chat_messages_serviceId_status_idx"    ON "live_chat_messages"("serviceId", "status");

CREATE TABLE "live_prayer_requests" (
    "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId"       TEXT               NOT NULL,
    "tenantId"        TEXT               NOT NULL,
    "firstName"       TEXT,
    "prayerSubject"   TEXT               NOT NULL,
    "phone"           TEXT,
    "email"           TEXT,
    "confidentiality" TEXT               NOT NULL DEFAULT 'TEAM',
    "wantsContact"    BOOLEAN            NOT NULL DEFAULT false,
    "status"          "LivePrayerStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId"    TEXT,
    "assignedAt"      TIMESTAMP(3),
    "closedAt"        TIMESTAMP(3),
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_prayer_requests_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_prayer_requests_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_prayer_requests_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "live_prayer_requests_serviceId_status_idx" ON "live_prayer_requests"("serviceId", "status");
CREATE INDEX "live_prayer_requests_tenantId_idx"          ON "live_prayer_requests"("tenantId");

CREATE TABLE "live_viewer_sessions" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId"   TEXT         NOT NULL,
    "userId"      TEXT,
    "guestToken"  TEXT,
    "enteredAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt"      TIMESTAMP(3),
    "durationSec" INTEGER,
    "device"      TEXT,
    "source"      TEXT,

    CONSTRAINT "live_viewer_sessions_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_viewer_sessions_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_viewer_sessions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "live_viewer_sessions_serviceId_idx"           ON "live_viewer_sessions"("serviceId");
CREATE INDEX "live_viewer_sessions_serviceId_enteredAt_idx" ON "live_viewer_sessions"("serviceId", "enteredAt");

CREATE TABLE "live_moments" (
    "id"          TEXT                NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId"   TEXT                NOT NULL,
    "type"        "LiveMomentType"    NOT NULL,
    "title"       TEXT                NOT NULL,
    "message"     TEXT,
    "buttonText"  TEXT,
    "actionUrl"   TEXT,
    "campaignId"  TEXT,
    "triggerMode" "LiveMomentTrigger" NOT NULL DEFAULT 'MANUAL',
    "scheduledAt" TIMESTAMP(3),
    "displayedAt" TIMESTAMP(3),
    "hiddenAt"    TIMESTAMP(3),
    "durationSec" INTEGER,
    "impressions" INTEGER             NOT NULL DEFAULT 0,
    "clicks"      INTEGER             NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN             NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_moments_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_moments_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_moments_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "public_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "live_moments_serviceId_idx"          ON "live_moments"("serviceId");
CREATE INDEX "live_moments_serviceId_isActive_idx" ON "live_moments"("serviceId", "isActive");

CREATE TABLE "live_engagement_events" (
    "id"        TEXT                      NOT NULL DEFAULT gen_random_uuid()::text,
    "serviceId" TEXT                      NOT NULL,
    "userId"    TEXT,
    "type"      "LiveEngagementEventType" NOT NULL,
    "metadata"  JSONB                     NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_engagement_events_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "live_engagement_events_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "live_engagement_events_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "live_engagement_events_serviceId_type_idx"      ON "live_engagement_events"("serviceId", "type");
CREATE INDEX "live_engagement_events_serviceId_createdAt_idx" ON "live_engagement_events"("serviceId", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 19 — Table : media_replays
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "media_replays" (
    "id"           TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"     TEXT               NOT NULL,
    "assemblyId"   TEXT,
    "serviceId"    TEXT,
    "title"        TEXT               NOT NULL,
    "description"  TEXT,
    "thumbnailUrl" TEXT,
    "videoUrl"     TEXT               NOT NULL,
    "provider"     "LiveProvider",
    "externalId"   TEXT,
    "preacher"     TEXT,
    "series"       TEXT,
    "tags"         TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
    "verseRefs"    TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
    "durationSec"  INTEGER,
    "visibility"   "ReplayVisibility" NOT NULL DEFAULT 'MEMBERS_ONLY',
    "publishedAt"  TIMESTAMP(3),
    "viewCount"    INTEGER            NOT NULL DEFAULT 0,
    "notes"        TEXT,
    "createdById"  TEXT               NOT NULL,
    "createdAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"    TIMESTAMP(3),

    CONSTRAINT "media_replays_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "media_replays_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "media_replays_assemblyId_fkey"
        FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "media_replays_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "live_services"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "media_replays_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "media_replays_tenantId_visibility_idx" ON "media_replays"("tenantId", "visibility");
CREATE INDEX "media_replays_assemblyId_idx"           ON "media_replays"("assemblyId");
CREATE INDEX "media_replays_serviceId_idx"            ON "media_replays"("serviceId");
CREATE INDEX "media_replays_deletedAt_idx"            ON "media_replays"("deletedAt");
