// Uso: pnpm admin:create <email> "<nombre>"   (la contraseña se pide por consola o por ADMIN_PASSWORD)
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) throw new Error('Uso: pnpm admin:create <email> "<nombre>"');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Contraseña (mínimo 10 caracteres): ");
    rl.close();
  }
  if (password.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres.");
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.adminUser.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), name, passwordHash },
    update: { name, passwordHash, active: true },
  });
  console.log(`Administrador listo: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
