import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ImageSourceType } from "@prisma/client";
import { audit } from "../audit";
import { db } from "../db";
import { BusinessError } from "../errors";
import { getStorage } from "../storage";
import type { Actor } from "./products";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"]);
const MAX_BYTES = 12 * 1024 * 1024;

export type ImageUpload = {
  data: Buffer;
  mimeType: string;
  sourceType: ImageSourceType;
  sourceNote: string | null;
  authorizedForPublication: boolean;
};

export async function addProductImage(productId: string, upload: ImageUpload, actor: Actor) {
  if (!ALLOWED.has(upload.mimeType)) throw new BusinessError("Formato de imagen no admitido (usar JPG, PNG, WEBP o HEIC).");
  if (upload.data.length > MAX_BYTES) throw new BusinessError("La imagen supera los 12 MB.");
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new BusinessError("El producto no existe.", "not_found");

  let meta: sharp.Metadata;
  try {
    meta = await sharp(upload.data).metadata();
  } catch {
    throw new BusinessError("El archivo no es una imagen válida.");
  }
  const id = randomUUID();
  const ext = upload.mimeType.split("/")[1].replace("jpeg", "jpg");
  const base = `products/${productId}/${id}`;
  const storage = getStorage();
  // Original intacto (privado) + versiones optimizadas para la tienda.
  await storage.put(`${base}/original.${ext}`, upload.data);
  const optimized = await sharp(upload.data).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const thumb = await sharp(upload.data).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  await storage.put(`${base}/optimized.webp`, optimized);
  await storage.put(`${base}/thumb.webp`, thumb);

  return db.$transaction(async (tx) => {
    const count = await tx.productImage.count({ where: { productId, deletedAt: null } });
    const img = await tx.productImage.create({
      data: {
        productId,
        originalKey: `${base}/original.${ext}`,
        optimizedKey: `${base}/optimized.webp`,
        thumbKey: `${base}/thumb.webp`,
        mimeType: upload.mimeType,
        width: meta.width ?? null,
        height: meta.height ?? null,
        sourceType: upload.sourceType,
        sourceNote: upload.sourceNote,
        authorizedForPublication: upload.authorizedForPublication,
        position: count,
        isCover: count === 0,
      },
    });
    await audit(tx, { entityType: "Product", entityId: productId, action: "image_added", changes: { imageId: img.id, source: upload.sourceType }, userEmail: actor.email });
    return img;
  });
}

export async function setCoverImage(productId: string, imageId: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    const img = await tx.productImage.findFirst({ where: { id: imageId, productId, deletedAt: null } });
    if (!img) throw new BusinessError("La imagen no existe.");
    await tx.productImage.updateMany({ where: { productId }, data: { isCover: false } });
    await tx.productImage.update({ where: { id: imageId }, data: { isCover: true } });
    await audit(tx, { entityType: "Product", entityId: productId, action: "image_cover", changes: { imageId }, userEmail: actor.email });
  });
}

export async function moveImage(productId: string, imageId: string, direction: -1 | 1, actor: Actor) {
  await db.$transaction(async (tx) => {
    const imgs = await tx.productImage.findMany({ where: { productId, deletedAt: null }, orderBy: { position: "asc" } });
    const i = imgs.findIndex((x) => x.id === imageId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= imgs.length) return;
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
    for (const [pos, img] of imgs.entries()) await tx.productImage.update({ where: { id: img.id }, data: { position: pos } });
    await audit(tx, { entityType: "Product", entityId: productId, action: "image_reorder", userEmail: actor.email });
  });
}

export async function setImageAuthorization(productId: string, imageId: string, authorized: boolean, actor: Actor) {
  await db.productImage.updateMany({ where: { id: imageId, productId }, data: { authorizedForPublication: authorized } });
  await audit(db, { entityType: "Product", entityId: productId, action: "image_authorization", changes: { imageId, authorized }, userEmail: actor.email });
}

/** Baja lógica: los archivos se conservan para pedidos y publicaciones históricas. */
export async function removeImage(productId: string, imageId: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    const img = await tx.productImage.findFirst({ where: { id: imageId, productId, deletedAt: null } });
    if (!img) throw new BusinessError("La imagen no existe.");
    await tx.productImage.update({ where: { id: imageId }, data: { deletedAt: new Date(), isCover: false } });
    if (img.isCover) {
      const next = await tx.productImage.findFirst({ where: { productId, deletedAt: null }, orderBy: { position: "asc" } });
      if (next) await tx.productImage.update({ where: { id: next.id }, data: { isCover: true } });
    }
    await audit(tx, { entityType: "Product", entityId: productId, action: "image_removed", changes: { imageId }, userEmail: actor.email });
  });
}
