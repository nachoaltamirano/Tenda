import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { applyReviewedItem, createSupplierMessage, getMessageForReview } from "@/server/catalog/import";
import { actor, resetDb, seedPricing, seedSupplier } from "./helpers";

let supplierId: string;
let jpg: Buffer;
beforeEach(async () => {
  await resetDb();
  await seedPricing();
  supplierId = (await seedSupplier()).id;
  jpg ??= await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 30, b: 30 } } }).jpeg().toBuffer();
});

const consultedAt = new Date("2026-10-29T10:00:00-03:00");
const text =
  "OFERTAS STOCK\n• Nike Air Force 1 blancas 38 al 40 $62.000 af1.jpg\nAF1-suela.jpg\n• Adidas Campus 00s gris 40 41 $70.000 campus.jpg";

/** Imagen distinta por nombre de archivo (el contenido se usa para detectar repetidas). */
async function imageFor(name: string) {
  const n = [...name.toLowerCase()].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: (n * 13) % 256 } } }).jpeg().toBuffer();
}

async function message(files = ["af1.jpg", "AF1-suela.jpg", "campus.jpg", "extra.jpg"]) {
  return createSupplierMessage(
    { supplierId, source: "WHATSAPP_GROUP", rawText: text, consultedAt, isTestData: true },
    actor,
    await Promise.all(files.map(async (filename) => ({ filename, mimeType: "image/jpeg", data: await imageFor(filename) }))),
  );
}

describe("mensaje con fotos", () => {
  it("guarda las fotos y sugiere cuáles corresponden a cada producto", async () => {
    const m = await message();
    const review = (await getMessageForReview(m.id))!;
    const names = (ids: string[]) => ids.map((id) => review.message.attachments.find((a) => a.id === id)!.filename);
    expect(names(review.items[0].photos.matched.map((x) => x.attachmentId))).toEqual(["af1.jpg", "AF1-suela.jpg"]);
    expect(names(review.items[1].photos.matched.map((x) => x.attachmentId))).toEqual(["campus.jpg"]);
    expect(review.unassigned.map((a) => a.filename)).toEqual(["extra.jpg"]);
    expect(await db.productImage.count()).toBe(0); // nada se vincula sin revisión
  });

  it("al aplicar, vincula las fotos elegidas en orden, con portada y fuente, sin duplicar archivos", async () => {
    const m = await message();
    const review = (await getMessageForReview(m.id))!;
    const ids = review.items[0].photos.matched.map((x) => x.attachmentId);
    const r = await applyReviewedItem(
      { messageId: m.id, itemIndex: 0, action: "create", brand: "[TEST] Nike", model: "Air Force 1", colors: ["blanco"], sizes: ["38", "39", "40"], price: 6_200_000, attachmentIds: ids, authorizePhotos: true },
      actor,
    );
    expect(r.photos).toBe(2);
    const imgs = await db.productImage.findMany({ where: { productId: r.productId }, orderBy: { position: "asc" }, include: { attachment: true } });
    expect(imgs.map((i) => [i.attachment?.filename, i.isCover, i.authorizedForPublication, i.sourceType])).toEqual([
      ["af1.jpg", true, true, "SUPPLIER"],
      ["AF1-suela.jpg", false, true, "SUPPLIER"],
    ]);
    expect(imgs[0].sourceNote).toMatch(/Mensaje del proveedor del 29\/10\/2026 · af1.jpg/);
    expect(imgs[0].optimizedKey).toBe(imgs[0].attachment!.optimizedKey);
  });

  it("sin la declaración de autorización, las fotos quedan sin autorizar", async () => {
    const m = await message();
    const review = (await getMessageForReview(m.id))!;
    const r = await applyReviewedItem(
      { messageId: m.id, itemIndex: 1, action: "create", brand: "[TEST] Adidas", model: "Campus 00s", colors: ["gris"], sizes: ["40"], price: 7_000_000, attachmentIds: review.items[1].photos.matched.map((x) => x.attachmentId) },
      actor,
    );
    expect((await db.productImage.findFirstOrThrow({ where: { productId: r.productId } })).authorizedForPublication).toBe(false);
  });

  it("rechaza fotos de otro mensaje", async () => {
    const m1 = await message();
    const m2 = await message(["otra.jpg"]);
    const foreign = (await db.supplierMessageAttachment.findFirstOrThrow({ where: { messageId: m2.id } })).id;
    await expect(
      applyReviewedItem({ messageId: m1.id, itemIndex: 0, action: "create", brand: "[TEST] A", model: "B", colors: ["negro"], sizes: ["40"], price: null, attachmentIds: [foreign] }, actor),
    ).rejects.toThrow(/no pertenece/);
  });

  it("rechaza nombres repetidos, HEIC y archivos que no son imágenes, sin guardar el mensaje", async () => {
    await expect(message(["a.jpg", "A.JPG"])).rejects.toThrow(/mismo nombre/);
    await expect(
      createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: text, consultedAt }, actor, [{ filename: "x.heic", mimeType: "image/heic", data: jpg }]),
    ).rejects.toThrow(/HEIC/);
    await expect(
      createSupplierMessage({ supplierId, source: "WHATSAPP_GROUP", rawText: text, consultedAt }, actor, [{ filename: "x.jpg", mimeType: "image/jpeg", data: Buffer.from("no") }]),
    ).rejects.toThrow(/no es una imagen válida/);
    expect(await db.supplierMessage.count()).toBe(0);
  });
});

describe("fotos repetidas", () => {
  it("si el proveedor vuelve a publicar la misma foto, no se duplica en el producto", async () => {
    const m1 = await message(["af1.jpg"]);
    const r1 = (await getMessageForReview(m1.id))!;
    const { productId } = await applyReviewedItem(
      { messageId: m1.id, itemIndex: 0, action: "create", brand: "[TEST] Nike", model: "Air Force 1", colors: ["blanco"], sizes: ["38"], price: 6_200_000, attachmentIds: r1.items[0].photos.matched.map((x) => x.attachmentId) },
      actor,
    );
    const m2 = await message(["af1.jpg"]);
    const r2 = (await getMessageForReview(m2.id))!;
    const out = await applyReviewedItem(
      { messageId: m2.id, itemIndex: 0, action: "update", productId, brand: "[TEST] Nike", model: "Air Force 1", colors: ["blanco"], sizes: ["39"], price: 6_200_000, attachmentIds: r2.items[0].photos.matched.map((x) => x.attachmentId) },
      actor,
    );
    expect(out.photos).toBe(0);
    expect(await db.productImage.count({ where: { productId } })).toBe(1);
  });
});
