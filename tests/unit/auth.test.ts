import { describe, expect, it } from "vitest";
import { requiresAdmin, signSession, verifySession } from "@/lib/auth/session";

describe("protección del panel", () => {
  it("todas las rutas del panel requieren sesión salvo el login", () => {
    expect(requiresAdmin("/admin")).toBe(true);
    expect(requiresAdmin("/admin/productos")).toBe(true);
    expect(requiresAdmin("/api/admin/x")).toBe(true);
    expect(requiresAdmin("/admin/login")).toBe(false);
    expect(requiresAdmin("/")).toBe(false);
    expect(requiresAdmin("/administracion")).toBe(false);
  });

  it("acepta sesiones firmadas y rechaza manipuladas", async () => {
    const token = await signSession({ userId: "u1", email: "a@b.c", name: "A" });
    expect(await verifySession(token)).toMatchObject({ userId: "u1", email: "a@b.c" });
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin", email: "x@y.z" })).toString("base64url")}.${s}`;
    expect(await verifySession(forged)).toBeNull();
    expect(await verifySession("basura")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});
