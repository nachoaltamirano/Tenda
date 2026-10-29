// Pedidos por encargo: alta, cotización, confirmación, compra, recepción,
// inspección, cobro, entrega y cierre. Cada cambio de estado pasa por
// `transitionErrors` y queda registrado en OrderStatusChange.

import { Prisma, type DeliveryMethod, type IncidentType, type InspectionResult, type PaymentMethod } from "@prisma/client";
import { dateInputValue } from "@/lib/format";
import { estimateDispatch } from "@/lib/orders/dispatch";
import { isLocked, nextStatuses, orderTotals, STATUS_LABELS, transitionErrors, type OrderStatus } from "@/lib/orders/status";
import { orderCreateInput, orderItemUpdateInput, paymentInput, type OrderCreateInput, type PaymentInput } from "@/lib/validation/catalog";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { BusinessError } from "../errors";
import { getDispatchSettings } from "../settings";
import type { Actor } from "../catalog/products";

type Ctx = { reason?: string | null; closeException?: string | null };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function phoneKey(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 6 ? digits.slice(-10) : null; // últimos 10 dígitos: ignora +54 9
}

async function generateCode(tx: Tx, now = new Date()): Promise<string> {
  const ym = now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(2, 7).replace("-", "");
  const prefix = `LB-${ym}-`;
  const last = await tx.order.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/** Fecha de solo día (columna @db.Date) a partir de "YYYY-MM-DD". */
function day(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function dayString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

async function loadOrder(tx: Tx, id: string) {
  const order = await tx.order.findUnique({ where: { id }, include: { items: true, payments: true, cashMovements: true } });
  if (!order) throw new BusinessError("El pedido no existe.", "not_found");
  return order;
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

export function totalsOf(order: LoadedOrder) {
  const paid = order.payments.reduce((s, p) => s + p.amount, 0);
  const expenses = order.cashMovements.filter((m) => m.type === "ORDER_EXPENSE").reduce((s, m) => s + m.amount, 0);
  const refunds = order.cashMovements.filter((m) => m.type === "REFUND").reduce((s, m) => s + m.amount, 0);
  return { ...orderTotals(order.items, paid - refunds, expenses), refunds, grossPaid: paid };
}

function snapshot(order: LoadedOrder) {
  const t = totalsOf(order);
  return {
    status: order.status,
    statusBeforeIncident: order.statusBeforeIncident,
    supplierConfirmedAt: order.supplierConfirmedAt,
    items: order.items,
    total: t.total,
    paid: t.paid,
    deliveryMethod: order.deliveryMethod,
    deliveredAt: order.deliveredAt,
    closeExceptionReason: order.closeExceptionReason,
  };
}

function assertOpen(order: { status: OrderStatus }) {
  if (["CLOSED", "CANCELLED"].includes(order.status)) throw new BusinessError(`El pedido está ${STATUS_LABELS[order.status].toLowerCase()}.`, "closed");
}

async function logChange(tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus, note: string | null, actor: Actor) {
  await tx.orderStatusChange.create({ data: { orderId, from, to, note, userEmail: actor.email } });
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

export async function createOrder(raw: OrderCreateInput, actor: Actor) {
  const input = orderCreateInput.parse(raw);
  return db.$transaction(async (tx) => {
    let customerId = input.customerId;
    if (!customerId) {
      if (!input.customerName) throw new BusinessError("Indicá el cliente.");
      const key = phoneKey(input.customerPhone);
      const existing = key ? await tx.customer.findFirst({ where: { phoneKey: key } }) : null;
      customerId =
        existing?.id ??
        (
          await tx.customer.create({
            data: { name: input.customerName, phone: input.customerPhone, phoneKey: key, channel: input.channel, isTestData: input.isTestData },
          })
        ).id;
    }
    const items = [];
    for (const it of input.items) {
      const p = await tx.product.findUnique({
        where: { id: it.productId },
        include: { costHistory: { orderBy: { consultedAt: "desc" }, take: 1 } },
      });
      if (!p) throw new BusinessError("Alguno de los productos no existe.");
      if (it.size && p.sizesOffered.length && !p.sizesOffered.includes(it.size)) {
        throw new BusinessError(`El talle ${it.size} no figura en la oferta de ${p.brand} ${p.model} (${p.sizesOffered.join(", ")}). Verificalo con el proveedor y actualizá el producto.`);
      }
      items.push({
        productId: p.id,
        brand: p.brand,
        model: p.model,
        internalSku: p.internalSku,
        size: it.size,
        color: it.color,
        quantity: it.quantity,
        agreedPrice: it.agreedPrice ?? p.salePrice ?? 0,
        costSnapshot: p.costPrice,
        costHistoryId: p.costHistory[0]?.id ?? null,
        costConsultedAt: p.costUpdatedAt,
      });
    }
    const order = await tx.order.create({
      data: {
        code: await generateCode(tx),
        customerId,
        channel: input.channel,
        internalNotes: input.internalNotes,
        isTestData: input.isTestData,
        items: { create: items },
      },
    });
    await logChange(tx, order.id, null, "INQUIRY", null, actor);
    return order;
  });
}

export async function updateOrderItem(orderId: string, itemId: string, raw: unknown, actor: Actor) {
  const input = orderItemUpdateInput.parse(raw);
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    if (isLocked(order.status)) {
      throw new BusinessError("El pedido ya fue confirmado: el precio y el producto acordados no se modifican.", "locked");
    }
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new BusinessError("El producto no pertenece al pedido.");
    await tx.orderItem.update({ where: { id: itemId }, data: input });
    await audit(tx, {
      entityType: "Order",
      entityId: orderId,
      action: "item_update",
      changes: { item: `${item.brand} ${item.model}`, from: { size: item.size, color: item.color, agreedPrice: item.agreedPrice }, to: input },
      userEmail: actor.email,
    });
  });
}

// ---------------------------------------------------------------------------
// Cambios de estado
// ---------------------------------------------------------------------------

async function transition(tx: Tx, order: LoadedOrder, to: OrderStatus, ctx: Ctx, actor: Actor) {
  const snap = snapshot(order);
  if (to === "CLOSED" && ctx.closeException) snap.closeExceptionReason = ctx.closeException;
  const errors = transitionErrors(snap, to, ctx);
  if (errors.length) throw new BusinessError(errors.join(" "), "transition_blocked", errors);

  const data: Prisma.OrderUpdateInput = { status: to };
  if (to === "CANCELLED") data.cancelReason = ctx.reason;
  if (to === "INCIDENT") data.statusBeforeIncident = order.status;
  if (order.status === "INCIDENT") data.statusBeforeIncident = null;
  if (to === "CLOSED" && ctx.closeException) {
    data.closeExceptionReason = ctx.closeException;
    data.closeExceptionBy = actor.email;
  }
  await tx.order.update({ where: { id: order.id }, data });
  if (to === "INCIDENT") {
    await tx.orderIncident.create({ data: { orderId: order.id, type: "OTHER", description: ctx.reason!, createdBy: actor.email } });
  }
  await logChange(tx, order.id, order.status, to, ctx.reason ?? ctx.closeException ?? null, actor);
  order.status = to;
}

export async function changeStatus(orderId: string, to: OrderStatus, ctx: Ctx, actor: Actor) {
  return db.$transaction(async (tx) => transition(tx, await loadOrder(tx, orderId), to, ctx, actor));
}

// ---------------------------------------------------------------------------
// Proveedor y logística
// ---------------------------------------------------------------------------

/** El proveedor confirmó disponibilidad del par puntual. Calcula la estimación de despacho si no hay una. */
export async function registerSupplierConfirmation(
  orderId: string,
  input: { confirmedAt: Date; note: string | null; confirmedDispatchDate: string | null },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    assertOpen(order);
    const settings = await getDispatchSettings(tx);
    const holidays = (await tx.holiday.findMany()).map((h) => dayString(h.date)!);
    const est = estimateDispatch({
      from: dateInputValue(input.confirmedAt),
      weekdays: settings.weekdays,
      holidays,
      maxDays: settings.maxEstimatedDays,
      confirmedDispatch: input.confirmedDispatchDate,
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        supplierQueriedAt: order.supplierQueriedAt ?? input.confirmedAt,
        supplierConfirmedAt: input.confirmedAt,
        supplierConfirmNote: input.note,
        confirmedDispatchDate: input.confirmedDispatchDate ? day(input.confirmedDispatchDate) : order.confirmedDispatchDate,
        estimatedDispatchDate: order.estimatedDispatchDate ?? (est.dispatch ? day(est.dispatch) : null),
        estimatedArrivalDate: order.estimatedArrivalDate ?? (est.arrivalLatest ? day(est.arrivalLatest) : null),
      },
    });
    for (const item of order.items) {
      if (!item.productId) continue;
      const p = await tx.product.findUnique({ where: { id: item.productId } });
      if (p && (!p.lastConsultedAt || p.lastConsultedAt < input.confirmedAt)) {
        await tx.product.update({ where: { id: p.id }, data: { lastConsultedAt: input.confirmedAt, availabilityStatus: "CONFIRMED_FOR_ORDER" } });
      }
    }
    await audit(tx, {
      entityType: "Order",
      entityId: orderId,
      action: "supplier_confirmed",
      changes: { confirmedAt: input.confirmedAt.toISOString(), note: input.note, estimate: est },
      userEmail: actor.email,
    });
    return est;
  });
}

const LOGISTICS_FIELDS = [
  "estimatedDispatchDate",
  "confirmedDispatchDate",
  "actualDispatchDate",
  "estimatedArrivalDate",
  "actualArrivalDate",
] as const;

export async function updateLogistics(
  orderId: string,
  input: Partial<Record<(typeof LOGISTICS_FIELDS)[number], string | null>> & { carrier?: string | null; trackingCode?: string | null },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    const data: Prisma.OrderUpdateInput = { carrier: input.carrier ?? null, trackingCode: input.trackingCode ?? null };
    for (const f of LOGISTICS_FIELDS) if (f in input) data[f] = input[f] ? day(input[f]!) : null;
    await tx.order.update({ where: { id: orderId }, data });
    await audit(tx, {
      entityType: "Order",
      entityId: orderId,
      action: "logistics_update",
      changes: Object.fromEntries(LOGISTICS_FIELDS.filter((f) => f in input).map((f) => [f, { from: dayString(order[f]), to: input[f] }])),
      userEmail: actor.email,
    });
  });
}

/** Registrar compra al proveedor: egreso de caja, costo real y estado "Comprado". */
export async function registerPurchase(orderId: string, input: { amount: number; paidAt: Date; method: PaymentMethod; note: string | null }, actor: Actor) {
  if (input.amount <= 0) throw new BusinessError("Indicá el importe pagado al proveedor.");
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    if (order.purchasedAt) throw new BusinessError("La compra de este pedido ya fue registrada.", "duplicate_purchase");
    // Reparto del costo real entre los productos según el costo cotizado (o en partes iguales).
    const units = order.items.reduce((s, i) => s + i.quantity, 0);
    const weights = order.items.map((i) => (i.costSnapshot ?? 0) * i.quantity);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let assigned = 0;
    for (const [idx, item] of order.items.entries()) {
      const share =
        idx === order.items.length - 1
          ? input.amount - assigned
          : Math.round(totalWeight > 0 ? (input.amount * weights[idx]) / totalWeight : (input.amount * item.quantity) / units);
      assigned += share;
      await tx.orderItem.update({ where: { id: item.id }, data: { actualCost: Math.round(share / item.quantity) } });
    }
    await tx.order.update({ where: { id: orderId }, data: { purchasedAt: input.paidAt } });
    await tx.cashMovement.create({
      data: {
        type: "SUPPLIER_PAYMENT",
        amount: input.amount,
        occurredAt: input.paidAt,
        description: `Compra al proveedor · ${order.code}${input.note ? ` · ${input.note}` : ""}`,
        orderId,
        method: input.method,
        createdBy: actor.email,
        isTestData: order.isTestData,
      },
    });
    const reloaded = await loadOrder(tx, orderId);
    if (order.status === "CONFIRMED" || order.status === "PURCHASE_PENDING") await transition(tx, reloaded, "PURCHASED", {}, actor);
  });
}

export async function markReceived(orderId: string, arrivedAt: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    await tx.order.update({ where: { id: orderId }, data: { actualArrivalDate: day(arrivedAt) } });
    await transition(tx, order, "RECEIVED_PENDING_INSPECTION", {}, actor);
  });
}

/** Inspección de modelo, talle, color y estado. Con todo aprobado avanza; un rechazo abre una incidencia. */
export async function inspectItem(orderId: string, itemId: string, input: { result: Exclude<InspectionResult, "PENDING">; notes: string | null }, actor: Actor) {
  if (input.result === "REJECTED" && !input.notes) throw new BusinessError("Describí el problema encontrado.");
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    if (order.status !== "RECEIVED_PENDING_INSPECTION") throw new BusinessError("La inspección se registra cuando el pedido está recibido y pendiente de inspección.");
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new BusinessError("El producto no pertenece al pedido.");
    await tx.orderItem.update({
      where: { id: itemId },
      data: { inspection: input.result, inspectionNotes: input.notes, inspectedAt: new Date(), inspectedBy: actor.email },
    });
    item.inspection = input.result;
    if (input.result === "REJECTED") {
      await transition(tx, order, "INCIDENT", { reason: `Inspección rechazada (${item.brand} ${item.model}): ${input.notes}` }, actor);
    } else if (order.items.every((i) => i.inspection === "APPROVED")) {
      await transition(tx, order, "INSPECTED_APPROVED", {}, actor);
    }
  });
}

// ---------------------------------------------------------------------------
// Cobros, gastos y devoluciones
// ---------------------------------------------------------------------------

export async function registerPayment(raw: PaymentInput, actor: Actor) {
  const input = paymentInput.parse(raw);
  try {
    return await db.$transaction(async (tx) => {
      const order = await loadOrder(tx, input.orderId);
      assertOpen(order);
      const t = totalsOf(order);
      if (input.amount > t.balance) {
        throw new BusinessError(`El importe supera el saldo pendiente (${(t.balance / 100).toLocaleString("es-AR")}).`, "overpayment");
      }
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount: input.amount,
          method: input.method,
          paidAt: input.paidAt,
          reference: input.reference,
          idempotencyKey: input.idempotencyKey,
          createdBy: actor.email,
        },
      });
      await tx.cashMovement.create({
        data: {
          type: "CUSTOMER_PAYMENT",
          amount: input.amount,
          occurredAt: input.paidAt,
          description: `Cobro · ${order.code}`,
          orderId: order.id,
          paymentId: payment.id,
          method: input.method,
          createdBy: actor.email,
          isTestData: order.isTestData,
        },
      });
      if (input.amount === t.balance && order.status === "AWAITING_PAYMENT") {
        await transition(tx, await loadOrder(tx, order.id), "PAYMENT_CONFIRMED", {}, actor);
      }
      return payment;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BusinessError("Este pago ya fue registrado (mismo envío del formulario o mismo número de operación).", "duplicate_payment");
    }
    throw e;
  }
}

export async function addOrderExpense(orderId: string, input: { amount: number; description: string; occurredAt: Date }, actor: Actor) {
  if (input.amount <= 0 || !input.description) throw new BusinessError("Indicá importe y concepto del gasto.");
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new BusinessError("El pedido no existe.", "not_found");
  return db.cashMovement.create({
    data: {
      type: "ORDER_EXPENSE",
      amount: input.amount,
      occurredAt: input.occurredAt,
      description: `${input.description} · ${order.code}`,
      orderId,
      createdBy: actor.email,
      isTestData: order.isTestData,
    },
  });
}

export async function registerRefund(orderId: string, input: { amount: number; reason: string; occurredAt: Date; method: PaymentMethod }, actor: Actor) {
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    const t = totalsOf(order);
    if (!input.reason) throw new BusinessError("Indicá el motivo de la devolución.");
    if (input.amount <= 0 || input.amount > t.paid) throw new BusinessError("La devolución no puede superar lo cobrado.");
    await tx.cashMovement.create({
      data: {
        type: "REFUND",
        amount: input.amount,
        occurredAt: input.occurredAt,
        description: `Devolución · ${order.code} · ${input.reason}`,
        orderId,
        method: input.method,
        createdBy: actor.email,
        isTestData: order.isTestData,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Entrega e incidencias
// ---------------------------------------------------------------------------

export async function setDelivery(
  orderId: string,
  input: { method: DeliveryMethod | null; address: string | null; scheduledAt: Date | null; deliveredAt: Date | null; markDelivered: boolean },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const order = await loadOrder(tx, orderId);
    assertOpen(order);
    await tx.order.update({
      where: { id: orderId },
      data: { deliveryMethod: input.method, deliveryAddress: input.address, deliveryScheduledAt: input.scheduledAt, deliveredAt: input.deliveredAt },
    });
    if (input.markDelivered) {
      const reloaded = await loadOrder(tx, orderId);
      await transition(tx, reloaded, "DELIVERED", {}, actor);
    }
  });
}

export async function addIncident(orderId: string, input: { type: IncidentType; description: string }, actor: Actor) {
  if (!input.description) throw new BusinessError("Describí la incidencia.");
  return db.orderIncident.create({ data: { orderId, type: input.type, description: input.description, createdBy: actor.email } });
}

export async function resolveIncident(incidentId: string, resolution: string, actor: Actor) {
  if (!resolution) throw new BusinessError("Indicá cómo se resolvió.");
  const inc = await db.orderIncident.update({ where: { id: incidentId }, data: { resolvedAt: new Date(), resolution } });
  await audit(db, { entityType: "Order", entityId: inc.orderId, action: "incident_resolved", changes: { incidentId, resolution }, userEmail: actor.email });
  return inc;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function getOrderDetail(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { product: { select: { id: true, costPrice: true, salePrice: true, costUpdatedAt: true, sizesOffered: true } } } },
      payments: { orderBy: { paidAt: "asc" } },
      cashMovements: { orderBy: { occurredAt: "asc" } },
      statusChanges: { orderBy: { createdAt: "desc" } },
      incidents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return null;
  const totals = totalsOf(order);
  const snap = snapshot(order);
  const transitions = nextStatuses(order).map((to) => ({ to, errors: transitionErrors(snap, to, { reason: "x" }) }));
  return { order, totals, transitions };
}

export async function listOrders(filters: { statuses?: OrderStatus[]; q?: string; includeTest?: boolean } = {}) {
  const where: Prisma.OrderWhereInput = {};
  if (filters.statuses?.length) where.status = { in: filters.statuses };
  if (!filters.includeTest) where.isTestData = false;
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: "insensitive" } },
      { customer: { name: { contains: filters.q, mode: "insensitive" } } },
      { customer: { phone: { contains: filters.q } } },
    ];
  }
  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { customer: true, items: true, payments: true, cashMovements: true },
  });
  return orders.map((o) => ({ ...o, totals: totalsOf(o) }));
}
