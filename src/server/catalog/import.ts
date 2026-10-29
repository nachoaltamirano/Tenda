// Importación manual asistida de mensajes del proveedor.
// 1) Se guarda el texto original con fecha y fuente.
// 2) El intérprete propone campos (no se guarda nada en el catálogo).
// 3) El administrador revisa/corrige cada ítem y elige crear o actualizar.
// 4) Recién entonces se aplican los cambios; los cambios de costo generan una
//    propuesta que también requiere aprobación.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { filenameKey, matchPhotos } from "@/lib/catalog/photo-matching";
import { formatDate } from "@/lib/format";
import { parseSupplierMessage, type ParseResult } from "@/lib/parser/supplier-message";
import {
  reviewedItemInput,
  supplierMessageInput,
  type ReviewedItemInput,
  type SupplierMessageInput,
} from "@/lib/validation/catalog";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { BusinessError } from "../errors";
import { storeImage } from "./images";
import { requestPriceUpdate, type PriceUpdateOutcome } from "./prices";
import { createProduct, findDuplicateCandidates, type Actor } from "./products";

type StoredParse = ParseResult & {
  applied: Record<
    string,
    { action: "create" | "update"; productId: string; at: string; price?: PriceUpdateOutcome["kind"] | "initial"; photos?: number }
  >;
};

export type MessageFile = { filename: string; mimeType: string; data: Buffer };

const MAX_FILES = 40;

export async function createSupplierMessage(rawInput: SupplierMessageInput, actor: Actor, files: MessageFile[] = []) {
  const input = supplierMessageInput.parse(rawInput);
  const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new BusinessError("El proveedor no existe.");
  if (files.length > MAX_FILES) throw new BusinessError(`Se pueden subir hasta ${MAX_FILES} fotos por mensaje.`);
  const seen = new Set<string>();
  for (const f of files) {
    const key = filenameKey(f.filename);
    if (seen.has(key)) throw new BusinessError(`Hay dos fotos con el mismo nombre: ${f.filename}. Renombrá una antes de subirlas.`);
    seen.add(key);
  }
  // Las imágenes se validan y procesan antes de guardar el mensaje: si alguna falla, no se guarda nada.
  const folder = `supplier-messages/${randomUUID()}`;
  const stored = [];
  for (const f of files) stored.push({ file: f, image: await storeImage(f.data, f.mimeType, folder, `La foto ${f.filename}`) });

  const parsed = parseSupplierMessage(input.rawText, input.receivedAt ?? input.consultedAt);
  const parseData: StoredParse = { ...parsed, applied: {} };
  return db.supplierMessage.create({
    data: {
      attachments: {
        create: stored.map(({ file, image }) => ({
          filename: file.filename,
          filenameKey: filenameKey(file.filename),
          originalKey: image.originalKey,
          optimizedKey: image.optimizedKey,
          thumbKey: image.thumbKey,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          sizeBytes: file.data.length,
          contentHash: image.contentHash,
        })),
      },
      supplierId: input.supplierId,
      source: input.source,
      rawText: input.rawText,
      consultedAt: input.consultedAt,
      receivedAt: input.receivedAt,
      parsedResult: parseData as unknown as Prisma.InputJsonValue,
      createdBy: actor.email,
      isTestData: input.isTestData,
    },
  });
}

export async function getMessageForReview(id: string) {
  const message = await db.supplierMessage.findUnique({
    where: { id },
    include: { supplier: true, attachments: { orderBy: { filename: "asc" }, include: { images: { select: { productId: true } } } } },
  });
  if (!message) return null;
  const parsed = message.parsedResult as unknown as StoredParse;
  const items = await Promise.all(
    parsed.items.map(async (item, index) => ({
      index,
      item,
      applied: parsed.applied[String(index)] ?? null,
      matches: await findDuplicateCandidates(db, { brand: item.brand, model: item.model, supplierSku: item.supplierSku }),
      photos: matchPhotos(item.photos ?? [], message.attachments),
    })),
  );
  // Fotos subidas que ningún producto menciona: se pueden asignar a mano al revisar.
  const mentioned = new Set(items.flatMap((i) => i.photos.matched.map((m) => m.attachmentId)));
  const unassigned = message.attachments.filter((a) => !mentioned.has(a.id));
  return { message, parsed, items, unassigned };
}

export async function applyReviewedItem(rawInput: ReviewedItemInput, actor: Actor) {
  const input = reviewedItemInput.parse(rawInput);
  if (input.sizes.length === 0) throw new BusinessError("Indicá los talles que ofrece el proveedor o dejá el ítem sin aplicar hasta confirmarlo.");

  return db.$transaction(async (tx) => {
    const message = await tx.supplierMessage.findUnique({ where: { id: input.messageId } });
    if (!message) throw new BusinessError("El mensaje no existe.", "not_found");
    if (message.status === "DISCARDED") throw new BusinessError("El mensaje fue descartado.");
    const parsed = message.parsedResult as unknown as StoredParse;
    if (!parsed.items[input.itemIndex]) throw new BusinessError("Ítem inexistente.");
    if (parsed.applied[String(input.itemIndex)]) throw new BusinessError("Este ítem ya fue aplicado.", "already_applied");

    const dataDate = message.receivedAt ?? message.consultedAt;
    let productId: string;
    let priceOutcome: PriceUpdateOutcome["kind"] | "initial" | undefined;

    if (input.action === "create") {
      const product = await createProduct(
        {
          supplierId: message.supplierId,
          supplierSku: input.supplierSku,
          brand: input.brand,
          model: input.model,
          currency: input.currency,
          costPrice: input.price,
          availabilityStatus: input.availabilityStatus,
          sizesOffered: input.sizes,
          colorsOffered: input.colors,
          assortmentNote: input.assortmentNote,
          dataSource: message.source,
          dataDate,
          lastConsultedAt: message.consultedAt,
          nextDispatchWeekday: input.nextDispatchWeekday,
          nextDispatchDate: input.nextDispatchDate,
          notes: input.notes,
          confirmDuplicate: input.confirmDuplicate,
          isTestData: message.isTestData,
        },
        actor,
        tx,
      );
      productId = product.id;
      if (input.price !== null) {
        // createProduct registra el costo inicial; se vincula al mensaje de origen.
        await tx.productCostHistory.updateMany({ where: { productId }, data: { supplierMessageId: message.id, consultedAt: message.consultedAt } });
        priceOutcome = "initial";
      }
    } else {
      if (!input.productId) throw new BusinessError("Elegí el producto a actualizar.");
      const p = await tx.product.findUnique({ where: { id: input.productId } });
      if (!p) throw new BusinessError("El producto no existe.", "not_found");
      if (input.price !== null && input.currency !== p.currency) {
        throw new BusinessError(`El precio está en ${input.currency} y el producto en ${p.currency}. Revisar antes de aplicar.`);
      }
      productId = p.id;
      const newer = !p.lastConsultedAt || message.consultedAt > p.lastConsultedAt;
      const productData: Prisma.ProductUpdateInput = {};
      if (newer) {
        productData.lastConsultedAt = message.consultedAt;
        productData.dataSource = message.source;
        productData.dataDate = dataDate;
        if (p.availabilityStatus !== "DISCONTINUED") productData.availabilityStatus = input.availabilityStatus;
        // La oferta más reciente reemplaza a la anterior. Sin colores informados se conservan los cargados.
        productData.sizesOffered = input.sizes;
        if (input.colors.length) productData.colorsOffered = input.colors;
        if (input.assortmentNote) productData.assortmentNote = input.assortmentNote;
        if (input.nextDispatchWeekday !== null || input.nextDispatchDate !== null) {
          productData.nextDispatchWeekday = input.nextDispatchWeekday;
          productData.nextDispatchDate = input.nextDispatchDate;
          productData.nextDispatchConfirmed = false;
        }
      }
      if (input.supplierSku && !p.supplierSku) productData.supplierSku = input.supplierSku;
      if (input.notes) productData.notes = p.notes ? `${p.notes}\n${input.notes}` : input.notes;
      if (Object.keys(productData).length) await tx.product.update({ where: { id: p.id }, data: productData });
      await audit(tx, {
        entityType: "Product",
        entityId: p.id,
        action: "import_update",
        changes: {
          sizesOffered: { from: p.sizesOffered, to: newer ? input.sizes : p.sizesOffered },
          colorsOffered: { from: p.colorsOffered, to: newer && input.colors.length ? input.colors : p.colorsOffered },
          status: input.availabilityStatus,
          consultedAt: message.consultedAt.toISOString(),
          olderThanCurrent: !newer,
        },
        reason: `Mensaje del proveedor ${message.id}`,
        userEmail: actor.email,
      });
      if (input.price !== null) {
        const r = await requestPriceUpdate(
          { productId: p.id, newCostPrice: input.price, consultedAt: message.consultedAt, source: message.source, supplierMessageId: message.id },
          actor,
          tx,
        );
        priceOutcome = r.kind;
      }
    }

    const photos = await linkAttachments(tx, message, productId, input.attachmentIds, input.authorizePhotos, actor);

    parsed.applied[String(input.itemIndex)] = { action: input.action, productId, at: new Date().toISOString(), price: priceOutcome, photos };
    const allApplied = parsed.items.every((_, i) => parsed.applied[String(i)]);
    await tx.supplierMessage.update({
      where: { id: message.id },
      data: { parsedResult: parsed as unknown as Prisma.InputJsonValue, status: allApplied ? "APPLIED" : "PARTIALLY_APPLIED" },
    });
    return { productId, priceOutcome, photos };
  });
}

/** Vincula fotos del mensaje al producto sin duplicar archivos. Devuelve cuántas se agregaron. */
async function linkAttachments(
  tx: Tx,
  message: { id: string; consultedAt: Date },
  productId: string,
  attachmentIds: string[],
  authorized: boolean,
  actor: Actor,
): Promise<number> {
  if (!attachmentIds.length) return 0;
  const attachments = await tx.supplierMessageAttachment.findMany({ where: { id: { in: attachmentIds }, messageId: message.id } });
  if (attachments.length !== new Set(attachmentIds).size) throw new BusinessError("Alguna de las fotos elegidas no pertenece a este mensaje.");
  const existing = await tx.productImage.findMany({ where: { productId, deletedAt: null } });
  let position = existing.length;
  let hasCover = existing.some((i) => i.isCover);
  let added = 0;
  for (const id of [...new Set(attachmentIds)]) {
    const a = attachments.find((x) => x.id === id)!;
    // Ya vinculada, o la misma foto llegó en otro mensaje (el proveedor repite ofertas).
    if (existing.some((i) => i.attachmentId === a.id || i.contentHash === a.contentHash)) continue;
    const img = await tx.productImage.create({
      data: {
        productId,
        attachmentId: a.id,
        originalKey: a.originalKey,
        optimizedKey: a.optimizedKey,
        thumbKey: a.thumbKey,
        mimeType: a.mimeType,
        contentHash: a.contentHash,
        width: a.width,
        height: a.height,
        sourceType: "SUPPLIER",
        sourceNote: `Mensaje del proveedor del ${formatDate(message.consultedAt)} · ${a.filename}`,
        authorizedForPublication: authorized,
        position: position++,
        isCover: !hasCover,
      },
    });
    hasCover = true;
    added++;
    existing.push(img);
    await audit(tx, {
      entityType: "Product",
      entityId: productId,
      action: "image_added",
      changes: { imageId: img.id, source: "SUPPLIER", filename: a.filename, authorized },
      userEmail: actor.email,
    });
  }
  return added;
}

export async function discardMessage(id: string, actor: Actor) {
  const m = await db.supplierMessage.update({ where: { id }, data: { status: "DISCARDED" } });
  await audit(db, { entityType: "SupplierMessage", entityId: id, action: "discard", userEmail: actor.email });
  return m;
}

export async function listMessages(status?: string) {
  return db.supplierMessage.findMany({
    where: status ? { status: status as Prisma.EnumSupplierMessageStatusFilter["equals"] } : undefined,
    orderBy: { createdAt: "desc" },
    include: { supplier: { select: { name: true } } },
    take: 100,
  });
}
