import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { applyReviewedItem, createSupplierMessage, getMessageForReview } from "@/server/catalog/import";
import { actor, resetDb, seedPricing, seedSupplier } from "./helpers";

let supplierId: string;
beforeEach(async () => {
  await resetDb();
  await seedPricing();
  supplierId = (await seedSupplier()).id;
});

const consultedAt = new Date("2026-10-27T15:00:00-03:00");

describe("importación asistida", () => {
  it("guarda el texto original y propone campos sin tocar el catálogo", async () => {
    const raw = "Modelo: [TEST] Nike Air Max 90. Color: negro. Talles: 39, 40, 41 y 42. Precio: 45000. Despacho: jueves.";
    const m = await createSupplierMessage({ supplierId, source: "WHATSAPP_DIRECT", rawText: raw, consultedAt, isTestData: true }, actor);
    expect(m.rawText).toBe(raw);
    expect(m.status).toBe("PENDING_REVIEW");
    expect(await db.product.count()).toBe(0);
    const review = await getMessageForReview(m.id);
    expect(review!.items[0].item).toMatchObject({ brand: "Nike", colors: ["negro"], price: 4_500_000 });
  });

  it("crea un producto a partir del ítem revisado", async () => {
    const m = await createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: "x $1", consultedAt, isTestData: true }, actor);
    const r = await applyReviewedItem(
      { messageId: m.id, itemIndex: 0, action: "create", brand: "[TEST] Nike", model: "Air Max 90", colors: ["negro"], sizes: ["40", "41"], price: 4_500_000, nextDispatchWeekday: 4 },
      actor,
    );
    const p = await db.product.findUniqueOrThrow({ where: { id: r.productId }, include: { variants: true, costHistory: true } });
    expect(p).toMatchObject({ costPrice: 4_500_000, dataSource: "WHATSAPP_GROUP", lastConsultedAt: consultedAt, nextDispatchWeekday: 4, nextDispatchConfirmed: false, isTestData: true });
    expect(p.variants.map((v) => v.availabilityStatus)).toEqual(["AVAILABLE_LAST_CHECK", "AVAILABLE_LAST_CHECK"]);
    expect(p.costHistory[0].supplierMessageId).toBe(m.id);
    expect((await db.supplierMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("APPLIED");
    // No se puede aplicar dos veces el mismo ítem.
    await expect(
      applyReviewedItem({ messageId: m.id, itemIndex: 0, action: "create", brand: "[TEST] Nike", model: "Air Max 90", colors: ["negro"], sizes: ["40"], price: null }, actor),
    ).rejects.toMatchObject({ code: "already_applied" });
  });

  it("actualizar un producto existente con otro precio genera propuesta pendiente", async () => {
    const m1 = await createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: "a $1\nb $2", consultedAt: new Date("2026-10-20"), isTestData: true }, actor);
    const { productId } = await applyReviewedItem(
      { messageId: m1.id, itemIndex: 0, action: "create", brand: "[TEST] Vans", model: "Old Skool", colors: ["negro"], sizes: ["40", "41"], price: 5_500_000 },
      actor,
    );
    const m2 = await createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: "c $3", consultedAt, isTestData: true }, actor);
    const r = await applyReviewedItem(
      { messageId: m2.id, itemIndex: 0, action: "update", productId, brand: "[TEST] Vans", model: "Old Skool", colors: ["negro"], sizes: ["42"], price: 6_000_000 },
      actor,
    );
    expect(r.priceOutcome).toBe("proposal");
    const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: { orderBy: { size: "asc" } } } });
    expect(p.costPrice).toBe(5_500_000);
    expect(p.lastConsultedAt).toEqual(consultedAt);
    // El talle nuevo se agrega y los anteriores siguen activos (no se asumen agotados).
    expect(p.variants.map((v) => [v.size, v.active])).toEqual([["40", true], ["41", true], ["42", true]]);
    expect((await db.supplierMessage.findUniqueOrThrow({ where: { id: m1.id } })).status).toBe("PARTIALLY_APPLIED");
  });

  it("exige confirmar combinaciones cuando hay varios colores", async () => {
    const m = await createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: "x $1", consultedAt, isTestData: true }, actor);
    const item = { messageId: m.id, itemIndex: 0, action: "create" as const, brand: "[TEST] A", model: "B", colors: ["negro", "blanco"], sizes: ["40"], price: 100_000_00 };
    await expect(applyReviewedItem(item, actor)).rejects.toMatchObject({ code: "combinations" });
    await applyReviewedItem({ ...item, confirmAllCombinations: true }, actor);
    expect(await db.productVariant.count()).toBe(2);
  });
});
