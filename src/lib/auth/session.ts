// Sesión del panel: JWT firmado (HS256) en cookie httpOnly.
// Este módulo no depende de Node ni de la base: se usa también en el middleware.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lobby_session";
export const SESSION_HOURS = 12;

export type Session = { userId: string; email: string; name: string };

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET no configurado o demasiado corto (mínimo 32 caracteres)");
  return new TextEncoder().encode(s);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ email: session.email, name: session.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email, name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

/** Rutas del panel que no requieren sesión. */
export function isPublicAdminPath(pathname: string): boolean {
  return pathname === "/admin/login";
}

export function requiresAdmin(pathname: string): boolean {
  return (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin")) && !isPublicAdminPath(pathname);
}
