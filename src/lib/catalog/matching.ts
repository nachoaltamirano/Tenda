// Identificación de productos existentes a partir de datos del proveedor y
// detección de posibles duplicados. Lógica pura.

import { normalizeKey, productNameKey, tokens } from "@/lib/text";

export type MatchCandidate = {
  id: string;
  internalSku: string;
  supplierSku: string | null;
  brand: string;
  model: string;
  nameKey: string;
};

export type MatchQuery = {
  brand: string | null;
  model: string | null;
  supplierSku?: string | null;
};

export type Match = {
  product: MatchCandidate;
  /** exact: mismo SKU de proveedor o mismo nombre normalizado. similar: requiere confirmación. */
  kind: "exact" | "similar";
  reason: string;
  score: number;
};

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function findMatches(query: MatchQuery, candidates: MatchCandidate[], threshold = 0.5): Match[] {
  const out: Match[] = [];
  const sku = query.supplierSku ? normalizeKey(query.supplierSku) : null;
  const qName = query.model ? productNameKey(query.brand ?? "", query.model) : null;
  const qTokens = qName ? tokens(qName) : [];

  for (const p of candidates) {
    if (sku && p.supplierSku && normalizeKey(p.supplierSku) === sku) {
      out.push({ product: p, kind: "exact", reason: "Mismo SKU del proveedor", score: 1 });
      continue;
    }
    if (!qName) continue;
    // Si no se informó marca, se compara solo contra el modelo.
    const pName = query.brand ? p.nameKey : normalizeKey(p.model);
    if (pName === (query.brand ? qName : normalizeKey(query.model!))) {
      out.push({ product: p, kind: "exact", reason: "Misma marca y modelo", score: 1 });
      continue;
    }
    const score = jaccard(qTokens, tokens(query.brand ? p.nameKey : p.model));
    if (score >= threshold) {
      out.push({ product: p, kind: "similar", reason: `Nombre parecido (${Math.round(score * 100)} %)`, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
