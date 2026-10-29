-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WEBSITE', 'INSTAGRAM', 'FACEBOOK_MARKETPLACE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('INQUIRY', 'VERIFYING_PRODUCT', 'AWAITING_SUPPLIER', 'QUOTE_SENT', 'AWAITING_CUSTOMER', 'CONFIRMED', 'PURCHASE_PENDING', 'PURCHASED', 'IN_TRANSIT', 'RECEIVED_PENDING_INSPECTION', 'INSPECTED_APPROVED', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'READY_FOR_DELIVERY', 'DELIVERED', 'CLOSED', 'CANCELLED', 'RETURNED', 'INCIDENT');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP', 'OWN_DELIVERY', 'CARRIER');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'MERCADO_PAGO', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('DELAY', 'MISSING', 'WRONG_ITEM', 'DAMAGED', 'CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CUSTOMER_PAYMENT', 'OTHER_INCOME', 'SUPPLIER_PAYMENT', 'REFUND', 'ORDER_EXPENSE', 'OPERATING_EXPENSE');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneKey" TEXT,
    "channel" "SalesChannel" NOT NULL DEFAULT 'WHATSAPP',
    "notes" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'INQUIRY',
    "statusBeforeIncident" "OrderStatus",
    "supplierQueriedAt" TIMESTAMP(3),
    "supplierConfirmedAt" TIMESTAMP(3),
    "supplierConfirmNote" TEXT,
    "estimatedDispatchDate" DATE,
    "confirmedDispatchDate" DATE,
    "actualDispatchDate" DATE,
    "estimatedArrivalDate" DATE,
    "actualArrivalDate" DATE,
    "carrier" TEXT,
    "trackingCode" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "deliveryMethod" "DeliveryMethod",
    "deliveryAddress" TEXT,
    "deliveryScheduledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closeExceptionReason" TEXT,
    "closeExceptionBy" TEXT,
    "cancelReason" TEXT,
    "internalNotes" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "internalSku" TEXT,
    "size" TEXT,
    "color" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "agreedPrice" INTEGER NOT NULL,
    "costSnapshot" INTEGER,
    "costHistoryId" TEXT,
    "costConsultedAt" TIMESTAMP(3),
    "actualCost" INTEGER,
    "inspection" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "inspectionNotes" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "inspectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierMessageId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusChange" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" "OrderStatus",
    "to" "OrderStatus" NOT NULL,
    "note" TEXT,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderIncident" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "method" "PaymentMethod",
    "createdBy" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_phoneKey_idx" ON "Customer"("phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "OrderStatusChange_orderId_createdAt_idx" ON "OrderStatusChange"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_method_reference_key" ON "Payment"("method", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_key" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE INDEX "CashMovement_occurredAt_idx" ON "CashMovement"("occurredAt");

-- CreateIndex
CREATE INDEX "CashMovement_orderId_idx" ON "CashMovement"("orderId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_supplierMessageId_fkey" FOREIGN KEY ("supplierMessageId") REFERENCES "SupplierMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIncident" ADD CONSTRAINT "OrderIncident_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
