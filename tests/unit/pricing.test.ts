import { describe, expect, it } from "vitest";
import {
  analyzeProduct,
  computeCostBase,
  evaluatePrice,
  roundPrice,
  suggestPrice,
  type CostInputs,
  type PricingRules,
} from "@/lib/pricing/engine";

// Caso de referencia (centavos): proveedor 45.000 + transporte 3.000 + embalaje 1.000 = 49.000 fijos.
// Comisión 6 % + impuestos 3 % = 9 % sobre el precio de venta.
const inputs: CostInputs = {
  supplierCost: 4_500_000,
  transportCost: 300_000,
  packagingCost: 100_000,
  deliveryCostAssumed: 0,
  accessoriesCost: 0,
  otherCosts: 0,
  paymentFeePercent: 6,
  paymentFeeFixed: 0,
  taxPercent: 3,
};
const rounding = { step: 100_000, mode: "UP" as const, offset: 0 };
const margin30: PricingRules = { targetMode: "MARGIN_PERCENT", targetValue: 30, minMarginPercent: 25, rounding };

describe("costo total", () => {
  it("suma costos fijos y separa los porcentuales", () => {
    const base = computeCostBase(inputs);
    expect(base.fixed).toBe(4_900_000);
    expect(base.percentOnSale).toBeCloseTo(0.09);
    expect(base.missing).toEqual([]);
  });

  it("informa los datos faltantes en lugar de inventarlos", () => {
    const base = computeCostBase({ ...inputs, packagingCost: null, taxPercent: null });
    expect(base.missing).toEqual(["packagingCost", "taxPercent"]);
    expect(base.fixed).toBe(4_800_000);
  });
});

describe("ganancia, margen y recargo", () => {
  it("calcula según las fórmulas de referencia", () => {
    // precio 81.000: variable 9 % = 7.290; costo total 56.290; ganancia 24.710
    const ev = evaluatePrice(computeCostBase(inputs), 8_100_000);
    expect(ev.totalCost).toBe(5_629_000);
    expect(ev.profit).toBe(2_471_000);
    expect(ev.marginPercent).toBeCloseTo((2_471_000 / 8_100_000) * 100, 6); // 30,51 %
    expect(ev.markupPercent).toBeCloseTo((2_471_000 / 5_629_000) * 100, 6); // 43,90 %
  });

  it("no divide entre cero", () => {
    const zero = computeCostBase({ ...inputs, supplierCost: 0, transportCost: 0, packagingCost: 0, paymentFeePercent: 0, taxPercent: 0 });
    expect(evaluatePrice(zero, 0).marginPercent).toBeNull();
    expect(evaluatePrice(zero, 1000).markupPercent).toBeNull();
  });
});

describe("precio sugerido", () => {
  it("margen objetivo considerando comisiones: P = C / (1 − p − m)", () => {
    const r = suggestPrice(computeCostBase(inputs), margin30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawPrice).toBe(Math.round(4_900_000 / 0.61)); // 80.327,87
    expect(r.suggestedPrice).toBe(8_100_000); // redondeado hacia arriba a $1.000
    expect(r.evaluation.marginPercent!).toBeGreaterThanOrEqual(30);
  });

  it("ganancia fija: P = (C + G) / (1 − p)", () => {
    const r = suggestPrice(computeCostBase(inputs), { ...margin30, targetMode: "FIXED_PROFIT", targetValue: 2_000_000 });
    expect(r.ok && r.suggestedPrice).toBe(7_600_000);
    expect(r.ok && r.evaluation.profit).toBeGreaterThanOrEqual(2_000_000);
  });

  it("recargo sobre costo total", () => {
    const r = suggestPrice(computeCostBase(inputs), {
      ...margin30,
      targetMode: "MARKUP_PERCENT",
      targetValue: 40,
      rounding: { step: 0, mode: "UP", offset: 0 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evaluation.markupPercent!).toBeCloseTo(40, 2);
  });

  it("rechaza objetivos imposibles en lugar de dividir entre cero", () => {
    const r = suggestPrice(computeCostBase({ ...inputs, paymentFeePercent: 61, taxPercent: 9 }), margin30);
    expect(r.ok).toBe(false);
  });

  it("exige objetivo configurado", () => {
    const r = suggestPrice(computeCostBase(inputs), { ...margin30, targetValue: null });
    expect(r.ok).toBe(false);
  });
});

describe("redondeo", () => {
  it("hacia arriba, al más cercano y hacia abajo", () => {
    expect(roundPrice(4_325_000, { step: 100_000, mode: "UP", offset: 0 })).toBe(4_400_000);
    expect(roundPrice(4_325_000, { step: 100_000, mode: "NEAREST", offset: 0 })).toBe(4_300_000);
    expect(roundPrice(4_399_999, { step: 100_000, mode: "DOWN", offset: 0 })).toBe(4_300_000);
    expect(roundPrice(4_400_000, { step: 100_000, mode: "UP", offset: 0 })).toBe(4_400_000);
  });

  it("con terminación (ej. precios en ...900)", () => {
    const rule = { step: 100_000, mode: "UP" as const, offset: -10_000 };
    expect(roundPrice(4_325_000, rule)).toBe(4_390_000);
    expect(roundPrice(4_395_000, rule)).toBe(4_490_000);
  });
});

describe("análisis para el panel", () => {
  it("sin costo del proveedor no calcula", () => {
    const a = analyzeProduct({ ...inputs, supplierCost: null }, margin30, 8_000_000);
    expect(a.canCompute).toBe(false);
    expect(a.published).toBeNull();
    expect(a.errors[0]).toMatch(/costo del proveedor/);
  });

  it("detecta precio publicado bajo el margen mínimo", () => {
    const a = analyzeProduct(inputs, margin30, 6_500_000);
    expect(a.publishedBelowMinMargin).toBe(true);
    expect(a.warnings.join(" ")).toMatch(/margen menor al mínimo/);
  });

  it("detecta pérdidas", () => {
    const a = analyzeProduct(inputs, margin30, 5_000_000);
    expect(a.published!.profit).toBeLessThan(0);
    expect(a.warnings.join(" ")).toMatch(/pérdida/);
  });

  it("advierte cálculo parcial cuando faltan costos opcionales", () => {
    const a = analyzeProduct({ ...inputs, transportCost: null }, margin30, null);
    expect(a.canCompute).toBe(true);
    expect(a.warnings.join(" ")).toMatch(/transporte/);
  });
});
