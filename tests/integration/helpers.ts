import { db } from "@/server/db";

export const actor = { email: "test@lobby.test" };

/** Vacía todas las tablas de la base de pruebas. */
export async function resetDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("test")) throw new Error(`Negado: la base ${url} no parece de pruebas`);
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** Configuración de precios de prueba: margen 30 %, mínimo 25 %, comisión 6 %, IIBB 3 %, embalaje $1.000. */
export async function seedPricing(overrides: Record<string, unknown> = {}) {
  await db.pricingSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  await db.pricingSettings.update({
    where: { id: 1 },
    data: {
      configured: true,
      packagingCost: 100_000,
      deliveryCostAssumed: 0,
      defaultTransportCost: 300_000,
      paymentFeePercent: 6,
      paymentFeeFixed: 0,
      taxPercent: 3,
      targetMode: "MARGIN_PERCENT",
      targetValue: 30,
      minMarginPercent: 25,
      roundingStep: 100_000,
      roundingMode: "UP",
      roundingOffset: 0,
      ...overrides,
    },
  });
}

export async function seedSupplier() {
  return db.supplier.create({ data: { name: "[TEST] Proveedor Rosario", city: "Rosario", isTestData: true } });
}

export const baseProduct = {
  brand: "[TEST] Marca",
  model: "Modelo Uno",
  costPrice: 4_500_000,
  isTestData: true,
  variants: [
    { color: "negro", size: "40" },
    { color: "negro", size: "41" },
  ],
};
