-- CreateEnum
CREATE TYPE "DiplomaType" AS ENUM ('BACCALAUREAT', 'LICENCE', 'MASTER', 'DOCTORAT', 'DIPLOME_THEOLOGIE', 'CERTIFICAT_THEOLOGIE', 'AUTRE');

-- CreateEnum
CREATE TYPE "NewVisitorStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOWING_UP', 'INTEGRATED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('FIRST_CALL', 'SECOND_CALL', 'THIRD_CALL', 'OTHER_CALL', 'VISIT', 'WELCOME_MESSAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "NewcomerSource" AS ENUM ('WORD_OF_MOUTH', 'INVITED_BY_MEMBER', 'SOCIAL_MEDIA', 'EVENT', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "VisitorProfileType" AS ENUM ('VISITOR', 'NEW_CONVERT', 'ESTABLISHED_CHRISTIAN', 'RETURNING_MEMBER', 'SEEKER');

-- CreateEnum
CREATE TYPE "SpiritualNeed" AS ENUM ('SPIRITUAL', 'SOCIAL', 'MATERIAL', 'FAMILY', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "BaptismStatus" AS ENUM ('UNKNOWN', 'ALREADY_BAPTIZED', 'NEEDS_PREPARATION', 'IN_PREPARATION', 'BAPTIZED_HERE');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('ACTIVE', 'INTEGRATED', 'RELAUNCHED', 'TRANSFERRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "JourneyContactType" AS ENUM ('CALL', 'MESSAGE', 'VISIT', 'PRAYER', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('BOOK', 'HYMNAL', 'AUDIO', 'RESOURCE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "scheduledAt" TIMESTAMP(3),
DROP COLUMN "attachments",
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "circulars" DROP COLUMN "attachments",
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "districts" ADD COLUMN     "hqAssemblyId" TEXT;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "isBaptized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFirstTime" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ministries" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "regions" ADD COLUMN     "hqAssemblyId" TEXT;

-- CreateTable
CREATE TABLE "pastor_spouses" (
    "id" TEXT NOT NULL,
    "pastorId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthDate" TIMESTAMP(3),
    "profession" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pastor_spouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pastor_children" (
    "id" TEXT NOT NULL,
    "pastorId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" "Gender" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pastor_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pastor_diplomas" (
    "id" TEXT NOT NULL,
    "pastorId" TEXT NOT NULL,
    "type" "DiplomaType" NOT NULL,
    "title" TEXT NOT NULL,
    "institution" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pastor_diplomas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "new_visitors" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gender" "Gender" NOT NULL,
    "address" TEXT,
    "birthDate" TIMESTAMP(3),
    "firstVisitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assemblyId" TEXT NOT NULL,
    "status" "NewVisitorStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "source" "NewcomerSource",
    "profileType" "VisitorProfileType",
    "spiritualNeed" "SpiritualNeed",
    "orientedDepartment" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "journeyStatus" "JourneyStatus" NOT NULL DEFAULT 'ACTIVE',
    "welcomeCallMade" BOOLEAN NOT NULL DEFAULT false,
    "welcomeCallDate" TIMESTAMP(3),
    "giftGiven" BOOLEAN NOT NULL DEFAULT false,
    "profileDiagnosed" BOOLEAN NOT NULL DEFAULT false,
    "diagnosisDate" TIMESTAMP(3),
    "mentorId" TEXT,
    "mentorAssignedDate" TIMESTAMP(3),
    "courseEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "courseEnrolledDate" TIMESTAMP(3),
    "cellGroupAssigned" BOOLEAN NOT NULL DEFAULT false,
    "cellGroupId" TEXT,
    "baptismStatus" "BaptismStatus" NOT NULL DEFAULT 'UNKNOWN',
    "baptismDate" TIMESTAMP(3),
    "ministryAssigned" BOOLEAN NOT NULL DEFAULT false,
    "ministryId" TEXT,
    "integrationScore" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closureReason" TEXT,
    "convertedMemberId" TEXT,

    CONSTRAINT "new_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "new_visitor_contacts" (
    "id" TEXT NOT NULL,
    "newVisitorId" TEXT NOT NULL,
    "contactType" "ContactType" NOT NULL,
    "contactDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "contactedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "new_visitor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_interactions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "JourneyContactType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publisher" TEXT,
    "type" "ProductType" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "description" TEXT,
    "coverUrl" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assemblyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_orders" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assemblyId" TEXT,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'PICKUP',
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pastor_spouses_pastorId_key" ON "pastor_spouses"("pastorId");

-- CreateIndex
CREATE INDEX "pastor_children_pastorId_idx" ON "pastor_children"("pastorId");

-- CreateIndex
CREATE INDEX "pastor_diplomas_pastorId_idx" ON "pastor_diplomas"("pastorId");

-- CreateIndex
CREATE UNIQUE INDEX "new_visitors_convertedMemberId_key" ON "new_visitors"("convertedMemberId");

-- CreateIndex
CREATE INDEX "new_visitors_assemblyId_idx" ON "new_visitors"("assemblyId");

-- CreateIndex
CREATE INDEX "new_visitors_status_idx" ON "new_visitors"("status");

-- CreateIndex
CREATE INDEX "new_visitors_journeyStatus_idx" ON "new_visitors"("journeyStatus");

-- CreateIndex
CREATE INDEX "new_visitors_currentStep_idx" ON "new_visitors"("currentStep");

-- CreateIndex
CREATE INDEX "new_visitors_mentorId_idx" ON "new_visitors"("mentorId");

-- CreateIndex
CREATE INDEX "new_visitors_deletedAt_idx" ON "new_visitors"("deletedAt");

-- CreateIndex
CREATE INDEX "new_visitor_contacts_newVisitorId_idx" ON "new_visitor_contacts"("newVisitorId");

-- CreateIndex
CREATE INDEX "journey_interactions_visitorId_idx" ON "journey_interactions"("visitorId");

-- CreateIndex
CREATE INDEX "journey_interactions_authorId_idx" ON "journey_interactions"("authorId");

-- CreateIndex
CREATE INDEX "journey_interactions_date_idx" ON "journey_interactions"("date");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_assemblyId_idx" ON "products"("assemblyId");

-- CreateIndex
CREATE INDEX "products_deletedAt_idx" ON "products"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shop_orders_reference_key" ON "shop_orders"("reference");

-- CreateIndex
CREATE INDEX "shop_orders_userId_idx" ON "shop_orders"("userId");

-- CreateIndex
CREATE INDEX "shop_orders_assemblyId_idx" ON "shop_orders"("assemblyId");

-- CreateIndex
CREATE INDEX "shop_orders_status_idx" ON "shop_orders"("status");

-- CreateIndex
CREATE INDEX "shop_orders_createdAt_idx" ON "shop_orders"("createdAt");

-- CreateIndex
CREATE INDEX "shop_order_items_orderId_idx" ON "shop_order_items"("orderId");

-- CreateIndex
CREATE INDEX "shop_order_items_productId_idx" ON "shop_order_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ministries_conversationId_key" ON "ministries"("conversationId");

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_hqAssemblyId_fkey" FOREIGN KEY ("hqAssemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_hqAssemblyId_fkey" FOREIGN KEY ("hqAssemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ministries" ADD CONSTRAINT "ministries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastor_spouses" ADD CONSTRAINT "pastor_spouses_pastorId_fkey" FOREIGN KEY ("pastorId") REFERENCES "pastors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastor_children" ADD CONSTRAINT "pastor_children_pastorId_fkey" FOREIGN KEY ("pastorId") REFERENCES "pastors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastor_diplomas" ADD CONSTRAINT "pastor_diplomas_pastorId_fkey" FOREIGN KEY ("pastorId") REFERENCES "pastors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_visitors" ADD CONSTRAINT "new_visitors_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_visitors" ADD CONSTRAINT "new_visitors_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_visitors" ADD CONSTRAINT "new_visitors_convertedMemberId_fkey" FOREIGN KEY ("convertedMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_visitor_contacts" ADD CONSTRAINT "new_visitor_contacts_newVisitorId_fkey" FOREIGN KEY ("newVisitorId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_interactions" ADD CONSTRAINT "journey_interactions_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "new_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_interactions" ADD CONSTRAINT "journey_interactions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

