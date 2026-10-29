import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ProductFields } from "@/components/ProductFields";
import { AvailabilityBadge, Badge, Card, Check, Field, Notice, PublicationBadge } from "@/components/ui";
import { dateInputValue, daysSince, formatDate, formatDateTime } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { WEEKDAY_NAMES } from "@/lib/text";
import { AVAILABILITY_LABELS, DATA_SOURCE_LABELS } from "@/lib/validation/catalog";
import { getProductDetail } from "@/server/catalog/products";
import { db } from "@/server/db";
import { getPricingSettings } from "@/server/settings";
import {
  imageAction,
  requestPriceUpdateAction,
  setPublicationAction,
  updateProductAction,
  uploadImagesAction,
} from "../../../actions";

export const metadata = { title: "Producto" };

const ACTION_LABELS: Record<string, string> = {
  create: "Alta",
  update: "Edición",
  price_proposal: "Propuesta de precio",
  price_approved: "Precio aprobado",
  price_rejected: "Propuesta rechazada",
  cost_confirmed: "Costo confirmado",
  publication: "Publicación",
  import_update: "Actualización desde mensaje",
  image_added: "Foto agregada",
  image_removed: "Foto quitada",
  image_cover: "Portada",
  image_reorder: "Orden de fotos",
  image_authorization: "Autorización de foto",
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();
  const { product: p, analysis: a, history, publicationBlockers } = detail;
  const [suppliers, settings] = await Promise.all([db.supplier.findMany({ orderBy: { name: "asc" } }), getPricingSettings()]);
  const costAge = daysSince(p.costUpdatedAt);
  const stale = costAge === null || costAge > settings.stalePriceDays;
  const pending = p.priceProposals.find((x) => x.status === "PENDING");
  const sugg = a.suggestion?.ok ? a.suggestion : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.brand} {p.model}</h1>
          <small>
            {p.internalSku} {p.supplierSku && `· SKU proveedor ${p.supplierSku}`} · {p.supplier?.name ?? "sin proveedor"} · /{p.slug}
          </small>
          <div className="actions" style={{ marginTop: ".4rem" }}>
            <AvailabilityBadge status={p.availabilityStatus} />
            <PublicationBadge status={p.publicationStatus} />
            {p.isTestData && <Badge>dato de prueba</Badge>}
            {p.dataVerified ? <Badge tone="ok">verificado</Badge> : <Badge tone="warn">sin verificar</Badge>}
          </div>
        </div>
        <ActionForm action={setPublicationAction} className="inline-form">
          <input type="hidden" name="id" value={p.id} />
          {p.publicationStatus !== "PUBLISHED" && <SubmitButton name="status" value="PUBLISHED">Publicar</SubmitButton>}
          {p.publicationStatus === "PUBLISHED" && <SubmitButton variant="secondary" name="status" value="PAUSED">Pausar</SubmitButton>}
          {p.publicationStatus !== "DRAFT" && <SubmitButton variant="secondary" name="status" value="DRAFT">Pasar a borrador</SubmitButton>}
        </ActionForm>
      </div>

      {publicationBlockers.length > 0 && p.publicationStatus !== "PUBLISHED" && (
        <Notice tone="info">
          Para publicar falta:
          <ul>{publicationBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </Notice>
      )}

      <div className="grid grid-2">
        <Card title="Rentabilidad">
          {a.errors.map((e) => <Notice key={e} tone="error">{e}</Notice>)}
          {a.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          {!settings.configured && <Notice tone="warn">La configuración de precios no fue revisada todavía.</Notice>}
          <table className="money-table">
            <tbody>
              {a.base.breakdown.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td>
                    {b.value === null ? <Badge tone="warn">sin dato</Badge> : b.key.endsWith("Percent") ? formatPercent(b.value, 2) : formatMoney(b.value, p.currency)}
                  </td>
                </tr>
              ))}
              <tr className="total"><td>Costo total (con precio publicado)</td><td>{formatMoney(a.published?.totalCost, p.currency)}</td></tr>
            </tbody>
          </table>
          <dl className="kv" style={{ marginTop: "1rem" }}>
            <dt>Costo del producto</dt><dd>{formatMoney(a.productCost, p.currency)}</dd>
            <dt>Precio sugerido</dt>
            <dd>
              {formatMoney(sugg?.suggestedPrice, p.currency)}
              {sugg && <small> (margen {formatPercent(sugg.evaluation.marginPercent)}, ganancia {formatMoney(sugg.evaluation.profit, p.currency)})</small>}
            </dd>
            <dt>Precio publicado</dt><dd><strong>{formatMoney(p.salePrice, p.currency)}</strong></dd>
            <dt>Ganancia estimada</dt><dd>{formatMoney(a.published?.profit, p.currency)}</dd>
            <dt>Margen</dt><dd>{formatPercent(a.published?.marginPercent)} {settings.minMarginPercent !== null && <small>(mínimo {formatPercent(settings.minMarginPercent)})</small>}</dd>
            <dt>Recargo sobre costo</dt><dd>{formatPercent(a.published?.markupPercent)}</dd>
            <dt>Última actualización del costo</dt>
            <dd>
              {formatDate(p.costUpdatedAt)} {costAge !== null && <small>(hace {costAge} días)</small>} {stale && <Badge tone="warn">desactualizado</Badge>}
            </dd>
          </dl>
        </Card>

        <Card title="Actualizar precio del proveedor">
          {pending && (
            <Notice tone="info">
              Hay un cambio pendiente: {formatMoney(pending.oldCostPrice, p.currency)} → {formatMoney(pending.newCostPrice, p.currency)}.{" "}
              <Link href="/admin/precios">Revisar y aprobar</Link>
            </Notice>
          )}
          <ActionForm action={requestPriceUpdateAction}>
            <input type="hidden" name="id" value={p.id} />
            <div className="form-grid">
              <Field label="Costo informado *" hint={`Vigente: ${formatMoney(p.costPrice, p.currency)}`}>
                <input name="newCostPrice" inputMode="decimal" required />
              </Field>
              <Field label="Fecha de la consulta *"><input type="date" name="consultedAt" required defaultValue={dateInputValue(new Date())} /></Field>
              <Field label="Fuente">
                <select name="source" defaultValue="WHATSAPP_GROUP">
                  {Object.entries(DATA_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Nota" wide><input name="note" /></Field>
            </div>
            <p className="field-hint">No se aplica directamente: se crea una propuesta con el impacto en el margen para aprobar.</p>
            <div className="actions"><SubmitButton>Registrar consulta de precio</SubmitButton></div>
          </ActionForm>
          <h3>Oferta del proveedor</h3>
          <dl className="kv">
            <dt>Talles</dt><dd>{p.sizesOffered.join(", ") || <Badge tone="warn">sin dato</Badge>}</dd>
            <dt>Colores</dt><dd>{p.colorsOffered.join(", ") || "—"}</dd>
            {p.assortmentNote && <><dt>Surtido</dt><dd>{p.assortmentNote}</dd></>}
          </dl>
          <h3>Datos de origen</h3>
          <dl className="kv">
            <dt>Fuente</dt><dd>{DATA_SOURCE_LABELS[p.dataSource]}</dd>
            <dt>Fecha del dato</dt><dd>{formatDate(p.dataDate)}</dd>
            <dt>Última consulta</dt><dd><strong>{formatDate(p.lastConsultedAt)}</strong></dd>
            <dt>Próximo despacho</dt>
            <dd>
              {p.nextDispatchDate ? formatDate(p.nextDispatchDate) : p.nextDispatchWeekday !== null ? WEEKDAY_NAMES[p.nextDispatchWeekday] : "—"}{" "}
              {(p.nextDispatchDate || p.nextDispatchWeekday !== null) &&
                (p.nextDispatchConfirmed ? <Badge tone="ok">confirmado</Badge> : <Badge tone="warn">estimado</Badge>)}
              {p.nextDispatchMode && <small> · {p.nextDispatchMode}</small>}
            </dd>
            <dt>Plazo estimado</dt><dd>{p.estimatedDeliveryDays !== null ? `${p.estimatedDeliveryDays} días` : "plazo general"}</dd>
          </dl>
        </Card>
      </div>

      <Card title={`Fotos (${p.images.length})`}>
        <div className="thumbs">
          {p.images.map((img, i) => (
            <div key={img.id} className={`thumb${img.isCover ? " cover" : ""}`}>
              <img src={`/media/${img.thumbKey ?? img.originalKey}`} alt="" />
              <div style={{ margin: ".3rem 0" }}>
                {img.isCover && <Badge tone="ok">portada</Badge>}{" "}
                {img.authorizedForPublication ? <Badge tone="ok">autorizada</Badge> : <Badge tone="warn">no autorizada</Badge>}
                <br />
                <small>{img.sourceType === "SUPPLIER" ? "Proveedor" : img.sourceType === "OWN_PHOTO" ? "Foto propia" : "Otra autorizada"}{img.sourceNote ? ` · ${img.sourceNote}` : ""}</small>
              </div>
              <ActionForm action={imageAction} className="inline-form">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="imageId" value={img.id} />
                {!img.isCover && <button className="btn btn-secondary btn-sm" name="op" value="cover">Portada</button>}
                {i > 0 && <button className="btn btn-secondary btn-sm" name="op" value="up" aria-label="Mover antes">←</button>}
                {i < p.images.length - 1 && <button className="btn btn-secondary btn-sm" name="op" value="down" aria-label="Mover después">→</button>}
                <button className="btn btn-secondary btn-sm" name="op" value={img.authorizedForPublication ? "unauthorize" : "authorize"}>
                  {img.authorizedForPublication ? "Desautorizar" : "Autorizar"}
                </button>
                <a className="btn btn-secondary btn-sm" href={`/media/${img.originalKey}`} target="_blank">Original</a>
                <button className="btn btn-danger btn-sm" name="op" value="remove">Quitar</button>
              </ActionForm>
            </div>
          ))}
        </div>
        <h3>Cargar fotos</h3>
        <ActionForm action={uploadImagesAction}>
          <input type="hidden" name="id" value={p.id} />
          <div className="form-grid">
            <Field label="Archivos *" hint="JPG, PNG, WEBP o HEIC. Máx. 12 MB c/u."><input type="file" name="files" multiple accept="image/*" required /></Field>
            <Field label="Fuente de la foto">
              <select name="sourceType" defaultValue="SUPPLIER">
                <option value="SUPPLIER">Proporcionada por el proveedor</option>
                <option value="OWN_PHOTO">Foto propia de LOBBY</option>
                <option value="OTHER_AUTHORIZED">Otra fuente autorizada</option>
              </select>
            </Field>
            <Field label="Detalle de la fuente"><input name="sourceNote" placeholder="ej. grupo WhatsApp 27/10" /></Field>
          </div>
          <Check name="authorized" label="Tengo autorización para publicar estas fotos" />
          <div className="actions"><SubmitButton variant="secondary">Subir</SubmitButton></div>
        </ActionForm>
        <p className="field-hint">Quitar una foto la oculta del catálogo pero conserva el archivo para pedidos y publicaciones anteriores.</p>
      </Card>

      <Card title="Editar datos del producto">
        <ActionForm action={updateProductAction}>
          <input type="hidden" name="id" value={p.id} />
          <ProductFields product={p} suppliers={suppliers} />
          <Field label="Motivo del cambio (queda en el historial)"><input name="reason" /></Field>
          <div className="actions"><SubmitButton>Guardar cambios</SubmitButton></div>
        </ActionForm>
      </Card>

      <div className="grid grid-2">
        <Card title="Historial de costos">
          {p.costHistory.length === 0 ? <p className="muted">Sin registros.</p> : (
            <table>
              <thead><tr><th>Consulta</th><th className="num">Costo</th><th>Fuente</th><th>Nota</th></tr></thead>
              <tbody>
                {p.costHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.consultedAt)}</td>
                    <td className="num">{formatMoney(h.costPrice, h.currency)}</td>
                    <td><small>{DATA_SOURCE_LABELS[h.source]}</small></td>
                    <td><small>{h.note}{h.supplierMessageId && <> · <Link href={`/admin/importar/${h.supplierMessageId}`}>mensaje</Link></>}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Historial de modificaciones">
          {history.length === 0 ? <p className="muted">Sin registros.</p> : (
            <table>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}><small>{formatDateTime(h.createdAt)}</small></td>
                    <td>
                      <strong>{ACTION_LABELS[h.action] ?? h.action}</strong> <small>{h.userEmail}</small>
                      {h.reason && <div><small>Motivo: {h.reason}</small></div>}
                      {h.changes && <details><summary><small>detalle</small></summary><pre className="raw">{JSON.stringify(h.changes, null, 1)}</pre></details>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
