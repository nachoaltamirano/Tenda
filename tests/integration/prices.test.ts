import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createProduct } from "@/server/catalog/products";
import { approveProposal, rejectProposal, requestPriceUpdate } from "@/server/catalog/prices";
import { actor, baseProduct, resetDb, seedPricing } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedPricing();
});

const day1 = new Date("2026-10-20T12:00:00-03:00");
const day2 = new Date("2026-10-27T12:00:00-03:00");

async function product() {
  return createProduct({ ...baseProduct, salePrice: 8_100_000, lastConsultedAt: day1 }, actor);
}

describe("actualización de precios", () => {
  it("propone el cambio sin aplicarlo y muestra valores y fechas anteriores y nuevos", async () => {
    const p = await product();
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 5_000_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    expect(r.kind).toBe("proposal");
    const after = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.costPrice).toBe(4_500_000); // sin cambios hasta aprobar
    expect(after.salePrice).toBe(8_100_000);
    expect(after.lastConsultedAt).toEqual(day2); // la consulta sí se registra
    const prop = await db.priceChangeProposal.findFirstOrThrow({ where: { productId: p.id } });
    expect(prop).toMatchObject({ oldCostPrice: 4_500_000, newCostPrice: 5_000_000, oldConsultedAt: day1, newConsultedAt: day2, oldSalePrice: 8_100_000 });
    // costo fijo nuevo 54.000 / (1 − 0,09 − 0,30) = 88.524,6 → 89.000
    expect(prop.proposedSalePrice).toBe(8_900_000);
    const impact = prop.impact as { before: { marginPercent: number }; afterKeepingPrice: { marginPercent: number } };
    expect(impact.afterKeepingPrice.marginPercent).toBeLessThan(impact.before.marginPercent);
    expect(prop.belowMinMargin).toBe(true);
  });

  it("aprobar aplica el costo, guarda el historial y no altera registros anteriores", async () => {
    const p = await product();
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 5_000_000, consultedAt: day2, source: "WHATSAPP_DIRECT" }, actor);
    if (r.kind !== "proposal") throw new Error();
    const firstHistory = await db.productCostHistory.findFirstOrThrow({ where: { productId: p.id } });
    await approveProposal({ proposalId: r.proposalId, salePriceChoice: "suggested" }, actor);
    const after = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ costPrice: 5_000_000, salePrice: 8_900_000, costUpdatedAt: day2 });
    const hist = await db.productCostHistory.findMany({ where: { productId: p.id }, orderBy: { consultedAt: "asc" } });
    expect(hist.map((h) => h.costPrice)).toEqual([4_500_000, 5_000_000]);
    expect(hist[0]).toEqual(firstHistory); // el registro histórico queda intacto
    expect((await db.priceChangeProposal.findUniqueOrThrow({ where: { id: r.proposalId } })).status).toBe("APPROVED");
  });

  it("no aprueba sin confirmación si el margen queda bajo el mínimo", async () => {
    const p = await product();
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 5_000_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    if (r.kind !== "proposal") throw new Error();
    await expect(approveProposal({ proposalId: r.proposalId, salePriceChoice: "keep" }, actor)).rejects.toMatchObject({ code: "low_margin" });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).costPrice).toBe(4_500_000);
    await approveProposal({ proposalId: r.proposalId, salePriceChoice: "keep", acceptLowMargin: true }, actor);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).salePrice).toBe(8_100_000);
  });

  it("no permite resolver dos veces la misma propuesta", async () => {
    const p = await product();
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 4_000_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    if (r.kind !== "proposal") throw new Error();
    await approveProposal({ proposalId: r.proposalId, salePriceChoice: "keep" }, actor);
    await expect(approveProposal({ proposalId: r.proposalId, salePriceChoice: "keep" }, actor)).rejects.toMatchObject({ code: "already_decided" });
    await expect(rejectProposal(r.proposalId, null, actor)).rejects.toMatchObject({ code: "already_decided" });
  });

  it("una propuesta nueva reemplaza a la pendiente", async () => {
    const p = await product();
    await requestPriceUpdate({ productId: p.id, newCostPrice: 4_800_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    await requestPriceUpdate({ productId: p.id, newCostPrice: 4_900_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    const props = await db.priceChangeProposal.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
    expect(props.map((x) => x.status)).toEqual(["SUPERSEDED", "PENDING"]);
  });

  it("el mismo costo solo renueva la fecha de consulta", async () => {
    const p = await product();
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 4_500_000, consultedAt: day2, source: "WHATSAPP_GROUP" }, actor);
    expect(r.kind).toBe("confirmed");
    const after = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.costUpdatedAt).toEqual(day2);
    expect(await db.priceChangeProposal.count()).toBe(0);
    expect(await db.productCostHistory.count({ where: { productId: p.id } })).toBe(2);
  });

  it("exige confirmación para aplicar un dato más antiguo que el vigente", async () => {
    const p = await createProduct({ ...baseProduct, lastConsultedAt: day2 }, actor);
    const r = await requestPriceUpdate({ productId: p.id, newCostPrice: 4_000_000, consultedAt: day1, source: "WHATSAPP_GROUP" }, actor);
    if (r.kind !== "proposal") throw new Error();
    await expect(approveProposal({ proposalId: r.proposalId, salePriceChoice: "keep" }, actor)).rejects.toMatchObject({ code: "older_data" });
  });
});
