// Flujo de pedidos: transiciones permitidas y validaciones. Lógica pura.

export const ORDER_STATUSES = [
  "INQUIRY",
  "VERIFYING_PRODUCT",
  "AWAITING_SUPPLIER",
  "QUOTE_SENT",
  "AWAITING_CUSTOMER",
  "CONFIRMED",
  "PURCHASE_PENDING",
  "PURCHASED",
  "IN_TRANSIT",
  "RECEIVED_PENDING_INSPECTION",
  "INSPECTED_APPROVED",
  "AWAITING_PAYMENT",
  "PAYMENT_CONFIRMED",
  "READY_FOR_DELIVERY",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
  "RETURNED",
  "INCIDENT",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  INQUIRY: "Consulta recibida",
  VERIFYING_PRODUCT: "Verificando producto",
  AWAITING_SUPPLIER: "Esperando confirmación del proveedor",
  QUOTE_SENT: "Cotización enviada",
  AWAITING_CUSTOMER: "Esperando confirmación del cliente",
  CONFIRMED: "Pedido confirmado",
  PURCHASE_PENDING: "Compra pendiente",
  PURCHASED: "Comprado al proveedor",
  IN_TRANSIT: "En tránsito",
  RECEIVED_PENDING_INSPECTION: "Recibido: pendiente de inspección",
  INSPECTED_APPROVED: "Inspeccionado y aprobado",
  AWAITING_PAYMENT: "Esperando pago",
  PAYMENT_CONFIRMED: "Pago confirmado",
  READY_FOR_DELIVERY: "Preparado para entrega",
  DELIVERED: "Enviado o entregado",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
  RETURNED: "Devuelto",
  INCIDENT: "Con incidencia",
};

/** Grupos para el tablero y los filtros. */
export const STATUS_GROUPS = {
  inquiries: ["INQUIRY", "VERIFYING_PRODUCT", "AWAITING_SUPPLIER", "QUOTE_SENT", "AWAITING_CUSTOMER"],
  confirmed: ["CONFIRMED", "PURCHASE_PENDING"],
  inTransit: ["PURCHASED", "IN_TRANSIT"],
  received: ["RECEIVED_PENDING_INSPECTION", "INSPECTED_APPROVED", "AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "READY_FOR_DELIVERY"],
  delivered: ["DELIVERED"],
  finished: ["CLOSED", "CANCELLED", "RETURNED"],
  incident: ["INCIDENT"],
} satisfies Record<string, OrderStatus[]>;

export const TERMINAL: OrderStatus[] = ["CLOSED", "CANCELLED", "RETURNED"];

/** Desde el pedido confirmado, precio y producto quedan fijos. */
export const LOCKED_FROM: OrderStatus = "CONFIRMED";
export function isLocked(status: OrderStatus): boolean {
  // Cancelado, devuelto e incidencia están al final de la lista: también quedan fijos.
  return ORDER_STATUSES.indexOf(status) >= ORDER_STATUSES.indexOf(LOCKED_FROM);
}

const FORWARD: Partial<Record<OrderStatus, OrderStatus[]>> = {
  INQUIRY: ["VERIFYING_PRODUCT", "AWAITING_SUPPLIER", "QUOTE_SENT"],
  VERIFYING_PRODUCT: ["AWAITING_SUPPLIER", "QUOTE_SENT"],
  AWAITING_SUPPLIER: ["QUOTE_SENT"],
  QUOTE_SENT: ["AWAITING_CUSTOMER", "CONFIRMED"],
  AWAITING_CUSTOMER: ["CONFIRMED"],
  CONFIRMED: ["PURCHASE_PENDING", "PURCHASED"],
  PURCHASE_PENDING: ["PURCHASED"],
  PURCHASED: ["IN_TRANSIT", "RECEIVED_PENDING_INSPECTION"],
  IN_TRANSIT: ["RECEIVED_PENDING_INSPECTION"],
  RECEIVED_PENDING_INSPECTION: ["INSPECTED_APPROVED"],
  INSPECTED_APPROVED: ["AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "READY_FOR_DELIVERY"],
  // Pago contra entrega: se puede preparar la entrega con saldo pendiente (queda la alerta y el cierre lo exige).
  AWAITING_PAYMENT: ["PAYMENT_CONFIRMED", "READY_FOR_DELIVERY"],
  PAYMENT_CONFIRMED: ["READY_FOR_DELIVERY"],
  READY_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["CLOSED", "RETURNED"],
  RETURNED: ["CLOSED"],
};

export type OrderSnapshot = {
  status: OrderStatus;
  statusBeforeIncident: OrderStatus | null;
  supplierConfirmedAt: Date | null;
  items: { size: string | null; color: string | null; agreedPrice: number; quantity: number; inspection: "PENDING" | "APPROVED" | "REJECTED" }[];
  total: number;
  paid: number;
  deliveryMethod: string | null;
  deliveredAt: Date | null;
  closeExceptionReason: string | null;
};

export type TransitionContext = { reason?: string | null };

/** Estados a los que se puede pasar desde el actual (sin evaluar las validaciones). */
export function nextStatuses(o: Pick<OrderSnapshot, "status" | "statusBeforeIncident">): OrderStatus[] {
  if (TERMINAL.includes(o.status) && o.status !== "RETURNED") return [];
  if (o.status === "INCIDENT") {
    return [...(o.statusBeforeIncident ? [o.statusBeforeIncident] : []), "CANCELLED", "RETURNED"];
  }
  const out = [...(FORWARD[o.status] ?? [])];
  if (o.status !== "RETURNED") {
    if (o.status !== "DELIVERED") out.push("CANCELLED");
    out.push("INCIDENT");
  }
  return out;
}

/** Devuelve los motivos por los que no se puede pasar al estado indicado (vacío = permitido). */
export function transitionErrors(o: OrderSnapshot, to: OrderStatus, ctx: TransitionContext = {}): string[] {
  const errors: string[] = [];
  if (!nextStatuses(o).includes(to)) {
    return [`No se puede pasar de "${STATUS_LABELS[o.status]}" a "${STATUS_LABELS[to]}".`];
  }
  const balance = o.total - o.paid;
  const itemsOk = o.items.length > 0;

  if (to === "QUOTE_SENT" && (!itemsOk || o.items.some((i) => i.agreedPrice <= 0))) {
    errors.push("Para cotizar, el pedido necesita al menos un producto con precio.");
  }
  if (to === "CONFIRMED") {
    if (!o.supplierConfirmedAt) errors.push("Falta registrar la confirmación de disponibilidad del proveedor.");
    if (!itemsOk) errors.push("El pedido no tiene productos.");
    if (o.items.some((i) => !i.size)) errors.push("Falta el talle de algún producto.");
    if (o.items.some((i) => !i.color)) errors.push("Falta el color de algún producto (el elegido por el cliente).");
    if (o.items.some((i) => i.agreedPrice <= 0)) errors.push("Falta el precio acordado de algún producto.");
  }
  if (to === "INSPECTED_APPROVED" && o.items.some((i) => i.inspection !== "APPROVED")) {
    errors.push("Todos los productos deben tener la inspección aprobada.");
  }
  if (to === "PAYMENT_CONFIRMED" && balance > 0) {
    errors.push(`Hay un saldo pendiente de cobro (${balance / 100}).`);
  }
  if (to === "DELIVERED") {
    if (o.items.some((i) => i.inspection !== "APPROVED")) errors.push("No se puede entregar sin la inspección aprobada.");
    if (!o.deliveryMethod) errors.push("Falta registrar el método de entrega.");
    if (!o.deliveredAt) errors.push("Falta registrar la fecha de entrega.");
  }
  if (to === "CLOSED" && balance > 0 && !o.closeExceptionReason) {
    errors.push("No se puede cerrar con saldo pendiente sin registrar una excepción autorizada.");
  }
  if ((to === "CANCELLED" || to === "INCIDENT" || to === "RETURNED") && !ctx.reason?.trim()) {
    errors.push("Indicá el motivo.");
  }
  return errors;
}

export function orderTotals(items: { agreedPrice: number; quantity: number; costSnapshot: number | null; actualCost: number | null }[], paid: number, expenses: number) {
  const total = items.reduce((s, i) => s + i.agreedPrice * i.quantity, 0);
  const costKnown = items.every((i) => i.actualCost !== null || i.costSnapshot !== null);
  const productCost = items.reduce((s, i) => s + (i.actualCost ?? i.costSnapshot ?? 0) * i.quantity, 0);
  return {
    total,
    paid,
    balance: total - paid,
    productCost,
    expenses,
    /** Resultado estimado: precio acordado − costo (real si ya se compró) − gastos registrados. */
    profit: total - productCost - expenses,
    costKnown,
  };
}
