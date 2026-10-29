import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Card, Check, Field, Notice } from "@/components/ui";
import { dateInputValue, formatDateTime, moneyInputValue } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { WEEKDAY_NAMES } from "@/lib/text";
import { AVAILABILITY_LABELS, DATA_SOURCE_LABELS } from "@/lib/validation/catalog";
import { getMessageForReview } from "@/server/catalog/import";
import { db } from "@/server/db";
import { applyItemAction, discardMessageAction } from "../../../actions";

export const metadata = { title: "Revisar mensaje" };

const FIELD_LABELS: Record<string, string> = {
  brand: "marca", model: "modelo", colors: "color", sizes: "talles", price: "precio", supplierSku: "SKU", dispatch: "despacho", stock: "stock", notes: "notas",
  photos: "fotos",
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = await getMessageForReview(id);
  if (!review) notFound();
  const { message: m, parsed, items, unassigned } = review;
  const allProducts = await db.product.findMany({ orderBy: [{ brand: "asc" }, { model: "asc" }], select: { id: true, brand: true, model: true, internalSku: true } });
  const closed = m.status === "DISCARDED";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Revisar mensaje</h1>
          <small>{m.supplier.name} · {DATA_SOURCE_LABELS[m.source]} · consulta {formatDateTime(m.consultedAt)}{m.receivedAt && ` · enviado ${formatDateTime(m.receivedAt)}`}</small>
        </div>
        {!closed && m.status !== "APPLIED" && (
          <ActionForm action={discardMessageAction} confirm="¿Descartar este mensaje? El texto se conserva.">
            <input type="hidden" name="id" value={m.id} />
            <SubmitButton variant="danger">Descartar mensaje</SubmitButton>
          </ActionForm>
        )}
      </div>
      {closed && <Notice tone="info">Mensaje descartado.</Notice>}

      <Card title="Texto original">
        <pre className="raw">{m.rawText}</pre>
        {parsed.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        {parsed.ignoredLines.length > 0 && (
          <details><summary><small>Líneas ignoradas ({parsed.ignoredLines.length})</small></summary><pre className="raw">{parsed.ignoredLines.join("\n")}</pre></details>
        )}
      </Card>

      {m.attachments.length > 0 && (
        <Card title={`Fotos subidas con el mensaje (${m.attachments.length})`}>
          <div className="thumbs">
            {m.attachments.map((a) => (
              <div key={a.id} className="thumb">
                <img src={`/media/${a.thumbKey}`} alt={a.filename} />
                <small>{a.filename}</small>{" "}
                {a.images.length > 0 ? <Badge tone="ok">vinculada</Badge> : unassigned.some((u) => u.id === a.id) ? <Badge tone="warn">sin mencionar</Badge> : null}
              </div>
            ))}
          </div>
        </Card>
      )}

      {items.map(({ index, item, applied, matches, photos }) => {
        const best = matches[0];
        const defaultAction = best?.kind === "exact" ? "update" : "create";
        return (
          <Card
            key={index}
            title={`Producto ${index + 1}: ${[item.brand, item.model].filter(Boolean).join(" ") || "(sin modelo)"}`}
            actions={applied ? <Badge tone="ok">aplicado</Badge> : <Badge tone="warn">por revisar</Badge>}
          >
            <pre className="raw">{item.rawText}</pre>
            {item.missing.length > 0 && <Notice tone="warn">Falta en el mensaje: {item.missing.map((f) => FIELD_LABELS[f]).join(", ")}. No se completa automáticamente.</Notice>}
            {item.clarifications.length > 0 && (
              <Notice tone="error">Requiere aclaración:<ul>{item.clarifications.map((c) => <li key={c}>{c}</li>)}</ul></Notice>
            )}
            {item.warnings.length > 0 && <Notice tone="warn"><ul>{item.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>}
            {photos.missing.length > 0 && (
              <Notice tone="warn">El mensaje menciona {photos.missing.join(", ")} pero no se subió ningún archivo con ese nombre.</Notice>
            )}
            {item.dispatch && (
              <p><small>Despacho informado: “{item.dispatch.text}” → {item.dispatch.date ?? (item.dispatch.weekday !== null ? WEEKDAY_NAMES[item.dispatch.weekday] : "sin día reconocido")} (estimado, no confirmado)</small></p>
            )}
            {matches.length > 0 && (
              <Notice tone="info">
                Productos existentes parecidos:
                <ul>{matches.map((x) => <li key={x.product.id}><Link href={`/admin/productos/${x.product.id}`}>{x.product.brand} {x.product.model}</Link> ({x.product.internalSku}) — {x.reason}</li>)}</ul>
              </Notice>
            )}
            {applied ? (
              <p>Aplicado el {formatDateTime(applied.at)} → <Link href={`/admin/productos/${applied.productId}`}>ver producto</Link>
                {applied.price === "proposal" && <> · cambio de precio <Link href="/admin/precios">pendiente de aprobación</Link></>}
                {applied.photos ? <> · {applied.photos} foto(s) vinculada(s)</> : null}</p>
            ) : closed ? null : (
              <ActionForm action={applyItemAction}>
                <input type="hidden" name="messageId" value={m.id} />
                <input type="hidden" name="itemIndex" value={index} />
                <div className="form-grid">
                  <Field label="Acción">
                    <select name="action" defaultValue={defaultAction}>
                      <option value="create">Crear producto nuevo</option>
                      <option value="update">Actualizar producto existente</option>
                    </select>
                  </Field>
                  <Field label="Producto a actualizar">
                    <select name="productId" defaultValue={best?.product.id ?? ""}>
                      <option value="">—</option>
                      {matches.map((x) => <option key={x.product.id} value={x.product.id}>★ {x.product.brand} {x.product.model} ({x.product.internalSku})</option>)}
                      {allProducts.filter((p) => !matches.some((x) => x.product.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.brand} {p.model} ({p.internalSku})</option>)}
                    </select>
                  </Field>
                  <Field label="Marca *"><input name="brand" defaultValue={item.brand ?? ""} required /></Field>
                  <Field label="Modelo *"><input name="model" defaultValue={item.model ?? ""} required /></Field>
                  <Field label="SKU del proveedor"><input name="supplierSku" defaultValue={item.supplierSku ?? ""} /></Field>
                  <Field label="Talles ofrecidos *" hint="Separados por coma"><input name="sizes" defaultValue={item.sizes.join(", ")} /></Field>
                  <Field label="Colores" hint="Opcional"><input name="colors" defaultValue={item.colors.join(", ")} /></Field>
                  <Field label="Nota de surtido"><input name="assortmentNote" defaultValue={item.assortmentNote ?? ""} /></Field>
                  <Field label="Costo del proveedor" hint="Vacío si no se informó"><input name="price" inputMode="decimal" defaultValue={moneyInputValue(item.price)} /></Field>
                  <Field label="Moneda">
                    <select name="currency" defaultValue={item.currency ?? "ARS"}><option value="ARS">ARS</option><option value="USD">USD</option></select>
                  </Field>
                  <Field label="Disponibilidad">
                    <select name="availabilityStatus" defaultValue="AVAILABLE_LAST_CHECK">
                      {Object.entries(AVAILABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Día de despacho">
                    <select name="nextDispatchWeekday" defaultValue={item.dispatch?.weekday ?? ""}>
                      <option value="">—</option>
                      {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Fecha de despacho"><input type="date" name="nextDispatchDate" defaultValue={item.dispatch?.date ? dateInputValue(`${item.dispatch.date}T12:00:00-03:00`) : ""} /></Field>
                  <Field label="Notas" wide><input name="notes" defaultValue={[item.stockNote && `Stock: ${item.stockNote}`, item.notes].filter(Boolean).join(" · ")} /></Field>
                </div>
                {(photos.matched.length > 0 || unassigned.length > 0) && (
                  <fieldset style={{ marginTop: ".75rem" }}>
                    <legend>Fotos para este producto</legend>
                    <div className="thumbs">
                      {photos.matched.map((ph, i) => {
                        const a = m.attachments.find((x) => x.id === ph.attachmentId)!;
                        return (
                          <label key={a.id} className="thumb">
                            <img src={`/media/${a.thumbKey}`} alt={a.filename} />
                            <span className="check"><input type="checkbox" name="attachmentIds" value={a.id} defaultChecked /> {a.filename}</span>
                            {i === 0 && <Badge tone="ok">portada</Badge>} {!ph.exact && <Badge tone="warn">mencionada como {ph.name}</Badge>}
                          </label>
                        );
                      })}
                      {unassigned.map((a) => (
                        <label key={a.id} className="thumb">
                          <img src={`/media/${a.thumbKey}`} alt={a.filename} />
                          <span className="check"><input type="checkbox" name="attachmentIds" value={a.id} /> {a.filename}</span>
                          <Badge>sin mencionar</Badge>
                        </label>
                      ))}
                    </div>
                    <Check name="authorizePhotos" label="El proveedor autoriza publicar estas fotos (si no se marca, quedan cargadas pero no se publican)" />
                  </fieldset>
                )}
                {item.price !== null && <p className="field-hint">Precio detectado: {formatMoney(item.price, item.currency ?? "ARS")}. Si el producto ya existe con otro costo, se crea una propuesta para aprobar.</p>}
                <Check name="confirmDuplicate" label="Al crear: confirmo que es un producto distinto de los parecidos" />
                <div className="actions"><SubmitButton>Aplicar este producto</SubmitButton></div>
              </ActionForm>
            )}
          </Card>
        );
      })}
    </>
  );
}
