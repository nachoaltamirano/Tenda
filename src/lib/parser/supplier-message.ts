// Intérprete de mensajes pegados desde WhatsApp.
// Propone campos estructurados; NUNCA completa datos que no estén en el texto.
// El resultado siempre requiere revisión humana antes de guardarse.

import { normalizeKey, stripAccents } from "@/lib/text";

export type FieldName = "brand" | "model" | "colors" | "sizes" | "price" | "supplierSku" | "dispatch" | "stock" | "notes" | "photos";

export type ParsedDispatch = {
  text: string;
  weekday: number | null; // 0=domingo..6=sábado
  date: string | null; // ISO yyyy-mm-dd, solo si el texto tiene una fecha explícita
};

export type ParsedItem = {
  rawText: string;
  brand: string | null;
  model: string | null;
  colors: string[];
  sizes: string[];
  /** centavos */
  price: number | null;
  currency: "ARS" | "USD" | null;
  supplierSku: string | null;
  dispatch: ParsedDispatch | null;
  stockNote: string | null;
  notes: string | null;
  /** Nombres de archivo de fotos mencionados en el texto, en el orden en que aparecen. */
  photos: string[];
  /** Campos deducidos de texto libre (sin etiqueta "Campo:"): revisar con más cuidado. */
  inferred: FieldName[];
  missing: FieldName[];
  warnings: string[];
  /** Preguntas para aclarar con el proveedor o resolver al revisar. */
  clarifications: string[];
};

export type ParseResult = {
  items: ParsedItem[];
  ignoredLines: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Diccionarios
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, FieldName> = {
  modelo: "model",
  model: "model",
  articulo: "model",
  producto: "model",
  marca: "brand",
  color: "colors",
  colores: "colors",
  talle: "sizes",
  talles: "sizes",
  numeracion: "sizes",
  numeros: "sizes",
  curva: "sizes",
  precio: "price",
  valor: "price",
  costo: "price",
  sku: "supplierSku",
  codigo: "supplierSku",
  cod: "supplierSku",
  despacho: "dispatch",
  despacha: "dispatch",
  envio: "dispatch",
  sale: "dispatch",
  stock: "stock",
  disponibilidad: "stock",
  foto: "photos",
  fotos: "photos",
  imagen: "photos",
  imagenes: "photos",
  archivo: "photos",
  archivos: "photos",
  obs: "notes",
  observaciones: "notes",
  nota: "notes",
  notas: "notes",
};

export const KNOWN_BRANDS = [
  "New Balance", "Under Armour", "Le Coq Sportif", "Onitsuka Tiger",
  "Nike", "Adidas", "Puma", "Vans", "Converse", "Reebok", "Fila", "Topper", "Asics",
  "Jordan", "Diadora", "Saucony", "Skechers", "Salomon", "Hoka", "Mizuno", "Kappa", "Umbro", "Lacoste", "Champion", "DC", "Crocs",
];

// forma normalizada -> nombre canónico
const COLOR_FORMS: [RegExp, string][] = [
  [/^negr[oa]s?$/, "negro"],
  [/^blanc[oa]s?$/, "blanco"],
  [/^gris(es)?$/, "gris"],
  [/^azul(es)?$/, "azul"],
  [/^roj[oa]s?$/, "rojo"],
  [/^verdes?$/, "verde"],
  [/^rosas?$/, "rosa"],
  [/^beiges?$/, "beige"],
  [/^marron(es)?$/, "marrón"],
  [/^celestes?$/, "celeste"],
  [/^amarill[oa]s?$/, "amarillo"],
  [/^naranjas?$/, "naranja"],
  [/^violetas?$/, "violeta"],
  [/^bordos?$/, "bordó"],
  [/^cremas?$/, "crema"],
  [/^plateado?s?$|^plata$/, "plateado"],
  [/^dorad[oa]s?$/, "dorado"],
  [/^lilas?$/, "lila"],
  [/^fucsias?$/, "fucsia"],
  [/^marino$/, "marino"],
];

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

const HEADER_WORDS = /\b(oferta|ofertas|promo|promocion|liquidacion|stock|deposito|disponible|ingreso|ingresos|novedad|novedades|nuevo|nuevos|llego|llegaron|hoy)\b/;

const MIN_SIZE = 16;
const MAX_SIZE = 50;

// ---------------------------------------------------------------------------
// Utilidades de campo
// ---------------------------------------------------------------------------

function canonicalColor(word: string): string | null {
  const w = normalizeKey(word);
  for (const [re, name] of COLOR_FORMS) if (re.test(w)) return name;
  return null;
}

export function parseColors(value: string): { colors: string[]; unknown: string[] } {
  const parts = value
    .split(/,|\/|\s+y\s+|\s+e\s+|\s+-\s+|;|\n/i)
    .map((s) => s.trim().replace(/[.]+$/, ""))
    .filter(Boolean);
  const colors: string[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    // Combinaciones como "blanco y negro" se separan arriba; "negro con blanco" queda como una sola combinación.
    const canon = canonicalColor(part);
    const label = canon ?? part.toLowerCase();
    if (!canon && !part.split(/\s+/).some((w) => canonicalColor(w))) unknown.push(part);
    if (!colors.includes(label)) colors.push(label);
  }
  return { colors, unknown };
}

function sizeToken(s: string): string | null {
  const t = s.replace(",", ".").replace("½", ".5").trim();
  if (!/^\d{2}(\.5)?$/.test(t)) return null;
  const n = Number(t);
  if (n < MIN_SIZE || n > MAX_SIZE) return null;
  return t;
}

export function parseSizes(value: string): { sizes: string[]; warnings: string[]; ok: boolean } {
  const warnings: string[] = [];
  const sizes: string[] = [];
  const add = (s: string) => {
    if (!sizes.includes(s)) sizes.push(s);
  };
  let rest = stripAccents(value.toLowerCase());
  // Rangos: "39 al 42", "del 39 al 42", "39-42", "39 a 42"
  const rangeRe = /(?:del\s+)?(\d{2}(?:[.,]5|½)?)\s*(?:al|a|-|–|hasta)\s*(\d{2}(?:[.,]5|½)?)/g;
  rest = rest.replace(rangeRe, (_m, a: string, b: string) => {
    const from = sizeToken(a);
    const to = sizeToken(b);
    if (from && to && Number(from) < Number(to)) {
      for (let n = Math.ceil(Number(from)); n <= Math.floor(Number(to)); n++) add(String(n));
      warnings.push(`Rango ${from} al ${to} expandido a talles enteros: confirmar si incluye medios talles y si están todos.`);
      return " ";
    }
    return _m;
  });
  const leftovers: string[] = [];
  for (const raw of rest.split(/[\s,;/]+|\by\b/)) {
    const t = raw.replace(/[.]+$/, "").trim();
    if (!t) continue;
    const s = sizeToken(t);
    if (s) add(s);
    else if (!/^(talles?|nros?|n°|numeros?|del|al)$/.test(t)) leftovers.push(t);
  }
  if (leftovers.length > 0) warnings.push(`Texto no reconocido como talle: "${leftovers.join(" ")}".`);
  sizes.sort((a, b) => Number(a) - Number(b));
  return { sizes, warnings, ok: sizes.length > 0 };
}

export type PriceParse = { values: number[]; currency: "ARS" | "USD" | null; warnings: string[] };

/** Extrae importes de un texto. Devuelve todos los encontrados (en centavos) para detectar ambigüedad. */
export function parsePrices(value: string, requireMarker = false): PriceParse {
  const warnings: string[] = [];
  const text = stripAccents(value.toLowerCase());
  const currency: "ARS" | "USD" | null = /\b(usd|u\$s|us\$|dolares?)\b/.test(text) ? "USD" : /\$|\bars\b|pesos/.test(text) ? "ARS" : null;
  const re = requireMarker
    ? /\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s*(?:k|mil)\b)?/g
    : /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s*(?:k|mil)\b)?/g;
  const values: number[] = [];
  for (const m of text.matchAll(re)) {
    let n = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (m[2]) {
      n *= 1000;
      warnings.push(`"${m[0].trim()}" interpretado como ${n.toLocaleString("es-AR")}.`);
    }
    if (!Number.isFinite(n) || n <= 0) continue;
    const cents = Math.round(n * 100);
    if (!values.includes(cents)) values.push(cents);
  }
  return { values, currency, warnings };
}

export function parseDispatch(value: string, consultedAt: Date): ParsedDispatch {
  const text = normalizeKey(value);
  let weekday: number | null = null;
  for (const [name, n] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) {
      weekday = weekday === null ? n : -1; // -1: más de un día mencionado
    }
  }
  let date: string | null = null;
  const dm = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : consultedAt.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return { text: value.trim(), weekday: weekday === -1 ? null : weekday, date };
}

function detectBrand(text: string): { brand: string; rest: string } | null {
  const norm = ` ${normalizeKey(text)} `;
  for (const brand of KNOWN_BRANDS) {
    const b = normalizeKey(brand);
    if (norm.includes(` ${b} `)) {
      const re = new RegExp(`\\b${brand.replace(/ /g, "\\s+")}\\b`, "i");
      const rest = stripAccents(text).replace(re, " ").replace(/\s+/g, " ").trim();
      return { brand, rest };
    }
  }
  return null;
}

// Sin espacios: "IMG-20261029-WA0012.jpg", "af1_negra.png". Un espacio haría ambiguo dónde empieza el nombre.
const FILENAME_RE = /[\p{L}\p{N}_()\-][\p{L}\p{N}_()\-.]*\.(?:jpe?g|png|webp|heic|heif|avif)\b/giu;

/** Nombres de archivo de imagen presentes en un texto. */
export function extractFilenames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FILENAME_RE)) {
    const name = m[0].trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function cleanValue(v: string): string {
  return v.trim().replace(/^[\s:=\-–]+/, "").replace(/[\s.,;]+$/, "").trim();
}

function stripDecorations(line: string): string {
  // Emojis, viñetas y símbolos decorativos al principio/fin.
  return line
    .replace(/[\p{Extended_Pictographic}‍️]/gu, " ")
    .replace(/^[\s•*·\-–>]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Separación en bloques
// ---------------------------------------------------------------------------

const KEY_PATTERN = Object.keys(KEY_ALIASES).sort((a, b) => b.length - a.length).join("|");
const KEY_RE = new RegExp(`(?:^|[\\s.,;•*\\-])(${KEY_PATTERN})s?\\s*:`, "gi");

type KV = { field: FieldName; value: string };

function extractKeyValues(text: string): { kvs: KV[]; leading: string } {
  const plain = stripAccents(text);
  const matches = [...plain.matchAll(KEY_RE)];
  const kvs: KV[] = [];
  if (matches.length === 0) return { kvs, leading: text };
  const leading = text.slice(0, matches[0].index!);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const key = m[1].toLowerCase();
    const field = KEY_ALIASES[key] ?? KEY_ALIASES[key.replace(/s$/, "")];
    if (!field) continue;
    kvs.push({ field, value: cleanValue(text.slice(start, end)) });
  }
  return { kvs, leading: leading.trim() };
}

function emptyItem(rawText: string): ParsedItem {
  return {
    rawText, brand: null, model: null, colors: [], sizes: [], price: null, currency: null,
    supplierSku: null, dispatch: null, stockNote: null, notes: null, photos: [],
    inferred: [], missing: [], warnings: [], clarifications: [],
  };
}

function applyKV(item: ParsedItem, kv: KV, consultedAt: Date) {
  let v = kv.value;
  if (kv.field !== "photos") {
    // Un nombre de archivo en la línea siguiente queda pegado al valor anterior: se separa.
    for (const f of extractFilenames(v)) if (!item.photos.includes(f)) item.photos.push(f);
    v = cleanValue(v.replace(FILENAME_RE, " ").replace(/\b(fotos?|imagen(es)?|archivos?)\s*:?\s*$/i, " "));
  }
  if (!v) {
    item.clarifications.push(`El campo "${kv.field}" aparece sin valor.`);
    return;
  }
  switch (kv.field) {
    case "model": {
      if (item.model) item.clarifications.push(`Hay más de un modelo en el mismo bloque ("${item.model}" y "${v}").`);
      item.model = v;
      break;
    }
    case "brand":
      item.brand = v;
      break;
    case "colors": {
      const { colors, unknown } = parseColors(v);
      item.colors.push(...colors.filter((c) => !item.colors.includes(c)));
      if (unknown.length) item.warnings.push(`Color no reconocido, se conserva tal cual: ${unknown.join(", ")}.`);
      break;
    }
    case "sizes": {
      const r = parseSizes(v);
      item.sizes.push(...r.sizes.filter((s) => !item.sizes.includes(s)));
      item.warnings.push(...r.warnings);
      if (!r.ok) item.clarifications.push(`No se pudieron interpretar los talles: "${v}".`);
      break;
    }
    case "price": {
      const r = parsePrices(v);
      item.warnings.push(...r.warnings);
      if (r.values.length === 1) {
        item.price = r.values[0];
        item.currency = r.currency;
      } else if (r.values.length > 1) {
        item.clarifications.push(`Hay más de un importe en el precio ("${v}"): indicar cuál corresponde.`);
      } else {
        item.clarifications.push(`No se reconoce un importe en "${v}".`);
      }
      break;
    }
    case "supplierSku":
      item.supplierSku = v;
      break;
    case "dispatch":
      item.dispatch = parseDispatch(v, consultedAt);
      break;
    case "stock":
      item.stockNote = v;
      break;
    case "photos": {
      const files = extractFilenames(v);
      if (files.length === 0) item.clarifications.push(`No se reconoce un nombre de archivo de imagen en "${v}" (ej: foto1.jpg).`);
      for (const f of files) if (!item.photos.includes(f)) item.photos.push(f);
      break;
    }
    case "notes":
      item.notes = item.notes ? `${item.notes}\n${v}` : v;
      break;
  }
}

/** Interpreta una línea de oferta sin etiquetas: "Nike Air Force 1 blancas 38 al 43 $62.000". */
function parseFreeLine(line: string, item: ParsedItem) {
  // Fotos sueltas en la línea ("... $62.000 foto: af1.jpg" o solo "af1.jpg").
  const files = extractFilenames(line);
  for (const f of files) if (!item.photos.includes(f)) item.photos.push(f);
  let text = stripDecorations(line.replace(FILENAME_RE, " ").replace(/\b(fotos?|imagen(es)?|archivos?)\s*:?\s*$/i, " "));
  // Precio: solo se reconoce con "$" para no confundir con talles o números del modelo.
  const pr = parsePrices(text, true);
  item.warnings.push(...pr.warnings);
  if (pr.values.length === 1) {
    item.price = pr.values[0];
    item.currency = pr.currency ?? "ARS";
    item.inferred.push("price");
  } else if (pr.values.length > 1) {
    item.clarifications.push(`Hay más de un importe en "${line.trim()}": indicar cuál es el precio.`);
  }
  text = text.replace(/\$\s*[\d.,]+(\s*(k|mil)\b)?/gi, " ");

  // Talles: rango o lista de números de 2 cifras al final del texto (ej. "38 al 43", "39 40 41").
  const sizeTail = text.match(/((?:del\s+)?\d{2}(?:[.,]5)?(?:\s*(?:al|a|-|–|,|y|\/|\s)\s*\d{2}(?:[.,]5)?)*)\s*$/i);
  if (sizeTail) {
    const r = parseSizes(sizeTail[1]);
    if (r.ok) {
      item.sizes = r.sizes;
      item.inferred.push("sizes");
      item.warnings.push(...r.warnings);
      text = text.slice(0, sizeTail.index).trim();
    }
  }
  text = text.replace(/\b(talles?|nros?)\b\s*$/i, "").trim();

  // Colores: palabras reconocidas al final del texto.
  const words = text.split(/\s+/);
  const colors: string[] = [];
  while (words.length > 1) {
    const last = words[words.length - 1].replace(/[.,]+$/, "");
    const c = canonicalColor(last);
    if (c) {
      colors.unshift(c);
      words.pop();
    } else if (/^(y|con|\/)$/i.test(last) && colors.length) {
      words.pop();
    } else break;
  }
  if (colors.length) {
    item.colors = [...new Set(colors)];
    item.inferred.push("colors");
  }
  const remaining = words.join(" ").replace(/[\s,.\-–]+$/, "").trim();
  if (remaining) {
    const b = detectBrand(remaining);
    if (b) {
      item.brand = b.brand;
      item.model = b.rest || null;
      item.inferred.push("brand");
    } else {
      item.model = remaining;
    }
    if (item.model) item.inferred.push("model");
  }
}

function isHeaderLine(line: string): boolean {
  const s = stripDecorations(line);
  if (!s) return true;
  const norm = normalizeKey(s);
  if (!norm) return true;
  const hasPrice = /\$\s*\d/.test(s);
  return !hasPrice && HEADER_WORDS.test(norm) && !detectBrand(s) && !/\d{2}/.test(norm);
}

function finalize(item: ParsedItem): ParsedItem {
  // Si la marca no vino etiquetada pero el modelo empieza con una marca conocida, se separa (dato presente en el texto).
  if (!item.brand && item.model) {
    const b = detectBrand(item.model);
    if (b && b.rest) {
      item.brand = b.brand;
      item.model = b.rest;
      if (!item.inferred.includes("brand")) item.inferred.push("brand");
    }
  }
  if (!item.model) item.missing.push("model");
  if (!item.brand) item.missing.push("brand");
  if (item.colors.length === 0) item.missing.push("colors");
  if (item.sizes.length === 0) item.missing.push("sizes");
  if (item.price === null) item.missing.push("price");
  if (item.price !== null && item.currency !== "USD" && item.price < 500_000) {
    item.warnings.push("Precio menor a $5.000: verificar si falta un cero o si está en dólares.");
  }
  if (item.price !== null && item.currency === null) item.currency = "ARS";
  if (item.dispatch && item.dispatch.weekday === null && !item.dispatch.date) {
    item.clarifications.push(`No se reconoce un día o fecha de despacho en "${item.dispatch.text}".`);
  }
  if (item.inferred.length) {
    item.warnings.push("Algunos campos se dedujeron de texto sin etiqueta: revisarlos antes de guardar.");
  }
  return item;
}

/**
 * Interpreta un mensaje del proveedor. Admite:
 *  - "Modelo: X. Color: negro. Talles: 39, 40, 41 y 42. Precio: 45000. Despacho: jueves." (una línea o varias)
 *  - Varios productos separados por líneas en blanco o por la repetición de "Modelo:".
 *  - Listas de ofertas: una línea por producto con precio en "$".
 */
export function parseSupplierMessage(rawText: string, consultedAt: Date = new Date()): ParseResult {
  const result: ParseResult = { items: [], ignoredLines: [], warnings: [] };
  const text = rawText.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    result.warnings.push("El mensaje está vacío.");
    return result;
  }

  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const { kvs, leading } = extractKeyValues(block);
    if (kvs.length > 0) {
      // Bloque etiquetado. Una repetición de "Modelo:" abre un producto nuevo.
      const groups: KV[][] = [[]];
      for (const kv of kvs) {
        const current = groups[groups.length - 1];
        if (kv.field === "model" && current.some((k) => k.field === "model")) groups.push([kv]);
        else current.push(kv);
      }
      const leadingLines = leading.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const [gi, group] of groups.entries()) {
        const item = emptyItem(gi === 0 ? block : group.map((k) => `${k.field}: ${k.value}`).join("\n"));
        for (const kv of group) applyKV(item, kv, consultedAt);
        if (gi === 0 && leadingLines.length) {
          for (const l of leadingLines) for (const f of extractFilenames(l)) if (!item.photos.includes(f)) item.photos.push(f);
          const candidates = leadingLines
            .map((l) => l.replace(FILENAME_RE, " ").trim())
            .filter((l) => l && !isHeaderLine(l));
          result.ignoredLines.push(...leadingLines.filter((l) => isHeaderLine(l)));
          if (!item.model && candidates.length === 1) {
            // Ej.: "Nike Air Force 1 blancas" sobre "Talles: 38 al 43".
            const free = emptyItem(candidates[0]);
            parseFreeLine(candidates[0], free);
            item.model = free.model;
            item.brand ??= free.brand;
            if (!item.colors.length && free.colors.length) item.colors = free.colors;
            if (!item.sizes.length && free.sizes.length) item.sizes = free.sizes;
            if (item.price === null && free.price !== null) {
              item.price = free.price;
              item.currency = free.currency;
            }
            item.inferred.push(...free.inferred.filter((f) => !item.inferred.includes(f)));
          } else if (candidates.length > 1) {
            item.clarifications.push(`Texto sin etiqueta que podría ser el modelo: ${candidates.map((c) => `"${c}"`).join(", ")}.`);
          }
        }
        result.items.push(finalize(item));
      }
      continue;
    }

    // Bloque sin etiquetas: cada línea con precio en "$" es un producto.
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const productLines = lines.filter((l) => /\$\s*\d/.test(l));
    const onlyFilenames = (l: string) => extractFilenames(l).length > 0 && !l.replace(FILENAME_RE, "").replace(/\b(fotos?|imagen(es)?|archivos?)\b|[\s,:;\-–•*]/gi, "");
    let blockItem: ParsedItem | null = null;
    for (const line of lines) {
      if (onlyFilenames(line)) {
        // Fotos en su propia línea: se asignan al producto anterior (de este bloque o del bloque previo).
        const target = blockItem ?? result.items.at(-1) ?? null;
        if (target) {
          for (const f of extractFilenames(line)) if (!target.photos.includes(f)) target.photos.push(f);
          if (!blockItem) target.warnings.push(`Foto(s) ${extractFilenames(line).join(", ")} asignadas a este producto por estar a continuación: verificar.`);
        } else {
          result.ignoredLines.push(line);
        }
        continue;
      }
      if (!productLines.includes(line)) {
        result.ignoredLines.push(line);
        continue;
      }
      const item = emptyItem(line);
      parseFreeLine(line, item);
      result.items.push(finalize(item));
      blockItem = item;
    }
  }

  if (result.items.length === 0) {
    result.warnings.push("No se identificó ningún producto. Usar el formato \"Modelo: … Precio: …\" o cargarlo manualmente.");
  }
  if (result.ignoredLines.length) {
    result.warnings.push(`Se ignoraron ${result.ignoredLines.length} línea(s) sin datos de producto; revisarlas por si contienen información.`);
  }
  return result;
}
