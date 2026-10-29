import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STATUS_GROUPS, type OrderStatus } from "@/lib/orders/status";
import { db } from "@/server/db";
import { cashSummary, orderAlerts } from "@/server/orders/cash";
import { getPricingSettings } from "@/server/settings";

export const metadata = { title: "Inicio" };

const ALERT_LABELS: Record<string, string> = {
  delayed: "Demorado",
  payment: "Pago pendiente",
  delivery: "Entrega",
  price: "Cambio de precio",
  missing: "Faltante",
  incident: "Incidencia",
};

export default async function Dashboard() {
  const settings = await getPricingSettings();
  const staleBefore = new Date(Date.now() - settings.stalePriceDays * 86_400_000);
  const real = { isTestData: false };
  const count = (statuses: OrderStatus[]) => db.order.count({ where: { ...real, status: { in: statuses } } });
  const [inquiries, confirmed, inTransit, received, incidents, stale, pendingProposals, pendingMessages, staleList, cash, alerts, topProducts] = await Promise.all([
    count(STATUS_GROUPS.inquiries),
    count(STATUS_GROUPS.confirmed),
    count(STATUS_GROUPS.inTransit),
    count(STATUS_GROUPS.received),
    count(STATUS_GROUPS.incident),
    db.product.count({ where: { ...real, OR: [{ costUpdatedAt: null }, { costUpdatedAt: { lt: staleBefore } }] } }),
    db.priceChangeProposal.count({ where: { status: "PENDING", product: real } }),
    db.supplierMessage.count({ where: { status: { in: ["PENDING_REVIEW", "PARTIALLY_APPLIED"] }, isTestData: false } }),
    db.product.findMany({
      where: { ...real, OR: [{ costUpdatedAt: null }, { costUpdatedAt: { lt: staleBefore } }] },
      orderBy: { costUpdatedAt: { sort: "asc", nulls: "first" } },
      take: 6,
      select: { id: true, brand: true, model: true, costUpdatedAt: true },
    }),
    cashSummary(),
    orderAlerts(),
    // Más consultados: productos con más pedidos (incluidas consultas) en los últimos 30 días.
    db.orderItem.groupBy({
      by: ["productId", "brand", "model"],
      where: { order: { ...real, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } },
      _count: { _all: true },
      orderBy: { _count: { productId: "desc" } },
      take: 6,
    }),
  ]);
  const delayed = alerts.filter((a) => a.kind === "delayed").length;
  const paymentsPending = alerts.filter((a) => a.kind === "payment").length;

  const stats = [
    { label: "Consultas y cotizaciones", value: inquiries, href: "/admin/pedidos?g=inquiries" },
    { label: "Pedidos confirmados", value: confirmed, href: "/admin/pedidos?g=confirmed" },
    { label: "En tránsito", value: inTransit, href: "/admin/pedidos?g=inTransit" },
    { label: "Recibidos (inspección, cobro, entrega)", value: received, href: "/admin/pedidos?g=received" },
    { label: "Pedidos atrasados", value: delayed, href: "/admin/pedidos", attention: delayed > 0 },
    { label: "Pagos pendientes", value: paymentsPending, href: "/admin/pedidos?g=received", attention: paymentsPending > 0 },
    { label: "Incidencias", value: incidents, href: "/admin/pedidos?g=incident", attention: incidents > 0 },
    { label: "Capital comprometido", value: formatMoney(cash.committed), href: "/admin/caja" },
    { label: "Saldo de caja", value: formatMoney(cash.net), href: "/admin/caja" },
    { label: "Saldos a cobrar", value: formatMoney(cash.receivables), href: "/admin/caja" },
    { label: `Precios desactualizados (+${settings.stalePriceDays} días)`, value: stale, href: "/admin/productos?stale=1", attention: stale > 0 },
    { label: "Cambios de precio por aprobar", value: pendingProposals, href: "/admin/precios", attention: pendingProposals > 0 },
    { label: "Mensajes por revisar", value: pendingMessages, href: "/admin/importar", attention: pendingMessages > 0 },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Inicio</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="btn btn-primary" href="/admin/pedidos/nuevo">Crear pedido</Link>
          <Link className="btn btn-secondary" href="/admin/importar">Pegar mensaje del proveedor</Link>
          <Link className="btn btn-secondary" href="/admin/productos/nuevo">Registrar producto</Link>
          <Link className="btn btn-secondary" href="/admin/productos">Actualizar precio</Link>
          <Link className="btn btn-secondary" href="/admin/caja">Registrar gasto</Link>
        </div>
      </div>
      {!settings.configured && (
        <Notice tone="warn">
          La configuración de precios todavía no fue revisada. Los precios sugeridos no son confiables hasta completar <Link href="/admin/configuracion">Configuración</Link>.
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

      <div className="grid grid-2">
        <Card title={`Alertas (${alerts.length})`}>
          {alerts.length === 0 ? <p className="muted">Sin alertas.</p> : (
            <table>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td><Link href={`/admin/pedidos/${a.orderId}`}>{a.code}</Link></td>
                    <td><strong>{ALERT_LABELS[a.kind]}</strong> <small>{a.message}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Más consultados (30 días)">
          {topProducts.length === 0 ? <p className="muted">Todavía no hay pedidos.</p> : (
            <table>
              <tbody>
                {topProducts.map((t) => (
                  <tr key={`${t.productId}-${t.model}`}>
                    <td>{t.productId ? <Link href={`/admin/productos/${t.productId}`}>{t.brand} {t.model}</Link> : `${t.brand} ${t.model}`}</td>
                    <td className="num">{t._count._all}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Costos más antiguos">
        {staleList.length === 0 ? <p className="muted">No hay productos con costos desactualizados.</p> : (
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
      <p className="muted">Stock propio y publicaciones pendientes se agregan con sus módulos.</p>
    </>
  );
}
