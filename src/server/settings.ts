import type { DispatchSettings, PricingSettings } from "@prisma/client";
import type { CostInputs, PricingRules } from "@/lib/pricing/engine";
import type { z } from "zod";
import { dispatchSettingsInput, pricingSettingsInput } from "@/lib/validation/catalog";
import { audit, diff } from "./audit";
import { db, type Tx } from "./db";

export async function getPricingSettings(tx: Tx = db): Promise<PricingSettings> {
  return (await tx.pricingSettings.findUnique({ where: { id: 1 } })) ?? tx.pricingSettings.create({ data: { id: 1 } });
}

export async function getDispatchSettings(tx: Tx = db): Promise<DispatchSettings> {
  return (await tx.dispatchSettings.findUnique({ where: { id: 1 } })) ?? tx.dispatchSettings.create({ data: { id: 1 } });
}

export function rulesFromSettings(s: PricingSettings): PricingRules {
  return {
    targetMode: s.targetMode,
    targetValue: s.targetValue,
    minMarginPercent: s.minMarginPercent,
    rounding: { step: s.roundingStep, mode: s.roundingMode, offset: s.roundingOffset },
  };
}

type ProductCosts = {
  costPrice: number | null;
  transportCost: number | null;
  otherCosts: number | null;
  accessoriesCost: number | null;
};

/** Combina los costos del producto con los costos generales configurados. */
export function costInputsFor(p: ProductCosts, s: PricingSettings, overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    supplierCost: p.costPrice,
    transportCost: p.transportCost ?? s.defaultTransportCost,
    packagingCost: s.packagingCost,
    deliveryCostAssumed: s.deliveryCostAssumed,
    // Accesorios y otros: sin dato en el producto se asume que no aplica (0), no que falta.
    accessoriesCost: p.accessoriesCost ?? 0,
    otherCosts: p.otherCosts ?? 0,
    paymentFeePercent: s.paymentFeePercent,
    paymentFeeFixed: s.paymentFeeFixed,
    taxPercent: s.taxPercent,
    ...overrides,
  };
}


export async function savePricingSettings(raw: z.input<typeof pricingSettingsInput>, actor: { email: string }) {
  const input = pricingSettingsInput.parse(raw);
  if (input.targetMode === "FIXED_PROFIT" && input.targetValue !== null && !Number.isInteger(input.targetValue)) {
    input.targetValue = Math.round(input.targetValue);
  }
  return db.$transaction(async (tx) => {
    const before = await getPricingSettings(tx);
    const after = await tx.pricingSettings.update({ where: { id: 1 }, data: { ...input, configured: true } });
    await audit(tx, {
      entityType: "PricingSettings",
      entityId: "1",
      action: "update",
      changes: diff(before as unknown as Record<string, unknown>, input),
      userEmail: actor.email,
    });
    return after;
  });
}

export async function saveDispatchSettings(raw: z.input<typeof dispatchSettingsInput>, actor: { email: string }) {
  const input = dispatchSettingsInput.parse(raw);
  input.weekdays = [...new Set(input.weekdays)].sort();
  return db.$transaction(async (tx) => {
    const before = await getDispatchSettings(tx);
    const after = await tx.dispatchSettings.update({ where: { id: 1 }, data: input });
    await audit(tx, {
      entityType: "DispatchSettings",
      entityId: "1",
      action: "update",
      changes: diff(before as unknown as Record<string, unknown>, input),
      userEmail: actor.email,
    });
    return after;
  });
}
