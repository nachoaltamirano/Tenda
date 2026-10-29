import { describe, expect, it } from "vitest";
import { parseSizes, parseSupplierMessage } from "@/lib/parser/supplier-message";

const consultedAt = new Date("2026-10-27T15:00:00-03:00");

describe("intérprete de mensajes del proveedor", () => {
  it("interpreta el ejemplo del enunciado (una sola línea)", () => {
    const r = parseSupplierMessage(
      "Modelo: modelo de ejemplo. Color: negro. Talles: 39, 40, 41 y 42. Precio: 45000. Despacho: jueves.",
      consultedAt,
    );
    expect(r.items).toHaveLength(1);
    const it0 = r.items[0];
    expect(it0.model).toBe("modelo de ejemplo");
    expect(it0.colors).toEqual(["negro"]);
    expect(it0.sizes).toEqual(["39", "40", "41", "42"]);
    expect(it0.price).toBe(4_500_000);
    expect(it0.currency).toBe("ARS");
    expect(it0.dispatch?.weekday).toBe(4);
    expect(it0.dispatch?.date).toBeNull(); // no inventa una fecha
    // La marca no está en el texto: se marca como faltante, no se inventa.
    expect(it0.brand).toBeNull();
    expect(it0.missing).toEqual(["brand"]);
  });

  it("no inventa datos que faltan", () => {
    const r = parseSupplierMessage("Modelo: Nike Air Max 90. Talles: 40 41", consultedAt);
    const it0 = r.items[0];
    expect(it0.brand).toBe("Nike");
    expect(it0.model).toBe("Air Max 90");
    expect(it0.price).toBeNull();
    expect(it0.colors).toEqual([]);
    expect(it0.missing).toEqual(expect.arrayContaining(["price", "colors"]));
  });

  it("pide aclaración si hay dos precios", () => {
    const r = parseSupplierMessage("Modelo: Puma Suede\nPrecio: 45000 / 52000", consultedAt);
    expect(r.items[0].price).toBeNull();
    expect(r.items[0].clarifications.join(" ")).toMatch(/más de un importe/);
  });

  it("separa varios productos por repetición de Modelo:", () => {
    const r = parseSupplierMessage(
      "Modelo: Vans Old Skool\nColor: negro\nPrecio: $55.000\nModelo: Converse Chuck 70\nColor: blanco\nPrecio: $60.000",
      consultedAt,
    );
    expect(r.items.map((i) => [i.brand, i.model, i.price])).toEqual([
      ["Vans", "Old Skool", 5_500_000],
      ["Converse", "Chuck 70", 6_000_000],
    ]);
  });

  it("interpreta ofertas de stock del grupo (una línea por producto)", () => {
    const r = parseSupplierMessage(
      "🔥 OFERTAS STOCK EN DEPÓSITO 🔥\n• Nike Air Force 1 blancas 38 al 43 $62.000\n• Adidas Campus 00s gris 40 41 42 $70.000\nLlega rápido!",
      consultedAt,
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ brand: "Nike", model: "Air Force 1", colors: ["blanco"], price: 6_200_000 });
    expect(r.items[0].sizes).toEqual(["38", "39", "40", "41", "42", "43"]);
    expect(r.items[0].warnings.join(" ")).toMatch(/Rango 38 al 43/);
    expect(r.items[1]).toMatchObject({ brand: "Adidas", model: "Campus 00s", colors: ["gris"], sizes: ["40", "41", "42"], price: 7_000_000 });
    expect(r.items[0].inferred).toContain("model");
    expect(r.ignoredLines.length).toBe(2);
  });

  it("bloque con encabezado de producto sin etiqueta y campos etiquetados", () => {
    const r = parseSupplierMessage("OFERTA STOCK\nNike Dunk Low negro blanco\nTalles: 39 al 41\nPrecio: $85.000", consultedAt);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ brand: "Nike", model: "Dunk Low", price: 8_500_000 });
    expect(r.items[0].colors).toEqual(["negro", "blanco"]);
  });

  it("advierte precios sospechosamente bajos y reconoce USD", () => {
    expect(parseSupplierMessage("Modelo: X\nPrecio: 450", consultedAt).items[0].warnings.join(" ")).toMatch(/falta un cero/);
    const usd = parseSupplierMessage("Modelo: X\nPrecio: USD 60", consultedAt).items[0];
    expect(usd.currency).toBe("USD");
    expect(usd.price).toBe(6000);
  });

  it("fecha explícita de despacho", () => {
    const d = parseSupplierMessage("Modelo: X\nDespacho: viernes 30/10", consultedAt).items[0].dispatch;
    expect(d).toMatchObject({ weekday: 5, date: "2026-10-30" });
  });

  it("mensaje sin productos", () => {
    const r = parseSupplierMessage("Buen día! Mañana paso lista", consultedAt);
    expect(r.items).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/No se identificó/);
  });
});

describe("talles", () => {
  it("listas, rangos y medios talles", () => {
    expect(parseSizes("39, 40, 41 y 42").sizes).toEqual(["39", "40", "41", "42"]);
    expect(parseSizes("del 36 al 38").sizes).toEqual(["36", "37", "38"]);
    expect(parseSizes("40.5 41½").sizes).toEqual(["40.5", "41.5"]);
    expect(parseSizes("S M L").ok).toBe(false);
  });
});
