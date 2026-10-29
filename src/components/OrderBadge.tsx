import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

const TONE: Partial<Record<OrderStatus, string>> = {
  INQUIRY: "warn",
  VERIFYING_PRODUCT: "warn",
  AWAITING_SUPPLIER: "warn",
  QUOTE_SENT: "info",
  AWAITING_CUSTOMER: "info",
  CONFIRMED: "ok",
  PURCHASE_PENDING: "warn",
  PURCHASED: "info",
  IN_TRANSIT: "info",
  RECEIVED_PENDING_INSPECTION: "warn",
  INSPECTED_APPROVED: "ok",
  AWAITING_PAYMENT: "warn",
  PAYMENT_CONFIRMED: "ok",
  READY_FOR_DELIVERY: "ok",
  DELIVERED: "ok",
  INCIDENT: "bad",
  CANCELLED: "muted",
  RETURNED: "muted",
  CLOSED: "muted",
};

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge badge-${TONE[status] ?? "muted"}`}>{STATUS_LABELS[status]}</span>;
}
