// Calendario de despacho. Fechas como "YYYY-MM-DD" para evitar problemas de zona horaria.

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

export function weekdayOf(d: string): number {
  return parse(d).getUTCDay();
}

/**
 * Próximo día habitual de despacho a partir de `from` (inclusive), salteando feriados.
 * Devuelve null si no hay días configurados.
 */
export function nextDispatchDate(from: string, weekdays: number[], holidays: string[] = []): string | null {
  if (weekdays.length === 0) return null;
  const skip = new Set(holidays);
  for (let i = 0; i < 60; i++) {
    const d = addDays(from, i);
    if (weekdays.includes(weekdayOf(d)) && !skip.has(d)) return d;
  }
  return null;
}

export type DispatchEstimate = {
  dispatch: string | null;
  arrivalLatest: string | null;
  /** Explica de dónde sale la estimación; nunca es una fecha garantizada. */
  basis: string;
};

/**
 * Estimación: el proveedor despacha el próximo día habitual y la llegada es "hasta" N días después.
 * Si el proveedor ya confirmó una fecha de despacho, se usa esa.
 */
export function estimateDispatch(opts: {
  from: string;
  weekdays: number[];
  holidays: string[];
  maxDays: number;
  confirmedDispatch?: string | null;
}): DispatchEstimate {
  if (opts.confirmedDispatch) {
    return {
      dispatch: opts.confirmedDispatch,
      arrivalLatest: addDays(opts.confirmedDispatch, opts.maxDays),
      basis: `Despacho confirmado por el proveedor; llegada estimada hasta ${opts.maxDays} días después.`,
    };
  }
  const dispatch = nextDispatchDate(opts.from, opts.weekdays, opts.holidays);
  return {
    dispatch,
    arrivalLatest: dispatch ? addDays(dispatch, opts.maxDays) : null,
    basis: dispatch
      ? `Estimado: próximo día habitual de despacho y hasta ${opts.maxDays} días de viaje. Sin confirmación del proveedor.`
      : "No hay días de despacho configurados.",
  };
}

/** Un pedido está demorado si pasó la llegada estimada y todavía no llegó. */
export function isDelayed(o: { estimatedArrivalDate: string | null; actualArrivalDate: string | null }, today: string): boolean {
  return !!o.estimatedArrivalDate && !o.actualArrivalDate && o.estimatedArrivalDate < today;
}
