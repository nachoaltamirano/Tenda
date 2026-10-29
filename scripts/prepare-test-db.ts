// Aplica las migraciones a la base de pruebas (TEST_DATABASE_URL).
import { execSync } from "node:child_process";
import { config } from "dotenv";

config();
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Falta TEST_DATABASE_URL");
if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL no puede ser igual a DATABASE_URL");
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
