import Link from "next/link";
import { AvailabilityBadge, Badge, PublicationBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { AVAILABILITY_LABELS, PUBLICATION_LABELS } from "@/lib/validation/catalog";
import { listProducts } from "@/server/catalog/products";

export const metadata = { title: "Productos" };

type SP = { q?: string; availability?: string; publication?: string; stale?: string; test?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const products = await listProducts({
    q: sp.q,
    availability: sp.availability || undefined,
    publication: sp.publication || undefined,
    stale: sp.stale === "1",
    includeTest: sp.test === "1",
  });
  return (
    <>
      <div className="page-head">
        <h1>Productos <small>({products.length})</small></h1>
        <Link className="btn btn-primary" href="/admin/productos/nuevo">Registrar producto</Link>
      </div>
      <form className="filters">
        <input type="search" name="q" placeholder="Buscar por marca, modelo o SKU" defaultValue={sp.q} />
        <select name="availability" defaultValue={sp.availability ?? ""}>
          <option value="">Toda disponibilidad</option>
          {Object.entries(AVAILABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="publication" defaultValue={sp.publication ?? ""}>
          <option value="">Toda publicación</option>
          {Object.entries(PUBLICATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="check"><input type="checkbox" name="stale" value="1" defaultChecked={sp.stale === "1"} /> Precio desactualizado</label>
        <label className="check"><input type="checkbox" name="test" value="1" defaultChecked={sp.test === "1"} /> Incluir datos de prueba</label>
        <button className="btn btn-secondary" type="submit">Filtrar</button>
      </form>
      <div className="card table-wrap">
        {products.length === 0 ? (
          <p className="muted">No hay productos con estos filtros.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Producto</th>
                <th>Talles / colores</th>
                <th>Disponibilidad</th>
                <th className="num">Costo</th>
                <th className="num">Publicado</th>
                <th className="num">Margen</th>
                <th>Última consulta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.isStale ? "stale" : undefined}>
                  <td>
                    {p.images[0]?.thumbKey ? <img className="thumb-sm" src={`/media/${p.images[0].thumbKey}`} alt="" /> : <div className="thumb-sm" />}
                  </td>
                  <td>
                    <Link href={`/admin/productos/${p.id}`}><strong>{p.brand} {p.model}</strong></Link>
                    <br /><small>{p.internalSku}{p.supplierSku ? ` · prov. ${p.supplierSku}` : ""}</small>
                    {p.isTestData && <> <Badge>prueba</Badge></>}
                  </td>
                  <td><small>{p.sizes.join(", ") || "—"}<br />{p.colors.join(", ")}</small></td>
                  <td><AvailabilityBadge status={p.availabilityStatus} /></td>
                  <td className="num">{formatMoney(p.costPrice, p.currency)}</td>
                  <td className="num">{formatMoney(p.salePrice, p.currency)}</td>
                  <td className="num">
                    {formatPercent(p.analysis.published?.marginPercent)}
                    {p.analysis.publishedBelowMinMargin && <><br /><Badge tone="bad">bajo mínimo</Badge></>}
                  </td>
                  <td>
                    {formatDate(p.lastConsultedAt)}
                    {p.isStale && <><br /><Badge tone="warn">costo desactualizado</Badge></>}
                    {p._count.priceProposals > 0 && <><br /><Badge tone="info">cambio pendiente</Badge></>}
                  </td>
                  <td><PublicationBadge status={p.publicationStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
