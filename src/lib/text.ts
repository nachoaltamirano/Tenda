export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Normaliza para comparar: minúsculas, sin acentos, sin signos, espacios simples. */
export function normalizeKey(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function productNameKey(brand: string, model: string): string {
  return normalizeKey(`${brand} ${model}`);
}

export function slugify(s: string): string {
  return normalizeKey(s).replace(/\s/g, "-").slice(0, 80);
}

export function tokens(s: string): string[] {
  return normalizeKey(s).split(" ").filter(Boolean);
}

export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
