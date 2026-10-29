import type { CashMovementType, PaymentMethod, Prisma } from "@prisma/client";
import { isDelayed } from "@/lib/orders/dispatch";
import { STATUS_GROUPS, TERMINAL, type OrderStatus } from "@/lib/orders/status";
import { INCOME_TYPES } from "@/lib/validation/catalog";
import { audit } from "../audit";
import { db } from "../db";
import { BusinessError } from "../errors";
import type { Actor } from "../catalog/products";
import { totalsOf } from "./orders";

const MANUAL_TYPES: CashMovementType[] = ["OTHER_INCOME", "OPERATING_EXPENSE"];

/** Movimientos que no dependen de un pedido: otros ingresos y gastos operativos. */
export async function addManualMovement(
  input: { type: CashMovementType; amount: number; occurredAt: Date; description: string; method: PaymentMethod | null },
  actor: Actor,
) {
  if (!MANUAL_TYPES.includes(input.type)) {
    throw new BusinessError("Los cobros, compras, gastos de pedido y devoluciones se registran desde el pedido.");
  }
  if (input.amount <= 0 || !input.description) throw new BusinessError("Indicá importe y concepto.");
  const m = await db.cashMovement.create({ data: { ...input, createdBy: actor.email } });
  await audit(db, { entityType: "CashMovement", entityId: m.id, action: "create", changes: { ...input, occurredAt: input.occurredAt.toISOString() }, userEmail: actor.email });
  return m;
}

const isIncome = (t: CashMovementType) => (INCOME_TYPES as readonly string[]).includes(t);

export async function cashSummary(range: { from?: Date; to?: Date } = {}, includeTest = false) {
  const where: Prisma.CashMovementWhereInput = { occurredAt: { gte: range.from, lte: range.to } };
  if (!includeTest) where.isTestData = false;
  const movements = await db.cashMovement.findMany({ where, orderBy: { occurredAt: "desc" }, include: { order: { select: { id: true, code: true } } } });
  const sum = (types: CashMovementType[]) => movements.filter((m) => types.includes(m.type)).reduce((s, m) => s + m.amount, 0);
  const collected = sum(["CUSTOMER_PAYMENT", "OTHER_INCOME"]);
  const costsPaid = sum(["SUPPLIER_PAYMENT", "ORDER_EXPENSE", "OPERATING_EXPENSE", "REFUND"]);

  // Saldos y capital de pedidos (no depende del período).
  const orders = await db.order.findMany({
    where: { status: { notIn: ["CANCELLED"] }, ...(includeTest ? {} : { isTestData: false }) },
    include: { items: true, payments: true, cashMovements: true },
  });
  let receivables = 0;
  let committed = 0;
  let realProfit = 0;
  for (const o of orders) {
    const t = totalsOf(o);
    const supplierPaid = o.cashMovements.filter((m) => m.type === "SUPPLIER_PAYMENT").reduce((s, m) => s + m.amount, 0);
    const finished = (["DELIVERED", "CLOSED", "RETURNED"] as OrderStatus[]).includes(o.status);
    if (!TERMINAL.includes(o.status) && t.balance > 0 && !(STATUS_GROUPS.inquiries as OrderStatus[]).includes(o.status)) receivables += t.balance;
    // Capital comprometido: lo que LOBBY puso (compra + gastos) y todavía no recuperó con cobros.
    if (!finished) committed += Math.max(0, supplierPaid + t.expenses - t.paid);
    // Ganancia real: solo pedidos entregados o cerrados, con lo efectivamente cobrado y pagado.
    if (finished) realProfit += t.paid - supplierPaid - t.expenses;
  }
  const operating = sum(["OPERATING_EXPENSE"]);
  return {
    movements: movements.map((m) => ({ ...m, income: isIncome(m.type) })),
    collected,
    costsPaid,
    net: collected - costsPaid,
    receivables,
    committed,
    realProfit,
    realProfitAfterOperating: realProfit - operating,
    operating,
  };
}

export type Alert = { kind: string; orderId: string; code: string; message: string };

/** Alertas: pedidos demorados, pagos pendientes, entregas sin coordinar, cotizaciones con costo cambiado, incidencias. */
export async function orderAlerts(today = new Date()): Promise<Alert[]> {
  const todayStr = today.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const orders = await db.order.findMany({
    where: { status: { notIn: TERMINAL }, isTestData: false },
    include: { items: { include: { product: { select: { costPrice: true } } } }, payments: true, cashMovements: true, incidents: { where: { resolvedAt: null } } },
  });
  const alerts: Alert[] = [];
  for (const o of orders) {
    const t = totalsOf(o);
    const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
    if (["PURCHASED", "IN_TRANSIT", "CONFIRMED", "PURCHASE_PENDING"].includes(o.status) && isDelayed({ estimatedArrivalDate: d(o.estimatedArrivalDate), actualArrivalDate: d(o.actualArrivalDate) }, todayStr)) {
      alerts.push({ kind: "delayed", orderId: o.id, code: o.code, message: `Demorado: la llegada estimada era el ${d(o.estimatedArrivalDate)}.` });
    }
    if ((["INSPECTED_APPROVED", "AWAITING_PAYMENT", "READY_FOR_DELIVERY", "DELIVERED"] as OrderStatus[]).includes(o.status) && t.balance > 0) {
      alerts.push({ kind: "payment", orderId: o.id, code: o.code, message: `Cliente con saldo pendiente: $ ${(t.balance / 100).toLocaleString("es-AR")}.` });
    }
    if ((["PAYMENT_CONFIRMED", "READY_FOR_DELIVERY"] as OrderStatus[]).includes(o.status) && (!o.deliveryMethod || !o.deliveryScheduledAt)) {
      alerts.push({ kind: "delivery", orderId: o.id, code: o.code, message: "Entrega sin coordinar (falta método o fecha)." });
    }
    if ((STATUS_GROUPS.inquiries as OrderStatus[]).includes(o.status)) {
      for (const i of o.items) {
        if (i.product && i.costSnapshot !== null && i.product.costPrice !== null && i.product.costPrice !== i.costSnapshot) {
          alerts.push({ kind: "price", orderId: o.id, code: o.code, message: `Cambió el costo de ${i.brand} ${i.model} desde la cotización: revisar el precio antes de confirmar.` });
        }
      }
    }
    for (const inc of o.incidents) {
      alerts.push({ kind: inc.type === "MISSING" ? "missing" : "incident", orderId: o.id, code: o.code, message: `Incidencia abierta: ${inc.description}` });
    }
  }
  return alerts;
}
