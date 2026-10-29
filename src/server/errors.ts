/** Error de regla comercial: su mensaje se muestra tal cual al administrador. */
export class BusinessError extends Error {
  constructor(
    message: string,
    public readonly code: string = "business_rule",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: string; details?: unknown; fieldErrors?: Record<string, string[]> };
