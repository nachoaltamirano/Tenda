import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession, type Session } from "@/lib/auth/session";
import { db } from "./db";
import { BusinessError } from "./errors";

const MAX_FAILED = 5;
const WINDOW_MIN = 15;

export async function hashPassword(password: string) {
  if (password.length < 10) throw new BusinessError("La contraseña debe tener al menos 10 caracteres.");
  return bcrypt.hash(password, 12);
}

/** Verifica credenciales con límite de intentos fallidos por email. */
export async function authenticate(emailRaw: string, password: string, ip: string | null): Promise<Session> {
  const email = emailRaw.trim().toLowerCase();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const failed = await db.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } });
  if (failed >= MAX_FAILED) {
    throw new BusinessError(`Demasiados intentos fallidos. Esperá ${WINDOW_MIN} minutos.`, "rate_limited");
  }
  const user = await db.adminUser.findUnique({ where: { email } });
  // Se compara igual aunque el usuario no exista, para no revelar qué emails son válidos.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  await db.loginAttempt.create({ data: { email, ip, success: ok && !!user?.active } });
  if (!user || !ok || !user.active) throw new BusinessError("Email o contraseña incorrectos.", "invalid_credentials");
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { userId: user.id, email: user.email, name: user.name };
}

export async function startSession(session: Session) {
  const token = await signSession(session);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // El usuario debe seguir existiendo y activo.
  const user = await db.adminUser.findUnique({ where: { id: session.userId }, select: { active: true } });
  return user?.active ? session : null;
}

/** Para páginas y acciones del panel: defensa adicional al middleware. */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}
