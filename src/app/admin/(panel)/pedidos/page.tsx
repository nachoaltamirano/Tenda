import Link from "next/link";
import { OrderBadge } from "@/components/OrderBadge";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { STATUS_GROUPS, type OrderStatus } from "@/lib/orders/status";
import { CHANNEL_LABELS } from "@/lib/validation/catalog";
import { listOrders } from "@/server/orders/orders";

export const metadata = { title: "Pedidos" };

const GROUPS: { key: string; label: string; statuses?: OrderStatus[] }[] = [
  { key: "open", label: "Abiertos" },
  { key: "inquiries", label: "Consultas", statuses: STATUS_GROUPS.inquiries },
  { key: "confirmed", label: "Confirmados", statuses: STATUS_GROUPS.confirmed },
  { key: "inTransit", label: "En tránsito", statuses: STATUS_GROUPS.inTransit },
  { key: "received", label: "Recibidos", statuses: STATUS_GROUPS.received },
  { key: "delivered", label: "Entregados", statuses: STATUS_GROUPS.delivered },
  { key: "incident", label: "Incidencias", statuses: STATUS_GROUPS.incident },
  { key: "finished", label: "Finalizados", statuses: STATUS_GROUPS.finished },
  { key: "all", label: "Todos" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ g?: string; q?: string; test?: string }> }) {
  const sp = await searchParams;
  const g = GROUPS.find((x) => x.key === (sp.g ?? "open")) ?? GROUPS[0];
  const statuses =
    g.key === "open" ? (Object.entries(STATUS_GROUPS).filter(([k]) => k !== "finished").flatMap(([, v]) => v) as OrderStatus[]) : g.statuses;
  const orders = await listOrders({ statuses, q: sp.q, includeTest: sp.test === "1" });
  const qs = (key: string) => `?g=${key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${sp.test === "1" ? "&test=1" : ""}`;
  return (
    <>
      <div className="page-head">
        <h1>Pedidos <small>({orders.length})</small></h1>
        <Link className="btn btn-primary" href="/admin/pedidos/nuevo">Crear pedido</Link>
      </div>
      <div className="actions" style={{ marginTop: 0, marginBottom: ".75rem" }}>
        {GROUPS.map((x) => (
          <Link key={x.key} href={qs(x.key)} className={`btn btn-sm ${x.key === g.key ? "btn-primary" : "btn-secondary"}`}>{x.label}</Link>
        ))}
      </div>
      <form className="filters">
        <input type="hidden" name="g" value={g.key} />
        <input type="search" name="q" placeholder="Código, nombre o teléfono" defaultValue={sp.q} />
        <label className="check"><input type="checkbox" name="test" value="1" defaultChecked={sp.test === "1"} /> Incluir pruebas</label>
        <button className="btn btn-secondary" type="submit">Buscar</button>
      </form>
      <div className="card table-wrap">
        {orders.length === 0 ? <p className="muted">No hay pedidos.</p> : (
          <table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Estado</th><th className="num">Total</th><th className="num">Saldo</th><th>Llegada est.</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/pedidos/${o.id}`}><strong>{o.code}</strong></Link><br /><small>{formatDate(o.createdAt)}</small>{o.isTestData && <> <Badge>prueba</Badge></>}</td>
                  <td>{o.customer.name}<br /><small>{CHANNEL_LABELS[o.channel]}</small></td>
                  <td><small>{o.items.map((i) => `${i.brand} ${i.model} ${i.size ?? "?"} ${i.color ?? ""}`).join(" · ")}</small></td>
                  <td><OrderBadge status={o.status} /></td>
                  <td className="num">{formatMoney(o.totals.total)}</td>
                  <td className="num">{o.totals.balance > 0 ? <strong>{formatMoney(o.totals.balance)}</strong> : "—"}</td>
                  <td>{formatDate(o.actualArrivalDate ?? o.estimatedArrivalDate)}{o.actualArrivalDate && <> <Badge tone="ok">llegó</Badge></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
