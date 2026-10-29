-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('WHATSAPP_GROUP', 'WHATSAPP_DIRECT', 'PHONE_CALL', 'SUPPLIER_LIST', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierMessageStatus" AS ENUM ('PENDING_REVIEW', 'PARTIALLY_APPLIED', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('PENDING_VERIFICATION', 'AVAILABLE_LAST_CHECK', 'CONFIRMED_FOR_ORDER', 'SOLD_OUT_CONFIRMED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ARS', 'USD');

-- CreateEnum
CREATE TYPE "ImageSourceType" AS ENUM ('SUPPLIER', 'OWN_PHOTO', 'OTHER_AUTHORIZED');

-- CreateEnum
CREATE TYPE "PriceProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TargetMode" AS ENUM ('FIXED_PROFIT', 'MARGIN_PERCENT', 'MARKUP_PERCENT');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('UP', 'NEAREST', 'DOWN');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "reason" TEXT,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "contactNote" TEXT,
    "notes" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMessage" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "rawText" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "consultedAt" TIMESTAMP(3) NOT NULL,
    "status" "SupplierMessageStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "parsedResult" JSONB,
    "createdBy" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "internalSku" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierSku" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "costPrice" INTEGER,
    "transportCost" INTEGER,
    "otherCosts" INTEGER,
    "accessoriesCost" INTEGER,
    "costUpdatedAt" TIMESTAMP(3),
    "salePrice" INTEGER,
    "salePriceUpdatedAt" TIMESTAMP(3),
    "availabilityStatus" "AvailabilityStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "estimatedDeliveryDays" INTEGER,
    "dataSource" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "dataDate" TIMESTAMP(3),
    "dataVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastConsultedAt" TIMESTAMP(3),
    "nextDispatchDate" TIMESTAMP(3),
    "nextDispatchWeekday" INTEGER,
    "nextDispatchMode" TEXT,
    "nextDispatchConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "conditions" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "supplierSku" TEXT,
    "availabilityStatus" "AvailabilityStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "lastConsultedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "optimizedKey" TEXT,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sourceType" "ImageSourceType" NOT NULL,
    "sourceNote" TEXT,
    "authorizedForPublication" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCostHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "costPrice" INTEGER,
    "transportCost" INTEGER,
    "otherCosts" INTEGER,
    "consultedAt" TIMESTAMP(3) NOT NULL,
    "source" "DataSource" NOT NULL,
    "supplierMessageId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeProposal" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierMessageId" TEXT,
    "source" "DataSource" NOT NULL,
    "oldCostPrice" INTEGER,
    "newCostPrice" INTEGER NOT NULL,
    "oldConsultedAt" TIMESTAMP(3),
    "newConsultedAt" TIMESTAMP(3) NOT NULL,
    "oldSalePrice" INTEGER,
    "proposedSalePrice" INTEGER,
    "impact" JSONB NOT NULL,
    "belowMinMargin" BOOLEAN NOT NULL DEFAULT false,
    "status" "PriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "appliedSalePrice" INTEGER,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "packagingCost" INTEGER,
    "deliveryCostAssumed" INTEGER,
    "defaultTransportCost" INTEGER,
    "paymentFeePercent" DOUBLE PRECISION,
    "paymentFeeFixed" INTEGER,
    "taxPercent" DOUBLE PRECISION,
    "targetMode" "TargetMode" NOT NULL DEFAULT 'MARGIN_PERCENT',
    "targetValue" DOUBLE PRECISION,
    "minMarginPercent" DOUBLE PRECISION,
    "roundingStep" INTEGER NOT NULL DEFAULT 100000,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'UP',
    "roundingOffset" INTEGER NOT NULL DEFAULT 0,
    "stalePriceDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[2, 4, 5]::INTEGER[],
    "maxEstimatedDays" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierMessage_consultedAt_idx" ON "SupplierMessage"("consultedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_internalSku_key" ON "Product"("internalSku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_nameKey_idx" ON "Product"("nameKey");

-- CreateIndex
CREATE INDEX "Product_supplierId_supplierSku_idx" ON "Product"("supplierId", "supplierSku");

-- CreateIndex
CREATE INDEX "Product_publicationStatus_idx" ON "Product"("publicationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_colorKey_size_key" ON "ProductVariant"("productId", "colorKey", "size");

-- CreateIndex
CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage"("productId", "position");

-- CreateIndex
CREATE INDEX "ProductCostHistory_productId_consultedAt_idx" ON "ProductCostHistory"("productId", "consultedAt");

-- CreateIndex
CREATE INDEX "PriceChangeProposal_status_createdAt_idx" ON "PriceChangeProposal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- AddForeignKey
ALTER TABLE "SupplierMessage" ADD CONSTRAINT "SupplierMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_supplierMessageId_fkey" FOREIGN KEY ("supplierMessageId") REFERENCES "SupplierMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChangeProposal" ADD CONSTRAINT "PriceChangeProposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChangeProposal" ADD CONSTRAINT "PriceChangeProposal_supplierMessageId_fkey" FOREIGN KEY ("supplierMessageId") REFERENCES "SupplierMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
