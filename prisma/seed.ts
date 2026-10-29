// Semilla mínima: filas de configuración y proveedor principal. No crea productos.
// Con --demo agrega productos de demostración marcados como datos de prueba.
import { PrismaClient } from "@prisma/client";
import { productNameKey } from "../src/lib/text";

const db = new PrismaClient();

async function main() {
  await db.pricingSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await db.dispatchSettings.upsert({ where: { id: 1 }, create: { id: 1, weekdays: [2, 4, 5], maxEstimatedDays: 5 }, update: {} });
  if ((await db.supplier.count({ where: { isTestData: false } })) === 0) {
    await db.supplier.create({ data: { name: "Proveedor principal (nombre pendiente)", city: "Rosario", notes: "Ofertas de stock en depósito de Argentina publicadas en grupo de WhatsApp." } });
  }
  console.log("Configuración inicial lista.");

  if (process.argv.includes("--demo")) {
    const supplier = await db.supplier.upsert({
      where: { id: "demo-supplier" },
      create: { id: "demo-supplier", name: "[DEMO] Proveedor de prueba", isTestData: true },
      update: {},
    });
    const demos = [
      { brand: "[DEMO] Marca", model: "Modelo A", cost: 4_500_000, sizes: ["39", "40", "41", "42"], color: "negro" },
      { brand: "[DEMO] Marca", model: "Modelo B", cost: 6_200_000, sizes: ["38", "39", "40"], color: "blanco" },
    ];
    for (const [i, d] of demos.entries()) {
      const slug = `demo-${i + 1}`;
      if (await db.product.findUnique({ where: { slug } })) continue;
      await db.product.create({
        data: {
          internalSku: `LB-DEMO-${i + 1}`,
          slug,
          brand: d.brand,
          model: d.model,
          nameKey: productNameKey(d.brand, d.model),
          supplierId: supplier.id,
          costPrice: d.cost,
          costUpdatedAt: new Date(),
          lastConsultedAt: new Date(),
          isTestData: true,
          notes: "Producto de demostración. No es un producto real.",
          sizesOffered: d.sizes,
          colorsOffered: [d.color],
          costHistory: { create: { currency: "ARS", costPrice: d.cost, consultedAt: new Date(), source: "MANUAL", note: "Demo" } },
        },
      });
    }
    console.log("Datos de demostración creados (marcados como prueba).");
  }
}

main().finally(() => db.$disconnect());
