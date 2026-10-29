// Condiciones mínimas para publicar un producto en la tienda.

export type PublicationCheckInput = {
  costPrice: number | null;
  salePrice: number | null;
  availabilityStatus: string;
  description: string | null;
  activeVariants: number;
  publishableImages: number; // autorizadas y no eliminadas
  belowMinMargin: boolean;
  profit: number | null;
};

export function publicationIssues(p: PublicationCheckInput): string[] {
  const issues: string[] = [];
  if (p.costPrice === null) issues.push("Falta el costo del proveedor.");
  if (p.salePrice === null || p.salePrice <= 0) issues.push("Falta el precio de venta.");
  if (p.activeVariants === 0) issues.push("No tiene talles/colores cargados.");
  if (p.publishableImages === 0) issues.push("No tiene fotos autorizadas para publicar.");
  if (p.availabilityStatus === "SOLD_OUT_CONFIRMED" || p.availabilityStatus === "DISCONTINUED") {
    issues.push("El producto está agotado o discontinuado.");
  }
  if (p.profit !== null && p.profit < 0) issues.push("El precio publicado genera pérdida.");
  if (p.belowMinMargin) issues.push("El margen está por debajo del mínimo configurado.");
  return issues;
}
