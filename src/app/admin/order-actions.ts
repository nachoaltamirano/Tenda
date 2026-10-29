"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CashMovementType, DeliveryMethod, IncidentType, PaymentMethod } from "@prisma/client";
import type { OrderStatus } from "@/lib/orders/status";
import type { channelValues } from "@/lib/validation/catalog";
import { requireAdmin } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { BusinessError, type ActionResult } from "@/server/errors";
import { bool, date, int, money, reqStr, runAction, str } from "@/server/forms";
import { addManualMovement } from "@/server/orders/cash";
import {
  addIncident,
  addOrderExpense,
  changeStatus,
  createOrder,
  inspectItem,
  markReceived,
  registerPayment,
  registerPurchase,
  registerRefund,
  registerSupplierConfirmation,
  resolveIncident,
  setDelivery,
  updateLogistics,
  updateOrderItem,
} from "@/server/orders/orders";

type State = ActionResult<unknown> | null;

/** "YYYY-MM-DD" o null. */
const dayStr = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BusinessError(`Fecha inválida: ${v}`);
  return v;
};

function refresh(orderId?: string) {
  if (orderId) revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin");
}

export async function createOrderAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(async () => {
    const items = [0, 1, 2]
      .map((i) => ({
        productId: str(fd, `item${i}.productId`),
        size: str(fd, `item${i}.size`)?.replace(",", ".") ?? null,
        color: str(fd, `item${i}.color`),
        quantity: int(fd, `item${i}.quantity`) ?? 1,
        agreedPrice: money(fd, `item${i}.agreedPrice`, "Precio acordado"),
      }))
      .filter((i): i is typeof i & { productId: string } => !!i.productId);
    return createOrder(
      {
        customerId: str(fd, "customerId"),
        customerName: str(fd, "customerName"),
        customerPhone: str(fd, "customerPhone"),
        channel: (str(fd, "channel") ?? "WHATSAPP") as (typeof channelValues)[number],
        items,
        internalNotes: str(fd, "internalNotes"),
        isTestData: bool(fd, "isTestData"),
      },
      session,
    );
  });
  if (!r.ok) return r;
  refresh();
  redirect(`/admin/pedidos/${r.data.id}`);
}

export async function changeStatusAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () => changeStatus(id, reqStr(fd, "to") as OrderStatus, { reason: str(fd, "reason"), closeException: str(fd, "closeException") }, session),
    "Estado actualizado.",
  );
  refresh(id);
  return r;
}

export async function updateItemAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      updateOrderItem(
        id,
        reqStr(fd, "itemId"),
        { size: str(fd, "size")?.replace(",", "."), color: str(fd, "color"), quantity: int(fd, "quantity") ?? 1, agreedPrice: money(fd, "agreedPrice", "Precio") ?? 0 },
        session,
      ),
    "Producto actualizado.",
  );
  refresh(id);
  return r;
}

export async function supplierConfirmationAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(async () => {
    const confirmedAt = date(fd, "confirmedAt");
    if (!confirmedAt) throw new BusinessError("Indicá cuándo confirmó el proveedor.");
    return registerSupplierConfirmation(id, { confirmedAt, note: str(fd, "note"), confirmedDispatchDate: dayStr(fd, "confirmedDispatchDate") }, session);
  }, "Confirmación del proveedor registrada.");
  refresh(id);
  return r;
}

export async function logisticsAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      updateLogistics(
        id,
        {
          estimatedDispatchDate: dayStr(fd, "estimatedDispatchDate"),
          confirmedDispatchDate: dayStr(fd, "confirmedDispatchDate"),
          actualDispatchDate: dayStr(fd, "actualDispatchDate"),
          estimatedArrivalDate: dayStr(fd, "estimatedArrivalDate"),
          actualArrivalDate: dayStr(fd, "actualArrivalDate"),
          carrier: str(fd, "carrier"),
          trackingCode: str(fd, "trackingCode"),
        },
        session,
      ),
    "Fechas de despacho guardadas.",
  );
  refresh(id);
  return r;
}

export async function purchaseAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      registerPurchase(
        id,
        {
          amount: money(fd, "amount", "Importe") ?? 0,
          paidAt: date(fd, "paidAt") ?? new Date(),
          method: (str(fd, "method") ?? "TRANSFER") as PaymentMethod,
          note: str(fd, "note"),
        },
        session,
      ),
    "Compra registrada.",
  );
  refresh(id);
  return r;
}

export async function receivedAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(async () => {
    const d = dayStr(fd, "arrivedAt");
    if (!d) throw new BusinessError("Indicá la fecha de llegada.");
    return markReceived(id, d, session);
  }, "Recepción registrada. Falta la inspección.");
  refresh(id);
  return r;
}

export async function inspectAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () => inspectItem(id, reqStr(fd, "itemId"), { result: reqStr(fd, "result") as "APPROVED" | "REJECTED", notes: str(fd, "notes") }, session),
    "Inspección registrada.",
  );
  refresh(id);
  return r;
}

export async function paymentAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      registerPayment(
        {
          orderId: id,
          amount: money(fd, "amount", "Importe") ?? 0,
          method: (str(fd, "method") ?? "TRANSFER") as PaymentMethod,
          paidAt: date(fd, "paidAt") ?? new Date(),
          reference: str(fd, "reference"),
          idempotencyKey: reqStr(fd, "idempotencyKey"),
        },
        session,
      ),
    "Pago registrado.",
  );
  refresh(id);
  return r;
}

export async function expenseAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () => addOrderExpense(id, { amount: money(fd, "amount", "Importe") ?? 0, description: reqStr(fd, "description"), occurredAt: date(fd, "occurredAt") ?? new Date() }, session),
    "Gasto registrado.",
  );
  refresh(id);
  return r;
}

export async function refundAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      registerRefund(
        id,
        { amount: money(fd, "amount", "Importe") ?? 0, reason: reqStr(fd, "reason"), occurredAt: date(fd, "occurredAt") ?? new Date(), method: (str(fd, "method") ?? "TRANSFER") as PaymentMethod },
        session,
      ),
    "Devolución registrada.",
  );
  refresh(id);
  return r;
}

export async function deliveryAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(
    () =>
      setDelivery(
        id,
        {
          method: (str(fd, "method") as DeliveryMethod | null) ?? null,
          address: str(fd, "address"),
          scheduledAt: date(fd, "scheduledAt"),
          deliveredAt: date(fd, "deliveredAt"),
          markDelivered: bool(fd, "markDelivered"),
        },
        session,
      ),
    "Entrega guardada.",
  );
  refresh(id);
  return r;
}

export async function incidentAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const incidentId = str(fd, "incidentId");
  const r = await runAction(
    () =>
      incidentId
        ? resolveIncident(incidentId, reqStr(fd, "resolution"), session)
        : addIncident(id, { type: (str(fd, "type") ?? "OTHER") as IncidentType, description: reqStr(fd, "description") }, session),
    incidentId ? "Incidencia resuelta." : "Incidencia registrada.",
  );
  refresh(id);
  return r;
}

export async function notesAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const id = reqStr(fd, "id");
  const r = await runAction(async () => {
    const notes = str(fd, "internalNotes");
    await db.order.update({ where: { id }, data: { internalNotes: notes } });
    await audit(db, { entityType: "Order", entityId: id, action: "notes", changes: { internalNotes: notes }, userEmail: session.email });
  }, "Notas guardadas.");
  refresh(id);
  return r;
}

export async function cashMovementAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const r = await runAction(
    () =>
      addManualMovement(
        {
          type: reqStr(fd, "type") as CashMovementType,
          amount: money(fd, "amount", "Importe") ?? 0,
          occurredAt: date(fd, "occurredAt") ?? new Date(),
          description: reqStr(fd, "description"),
          method: (str(fd, "method") as PaymentMethod | null) ?? null,
        },
        session,
      ),
    "Movimiento registrado.",
  );
  revalidatePath("/admin/caja");
  return r;
}

export async function holidayAction(_prev: State, fd: FormData): Promise<State> {
  const session = await requireAdmin();
  const removeId = str(fd, "removeId");
  const r = await runAction(async () => {
    if (removeId) {
      await db.holiday.delete({ where: { id: removeId } });
    } else {
      const d = dayStr(fd, "date");
      if (!d) throw new BusinessError("Indicá la fecha.");
      if (await db.holiday.findUnique({ where: { date: new Date(`${d}T00:00:00Z`) } })) throw new BusinessError("Esa fecha ya está cargada.");
      await db.holiday.create({ data: { date: new Date(`${d}T00:00:00Z`), description: reqStr(fd, "description") || "Feriado" } });
    }
    await audit(db, { entityType: "Holiday", entityId: removeId ?? "new", action: removeId ? "delete" : "create", userEmail: session.email });
  }, removeId ? "Fecha quitada." : "Fecha agregada.");
  revalidatePath("/admin/configuracion");
  return r;
}
