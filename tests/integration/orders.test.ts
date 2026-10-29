import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveProposal, requestPriceUpdate } from "@/server/catalog/prices";
import { createProduct } from "@/server/catalog/products";
import { cashSummary } from "@/server/orders/cash";
import {
  changeStatus,
  createOrder,
  inspectItem,
  markReceived,
  registerPayment,
  registerPurchase,
  registerRefund,
  registerSupplierConfirmation,
  setDelivery,
  updateOrderItem,
} from "@/server/orders/orders";
import { actor, baseProduct, resetDb, seedPricing } from "./helpers";

let productId: string;
beforeEach(async () => {
  await resetDb();
  await seedPricing();
  await db.dispatchSettings.create({ data: { id: 1, weekdays: [2, 4, 5], maxEstimatedDays: 5 } });
  productId = (await createProduct({ ...baseProduct, sizesOffered: ["39", "40", "41"], salePrice: 8_100_000 }, actor)).id;
});

const pay = (orderId: string, amount: number, extra: Record<string, unknown> = {}) =>
  registerPayment({ orderId, amount, method: "TRANSFER", paidAt: new Date(), idempotencyKey: randomUUID(), ...extra }, actor);

async function newOrder(item: Record<string, unknown> = {}) {
  return createOrder(
    { customerName: "[TEST] Cliente", customerPhone: "+54 9 341 555-0000", channel: "WHATSAPP", isTestData: true, items: [{ productId, size: "40", color: "negro", ...item }] },
    actor,
  );
}

/** Lleva un pedido hasta "Pedido confirmado". */
async function confirmed() {
  const o = await newOrder();
  await changeStatus(o.id, "QUOTE_SENT", {}, actor);
  await registerSupplierConfirmation(o.id, { confirmedAt: new Date("2026-10-26T15:00:00-03:00"), note: "Hay 40 negro", confirmedDispatchDate: null }, actor);
  await changeStatus(o.id, "CONFIRMED", {}, actor);
  return o;
}

describe("alta de pedidos", () => {
  it("crea código único, cliente y copia precio y costo vigentes", async () => {
    const o1 = await newOrder();
    const o2 = await newOrder();
    expect(o1.code).toMatch(/^LB-\d{4}-0001$/);
    expect(o2.code).toMatch(/-0002$/);
    expect(await db.customer.count()).toBe(1); // mismo teléfono = mismo cliente
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o1.id } });
    expect(item).toMatchObject({ agreedPrice: 8_100_000, costSnapshot: 4_500_000, size: "40", color: "negro", brand: "[TEST] Marca" });
    expect(item.costHistoryId).not.toBeNull();
    expect((await db.orderStatusChange.findFirstOrThrow({ where: { orderId: o1.id } })).to).toBe("INQUIRY");
  });

  it("rechaza un talle que no está en la oferta", async () => {
    await expect(newOrder({ size: "45" })).rejects.toThrow(/no figura en la oferta/);
  });
});

describe("confirmación y precio acordado", () => {
  it("no confirma sin verificar la disponibilidad con el proveedor", async () => {
    const o = await newOrder();
    await changeStatus(o.id, "QUOTE_SENT", {}, actor);
    await expect(changeStatus(o.id, "CONFIRMED", {}, actor)).rejects.toMatchObject({ code: "transition_blocked" });
  });

  it("la confirmación del proveedor calcula despacho y llegada estimados (no confirmados)", async () => {
    const o = await newOrder();
    await registerSupplierConfirmation(o.id, { confirmedAt: new Date("2026-10-26T15:00:00-03:00"), note: null, confirmedDispatchDate: null }, actor);
    const r = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.estimatedDispatchDate?.toISOString().slice(0, 10)).toBe("2026-10-27"); // lunes -> martes
    expect(r.estimatedArrivalDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(r.confirmedDispatchDate).toBeNull();
  });

  it("una actualización de precio del catálogo no modifica un pedido confirmado", async () => {
    const o = await confirmed();
    const p = await requestPriceUpdate({ productId, newCostPrice: 6_000_000, consultedAt: new Date(), source: "WHATSAPP_GROUP" }, actor);
    if (p.kind !== "proposal") throw new Error();
    await approveProposal({ proposalId: p.proposalId, salePriceChoice: "suggested" }, actor);
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.costPrice).toBe(6_000_000);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    expect(item).toMatchObject({ agreedPrice: 8_100_000, costSnapshot: 4_500_000 });
  });

  it("no permite cambiar el precio de un pedido aceptado", async () => {
    const o = await confirmed();
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await expect(updateOrderItem(o.id, item.id, { size: "40", color: "negro", quantity: 1, agreedPrice: 1 }, actor)).rejects.toMatchObject({ code: "locked" });
  });
});

describe("pagos", () => {
  it("no registra dos veces el mismo pago ni el mismo número de operación", async () => {
    const o = await newOrder();
    const key = randomUUID();
    await pay(o.id, 3_000_000, { idempotencyKey: key });
    await expect(pay(o.id, 3_000_000, { idempotencyKey: key })).rejects.toMatchObject({ code: "duplicate_payment" });
    await pay(o.id, 1_000_000, { reference: "OP-123" });
    await expect(pay(o.id, 1_000_000, { reference: "OP-123" })).rejects.toMatchObject({ code: "duplicate_payment" });
    expect(await db.payment.count()).toBe(2);
    expect(await db.cashMovement.count({ where: { type: "CUSTOMER_PAYMENT" } })).toBe(2);
  });

  it("no acepta pagos mayores al saldo", async () => {
    const o = await newOrder();
    await expect(pay(o.id, 9_000_000)).rejects.toMatchObject({ code: "overpayment" });
  });
});

describe("circuito completo", () => {
  it("compra, recepción, inspección, cobro, entrega y cierre", async () => {
    const o = await confirmed();
    await registerPurchase(o.id, { amount: 4_600_000, paidAt: new Date(), method: "TRANSFER", note: null }, actor);
    await expect(registerPurchase(o.id, { amount: 4_600_000, paidAt: new Date(), method: "TRANSFER", note: null }, actor)).rejects.toMatchObject({ code: "duplicate_purchase" });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PURCHASED");
    await markReceived(o.id, "2026-10-29", actor);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    expect(item.actualCost).toBe(4_600_000);
    await inspectItem(o.id, item.id, { result: "APPROVED", notes: null }, actor);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("INSPECTED_APPROVED");

    await changeStatus(o.id, "AWAITING_PAYMENT", {}, actor);
    await pay(o.id, 8_100_000);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PAYMENT_CONFIRMED");
    await changeStatus(o.id, "READY_FOR_DELIVERY", {}, actor);

    // No se marca entregado sin método y fecha.
    await expect(changeStatus(o.id, "DELIVERED", {}, actor)).rejects.toMatchObject({ code: "transition_blocked" });
    await setDelivery(o.id, { method: "PICKUP", address: null, scheduledAt: new Date(), deliveredAt: new Date(), markDelivered: true }, actor);
    await changeStatus(o.id, "CLOSED", {}, actor);

    const s = await cashSummary({}, true);
    expect(s).toMatchObject({ collected: 8_100_000, costsPaid: 4_600_000, realProfit: 3_500_000, receivables: 0, committed: 0 });
    const history = await db.orderStatusChange.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.to)).toEqual([
      "INQUIRY", "QUOTE_SENT", "CONFIRMED", "PURCHASED", "RECEIVED_PENDING_INSPECTION", "INSPECTED_APPROVED",
      "AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "READY_FOR_DELIVERY", "DELIVERED", "CLOSED",
    ]);
  });

  it("una inspección rechazada abre una incidencia y bloquea la entrega", async () => {
    const o = await confirmed();
    await registerPurchase(o.id, { amount: 4_500_000, paidAt: new Date(), method: "CASH", note: null }, actor);
    await markReceived(o.id, "2026-10-29", actor);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await expect(inspectItem(o.id, item.id, { result: "REJECTED", notes: null }, actor)).rejects.toThrow(/Describí/);
    await inspectItem(o.id, item.id, { result: "REJECTED", notes: "Llegó talle 41" }, actor);
    const r = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { incidents: true } });
    expect(r.status).toBe("INCIDENT");
    expect(r.statusBeforeIncident).toBe("RECEIVED_PENDING_INSPECTION");
    expect(r.incidents[0].description).toMatch(/talle 41/);
    // Capital comprometido: se pagó al proveedor y no se cobró nada.
    expect((await cashSummary({}, true)).committed).toBe(4_500_000);
  });

  it("no cierra con saldo pendiente salvo excepción autorizada", async () => {
    const o = await confirmed();
    await registerPurchase(o.id, { amount: 4_500_000, paidAt: new Date(), method: "CASH", note: null }, actor);
    await markReceived(o.id, "2026-10-29", actor);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await inspectItem(o.id, item.id, { result: "APPROVED", notes: null }, actor);
    await pay(o.id, 8_000_000);
    await changeStatus(o.id, "AWAITING_PAYMENT", {}, actor);
    await expect(changeStatus(o.id, "PAYMENT_CONFIRMED", {}, actor)).rejects.toMatchObject({ code: "transition_blocked" });
    // Pago contra entrega: se entrega con saldo pendiente.
    await changeStatus(o.id, "READY_FOR_DELIVERY", {}, actor);
    await setDelivery(o.id, { method: "PICKUP", address: null, scheduledAt: new Date(), deliveredAt: new Date(), markDelivered: true }, actor);
    await expect(changeStatus(o.id, "CLOSED", {}, actor)).rejects.toMatchObject({ code: "transition_blocked" });
    await changeStatus(o.id, "CLOSED", { closeException: "Descuento de $1.000 acordado" }, actor);
    expect(await db.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "CLOSED", closeExceptionBy: actor.email });
  });

  it("las devoluciones no superan lo cobrado y suben el saldo", async () => {
    const o = await newOrder();
    await pay(o.id, 3_000_000);
    await expect(registerRefund(o.id, { amount: 4_000_000, reason: "x", occurredAt: new Date(), method: "CASH" }, actor)).rejects.toThrow(/no puede superar/);
    await registerRefund(o.id, { amount: 1_000_000, reason: "Ajuste", occurredAt: new Date(), method: "CASH" }, actor);
    expect((await cashSummary({}, true)).costsPaid).toBe(1_000_000);
  });

  it("las cancelaciones exigen motivo y quedan en el historial", async () => {
    const o = await newOrder();
    await expect(changeStatus(o.id, "CANCELLED", {}, actor)).rejects.toThrow(/motivo/);
    await changeStatus(o.id, "CANCELLED", { reason: "El cliente desistió" }, actor);
    const r = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { statusChanges: { orderBy: { createdAt: "desc" } } } });
    expect(r).toMatchObject({ status: "CANCELLED", cancelReason: "El cliente desistió" });
    expect(r.statusChanges[0]).toMatchObject({ from: "INQUIRY", to: "CANCELLED", note: "El cliente desistió" });
    await expect(pay(o.id, 1000)).rejects.toMatchObject({ code: "closed" });
  });
});
