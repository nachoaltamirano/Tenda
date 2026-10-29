// Importación manual asistida de mensajes del proveedor.
// 1) Se guarda el texto original con fecha y fuente.
// 2) El intérprete propone campos (no se guarda nada en el catálogo).
// 3) El administrador revisa/corrige cada ítem y elige crear o actualizar.
// 4) Recién entonces se aplican los cambios; los cambios de costo generan una
//    propuesta que también requiere aprobación.

import type { Prisma } from "@prisma/client";
import { parseSupplierMessage, type ParseResult } from "@/lib/parser/supplier-message";
import {
  reviewedItemInput,
  supplierMessageInput,
  type ReviewedItemInput,
  type SupplierMessageInput,
} from "@/lib/validation/catalog";
import { audit } from "../audit";
import { db } from "../db";
import { BusinessError } from "../errors";
import { requestPriceUpdate, type PriceUpdateOutcome } from "./prices";
import { createProduct, findDuplicateCandidates, syncVariants, type Actor } from "./products";

type StoredParse = ParseResult & {
  applied: Record<string, { action: "create" | "update"; productId: string; at: string; price?: PriceUpdateOutcome["kind"] | "initial" }>;
};

export async function createSupplierMessage(rawInput: SupplierMessageInput, actor: Actor) {
  const input = supplierMessageInput.parse(rawInput);
  const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new BusinessError("El proveedor no existe.");
  const parsed = parseSupplierMessage(input.rawText, input.receivedAt ?? input.consultedAt);
  const stored: StoredParse = { ...parsed, applied: {} };
  return db.supplierMessage.create({
    data: {
      supplierId: input.supplierId,
      source: input.source,
      rawText: input.rawText,
      consultedAt: input.consultedAt,
      receivedAt: input.receivedAt,
      parsedResult: stored as unknown as Prisma.InputJsonValue,
      createdBy: actor.email,
      isTestData: input.isTestData,
    },
  });
}

export async function getMessageForReview(id: string) {
  const message = await db.supplierMessage.findUnique({ where: { id }, include: { supplier: true } });
  if (!message) return null;
  const parsed = message.parsedResult as unknown as StoredParse;
  const items = await Promise.all(
    parsed.items.map(async (item, index) => ({
      index,
      item,
      applied: parsed.applied[String(index)] ?? null,
      matches: await findDuplicateCandidates(db, { brand: item.brand, model: item.model, supplierSku: item.supplierSku }),
    })),
  );
  return { message, parsed, items };
}

export async function applyReviewedItem(rawInput: ReviewedItemInput, actor: Actor) {
  const input = reviewedItemInput.parse(rawInput);
  if (input.colors.length === 0) throw new BusinessError("Indicá al menos un color o dejá el ítem sin aplicar hasta confirmarlo.");
  if (input.sizes.length === 0) throw new BusinessError("Indicá al menos un talle o dejá el ítem sin aplicar hasta confirmarlo.");
  if (input.colors.length > 1 && !input.confirmAllCombinations) {
    throw new BusinessError(
      "El ítem tiene varios colores: confirmá que todos los talles existen en todos los colores, o cargalo como ítems separados.",
      "combinations",
    );
  }

  return db.$transaction(async (tx) => {
    const message = await tx.supplierMessage.findUnique({ where: { id: input.messageId } });
    if (!message) throw new BusinessError("El mensaje no existe.", "not_found");
    if (message.status === "DISCARDED") throw new BusinessError("El mensaje fue descartado.");
    const parsed = message.parsedResult as unknown as StoredParse;
    if (!parsed.items[input.itemIndex]) throw new BusinessError("Ítem inexistente.");
    if (parsed.applied[String(input.itemIndex)]) throw new BusinessError("Este ítem ya fue aplicado.", "already_applied");

    const dataDate = message.receivedAt ?? message.consultedAt;
    const variants = input.colors.flatMap((color) =>
      input.sizes.map((size) => ({ color, size, supplierSku: null, availabilityStatus: input.variantStatus })),
    );
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
          availabilityStatus: input.variantStatus,
          dataSource: message.source,
          dataDate,
          lastConsultedAt: message.consultedAt,
          nextDispatchWeekday: input.nextDispatchWeekday,
          nextDispatchDate: input.nextDispatchDate,
          notes: input.notes,
          variants,
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
      // Solo se actualizan las variantes informadas; las demás no se tocan
      // (que no figuren en el mensaje no significa que estén agotadas).
      await syncVariants(tx, p.id, variants, message.consultedAt, false);
      const newer = !p.lastConsultedAt || message.consultedAt > p.lastConsultedAt;
      const productData: Prisma.ProductUpdateInput = {};
      if (newer) {
        productData.lastConsultedAt = message.consultedAt;
        productData.dataSource = message.source;
        productData.dataDate = dataDate;
        if (p.availabilityStatus !== "DISCONTINUED") productData.availabilityStatus = input.variantStatus;
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
          variants: variants.map((v) => `${v.color} ${v.size}`),
          status: input.variantStatus,
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

    parsed.applied[String(input.itemIndex)] = { action: input.action, productId, at: new Date().toISOString(), price: priceOutcome };
    const allApplied = parsed.items.every((_, i) => parsed.applied[String(i)]);
    await tx.supplierMessage.update({
      where: { id: message.id },
      data: { parsedResult: parsed as unknown as Prisma.InputJsonValue, status: allApplied ? "APPLIED" : "PARTIALLY_APPLIED" },
    });
    return { productId, priceOutcome };
  });
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
