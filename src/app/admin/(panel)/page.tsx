import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { db } from "@/server/db";
import { getPricingSettings } from "@/server/settings";

export const metadata = { title: "Inicio" };

export default async function Dashboard() {
  const settings = await getPricingSettings();
  const staleBefore = new Date(Date.now() - settings.stalePriceDays * 86_400_000);
  const real = { isTestData: false };
  const [total, published, pendingVerification, stale, pendingProposals, pendingMessages, staleList] = await Promise.all([
    db.product.count({ where: real }),
    db.product.count({ where: { ...real, publicationStatus: "PUBLISHED" } }),
    db.product.count({ where: { ...real, availabilityStatus: "PENDING_VERIFICATION" } }),
    db.product.count({ where: { ...real, OR: [{ costUpdatedAt: null }, { costUpdatedAt: { lt: staleBefore } }] } }),
    db.priceChangeProposal.count({ where: { status: "PENDING", product: real } }),
    db.supplierMessage.count({ where: { status: { in: ["PENDING_REVIEW", "PARTIALLY_APPLIED"] }, isTestData: false } }),
    db.product.findMany({
      where: { ...real, OR: [{ costUpdatedAt: null }, { costUpdatedAt: { lt: staleBefore } }] },
      orderBy: { costUpdatedAt: { sort: "asc", nulls: "first" } },
      take: 8,
      select: { id: true, brand: true, model: true, costUpdatedAt: true, publicationStatus: true },
    }),
  ]);

  const stats = [
    { label: "Productos en catálogo", value: total, href: "/admin/productos" },
    { label: "Publicados", value: published, href: "/admin/productos?publication=PUBLISHED" },
    { label: "Pendientes de verificar", value: pendingVerification, href: "/admin/productos?availability=PENDING_VERIFICATION", attention: pendingVerification > 0 },
    { label: `Precios desactualizados (+${settings.stalePriceDays} días)`, value: stale, href: "/admin/productos?stale=1", attention: stale > 0 },
    { label: "Cambios de precio por aprobar", value: pendingProposals, href: "/admin/precios", attention: pendingProposals > 0 },
    { label: "Mensajes por revisar", value: pendingMessages, href: "/admin/importar", attention: pendingMessages > 0 },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Inicio</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="btn btn-primary" href="/admin/importar">Pegar mensaje del proveedor</Link>
          <Link className="btn btn-secondary" href="/admin/productos/nuevo">Registrar producto</Link>
        </div>
      </div>
      {!settings.configured && (
        <Notice tone="warn">
          La configuración de precios todavía no fue revisada. Los precios sugeridos no son confiables hasta completar{" "}
          <Link href="/admin/configuracion">Configuración</Link>.
        </Notice>
      )}
      <div className="stats">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={`stat${s.attention ? " attention" : ""}`}>
            <div className="value">{s.value}</div>
            <div className="label">{s.label}</div>
          </Link>
        ))}
      </div>
      <Card title="Costos más antiguos">
        {staleList.length === 0 ? (
          <p className="muted">No hay productos con costos desactualizados.</p>
        ) : (
          <table>
            <tbody>
              {staleList.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/admin/productos/${p.id}`}>{p.brand} {p.model}</Link></td>
                  <td className="num">Costo del {formatDate(p.costUpdatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="muted">
        Pedidos, tránsito, pagos, capital comprometido, caja, stock propio y publicaciones se agregan al tablero en las etapas 3 y 5.
      </p>
    </>
  );
}
