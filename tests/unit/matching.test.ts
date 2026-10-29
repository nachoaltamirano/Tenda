import { describe, expect, it } from "vitest";
import { findMatches, type MatchCandidate } from "@/lib/catalog/matching";
import { productNameKey } from "@/lib/text";

const mk = (id: string, brand: string, model: string, supplierSku: string | null = null): MatchCandidate => ({
  id, internalSku: id, brand, model, supplierSku, nameKey: productNameKey(brand, model),
});
const catalog = [mk("1", "Nike", "Air Force 1", "AF1-W"), mk("2", "Nike", "Air Max 90"), mk("3", "Adidas", "Campus 00s")];

describe("detección de duplicados", () => {
  it("coincidencia exacta por nombre, sin importar mayúsculas ni acentos", () => {
    const m = findMatches({ brand: "NIKE", model: "air force 1" }, catalog);
    expect(m[0]).toMatchObject({ kind: "exact", product: { id: "1" } });
  });
  it("coincidencia por SKU del proveedor", () => {
    expect(findMatches({ brand: null, model: "otro nombre", supplierSku: "af1-w" }, catalog)[0].product.id).toBe("1");
  });
  it("nombres parecidos requieren confirmación", () => {
    const m = findMatches({ brand: "Nike", model: "Air Force 1 Low" }, catalog);
    expect(m[0]).toMatchObject({ kind: "similar", product: { id: "1" } });
  });
  it("sin marca compara contra el modelo", () => {
    expect(findMatches({ brand: null, model: "Campus 00s" }, catalog)[0]).toMatchObject({ kind: "exact", product: { id: "3" } });
  });
  it("productos distintos no coinciden", () => {
    expect(findMatches({ brand: "Puma", model: "Suede Classic" }, catalog)).toEqual([]);
  });
});
