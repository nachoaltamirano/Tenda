import { describe, expect, it } from "vitest";
import { estimateDispatch, isDelayed, nextDispatchDate } from "@/lib/orders/dispatch";
import { isLocked, nextStatuses, orderTotals, transitionErrors, type OrderSnapshot } from "@/lib/orders/status";

const base: OrderSnapshot = {
  status: "QUOTE_SENT",
  statusBeforeIncident: null,
  supplierConfirmedAt: null,
  items: [{ size: "40", color: "negro", agreedPrice: 8_000_000, quantity: 1, inspection: "PENDING" }],
  total: 8_000_000,
  paid: 0,
  deliveryMethod: null,
  deliveredAt: null,
  closeExceptionReason: null,
};

describe("flujo de pedidos", () => {
  it("no confirma sin verificar disponibilidad con el proveedor", () => {
    expect(transitionErrors(base, "CONFIRMED")).toContain("Falta registrar la confirmación de disponibilidad del proveedor.");
    expect(transitionErrors({ ...base, supplierConfirmedAt: new Date() }, "CONFIRMED")).toEqual([]);
  });

  it("no confirma sin talle y color elegidos", () => {
    const o = { ...base, supplierConfirmedAt: new Date(), items: [{ ...base.items[0], size: null, color: null }] };
    expect(transitionErrors(o, "CONFIRMED")).toHaveLength(2);
  });

  it("no permite saltear etapas", () => {
    expect(transitionErrors({ ...base, status: "CONFIRMED" }, "DELIVERED")[0]).toMatch(/No se puede pasar/);
    expect(nextStatuses({ status: "CLOSED", statusBeforeIncident: null })).toEqual([]);
  });

  it("no aprueba la inspección si algún par no está aprobado", () => {
    const o = { ...base, status: "RECEIVED_PENDING_INSPECTION" as const };
    expect(transitionErrors(o, "INSPECTED_APPROVED")).toHaveLength(1);
    expect(transitionErrors({ ...o, items: [{ ...o.items[0], inspection: "APPROVED" as const }] }, "INSPECTED_APPROVED")).toEqual([]);
  });

  it("no entrega sin inspección aprobada, método y fecha", () => {
    const o = { ...base, status: "READY_FOR_DELIVERY" as const, paid: 8_000_000 };
    expect(transitionErrors(o, "DELIVERED")).toEqual([
      "No se puede entregar sin la inspección aprobada.",
      "Falta registrar el método de entrega.",
      "Falta registrar la fecha de entrega.",
    ]);
    const ok = { ...o, items: [{ ...o.items[0], inspection: "APPROVED" as const }], deliveryMethod: "PICKUP", deliveredAt: new Date() };
    expect(transitionErrors(ok, "DELIVERED")).toEqual([]);
  });

  it("no confirma el pago ni cierra con saldo pendiente salvo excepción", () => {
    expect(transitionErrors({ ...base, status: "AWAITING_PAYMENT", paid: 5_000_000 }, "PAYMENT_CONFIRMED")[0]).toMatch(/saldo pendiente/);
    const delivered = { ...base, status: "DELIVERED" as const, paid: 7_000_000 };
    expect(transitionErrors(delivered, "CLOSED")[0]).toMatch(/excepción/);
    expect(transitionErrors({ ...delivered, closeExceptionReason: "Descuento acordado" }, "CLOSED")).toEqual([]);
  });

  it("pago contra entrega: se prepara la entrega con saldo, pero no se confirma el pago", () => {
    const o = { ...base, status: "AWAITING_PAYMENT" as const };
    expect(transitionErrors(o, "READY_FOR_DELIVERY")).toEqual([]);
    expect(transitionErrors(o, "PAYMENT_CONFIRMED")).toHaveLength(1);
  });

  it("cancelar e incidencia exigen motivo; desde incidencia se vuelve al estado anterior", () => {
    expect(transitionErrors(base, "CANCELLED")).toEqual(["Indicá el motivo."]);
    expect(transitionErrors(base, "CANCELLED", { reason: "El cliente desistió" })).toEqual([]);
    expect(nextStatuses({ status: "INCIDENT", statusBeforeIncident: "IN_TRANSIT" })).toEqual(["IN_TRANSIT", "CANCELLED", "RETURNED"]);
  });

  it("el precio queda fijo desde la confirmación", () => {
    expect(isLocked("QUOTE_SENT")).toBe(false);
    expect(isLocked("CONFIRMED")).toBe(true);
    expect(isLocked("INCIDENT")).toBe(true);
  });

  it("totales, saldo y resultado", () => {
    const t = orderTotals([{ agreedPrice: 8_000_000, quantity: 1, costSnapshot: 4_500_000, actualCost: 4_600_000 }], 3_000_000, 200_000);
    expect(t).toMatchObject({ total: 8_000_000, balance: 5_000_000, productCost: 4_600_000, profit: 3_200_000, costKnown: true });
  });
});

describe("calendario de despacho", () => {
  const days = [2, 4, 5]; // martes, jueves, viernes
  it("próximo día habitual, incluido el mismo día", () => {
    expect(nextDispatchDate("2026-10-26", days)).toBe("2026-10-27"); // lunes -> martes
    expect(nextDispatchDate("2026-10-27", days)).toBe("2026-10-27"); // martes -> mismo día
    expect(nextDispatchDate("2026-10-31", days)).toBe("2026-11-03"); // sábado -> martes
  });
  it("saltea feriados", () => {
    expect(nextDispatchDate("2026-10-27", days, ["2026-10-27"])).toBe("2026-10-29");
  });
  it("estimado vs. confirmado", () => {
    const e = estimateDispatch({ from: "2026-10-26", weekdays: days, holidays: [], maxDays: 5 });
    expect(e).toMatchObject({ dispatch: "2026-10-27", arrivalLatest: "2026-11-01" });
    expect(e.basis).toMatch(/Sin confirmación/);
    const c = estimateDispatch({ from: "2026-10-26", weekdays: days, holidays: [], maxDays: 5, confirmedDispatch: "2026-10-30" });
    expect(c).toMatchObject({ dispatch: "2026-10-30", arrivalLatest: "2026-11-04" });
    expect(estimateDispatch({ from: "2026-10-26", weekdays: [], holidays: [], maxDays: 5 }).dispatch).toBeNull();
  });
  it("demoras", () => {
    expect(isDelayed({ estimatedArrivalDate: "2026-10-28", actualArrivalDate: null }, "2026-10-29")).toBe(true);
    expect(isDelayed({ estimatedArrivalDate: "2026-10-28", actualArrivalDate: "2026-10-28" }, "2026-10-29")).toBe(false);
  });
});
