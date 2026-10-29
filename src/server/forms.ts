// Conversión de FormData a valores tipados. La validación definitiva la hace zod en cada servicio.
import { ZodError } from "zod";
import { parseMoneyInput } from "@/lib/money";
import { BusinessError, type ActionResult } from "./errors";

export const str = (fd: FormData, k: string): string | null => {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

export const reqStr = (fd: FormData, k: string): string => str(fd, k) ?? "";

/** Importe en pesos ("45.000") -> centavos. Lanza error si el texto no es un importe. */
export const money = (fd: FormData, k: string, label = k): number | null => {
  const raw = str(fd, k);
  if (raw === null) return null;
  const cents = parseMoneyInput(raw);
  if (cents === null) throw new BusinessError(`${label}: "${raw}" no es un importe válido.`);
  return cents;
};

export const num = (fd: FormData, k: string): number | null => {
  const raw = str(fd, k);
  if (raw === null) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw new BusinessError(`"${raw}" no es un número válido.`);
  return n;
};

export const int = (fd: FormData, k: string): number | null => {
  const n = num(fd, k);
  return n === null ? null : Math.trunc(n);
};

export const bool = (fd: FormData, k: string): boolean => fd.get(k) === "on" || fd.get(k) === "true";

/**
 * "2026-10-27" o "2026-10-27T14:30" en hora de Argentina. Una fecha sin hora se toma
 * a las 12:00, salvo que sea hoy: entonces se usa la hora actual para no registrar
 * consultas en el futuro.
 */
export const date = (fd: FormData, k: string): Date | null => {
  const raw = str(fd, k);
  if (raw === null) return null;
  if (raw === new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })) return new Date();
  const iso = raw.length === 10 ? `${raw}T12:00:00-03:00` : `${raw}:00-03:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new BusinessError(`Fecha inválida: ${raw}`);
  return d;
};

export const list = (fd: FormData, k: string): string[] =>
  (str(fd, k) ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const FIELD_LABELS: Record<string, string> = { brand: "Marca", model: "Modelo", size: "Talle", color: "Color" };

/** Ejecuta una acción y convierte errores en mensajes claros para el administrador. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (e) {
    if (e instanceof BusinessError) return { ok: false, error: e.message, code: e.code, details: e.details };
    if (e instanceof ZodError) {
      const msgs = e.issues.map((i) => `${FIELD_LABELS[String(i.path.at(-1))] ?? i.path.join(".")}: ${i.message}`);
      return { ok: false, error: `Datos inválidos. ${msgs.join(" · ")}`, code: "validation" };
    }
    // Errores de redirect de Next deben propagarse.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { ok: false, error: "Error inesperado. El cambio no se guardó. Revisá los registros del servidor.", code: "unexpected" };
  }
}
