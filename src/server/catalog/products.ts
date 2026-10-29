import type { Prisma, Product, PublicationStatus } from "@prisma/client";
import { findMatches, type Match } from "@/lib/catalog/matching";
import { publicationIssues } from "@/lib/catalog/publication";
import { formatPercent } from "@/lib/money";
import { analyzeProduct, type ProductAnalysis } from "@/lib/pricing/engine";
import { normalizeKey, productNameKey, slugify } from "@/lib/text";
import {
  productCreateInput,
  productUpdateInput,
  variantInput,
  type ProductCreateInput,
  type ProductUpdateInput,
  type VariantInput,
} from "@/lib/validation/catalog";
import { audit, diff } from "../audit";
import { db, type Tx } from "../db";
import { BusinessError } from "../errors";
import { costInputsFor, getPricingSettings, rulesFromSettings } from "../settings";

export type Actor = { email: string };

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

const SKU_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += SKU_ALPHABET[Math.floor(Math.random() * SKU_ALPHABET.length)];
  return s;
}

export async function generateInternalSku(tx: Tx, brand: string): Promise<string> {
  const prefix = normalizeKey(brand).replace(/\s/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  for (let i = 0; i < 10; i++) {
    const sku = `LB-${prefix}-${randomCode(4)}`;
    if (!(await tx.product.findUnique({ where: { internalSku: sku } }))) return sku;
  }
  throw new BusinessError("No se pudo generar un SKU interno único. Reintentar.");
}

async function uniqueSlug(tx: Tx, brand: string, model: string, excludeId?: string): Promise<string> {
  const base = slugify(`${brand} ${model}`) || "producto";
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const existing = await tx.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${randomCode(3).toLowerCase()}`;
  }
  throw new BusinessError("No se pudo generar una URL única.");
}

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------

export async function findDuplicateCandidates(
  tx: Tx,
  q: { brand: string | null; model: string | null; supplierSku?: string | null },
  excludeId?: string,
): Promise<Match[]> {
  const candidates = await tx.product.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
    select: { id: true, internalSku: true, supplierSku: true, brand: true, model: true, nameKey: true },
  });
  return findMatches(q, candidates);
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

export async function analyzeProductPricing(
  p: Pick<Product, "costPrice" | "transportCost" | "otherCosts" | "accessoriesCost" | "salePrice">,
  tx: Tx = db,
): Promise<ProductAnalysis> {
  const settings = await getPricingSettings(tx);
  return analyzeProduct(costInputsFor(p, settings), rulesFromSettings(settings), p.salePrice);
}

async function assertSalePriceAcceptable(
  tx: Tx,
  p: Pick<Product, "costPrice" | "transportCost" | "otherCosts" | "accessoriesCost" | "salePrice">,
  acceptLowMargin: boolean,
) {
  if (p.salePrice === null || p.costPrice === null) return;
  const a = await analyzeProductPricing(p, tx);
  if ((a.publishedBelowMinMargin || (a.published && a.published.profit < 0)) && !acceptLowMargin) {
    throw new BusinessError(
      `El precio de venta deja un margen de ${formatPercent(a.published?.marginPercent)}, menor al mínimo configurado. Confirmá explícitamente para guardarlo.`,
      "low_margin",
      { marginPercent: a.published?.marginPercent ?? null },
    );
  }
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

/**
 * Sincroniza variantes. Las que ya no figuran se desactivan (no se borran ni
 * se marcan como agotadas: la falta de información no implica agotado).
 */
export async function syncVariants(tx: Tx, productId: string, variants: VariantInput[], consultedAt: Date | null, deactivateMissing = true) {
  const seen = new Set<string>();
  for (const raw of variants) {
    const v = variantInput.parse(raw);
    const colorKey = normalizeKey(v.color);
    const key = `${colorKey}|${v.size}`;
    if (seen.has(key)) throw new BusinessError(`Variante repetida: ${v.color} talle ${v.size}.`);
    seen.add(key);
    await tx.productVariant.upsert({
      where: { productId_colorKey_size: { productId, colorKey, size: v.size } },
      create: {
        productId,
        color: v.color,
        colorKey,
        size: v.size,
        supplierSku: v.supplierSku,
        availabilityStatus: v.availabilityStatus,
        lastConsultedAt: consultedAt,
      },
      update: {
        color: v.color,
        supplierSku: v.supplierSku ?? undefined,
        availabilityStatus: v.availabilityStatus,
        active: true,
        ...(consultedAt ? { lastConsultedAt: consultedAt } : {}),
      },
    });
  }
  if (deactivateMissing) {
    const existing = await tx.productVariant.findMany({ where: { productId, active: true } });
    for (const v of existing) {
      if (!seen.has(`${v.colorKey}|${v.size}`)) await tx.productVariant.update({ where: { id: v.id }, data: { active: false } });
    }
  }
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

export async function createProduct(rawInput: ProductCreateInput, actor: Actor, txArg?: Tx): Promise<Product> {
  const input = productCreateInput.parse(rawInput);
  const run = async (tx: Tx) => {
    const dups = await findDuplicateCandidates(tx, { brand: input.brand, model: input.model, supplierSku: input.supplierSku });
    if (dups.length > 0 && !input.confirmDuplicate) {
      throw new BusinessError(
        `Posible duplicado: ${dups.map((d) => `${d.product.brand} ${d.product.model} (${d.product.internalSku}) — ${d.reason}`).join("; ")}.`,
        "duplicate",
        dups.map((d) => ({ id: d.product.id, sku: d.product.internalSku, reason: d.reason, kind: d.kind })),
      );
    }
    await assertSalePriceAcceptable(tx, { ...input, costPrice: input.costPrice }, input.acceptLowMargin);
    const consulted = input.lastConsultedAt ?? input.dataDate ?? null;
    const product = await tx.product.create({
      data: {
        internalSku: await generateInternalSku(tx, input.brand),
        slug: await uniqueSlug(tx, input.brand, input.model),
        nameKey: productNameKey(input.brand, input.model),
        supplierId: input.supplierId,
        supplierSku: input.supplierSku,
        brand: input.brand,
        model: input.model,
        description: input.description,
        category: input.category,
        currency: input.currency,
        costPrice: input.costPrice,
        transportCost: input.transportCost,
        otherCosts: input.otherCosts,
        accessoriesCost: input.accessoriesCost,
        costUpdatedAt: input.costPrice !== null ? consulted ?? new Date() : null,
        salePrice: input.salePrice,
        salePriceUpdatedAt: input.salePrice !== null ? new Date() : null,
        availabilityStatus: input.availabilityStatus,
        estimatedDeliveryDays: input.estimatedDeliveryDays,
        dataSource: input.dataSource,
        dataDate: input.dataDate,
        dataVerified: input.dataVerified,
        lastConsultedAt: input.lastConsultedAt,
        nextDispatchDate: input.nextDispatchDate,
        nextDispatchWeekday: input.nextDispatchWeekday,
        nextDispatchMode: input.nextDispatchMode,
        nextDispatchConfirmed: input.nextDispatchConfirmed,
        notes: input.notes,
        conditions: input.conditions,
        isTestData: input.isTestData,
      },
    });
    if (input.costPrice !== null) {
      await tx.productCostHistory.create({
        data: {
          productId: product.id,
          currency: input.currency,
          costPrice: input.costPrice,
          transportCost: input.transportCost,
          otherCosts: input.otherCosts,
          consultedAt: consulted ?? new Date(),
          source: input.dataSource,
          note: "Costo inicial",
          createdBy: actor.email,
        },
      });
    }
    await syncVariants(tx, product.id, input.variants, input.lastConsultedAt);
    await audit(tx, {
      entityType: "Product",
      entityId: product.id,
      action: "create",
      changes: { brand: input.brand, model: input.model, costPrice: input.costPrice, salePrice: input.salePrice, variants: input.variants.length },
      reason: dups.length ? "Alta confirmada pese a posible duplicado" : undefined,
      userEmail: actor.email,
    });
    return product;
  };
  return txArg ? run(txArg) : db.$transaction(run);
}

const EDITABLE_FIELDS = [
  "supplierId", "supplierSku", "brand", "model", "description", "category", "currency", "transportCost", "otherCosts",
  "accessoriesCost", "salePrice", "availabilityStatus", "estimatedDeliveryDays", "dataSource", "dataDate", "dataVerified",
  "lastConsultedAt", "nextDispatchDate", "nextDispatchWeekday", "nextDispatchMode", "nextDispatchConfirmed", "notes",
  "conditions", "isTestData",
] as const;

export async function updateProduct(id: string, rawInput: ProductUpdateInput, actor: Actor): Promise<Product> {
  const input = productUpdateInput.parse(rawInput);
  return db.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id } });
    if (!current) throw new BusinessError("El producto no existe.", "not_found");

    const next: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) next[f] = input[f];
    const changes = diff(current as unknown as Record<string, unknown>, next);
    if (Object.keys(changes).length === 0) return current;

    if (changes.salePrice || changes.transportCost || changes.otherCosts || changes.accessoriesCost) {
      await assertSalePriceAcceptable(tx, { ...current, ...input }, input.acceptLowMargin);
    }
    if (current.publicationStatus === "PUBLISHED" && (input.availabilityStatus === "SOLD_OUT_CONFIRMED" || input.availabilityStatus === "DISCONTINUED")) {
      // Un producto agotado o discontinuado no puede seguir publicado.
      next.publicationStatus = "PAUSED";
      changes.publicationStatus = { from: "PUBLISHED", to: "PAUSED" };
    }
    const data: Prisma.ProductUncheckedUpdateInput = { ...(next as Prisma.ProductUncheckedUpdateInput) };
    if (changes.brand || changes.model) {
      data.nameKey = productNameKey(input.brand, input.model);
      data.slug = await uniqueSlug(tx, input.brand, input.model, id);
    }
    if (changes.salePrice) data.salePriceUpdatedAt = new Date();

    const updated = await tx.product.update({ where: { id }, data });
    await audit(tx, { entityType: "Product", entityId: id, action: "update", changes, reason: input.reason ?? undefined, userEmail: actor.email });
    return updated;
  });
}

export async function updateVariants(productId: string, variants: VariantInput[], actor: Actor, consultedAt: Date | null) {
  return db.$transaction(async (tx) => {
    const before = await tx.productVariant.findMany({ where: { productId, active: true }, orderBy: [{ color: "asc" }, { size: "asc" }] });
    await syncVariants(tx, productId, variants, consultedAt);
    const after = await tx.productVariant.findMany({ where: { productId, active: true }, orderBy: [{ color: "asc" }, { size: "asc" }] });
    const fmt = (vs: typeof before) => vs.map((v) => `${v.color} ${v.size} (${v.availabilityStatus})`);
    await audit(tx, {
      entityType: "Product",
      entityId: productId,
      action: "variants_update",
      changes: { variants: { from: fmt(before), to: fmt(after) } },
      userEmail: actor.email,
    });
  });
}

// ---------------------------------------------------------------------------
// Publicación
// ---------------------------------------------------------------------------

export async function getPublicationIssues(id: string, tx: Tx = db): Promise<string[]> {
  const p = await tx.product.findUnique({
    where: { id },
    include: {
      variants: { where: { active: true } },
      images: { where: { deletedAt: null, authorizedForPublication: true } },
    },
  });
  if (!p) throw new BusinessError("El producto no existe.", "not_found");
  const a = await analyzeProductPricing(p, tx);
  return publicationIssues({
    costPrice: p.costPrice,
    salePrice: p.salePrice,
    availabilityStatus: p.availabilityStatus,
    description: p.description,
    activeVariants: p.variants.length,
    publishableImages: p.images.length,
    belowMinMargin: a.publishedBelowMinMargin,
    profit: a.published?.profit ?? null,
  });
}

export async function setPublicationStatus(id: string, status: PublicationStatus, actor: Actor) {
  return db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id } });
    if (!p) throw new BusinessError("El producto no existe.", "not_found");
    if (status === "PUBLISHED") {
      const issues = await getPublicationIssues(id, tx);
      if (issues.length) throw new BusinessError(`No se puede publicar: ${issues.join(" ")}`, "publication_blocked", issues);
    }
    const updated = await tx.product.update({ where: { id }, data: { publicationStatus: status } });
    await audit(tx, {
      entityType: "Product",
      entityId: id,
      action: "publication",
      changes: { publicationStatus: { from: p.publicationStatus, to: status } },
      userEmail: actor.email,
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type ProductFilters = {
  q?: string;
  availability?: string;
  publication?: string;
  stale?: boolean;
  includeTest?: boolean;
};

export async function listProducts(filters: ProductFilters = {}) {
  const settings = await getPricingSettings();
  const staleBefore = new Date(Date.now() - settings.stalePriceDays * 86_400_000);
  const where: Prisma.ProductWhereInput = {};
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { nameKey: { contains: normalizeKey(q) } },
      { internalSku: { contains: q, mode: "insensitive" } },
      { supplierSku: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filters.availability) where.availabilityStatus = filters.availability as Prisma.EnumAvailabilityStatusFilter["equals"];
  if (filters.publication) where.publicationStatus = filters.publication as Prisma.EnumPublicationStatusFilter["equals"];
  if (filters.stale) where.AND = [{ OR: [{ costUpdatedAt: null }, { costUpdatedAt: { lt: staleBefore } }] }];
  if (!filters.includeTest) where.isTestData = false;

  const products = await db.product.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      variants: { where: { active: true }, select: { color: true, size: true, availabilityStatus: true } },
      images: { where: { deletedAt: null, isCover: true }, take: 1 },
      _count: { select: { priceProposals: { where: { status: "PENDING" } } } },
    },
    take: 500,
  });
  const rules = rulesFromSettings(settings);
  return products.map((p) => {
    const a = analyzeProduct(costInputsFor(p, settings), rules, p.salePrice);
    return {
      ...p,
      analysis: a,
      isStale: !p.costUpdatedAt || p.costUpdatedAt < staleBefore,
      colors: [...new Set(p.variants.map((v) => v.color))],
      sizes: [...new Set(p.variants.map((v) => v.size))].sort((x, y) => Number(x) - Number(y)),
    };
  });
}

export async function getProductDetail(id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      supplier: true,
      variants: { orderBy: [{ active: "desc" }, { color: "asc" }, { size: "asc" }] },
      images: { where: { deletedAt: null }, orderBy: { position: "asc" } },
      costHistory: { orderBy: { consultedAt: "desc" }, take: 50 },
      priceProposals: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!product) return null;
  const history = await db.auditLog.findMany({
    where: { entityType: "Product", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const analysis = await analyzeProductPricing(product);
  const publicationBlockers = await getPublicationIssues(id);
  return { product, history, analysis, publicationBlockers };
}

export async function addVariants(
  productId: string,
  input: { color: string; sizes: string[]; availabilityStatus: VariantInput["availabilityStatus"]; consultedAt: Date | null },
  actor: Actor,
) {
  if (!input.sizes.length) throw new BusinessError("Indicá al menos un talle.");
  return db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId } });
    if (!p) throw new BusinessError("El producto no existe.", "not_found");
    await syncVariants(
      tx,
      productId,
      input.sizes.map((size) => ({ color: input.color, size, availabilityStatus: input.availabilityStatus })),
      input.consultedAt,
      false,
    );
    await audit(tx, {
      entityType: "Product",
      entityId: productId,
      action: "variants_added",
      changes: { color: input.color, sizes: input.sizes, status: input.availabilityStatus },
      userEmail: actor.email,
    });
  });
}

export async function setVariantState(
  productId: string,
  variantId: string,
  data: { availabilityStatus?: VariantInput["availabilityStatus"]; active?: boolean; consultedAt?: Date | null },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const v = await tx.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!v) throw new BusinessError("La variante no existe.", "not_found");
    const update = {
      ...(data.availabilityStatus ? { availabilityStatus: data.availabilityStatus } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.consultedAt ? { lastConsultedAt: data.consultedAt } : {}),
    };
    await tx.productVariant.update({ where: { id: variantId }, data: update });
    await audit(tx, {
      entityType: "Product",
      entityId: productId,
      action: "variant_update",
      changes: {
        variant: `${v.color} ${v.size}`,
        ...(data.availabilityStatus ? { availabilityStatus: { from: v.availabilityStatus, to: data.availabilityStatus } } : {}),
        ...(data.active !== undefined ? { active: { from: v.active, to: data.active } } : {}),
      },
      userEmail: actor.email,
    });
  });
}
