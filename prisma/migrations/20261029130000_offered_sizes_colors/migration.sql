-- La disponibilidad por talle/color deja de registrarse: el producto guarda lo que
-- ofrece el proveedor y cada par se confirma al momento de la consulta.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "assortmentNote" TEXT,
ADD COLUMN     "colorsOffered" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sizesOffered" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Conservar talles y colores de las variantes activas existentes.
UPDATE "Product" p SET
  "sizesOffered" = COALESCE((
    SELECT array_agg(s ORDER BY s::numeric) FROM (SELECT DISTINCT v."size" AS s FROM "ProductVariant" v WHERE v."productId" = p.id AND v."active") x
  ), ARRAY[]::TEXT[]),
  "colorsOffered" = COALESCE((
    SELECT array_agg(c ORDER BY c) FROM (SELECT DISTINCT v."color" AS c FROM "ProductVariant" v WHERE v."productId" = p.id AND v."active") y
  ), ARRAY[]::TEXT[]);

-- DropForeignKey
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_productId_fkey";

-- DropTable
DROP TABLE "ProductVariant";
