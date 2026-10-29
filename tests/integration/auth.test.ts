import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticate } from "@/server/auth";
import { db } from "@/server/db";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await db.adminUser.create({ data: { email: "admin@lobby.test", name: "Test", passwordHash: await bcrypt.hash("clave-correcta-123", 4) } });
});

describe("acceso al panel", () => {
  it("valida credenciales sin revelar si el email existe", async () => {
    await expect(authenticate("admin@lobby.test", "mal", null)).rejects.toThrow("Email o contraseña incorrectos.");
    await expect(authenticate("nadie@lobby.test", "mal", null)).rejects.toThrow("Email o contraseña incorrectos.");
    await expect(authenticate(" ADMIN@lobby.test ", "clave-correcta-123", null)).resolves.toMatchObject({ email: "admin@lobby.test" });
  });

  it("bloquea tras 5 intentos fallidos aunque luego se use la clave correcta", async () => {
    for (let i = 0; i < 5; i++) await expect(authenticate("admin@lobby.test", "mal", null)).rejects.toThrow();
    await expect(authenticate("admin@lobby.test", "clave-correcta-123", null)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("rechaza usuarios desactivados", async () => {
    await db.adminUser.update({ where: { email: "admin@lobby.test" }, data: { active: false } });
    await expect(authenticate("admin@lobby.test", "clave-correcta-123", null)).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
