"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AvailabilityStatus, ImageSourceType, PublicationStatus } from "@prisma/client";
import { authenticate, endSession, requireAdmin, startSession } from "@/server/auth";
import { db } from "@/server/db";
import { BusinessError, type ActionResult } from "@/server/errors";
import { bool, date, int, list, money, num, reqStr, runAction, str } from "@/server/forms";
import { applyReviewedItem, createSupplierMessage, discardMessage } from "@/server/catalog/import";
import { addProductImage, moveImage, removeImage, setCoverImage, setImageAuthorization } from "@/server/catalog/images";
import { approveProposal, rejectProposal, requestPriceUpdate } from "@/server/catalog/prices";
import { addVariants, createProduct, setPublicationStatus, setVariantState, updateProduct } from "@/server/catalog/products";
import { saveDispatchSettings, savePricingSettings } from "@/server/settings";
import type { dataSourceValues } from "@/lib/validation/catalog";

type State = ActionResult<unknown> | null;
type DataSource = (typeof dataSourceValues)[number];

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

export async function loginAction(_prev: State, fd: FormData): Promise<State> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const result = await runAction(async () => {
    const session = await authenticate(reqStr(fd, "email"), String(fd.get("password") ?? ""), ip);
    await startSession(session);
  });
  if (!result.ok) return result;
  const next = str(fd, "next");
  redirect(next && next.startsWith("/admin") ? next : "/admin");
}

export async function logoutAction() {
  await endSession();
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

function productFields(fd: FormData) {
  return {
    supplierId: str(fd, "supplierId"),
    supplierSku: str(fd, "supplierSku"),
    brand: reqStr(fd, "brand"),
    model: reqStr(fd, "model"),
    description: str(fd, "description"),
    category: str(fd, "category"),
    currency: (str(fd, "currency") ?? "ARS") as "ARS" | "USD",
    transportCost: money(fd, "transportCost", "Transporte"),
    otherCosts: money(fd, "otherCosts", "Otros costos"),
    accessoriesCost: money(fd, "accessoriesCost", "Accesorios"),
    salePrice: money(fd, "salePrice", "Precio de venta"),
    availabilityStatus: (str(fd, "availabilityStatus") ?? "PENDING_VERIFICATION") as AvailabilityStatus,
    estimatedDeliveryDays: int(fd, "estimatedDeliveryDays"),
    dataSource: (str(fd, "dataSource") ?? "MANUAL") as DataSource,
    dataDate: date(fd, "dataDate"),
    dataVerified: bool(fd, "dataVerified"),
    lastConsultedAt: date(fd, "lastConsultedAt"),
    nextDispatchDate: date(fd, "nextDispatchDate"),
    nextDispatchWeekday: int(fd, "nextDispatchWeekday"),
    nextDispatchMode: str(fd, "nextDispatchMode"),
    nextDispatchConfirmed: bool(fd, "nextDispatchConfirmed"),
    notes: str(fd, "notes"),
    conditions: str(fd, "conditions"),
    isTestData: bool(fd, "isTestData"),
    acceptLowMargin: bool(fd, "acceptLowMargin"),
  };
}

export async function createProductAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const result = await runAction(async () => {
    const sizes = list(fd, "sizes");
    const colors = list(fd, "colors");
    if (colors.length > 1 && sizes.length && !bool(fd, "confirmAllCombinations")) {
      throw new BusinessError("Con varios colores, confirmá que todos los talles existen en todos los colores.");
    }
    const status = (str(fd, "variantStatus") ?? "PENDING_VERIFICATION") as AvailabilityStatus;
    return createProduct(
      {
        ...productFields(fd),
        costPrice: money(fd, "costPrice", "Costo del proveedor"),
        variants: colors.flatMap((color) => sizes.map((size) => ({ color, size, availabilityStatus: status }))),
        confirmDuplicate: bool(fd, "confirmDuplicate"),
      },
      session,
    );
  });
  if (!result.ok) return result;
  redirect(`/admin/productos/${result.data.id}`);
}

export async function updateProductAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(() => updateProduct(id, { ...productFields(fd), reason: str(fd, "reason") }, session), "Cambios guardados.");
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

export async function setPublicationAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const status = reqStr(fd, "status") as PublicationStatus;
  const r = await runAction(() => setPublicationStatus(id, status, session), "Estado de publicación actualizado.");
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

export async function addVariantsAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      addVariants(
        id,
        {
          color: reqStr(fd, "color"),
          sizes: list(fd, "sizes"),
          availabilityStatus: (str(fd, "availabilityStatus") ?? "PENDING_VERIFICATION") as AvailabilityStatus,
          consultedAt: date(fd, "consultedAt"),
        },
        session,
      ),
    "Variantes agregadas.",
  );
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

export async function setVariantAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const active = str(fd, "active");
  const r = await runAction(
    () =>
      setVariantState(
        id,
        reqStr(fd, "variantId"),
        {
          availabilityStatus: (str(fd, "availabilityStatus") ?? undefined) as AvailabilityStatus | undefined,
          active: active === null ? undefined : active === "true",
          consultedAt: bool(fd, "touchConsulted") ? new Date() : null,
        },
        session,
      ),
    "Variante actualizada.",
  );
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

export async function uploadImagesAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const r = await runAction(async () => {
    if (!files.length) throw new BusinessError("Elegí al menos una imagen.");
    const sourceType = (str(fd, "sourceType") ?? "SUPPLIER") as ImageSourceType;
    for (const file of files) {
      await addProductImage(
        id,
        {
          data: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type,
          sourceType,
          sourceNote: str(fd, "sourceNote"),
          authorizedForPublication: bool(fd, "authorized"),
        },
        session,
      );
    }
    return files.length;
  }, `${files.length} imagen(es) cargada(s).`);
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

export async function imageAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const imageId = reqStr(fd, "imageId");
  const op = reqStr(fd, "op");
  const r = await runAction(async () => {
    if (op === "cover") await setCoverImage(id, imageId, session);
    else if (op === "up" || op === "down") await moveImage(id, imageId, op === "up" ? -1 : 1, session);
    else if (op === "remove") await removeImage(id, imageId, session);
    else if (op === "authorize" || op === "unauthorize") await setImageAuthorization(id, imageId, op === "authorize", session);
    else throw new BusinessError("Operación desconocida.");
  });
  revalidatePath(`/admin/productos/${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

export async function requestPriceUpdateAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(async () => {
    const newCostPrice = money(fd, "newCostPrice", "Costo nuevo");
    if (newCostPrice === null) throw new BusinessError("Indicá el costo informado por el proveedor.");
    const consultedAt = date(fd, "consultedAt");
    if (!consultedAt) throw new BusinessError("Indicá la fecha de la consulta.");
    return requestPriceUpdate(
      { productId: id, newCostPrice, consultedAt, source: (str(fd, "source") ?? "WHATSAPP_DIRECT") as DataSource, note: str(fd, "note") },
      session,
    );
  });
  revalidatePath(`/admin/productos/${id}`);
  revalidatePath("/admin/precios");
  if (r.ok) {
    const out = r.data;
    return {
      ok: true,
      data: out,
      message:
        out.kind === "confirmed"
          ? "El costo coincide con el vigente: se registró la consulta y se renovó la fecha."
          : `Propuesta creada. Revisala y aprobala en Precios${out.belowMinMargin ? " (atención: el margen queda bajo el mínimo)" : ""}.`,
    };
  }
  return r;
}

export async function approveProposalAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(
    async () =>
      approveProposal(
        {
          proposalId: reqStr(fd, "proposalId"),
          salePriceChoice: (str(fd, "salePriceChoice") ?? "keep") as "keep" | "suggested" | "custom",
          customSalePrice: money(fd, "customSalePrice", "Precio de venta"),
          acceptLowMargin: bool(fd, "acceptLowMargin"),
          acceptOlderData: bool(fd, "acceptOlderData"),
          note: str(fd, "note"),
        },
        session,
      ),
    "Cambio aprobado y aplicado.",
  );
  revalidatePath("/admin/precios");
  revalidatePath("/admin/productos");
  return r;
}

export async function rejectProposalAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(() => rejectProposal(reqStr(fd, "proposalId"), str(fd, "note"), session), "Propuesta rechazada.");
  revalidatePath("/admin/precios");
  return r;
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

export async function createMessageAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(async () => {
    const consultedAt = date(fd, "consultedAt");
    if (!consultedAt) throw new BusinessError("Indicá la fecha de consulta.");
    return createSupplierMessage(
      {
        supplierId: reqStr(fd, "supplierId"),
        source: (str(fd, "source") ?? "WHATSAPP_GROUP") as DataSource,
        rawText: String(fd.get("rawText") ?? ""),
        consultedAt,
        receivedAt: date(fd, "receivedAt"),
        isTestData: bool(fd, "isTestData"),
      },
      session,
    );
  });
  if (!r.ok) return r;
  redirect(`/admin/importar/${r.data.id}`);
}

export async function applyItemAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const messageId = reqStr(fd, "messageId");
  const r = await runAction(async () => {
    const out = await applyReviewedItem(
      {
        messageId,
        itemIndex: int(fd, "itemIndex") ?? -1,
        action: (str(fd, "action") ?? "create") as "create" | "update",
        productId: str(fd, "productId"),
        brand: reqStr(fd, "brand"),
        model: reqStr(fd, "model"),
        supplierSku: str(fd, "supplierSku"),
        colors: list(fd, "colors"),
        sizes: list(fd, "sizes").map((s) => s.replace(",", ".")),
        price: money(fd, "price", "Precio"),
        currency: (str(fd, "currency") ?? "ARS") as "ARS" | "USD",
        variantStatus: (str(fd, "variantStatus") ?? "AVAILABLE_LAST_CHECK") as AvailabilityStatus,
        nextDispatchWeekday: int(fd, "nextDispatchWeekday"),
        nextDispatchDate: date(fd, "nextDispatchDate"),
        notes: str(fd, "notes"),
        confirmDuplicate: bool(fd, "confirmDuplicate"),
        confirmAllCombinations: bool(fd, "confirmAllCombinations"),
      },
      session,
    );
    return out;
  });
  revalidatePath(`/admin/importar/${messageId}`);
  if (r.ok) {
    const msg =
      r.data.priceOutcome === "proposal"
        ? "Aplicado. El cambio de costo quedó pendiente de aprobación en Precios."
        : r.data.priceOutcome === "confirmed"
          ? "Aplicado. El costo coincide con el vigente: se renovó la fecha de consulta."
          : "Aplicado.";
    return { ...r, message: msg };
  }
  return r;
}

export async function discardMessageAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(() => discardMessage(id, session), "Mensaje descartado.");
  revalidatePath(`/admin/importar/${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export async function savePricingSettingsAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(() => {
    const targetMode = reqStr(fd, "targetMode") as "FIXED_PROFIT" | "MARGIN_PERCENT" | "MARKUP_PERCENT";
    return savePricingSettings(
      {
        packagingCost: money(fd, "packagingCost", "Embalaje"),
        deliveryCostAssumed: money(fd, "deliveryCostAssumed", "Envío asumido"),
        defaultTransportCost: money(fd, "defaultTransportCost", "Transporte"),
        paymentFeePercent: num(fd, "paymentFeePercent"),
        paymentFeeFixed: money(fd, "paymentFeeFixed", "Comisión fija"),
        taxPercent: num(fd, "taxPercent"),
        targetMode,
        targetValue: targetMode === "FIXED_PROFIT" ? money(fd, "targetValue", "Objetivo") : num(fd, "targetValue"),
        minMarginPercent: num(fd, "minMarginPercent"),
        roundingStep: money(fd, "roundingStep", "Redondeo") ?? 0,
        roundingMode: reqStr(fd, "roundingMode") as "UP" | "NEAREST" | "DOWN",
        roundingOffset: -(money(fd, "roundingOffsetDown", "Terminación") ?? 0),
        stalePriceDays: int(fd, "stalePriceDays") ?? 7,
      },
      session,
    );
  }, "Configuración de precios guardada.");
  revalidatePath("/admin", "layout");
  return r;
}

export async function saveDispatchSettingsAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(
    () =>
      saveDispatchSettings(
        { weekdays: fd.getAll("weekdays").map((d) => Number(d)), maxEstimatedDays: int(fd, "maxEstimatedDays") ?? 5 },
        session,
      ),
    "Días de despacho guardados.",
  );
  revalidatePath("/admin/configuracion");
  return r;
}

export async function saveSupplierAction(_prev: State, fd: FormData): Promise<State> {
  await requireAdmin();
  const id = str(fd, "id");
  const r = await runAction(async () => {
    const name = reqStr(fd, "name");
    if (!name) throw new BusinessError("El nombre del proveedor es obligatorio.");
    const data = { name, city: str(fd, "city"), contactNote: str(fd, "contactNote"), notes: str(fd, "notes") };
    return id ? db.supplier.update({ where: { id }, data }) : db.supplier.create({ data });
  }, "Proveedor guardado.");
  revalidatePath("/admin/configuracion");
  return r;
}
