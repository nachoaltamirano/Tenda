// Actualización de costos/precios con aprobación previa.
// Flujo: nueva consulta -> propuesta (valor anterior vs. nuevo, fechas, impacto)
// -> aprobación o rechazo -> historial. Los pedidos guardan su propia copia
// de precio y costo, por lo que nada de esto modifica operaciones anteriores.

import type { Prisma } from "@prisma/client";
import { formatPercent } from "@/lib/money";
import { analyzeProduct, isBelowMinMargin } from "@/lib/pricing/engine";
import { approveProposalInput, priceUpdateInput, type ApproveProposalInput, type PriceUpdateInput } from "@/lib/validation/catalog";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { BusinessError } from "../errors";
import { costInputsFor, getPricingSettings, rulesFromSettings } from "../settings";
import type { Actor } from "./products";

export type PriceUpdateOutcome =
  | { kind: "confirmed"; productId: string } // mismo costo: solo se renueva la fecha
  | { kind: "proposal"; proposalId: string; belowMinMargin: boolean };

type ImpactSide = {
  costPrice: number | null;
  totalCost: number | null;
  salePrice: number | null;
  profit: number | null;
  marginPercent: number | null;
  markupPercent: number | null;
  suggestedPrice: number | null;
};

export type ProposalImpact = {
  before: ImpactSide;
  /** Con el costo nuevo manteniendo el precio publicado actual. */
  afterKeepingPrice: ImpactSide;
  /** Con el costo nuevo y el precio sugerido por la regla configurada. */
  afterSuggested: ImpactSide;
  minMarginPercent: number | null;
  warnings: string[];
};

export async function requestPriceUpdate(rawInput: PriceUpdateInput, actor: Actor, txArg?: Tx): Promise<PriceUpdateOutcome> {
  const input = priceUpdateInput.parse(rawInput);
  const run = async (tx: Tx): Promise<PriceUpdateOutcome> => {
    const p = await tx.product.findUnique({ where: { id: input.productId } });
    if (!p) throw new BusinessError("El producto no existe.", "not_found");

    if (p.costPrice === input.newCostPrice) {
      // Precio confirmado sin cambios: se registra la consulta y se renueva la fecha.
      await tx.productCostHistory.create({
        data: {
          productId: p.id,
          currency: p.currency,
          costPrice: p.costPrice,
          transportCost: p.transportCost,
          otherCosts: p.otherCosts,
          consultedAt: input.consultedAt,
          source: input.source,
          supplierMessageId: input.supplierMessageId,
          note: input.note ?? "Costo confirmado sin cambios",
          createdBy: actor.email,
        },
      });
      const newer = !p.costUpdatedAt || input.consultedAt > p.costUpdatedAt;
      await tx.product.update({
        where: { id: p.id },
        data: newer ? { costUpdatedAt: input.consultedAt, lastConsultedAt: input.consultedAt } : {},
      });
      await audit(tx, {
        entityType: "Product",
        entityId: p.id,
        action: "cost_confirmed",
        changes: { costPrice: p.costPrice, consultedAt: input.consultedAt.toISOString() },
        userEmail: actor.email,
      });
      return { kind: "confirmed", productId: p.id };
    }

    const settings = await getPricingSettings(tx);
    const rules = rulesFromSettings(settings);
    const side = (costPrice: number | null, salePrice: number | null): ImpactSide => {
      const a = analyzeProduct(costInputsFor({ ...p, costPrice }, settings), rules, salePrice);
      return {
        costPrice,
        totalCost: a.published?.totalCost ?? null,
        salePrice,
        profit: a.published?.profit ?? null,
        marginPercent: a.published?.marginPercent ?? null,
        markupPercent: a.published?.markupPercent ?? null,
        suggestedPrice: a.suggestion?.ok ? a.suggestion.suggestedPrice : null,
      };
    };
    const before = side(p.costPrice, p.salePrice);
    const afterKeepingPrice = side(input.newCostPrice, p.salePrice);
    const suggested = afterKeepingPrice.suggestedPrice;
    const afterSuggested = side(input.newCostPrice, suggested);

    const warnings: string[] = [];
    const belowMin =
      p.salePrice !== null &&
      settings.minMarginPercent !== null &&
      (afterKeepingPrice.marginPercent === null || afterKeepingPrice.marginPercent < settings.minMarginPercent);
    if (belowMin) warnings.push("Con el costo nuevo, el precio publicado queda por debajo del margen mínimo.");
    if (afterKeepingPrice.profit !== null && afterKeepingPrice.profit < 0) warnings.push("Con el costo nuevo, el precio publicado genera pérdida.");
    if (p.costUpdatedAt && input.consultedAt < p.costUpdatedAt) {
      warnings.push("La consulta nueva es más antigua que la del costo vigente.");
    }
    if (suggested === null) warnings.push("No se pudo calcular un precio sugerido (revisar configuración de precios).");

    const impact: ProposalImpact = { before, afterKeepingPrice, afterSuggested, minMarginPercent: settings.minMarginPercent, warnings };

    // Una propuesta nueva reemplaza a las pendientes del mismo producto.
    await tx.priceChangeProposal.updateMany({
      where: { productId: p.id, status: "PENDING" },
      data: { status: "SUPERSEDED", decidedAt: new Date(), decidedBy: actor.email, decisionNote: "Reemplazada por una consulta más reciente" },
    });
    const proposal = await tx.priceChangeProposal.create({
      data: {
        productId: p.id,
        supplierMessageId: input.supplierMessageId,
        source: input.source,
        oldCostPrice: p.costPrice,
        newCostPrice: input.newCostPrice,
        oldConsultedAt: p.costUpdatedAt,
        newConsultedAt: input.consultedAt,
        oldSalePrice: p.salePrice,
        proposedSalePrice: suggested,
        impact: impact as unknown as Prisma.InputJsonValue,
        belowMinMargin: belowMin,
        decisionNote: input.note,
      },
    });
    // La consulta se registra aunque el costo todavía no se aplique.
    const newer = !p.lastConsultedAt || input.consultedAt > p.lastConsultedAt;
    if (newer) await tx.product.update({ where: { id: p.id }, data: { lastConsultedAt: input.consultedAt } });
    await audit(tx, {
      entityType: "Product",
      entityId: p.id,
      action: "price_proposal",
      changes: { costPrice: { from: p.costPrice, to: input.newCostPrice } },
      reason: `Propuesta ${proposal.id} pendiente de aprobación`,
      userEmail: actor.email,
    });
    return { kind: "proposal", proposalId: proposal.id, belowMinMargin: belowMin };
  };
  return txArg ? run(txArg) : db.$transaction(run);
}

export async function approveProposal(rawInput: ApproveProposalInput, actor: Actor) {
  const input = approveProposalInput.parse(rawInput);
  return db.$transaction(async (tx) => {
    const prop = await tx.priceChangeProposal.findUnique({ where: { id: input.proposalId }, include: { product: true } });
    if (!prop) throw new BusinessError("La propuesta no existe.", "not_found");
    if (prop.status !== "PENDING") throw new BusinessError("La propuesta ya fue resuelta.", "already_decided");
    const p = prop.product;

    if (p.costUpdatedAt && prop.newConsultedAt < p.costUpdatedAt && !input.acceptOlderData) {
      throw new BusinessError(
        "El costo propuesto proviene de una consulta más antigua que la vigente. Confirmá explícitamente para aplicarlo.",
        "older_data",
      );
    }

    let newSalePrice: number | null;
    if (input.salePriceChoice === "keep") newSalePrice = p.salePrice;
    else if (input.salePriceChoice === "suggested") {
      if (prop.proposedSalePrice === null) throw new BusinessError("La propuesta no tiene precio sugerido.");
      newSalePrice = prop.proposedSalePrice;
    } else {
      if (!input.customSalePrice) throw new BusinessError("Indicá el precio de venta.");
      newSalePrice = input.customSalePrice;
    }

    const settings = await getPricingSettings(tx);
    const rules = rulesFromSettings(settings);
    const a = analyzeProduct(costInputsFor({ ...p, costPrice: prop.newCostPrice }, settings), rules, newSalePrice);
    const low = a.published !== null && (isBelowMinMargin(a.published, rules) || a.published.profit < 0);
    if (low && !input.acceptLowMargin) {
      throw new BusinessError(
        `Con este precio el margen queda en ${formatPercent(a.published?.marginPercent)}, por debajo del mínimo (${formatPercent(settings.minMarginPercent)}). Confirmá explícitamente para aprobar.`,
        "low_margin",
      );
    }

    const isNewer = !p.costUpdatedAt || prop.newConsultedAt >= p.costUpdatedAt;
    await tx.product.update({
      where: { id: p.id },
      data: {
        costPrice: prop.newCostPrice,
        costUpdatedAt: isNewer ? prop.newConsultedAt : p.costUpdatedAt,
        salePrice: newSalePrice,
        ...(newSalePrice !== p.salePrice ? { salePriceUpdatedAt: new Date() } : {}),
      },
    });
    await tx.productCostHistory.create({
      data: {
        productId: p.id,
        currency: p.currency,
        costPrice: prop.newCostPrice,
        transportCost: p.transportCost,
        otherCosts: p.otherCosts,
        consultedAt: prop.newConsultedAt,
        source: prop.source,
        supplierMessageId: prop.supplierMessageId,
        note: input.note ?? `Aprobado (propuesta ${prop.id})`,
        createdBy: actor.email,
      },
    });
    await tx.priceChangeProposal.update({
      where: { id: prop.id },
      data: {
        status: "APPROVED",
        appliedSalePrice: newSalePrice,
        decidedBy: actor.email,
        decidedAt: new Date(),
        decisionNote: input.note ?? prop.decisionNote,
      },
    });
    await audit(tx, {
      entityType: "Product",
      entityId: p.id,
      action: "price_approved",
      changes: {
        costPrice: { from: p.costPrice, to: prop.newCostPrice },
        salePrice: { from: p.salePrice, to: newSalePrice },
      },
      reason: low ? "Aprobado con margen inferior al mínimo (confirmado)" : undefined,
      userEmail: actor.email,
    });
    return { productId: p.id, salePrice: newSalePrice };
  });
}

export async function rejectProposal(proposalId: string, note: string | null, actor: Actor) {
  return db.$transaction(async (tx) => {
    const prop = await tx.priceChangeProposal.findUnique({ where: { id: proposalId } });
    if (!prop) throw new BusinessError("La propuesta no existe.", "not_found");
    if (prop.status !== "PENDING") throw new BusinessError("La propuesta ya fue resuelta.", "already_decided");
    await tx.priceChangeProposal.update({
      where: { id: proposalId },
      data: { status: "REJECTED", decidedBy: actor.email, decidedAt: new Date(), decisionNote: note },
    });
    await audit(tx, { entityType: "Product", entityId: prop.productId, action: "price_rejected", reason: note ?? undefined, userEmail: actor.email });
  });
}

export async function listPendingProposals() {
  return db.priceChangeProposal.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { product: { select: { id: true, brand: true, model: true, internalSku: true, currency: true, publicationStatus: true } } },
  });
}
