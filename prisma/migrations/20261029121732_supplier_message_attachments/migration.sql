-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "attachmentId" TEXT;

-- CreateTable
CREATE TABLE "SupplierMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filenameKey" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "optimizedKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierMessageAttachment_messageId_filenameKey_key" ON "SupplierMessageAttachment"("messageId", "filenameKey");

-- AddForeignKey
ALTER TABLE "SupplierMessageAttachment" ADD CONSTRAINT "SupplierMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupplierMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "SupplierMessageAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
