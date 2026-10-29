import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  createProduct,
  getPublicationIssues,
  setPublicationStatus,
  updateProduct,
  updateVariants,
} from "@/server/catalog/products";
import { actor, baseProduct, resetDb, seedPricing } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedPricing();
});

describe("alta de productos", () => {
  it("crea producto, variantes, costo inicial e historial", async () => {
    const p = await createProduct({ ...baseProduct, lastConsultedAt: new Date("2026-10-27") }, actor);
    expect(p.internalSku).toMatch(/^LB-TES-[A-Z0-9]{4}$/);
    expect(p.slug).toBe("test-marca-modelo-uno");
    expect(p.availabilityStatus).toBe("PENDING_VERIFICATION");
    expect(p.publicationStatus).toBe("DRAFT");
    expect(await db.productVariant.count({ where: { productId: p.id } })).toBe(2);
    const hist = await db.productCostHistory.findMany({ where: { productId: p.id } });
    expect(hist).toHaveLength(1);
    expect(hist[0].costPrice).toBe(4_500_000);
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "create" } })).toBe(1);
  });

  it("detecta duplicados y exige confirmación", async () => {
    await createProduct(baseProduct, actor);
    await expect(createProduct({ ...baseProduct, model: "modelo  UNO" }, actor)).rejects.toMatchObject({ code: "duplicate" });
    const second = await createProduct({ ...baseProduct, confirmDuplicate: true }, actor);
    expect(second.slug).not.toBe("test-marca-modelo-uno"); // URL única
  });

  it("detecta duplicados por SKU del proveedor", async () => {
    await createProduct({ ...baseProduct, supplierSku: "ABC-1" }, actor);
    await expect(createProduct({ ...baseProduct, model: "Otro", supplierSku: "abc-1" }, actor)).rejects.toMatchObject({ code: "duplicate" });
  });

  it("rechaza datos inválidos en el servidor", async () => {
    await expect(createProduct({ ...baseProduct, brand: "  " }, actor)).rejects.toThrow();
    await expect(createProduct({ ...baseProduct, variants: [{ color: "negro", size: "XL" }] }, actor)).rejects.toThrow();
    await expect(createProduct({ ...baseProduct, costPrice: -5 }, actor)).rejects.toThrow();
  });

  it("exige confirmación para un precio de venta bajo el margen mínimo", async () => {
    await expect(createProduct({ ...baseProduct, salePrice: 6_000_000 }, actor)).rejects.toMatchObject({ code: "low_margin" });
    const p = await createProduct({ ...baseProduct, salePrice: 6_000_000, acceptLowMargin: true }, actor);
    expect(p.salePrice).toBe(6_000_000);
  });
});

describe("edición de productos", () => {
  it("registra los cambios en el historial y no permite cambiar el costo directamente", async () => {
    const p = await createProduct(baseProduct, actor);
    const u = await updateProduct(
      p.id,
      // @ts-expect-error costPrice no forma parte de la edición: se ignora
      { ...baseProduct, costPrice: 1, description: "Descripción nueva", reason: "corrección" },
      actor,
    );
    expect(u.costPrice).toBe(4_500_000);
    expect(u.description).toBe("Descripción nueva");
    const log = await db.auditLog.findFirst({ where: { entityId: p.id, action: "update" } });
    expect(log?.changes).toMatchObject({ description: { from: null, to: "Descripción nueva" } });
    expect(log?.reason).toBe("corrección");
  });

  it("no marca agotadas las variantes que dejan de figurar", async () => {
    const p = await createProduct(baseProduct, actor);
    await updateVariants(p.id, [{ color: "negro", size: "40", availabilityStatus: "AVAILABLE_LAST_CHECK" }], actor, new Date());
    const vs = await db.productVariant.findMany({ where: { productId: p.id }, orderBy: { size: "asc" } });
    expect(vs.map((v) => [v.size, v.active, v.availabilityStatus])).toEqual([
      ["40", true, "AVAILABLE_LAST_CHECK"],
      ["41", false, "PENDING_VERIFICATION"],
    ]);
  });
});

describe("publicación", () => {
  it("bloquea publicar con datos incompletos", async () => {
    const p = await createProduct({ ...baseProduct, costPrice: null }, actor);
    const issues = await getPublicationIssues(p.id);
    expect(issues).toEqual(expect.arrayContaining(["Falta el costo del proveedor.", "Falta el precio de venta.", "No tiene fotos autorizadas para publicar."]));
    await expect(setPublicationStatus(p.id, "PUBLISHED", actor)).rejects.toMatchObject({ code: "publication_blocked" });
  });

  it("publica cuando está completo y pausa si se confirma agotado", async () => {
    const p = await createProduct({ ...baseProduct, salePrice: 8_100_000 }, actor);
    await db.productImage.create({
      data: { productId: p.id, originalKey: "x", mimeType: "image/jpeg", sourceType: "SUPPLIER", authorizedForPublication: true, isCover: true },
    });
    await setPublicationStatus(p.id, "PUBLISHED", actor);
    const u = await updateProduct(p.id, { ...baseProduct, salePrice: 8_100_000, availabilityStatus: "SOLD_OUT_CONFIRMED" }, actor);
    expect(u.publicationStatus).toBe("PAUSED");
  });
});
