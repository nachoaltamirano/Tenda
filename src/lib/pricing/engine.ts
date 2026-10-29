// Motor de precios de LOBBY. Funciones puras: no acceden a la base de datos.
// Todos los importes en centavos; los porcentajes como número (6.5 = 6,5 %).
//
// Modelo de costos:
//   costo fijo (C)  = proveedor + transporte + embalaje + envío asumido + accesorios + otros + comisión fija
//   costo variable  = (comisión % + impuestos %) × precio de venta
//   costo total(P)  = C + p·P            con p = (comisión % + impuestos %) / 100
//   ganancia(P)     = P − costo total(P)
//   margen          = ganancia / P × 100
//   recargo         = ganancia / costo total × 100

const EPS = 1e-9;

export type CostInputs = {
  supplierCost: number | null;
  transportCost: number | null;
  packagingCost: number | null;
  deliveryCostAssumed: number | null;
  accessoriesCost: number | null;
  otherCosts: number | null;
  paymentFeePercent: number | null;
  paymentFeeFixed: number | null;
  taxPercent: number | null;
};

export type TargetMode = "FIXED_PROFIT" | "MARGIN_PERCENT" | "MARKUP_PERCENT";
export type RoundingMode = "UP" | "NEAREST" | "DOWN";

export type RoundingRule = { step: number; mode: RoundingMode; offset: number };

export type PricingRules = {
  targetMode: TargetMode;
  /** centavos si FIXED_PROFIT; porcentaje en los otros modos */
  targetValue: number | null;
  minMarginPercent: number | null;
  rounding: RoundingRule;
};

export const COST_LABELS: Record<keyof CostInputs, string> = {
  supplierCost: "Costo del proveedor",
  transportCost: "Transporte desde el proveedor",
  packagingCost: "Embalaje",
  deliveryCostAssumed: "Envío al cliente asumido por LOBBY",
  accessoriesCost: "Accesorios y personalización",
  otherCosts: "Otros costos",
  paymentFeePercent: "Comisión de cobro (%)",
  paymentFeeFixed: "Comisión de cobro fija",
  taxPercent: "Impuestos (%)",
};

export type CostBase = {
  fixed: number;
  percentOnSale: number; // fracción 0..1
  /** Componentes sin dato: se calculan como 0 y se informan al administrador. */
  missing: (keyof CostInputs)[];
  breakdown: { key: keyof CostInputs; label: string; value: number | null }[];
};

export function computeCostBase(inputs: CostInputs): CostBase {
  const missing: (keyof CostInputs)[] = [];
  const breakdown = (Object.keys(COST_LABELS) as (keyof CostInputs)[]).map((key) => {
    const value = inputs[key];
    if (value === null || value === undefined) missing.push(key);
    return { key, label: COST_LABELS[key], value: value ?? null };
  });
  const v = (n: number | null) => n ?? 0;
  const fixed =
    v(inputs.supplierCost) +
    v(inputs.transportCost) +
    v(inputs.packagingCost) +
    v(inputs.deliveryCostAssumed) +
    v(inputs.accessoriesCost) +
    v(inputs.otherCosts) +
    v(inputs.paymentFeeFixed);
  const percentOnSale = (v(inputs.paymentFeePercent) + v(inputs.taxPercent)) / 100;
  return { fixed, percentOnSale, missing, breakdown };
}

export type PriceEvaluation = {
  salePrice: number;
  totalCost: number;
  variableCost: number;
  profit: number;
  marginPercent: number | null;
  markupPercent: number | null;
};

export function evaluatePrice(base: CostBase, salePrice: number): PriceEvaluation {
  const variableCost = Math.round(base.percentOnSale * salePrice);
  const totalCost = base.fixed + variableCost;
  const profit = salePrice - totalCost;
  return {
    salePrice,
    totalCost,
    variableCost,
    profit,
    marginPercent: salePrice > 0 ? (profit / salePrice) * 100 : null,
    markupPercent: totalCost > 0 ? (profit / totalCost) * 100 : null,
  };
}

/** Redondea un precio: ceil/round/floor((precio − offset) / paso) × paso + offset. */
export function roundPrice(price: number, rule: RoundingRule): number {
  if (!rule.step || rule.step <= 0) return Math.round(price);
  const q = (price - rule.offset) / rule.step;
  const fn = rule.mode === "UP" ? Math.ceil : rule.mode === "DOWN" ? Math.floor : Math.round;
  // Tolerancia para evitar que 4500000.0000001 suba un escalón por error de coma flotante.
  const qq = Math.abs(q - Math.round(q)) < 1e-9 ? Math.round(q) : q;
  return fn(qq) * rule.step + rule.offset;
}

export type SuggestionResult =
  | { ok: true; rawPrice: number; suggestedPrice: number; evaluation: PriceEvaluation }
  | { ok: false; error: string };

/** Precio mínimo que cumple el objetivo, considerando comisiones porcentuales. */
export function suggestPrice(base: CostBase, rules: PricingRules): SuggestionResult {
  if (rules.targetValue === null || rules.targetValue === undefined) {
    return { ok: false, error: "Falta configurar la ganancia o el margen objetivo." };
  }
  const p = base.percentOnSale;
  const C = base.fixed;
  let raw: number;
  if (rules.targetMode === "FIXED_PROFIT") {
    const denom = 1 - p;
    if (denom <= EPS) return { ok: false, error: "Las comisiones e impuestos suman 100 % o más del precio." };
    raw = (C + rules.targetValue) / denom;
  } else if (rules.targetMode === "MARGIN_PERCENT") {
    const m = rules.targetValue / 100;
    const denom = 1 - p - m;
    if (denom <= EPS) {
      return { ok: false, error: "Comisiones, impuestos y margen objetivo suman 100 % o más: no existe un precio posible." };
    }
    raw = C / denom;
  } else {
    const k = rules.targetValue / 100;
    const denom = 1 - p * (1 + k);
    if (denom <= EPS) return { ok: false, error: "Con ese recargo y esas comisiones no existe un precio posible." };
    raw = (C * (1 + k)) / denom;
  }
  if (!Number.isFinite(raw) || raw <= 0) return { ok: false, error: "No se pudo calcular un precio con los datos cargados." };
  const suggestedPrice = roundPrice(raw, rules.rounding);
  return { ok: true, rawPrice: Math.round(raw), suggestedPrice, evaluation: evaluatePrice(base, suggestedPrice) };
}

export type ProductAnalysis = {
  canCompute: boolean;
  errors: string[];
  warnings: string[];
  missing: { key: keyof CostInputs; label: string }[];
  base: CostBase;
  productCost: number | null;
  suggestion: SuggestionResult | null;
  published: PriceEvaluation | null;
  publishedBelowMinMargin: boolean;
  suggestedBelowMinMargin: boolean;
};

export function isBelowMinMargin(ev: PriceEvaluation | null, rules: PricingRules): boolean {
  if (!ev || rules.minMarginPercent === null || rules.minMarginPercent === undefined) return false;
  if (ev.marginPercent === null) return true;
  return ev.marginPercent < rules.minMarginPercent;
}

/** Análisis completo para el panel: costo, costo total, sugerido, publicado, ganancia, margen y recargo. */
export function analyzeProduct(inputs: CostInputs, rules: PricingRules, publishedPrice: number | null): ProductAnalysis {
  const base = computeCostBase(inputs);
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing = base.missing.map((key) => ({ key, label: COST_LABELS[key] }));

  if (inputs.supplierCost === null || inputs.supplierCost === undefined) {
    errors.push("Falta el costo del proveedor: no se puede calcular el precio.");
  }
  const optionalMissing = missing.filter((m) => m.key !== "supplierCost");
  if (optionalMissing.length > 0) {
    warnings.push(`Cálculo parcial: sin dato para ${optionalMissing.map((m) => m.label.toLowerCase()).join(", ")} (se toman como 0).`);
  }
  if (rules.minMarginPercent === null || rules.minMarginPercent === undefined) {
    warnings.push("No hay margen mínimo configurado.");
  }

  const canCompute = errors.length === 0;
  const suggestion = canCompute ? suggestPrice(base, rules) : null;
  if (suggestion && !suggestion.ok) errors.push(suggestion.error);

  const published = canCompute && publishedPrice !== null && publishedPrice > 0 ? evaluatePrice(base, publishedPrice) : null;
  const publishedBelowMinMargin = isBelowMinMargin(published, rules);
  const suggestedBelowMinMargin = suggestion?.ok ? isBelowMinMargin(suggestion.evaluation, rules) : false;
  if (publishedBelowMinMargin) warnings.push("El precio publicado deja un margen menor al mínimo configurado.");
  if (published && published.profit < 0) warnings.push("El precio publicado genera pérdida.");
  if (suggestedBelowMinMargin) warnings.push("El redondeo deja el precio sugerido por debajo del margen mínimo.");

  return {
    canCompute,
    errors,
    warnings,
    missing,
    base,
    productCost: inputs.supplierCost,
    suggestion,
    published,
    publishedBelowMinMargin,
    suggestedBelowMinMargin,
  };
}
