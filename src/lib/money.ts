// Los importes se manejan en centavos (enteros) para evitar errores de coma flotante.

export function toCents(pesos: number): number {
  return Math.round(pesos * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Formatea centavos como "$ 45.000" (o con decimales si los hay). */
export function formatMoney(cents: number | null | undefined, currency: "ARS" | "USD" = "ARS"): string {
  if (cents === null || cents === undefined) return "—";
  const value = cents / 100;
  const hasDecimals = cents % 100 !== 0;
  const formatted = value.toLocaleString("es-AR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return currency === "USD" ? `US$ ${formatted}` : `$ ${formatted}`;
}

/**
 * Interpreta un importe escrito en formato argentino ("45.000", "45.000,50", "45000")
 * y devuelve centavos, o null si no es un número válido.
 */
export function parseMoneyInput(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/\$|ars|\s/gi, "");
  if (s === "") return null;
  // "45.000,50" -> "45000.50"; "45.000" -> "45000"; "45000.5" se respeta si hay un solo punto con 1-2 decimales
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return toCents(Number(s));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
