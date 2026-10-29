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
    expect(it0.missing).toEqual(["price"]); // el color es opcional: se consulta con el proveedor
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

describe("formato real del grupo del proveedor", () => {
  // Estructura de un mensaje real (29/10/2026); el nombre del modelo se reemplazó por uno genérico.
  const real = "DEPOSITO #2🚚🇦🇷\nModelo Urbano X✅Calidad G-5💎\n👣Talles: 38 al 43\n✅Surtidas (sueltas a elección)\n💰$40.900 c/par";

  it("reconoce talles pegados a emojis, precio suelto, surtido, calidad y depósito", () => {
    const r = parseSupplierMessage(real, consultedAt);
    expect(r.items).toHaveLength(1);
    const it0 = r.items[0];
    expect(it0.model).toBe("Modelo Urbano X");
    expect(it0.sizes).toEqual(["38", "39", "40", "41", "42", "43"]);
    expect(it0.price).toBe(4_090_000);
    expect(it0.assortmentNote).toBe("Surtidas (sueltas a elección)");
    expect(it0.notes).toBe("Calidad G-5");
    expect(it0.stockNote).toBe("DEPOSITO #2");
    expect(it0.colors).toEqual([]); // "surtidas" no se traduce en colores inventados
    expect(it0.clarifications).toEqual([]);
    expect(it0.missing).toEqual(["brand"]);
  });

  it("el precio con c/par también en listas sin etiquetas", () => {
    const it0 = parseSupplierMessage("• Puma Suede negro 40 41 $50.000 c/par", consultedAt).items[0];
    expect(it0).toMatchObject({ brand: "Puma", model: "Suede", price: 5_000_000, colors: ["negro"] });
  });

  it("el formato de una línea sigue funcionando", () => {
    const it0 = parseSupplierMessage("Modelo: X. Color: negro. Talles: 39 y 40. Precio: 45000. Despacho: jueves.", consultedAt).items[0];
    expect(it0).toMatchObject({ model: "X", colors: ["negro"], sizes: ["39", "40"], price: 4_500_000 });
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

describe("fotos por nombre de archivo", () => {
  it("con etiqueta Foto/Fotos, en el orden indicado", () => {
    const r = parseSupplierMessage("Modelo: Nike Air Max 90\nColor: negro\nTalles: 40 41\nPrecio: 45000\nFotos: IMG-20261029-WA0012.jpg, IMG-20261029-WA0013.jpg", consultedAt);
    expect(r.items[0].photos).toEqual(["IMG-20261029-WA0012.jpg", "IMG-20261029-WA0013.jpg"]);
    expect(r.items[0].price).toBe(4_500_000);
  });

  it("en una sola línea con el formato del enunciado", () => {
    const it0 = parseSupplierMessage("Modelo: X. Color: negro. Talles: 39 y 40. Precio: 45000. Foto: x_negra.jpg", consultedAt).items[0];
    expect(it0.photos).toEqual(["x_negra.jpg"]);
    expect(it0.sizes).toEqual(["39", "40"]);
  });

  it("un archivo en una línea sin etiqueta no se mezcla con el precio", () => {
    const it0 = parseSupplierMessage("Modelo: Puma Suede\nPrecio: 52000\naf1.jpg", consultedAt).items[0];
    expect(it0.price).toBe(5_200_000);
    expect(it0.photos).toEqual(["af1.jpg"]);
    expect(it0.clarifications).toEqual([]);
  });

  it("en listas de ofertas: al final de la línea o en la línea siguiente", () => {
    const r = parseSupplierMessage(
      "OFERTAS STOCK\n• Nike Air Force 1 blancas 38 al 43 $62.000 af1.jpg\n• Adidas Campus 00s gris 40 41 42 $70.000\ncampus1.jpg campus2.png",
      consultedAt,
    );
    expect(r.items[0]).toMatchObject({ brand: "Nike", model: "Air Force 1", photos: ["af1.jpg"], price: 6_200_000 });
    expect(r.items[0].sizes).toEqual(["38", "39", "40", "41", "42", "43"]);
    expect(r.items[1].photos).toEqual(["campus1.jpg", "campus2.png"]);
    expect(r.items[1].sizes).toEqual(["40", "41", "42"]);
  });

  it("pide aclaración si la etiqueta Foto no tiene un archivo", () => {
    expect(parseSupplierMessage("Modelo: X\nFoto: la de ayer", consultedAt).items[0].clarifications.join(" ")).toMatch(/nombre de archivo/);
  });
});
