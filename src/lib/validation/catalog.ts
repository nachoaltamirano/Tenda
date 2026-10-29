import { z } from "zod";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const cents = z.number().int().min(0).max(2_000_000_000);
const optCents = cents.nullable().optional().transform((v) => v ?? null);
const optDate = z.coerce.date().nullable().optional().transform((v) => v ?? null);

export const availabilityValues = [
  "PENDING_VERIFICATION",
  "AVAILABLE_LAST_CHECK",
  "CONFIRMED_FOR_ORDER",
  "SOLD_OUT_CONFIRMED",
  "DISCONTINUED",
] as const;
export const dataSourceValues = ["WHATSAPP_GROUP", "WHATSAPP_DIRECT", "PHONE_CALL", "SUPPLIER_LIST", "MANUAL", "OTHER"] as const;

export const AVAILABILITY_LABELS: Record<(typeof availabilityValues)[number], string> = {
  PENDING_VERIFICATION: "Pendiente de verificar",
  AVAILABLE_LAST_CHECK: "Disponible según última consulta",
  CONFIRMED_FOR_ORDER: "Disponibilidad confirmada para un pedido",
  SOLD_OUT_CONFIRMED: "Agotado confirmado",
  DISCONTINUED: "Discontinuado",
};
export const DATA_SOURCE_LABELS: Record<(typeof dataSourceValues)[number], string> = {
  WHATSAPP_GROUP: "Grupo de WhatsApp del proveedor",
  WHATSAPP_DIRECT: "WhatsApp directo",
  PHONE_CALL: "Llamada",
  SUPPLIER_LIST: "Lista del proveedor",
  MANUAL: "Carga manual",
  OTHER: "Otra",
};
export const PUBLICATION_LABELS = { DRAFT: "Borrador", PUBLISHED: "Publicado", PAUSED: "Pausado" } as const;

export const variantInput = z.object({
  color: z.string().trim().min(1, "Color requerido").max(60),
  size: z
    .string()
    .trim()
    .regex(/^\d{2}(\.5)?$/, "Talle inválido (ej: 40 o 40.5)"),
  supplierSku: optText(60),
  availabilityStatus: z.enum(availabilityValues).default("PENDING_VERIFICATION"),
});
export type VariantInput = z.input<typeof variantInput>;

const productBase = {
  supplierId: z.string().nullable().optional().transform((v) => v || null),
  supplierSku: optText(60),
  brand: z.string().trim().min(1, "La marca es obligatoria").max(60),
  model: z.string().trim().min(1, "El modelo es obligatorio").max(120),
  description: optText(4000),
  category: optText(60),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  transportCost: optCents,
  otherCosts: optCents,
  accessoriesCost: optCents,
  salePrice: optCents,
  availabilityStatus: z.enum(availabilityValues).default("PENDING_VERIFICATION"),
  estimatedDeliveryDays: z.number().int().min(0).max(90).nullable().optional().transform((v) => v ?? null),
  dataSource: z.enum(dataSourceValues).default("MANUAL"),
  dataDate: optDate,
  dataVerified: z.boolean().default(false),
  lastConsultedAt: optDate,
  nextDispatchDate: optDate,
  nextDispatchWeekday: z.number().int().min(0).max(6).nullable().optional().transform((v) => v ?? null),
  nextDispatchMode: optText(120),
  nextDispatchConfirmed: z.boolean().default(false),
  notes: optText(4000),
  conditions: optText(2000),
  isTestData: z.boolean().default(false),
};

export const productCreateInput = z.object({
  ...productBase,
  costPrice: optCents,
  variants: z.array(variantInput).max(200).default([]),
  /** Confirmación explícita cuando el sistema detecta un posible duplicado. */
  confirmDuplicate: z.boolean().default(false),
  acceptLowMargin: z.boolean().default(false),
});
export type ProductCreateInput = z.input<typeof productCreateInput>;

// El costo no se edita aquí: se cambia con una actualización de precio aprobada.
export const productUpdateInput = z.object({
  ...productBase,
  acceptLowMargin: z.boolean().default(false),
  reason: optText(500),
});
export type ProductUpdateInput = z.input<typeof productUpdateInput>;

export const priceUpdateInput = z.object({
  productId: z.string().min(1),
  newCostPrice: cents,
  consultedAt: z.coerce.date(),
  source: z.enum(dataSourceValues),
  supplierMessageId: z.string().nullable().optional().transform((v) => v || null),
  note: optText(500),
});
export type PriceUpdateInput = z.input<typeof priceUpdateInput>;

export const approveProposalInput = z.object({
  proposalId: z.string().min(1),
  salePriceChoice: z.enum(["keep", "suggested", "custom"]),
  customSalePrice: optCents,
  acceptLowMargin: z.boolean().default(false),
  acceptOlderData: z.boolean().default(false),
  note: optText(500),
});
export type ApproveProposalInput = z.input<typeof approveProposalInput>;

export const supplierMessageInput = z.object({
  supplierId: z.string().min(1, "Elegí el proveedor"),
  source: z.enum(dataSourceValues),
  rawText: z.string().trim().min(1, "Pegá el mensaje").max(20_000),
  consultedAt: z.coerce.date(),
  receivedAt: optDate,
  isTestData: z.boolean().default(false),
});
export type SupplierMessageInput = z.input<typeof supplierMessageInput>;

/** Ítem revisado por el administrador a partir de la propuesta del intérprete. */
export const reviewedItemInput = z.object({
  messageId: z.string().min(1),
  itemIndex: z.number().int().min(0),
  action: z.enum(["create", "update"]),
  productId: z.string().nullable().optional().transform((v) => v || null),
  brand: z.string().trim().min(1, "La marca es obligatoria").max(60),
  model: z.string().trim().min(1, "El modelo es obligatorio").max(120),
  supplierSku: optText(60),
  colors: z.array(z.string().trim().min(1).max(60)).max(20),
  sizes: z.array(z.string().trim().regex(/^\d{2}(\.5)?$/, "Talle inválido")).max(40),
  price: optCents,
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  /** Estado que se asigna a las variantes informadas en el mensaje. */
  variantStatus: z.enum(availabilityValues).default("AVAILABLE_LAST_CHECK"),
  nextDispatchWeekday: z.number().int().min(0).max(6).nullable().optional().transform((v) => v ?? null),
  nextDispatchDate: optDate,
  notes: optText(2000),
  confirmDuplicate: z.boolean().default(false),
  /** Con más de un color, confirmar que todos los talles existen en todos los colores. */
  confirmAllCombinations: z.boolean().default(false),
});
export type ReviewedItemInput = z.input<typeof reviewedItemInput>;

export const pricingSettingsInput = z.object({
  packagingCost: optCents,
  deliveryCostAssumed: optCents,
  defaultTransportCost: optCents,
  paymentFeePercent: z.number().min(0).max(100).nullable(),
  paymentFeeFixed: optCents,
  taxPercent: z.number().min(0).max(100).nullable(),
  targetMode: z.enum(["FIXED_PROFIT", "MARGIN_PERCENT", "MARKUP_PERCENT"]),
  targetValue: z.number().min(0).nullable(),
  minMarginPercent: z.number().min(0).max(99).nullable(),
  roundingStep: cents,
  roundingMode: z.enum(["UP", "NEAREST", "DOWN"]),
  roundingOffset: z.number().int().min(-100_000_000).max(100_000_000),
  stalePriceDays: z.number().int().min(1).max(365),
});

export const dispatchSettingsInput = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Elegí al menos un día de despacho"),
  maxEstimatedDays: z.number().int().min(1).max(60),
});
