/*
  Warnings:

  - Added the required column `contentHash` to the `SupplierMessageAttachment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "contentHash" TEXT;

-- AlterTable
ALTER TABLE "SupplierMessageAttachment" ADD COLUMN     "contentHash" TEXT NOT NULL;
