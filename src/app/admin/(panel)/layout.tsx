import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { logoutAction } from "../actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="brand">LOBBY</div>
        <nav>
          <Link href="/admin">Inicio</Link>
          <div className="section">Catálogo</div>
          <Link href="/admin/productos">Productos</Link>
          <Link href="/admin/productos/nuevo">+ Registrar producto</Link>
          <Link href="/admin/importar">Importar mensaje</Link>
          <Link href="/admin/precios">Precios pendientes</Link>
          <div className="section">Operación</div>
          <Link href="/admin/pedidos">Pedidos</Link>
          <Link href="/admin/pedidos/nuevo">+ Crear pedido</Link>
          <Link href="/admin/caja">Caja</Link>
          <div className="section">Configuración</div>
          <Link href="/admin/configuracion">Precios y despacho</Link>
          <div className="section">Próximas etapas</div>
          <div className="pending">Stock propio · Tienda · Contenido</div>
        </nav>
        <form action={logoutAction}>
          <small style={{ display: "block", padding: "0 .6rem .4rem" }}>{session.email}</small>
          <button className="btn btn-secondary btn-sm" type="submit">Salir</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
