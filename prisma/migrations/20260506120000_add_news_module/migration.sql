-- CreateEnum
CREATE TYPE "NewsPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NewsPostType" AS ENUM ('NEWS', 'HIGHLIGHT', 'MESSAGE', 'TESTIMONY', 'EVENT_RECAP');

-- AlterEnum
ALTER TYPE "CommentTargetType" ADD VALUE IF NOT EXISTS 'NEWS_POST';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEWS';

-- CreateTable
CREATE TABLE "news_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "type" "NewsPostType" NOT NULL DEFAULT 'NEWS',
    "status" "NewsPostStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "level" "AnnouncementLevel" NOT NULL,
    "regionId" TEXT,
    "districtId" TEXT,
    "assemblyId" TEXT,
    "ministryId" TEXT,
    "media" JSONB NOT NULL DEFAULT '[]',
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "news_posts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "comments" ADD COLUMN "newsPostId" TEXT;
ALTER TABLE "comments" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "news_posts_tenantId_idx" ON "news_posts"("tenantId");
CREATE INDEX "news_posts_authorId_idx" ON "news_posts"("authorId");
CREATE INDEX "news_posts_level_idx" ON "news_posts"("level");
CREATE INDEX "news_posts_status_idx" ON "news_posts"("status");
CREATE INDEX "news_posts_type_idx" ON "news_posts"("type");
CREATE INDEX "news_posts_featured_idx" ON "news_posts"("featured");
CREATE INDEX "news_posts_publishedAt_idx" ON "news_posts"("publishedAt");
CREATE INDEX "news_posts_deletedAt_idx" ON "news_posts"("deletedAt");
CREATE INDEX "comments_newsPostId_idx" ON "comments"("newsPostId");
CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");

-- AddForeignKey
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_ministryId_fkey" FOREIGN KEY ("ministryId") REFERENCES "ministries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_newsPostId_fkey" FOREIGN KEY ("newsPostId") REFERENCES "news_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed permissions for the news module and attach them to existing system roles.
INSERT INTO "permissions" ("id", "name", "displayName", "module", "action", "createdAt")
VALUES
  ('00000000-0000-0000-0000-000000000611', 'news:read', 'Lire les actualites', 'news', 'read', CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000612', 'news:write', 'Creer ou modifier des actualites', 'news', 'write', CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000613', 'news:publish', 'Publier des actualites', 'news', 'publish', CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000614', 'news:delete', 'Supprimer des actualites', 'news', 'delete', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action";

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5(r."id" || p."id"), 1, 8), '-',
    substr(md5(r."id" || p."id"), 9, 4), '-',
    substr(md5(r."id" || p."id"), 13, 4), '-',
    substr(md5(r."id" || p."id"), 17, 4), '-',
    substr(md5(r."id" || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
JOIN "permissions" p ON p."name" IN ('news:read', 'news:write', 'news:publish', 'news:delete')
WHERE r."name" IN ('super_admin', 'tenant_owner', 'tenant_admin', 'national_admin', 'regional_leader', 'district_leader')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5(r."id" || p."id"), 1, 8), '-',
    substr(md5(r."id" || p."id"), 9, 4), '-',
    substr(md5(r."id" || p."id"), 13, 4), '-',
    substr(md5(r."id" || p."id"), 17, 4), '-',
    substr(md5(r."id" || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
JOIN "permissions" p ON p."name" IN ('news:read', 'news:write', 'news:publish')
WHERE r."name" IN ('assembly_pastor', 'assembly_admin')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5(r."id" || p."id"), 1, 8), '-',
    substr(md5(r."id" || p."id"), 9, 4), '-',
    substr(md5(r."id" || p."id"), 13, 4), '-',
    substr(md5(r."id" || p."id"), 17, 4), '-',
    substr(md5(r."id" || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
JOIN "permissions" p ON p."name" = 'news:read'
WHERE r."name" IN ('ministry_leader', 'member')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
