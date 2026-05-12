-- Migration de rattrapage : champs consolidation / FD pour new_visitors
-- Contexte : schema.prisma attend ces champs mais la base de production ne les possède pas encore.

DO $$ BEGIN
    CREATE TYPE "SoulType" AS ENUM ('NA', 'NC');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AgeRange" AS ENUM ('CHILD', 'TEEN', 'YOUNG_ADULT', 'ADULT', 'MIDDLE', 'SENIOR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "InviterType" AS ENUM ('DISCIPLE_MAKER', 'MEMBER', 'CAMPAIGN', 'EXTERNAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "new_visitors"
ADD COLUMN IF NOT EXISTS "soulType" "SoulType" NOT NULL DEFAULT 'NA',
ADD COLUMN IF NOT EXISTS "phone2" TEXT,
ADD COLUMN IF NOT EXISTS "neighborhood" TEXT,
ADD COLUMN IF NOT EXISTS "ageRange" "AgeRange",
ADD COLUMN IF NOT EXISTS "arrivalEventId" TEXT,
ADD COLUMN IF NOT EXISTS "invitedByMemberId" TEXT,
ADD COLUMN IF NOT EXISTS "inviterType" "InviterType",
ADD COLUMN IF NOT EXISTS "consentToContact" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "transportNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "prayerNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "familyOfDisciplesId" TEXT,
ADD COLUMN IF NOT EXISTS "primaryMakerProfileId" TEXT,
ADD COLUMN IF NOT EXISTS "secondaryMakerProfileId" TEXT,
ADD COLUMN IF NOT EXISTS "riskScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastContactDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastCulteDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "consecutiveAbsences" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "language" TEXT;

CREATE INDEX IF NOT EXISTS "new_visitors_soulType_idx"
ON "new_visitors"("soulType");

CREATE INDEX IF NOT EXISTS "new_visitors_familyOfDisciplesId_idx"
ON "new_visitors"("familyOfDisciplesId");

CREATE INDEX IF NOT EXISTS "new_visitors_primaryMakerProfileId_idx"
ON "new_visitors"("primaryMakerProfileId");

CREATE INDEX IF NOT EXISTS "new_visitors_secondaryMakerProfileId_idx"
ON "new_visitors"("secondaryMakerProfileId");

CREATE INDEX IF NOT EXISTS "new_visitors_arrivalEventId_idx"
ON "new_visitors"("arrivalEventId");

CREATE INDEX IF NOT EXISTS "new_visitors_invitedByMemberId_idx"
ON "new_visitors"("invitedByMemberId");
