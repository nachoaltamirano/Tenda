// Build de producción: migraciones + configuración inicial + compilación.
// Con la integración Vercel–Supabase, las conexiones llegan como POSTGRES_PRISMA_URL
// (pooler, para la app) y POSTGRES_URL_NON_POOLING (para migrar); se mapean a los
// nombres que usa Prisma si no se definieron a mano.
import { execSync } from "node:child_process";

const env = { ...process.env };
env.DATABASE_URL ||= env.POSTGRES_PRISMA_URL;
env.DIRECT_URL ||= env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
if (!env.DATABASE_URL) {
  throw new Error("Falta la base de datos: definí DATABASE_URL o conectá Supabase al proyecto de Vercel.");
}
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
  throw new Error("Falta SESSION_SECRET (mínimo 32 caracteres) en las variables de entorno.");
}

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env });
run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx next build");
