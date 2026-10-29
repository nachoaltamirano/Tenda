import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { OrderBadge } from "@/components/OrderBadge";
import { Badge, Card, Check, Field, Notice } from "@/components/ui";
import { dateInputValue, formatDate, formatDateTime, moneyInputValue } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { isLocked, STATUS_LABELS } from "@/lib/orders/status";
import { CASH_TYPE_LABELS, CHANNEL_LABELS, DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/validation/catalog";
import { getOrderDetail } from "@/server/orders/orders";
import {
  changeStatusAction,
  deliveryAction,
  expenseAction,
  incidentAction,
  inspectAction,
  logisticsAction,
  notesAction,
  paymentAction,
  purchaseAction,
  receivedAction,
  refundAction,
  supplierConfirmationAction,
  updateItemAction,
} from "../../../order-actions";

export const metadata = { title: "Pedido" };

const INCIDENT_LABELS = { DELAY: "Demora", MISSING: "Faltante", WRONG_ITEM: "Producto equivocado", DAMAGED: "Daño", CUSTOMER: "Cliente", OTHER: "Otra" };
const NEEDS_REASON = ["CANCELLED", "INCIDENT", "RETURNED"];

function PaymentMethodSelect({ name = "method" }: { name?: string }) {
  return (
    <select name={name} defaultValue="TRANSFER">
      {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { order: o, totals: t, transitions } = detail;
  const locked = isLocked(o.status);
  const today = dateInputValue(new Date());
  const waPhone = o.customer.phone?.replace(/\D/g, "");
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  const finished = ["CLOSED", "CANCELLED"].includes(o.status);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{o.code} <OrderBadge status={o.status} /> {o.isTestData && <Badge>prueba</Badge>}</h1>
          <small>
            {o.customer.name}
            {o.customer.phone && <> · <a href={`https://wa.me/${waPhone}`} target="_blank">{o.customer.phone}</a></>} · {CHANNEL_LABELS[o.channel]} · creado {formatDateTime(o.createdAt)}
          </small>
        </div>
        <Link className="btn btn-secondary" href="/admin/pedidos">← Pedidos</Link>
      </div>

      <div className="stats">
        <div className="stat"><div className="value">{formatMoney(t.total)}</div><div className="label">Total acordado</div></div>
        <div className="stat"><div className="value">{formatMoney(t.paid)}</div><div className="label">Cobrado{t.refunds ? ` (neto de ${formatMoney(t.refunds)} devuelto)` : ""}</div></div>
        <div className={`stat${t.balance > 0 ? " attention" : ""}`}><div className="value">{formatMoney(t.balance)}</div><div className="label">Saldo pendiente</div></div>
        <div className="stat"><div className="value">{formatMoney(t.productCost + t.expenses)}</div><div className="label">Costo {o.purchasedAt ? "real" : "estimado"} + gastos</div></div>
        <div className="stat"><div className="value">{formatMoney(t.profit)}</div><div className="label">Resultado {o.status === "CLOSED" ? "" : "estimado"}{!t.costKnown && " (falta costo)"}</div></div>
      </div>

      {!finished && (
        <Card title="Avanzar el pedido">
          <div className="grid grid-3">
            {transitions.map(({ to, errors }) => (
              <ActionForm key={to} action={changeStatusAction} className="card" confirm={to === "CANCELLED" ? "¿Cancelar el pedido?" : undefined}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="to" value={to} />
                <strong>{STATUS_LABELS[to]}</strong>
                {errors.length > 0 && <ul className="field-hint" style={{ paddingLeft: "1rem" }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                {NEEDS_REASON.includes(to) && <input name="reason" placeholder="Motivo *" style={{ marginTop: ".4rem" }} />}
                {to === "CLOSED" && t.balance > 0 && <input name="closeException" placeholder="Excepción autorizada (motivo) *" style={{ marginTop: ".4rem" }} />}
                <div className="actions">
                  <SubmitButton variant={to === "CANCELLED" ? "danger" : errors.length ? "secondary" : "primary"}>Pasar a este estado</SubmitButton>
                </div>
              </ActionForm>
            ))}
          </div>
          {o.cancelReason && <Notice tone="info">Motivo de cancelación: {o.cancelReason}</Notice>}
        </Card>
      )}
      {o.closeExceptionReason && <Notice tone="warn">Cerrado con saldo pendiente. Excepción: {o.closeExceptionReason} (autorizó {o.closeExceptionBy}).</Notice>}

      <Card title="Productos">
        {locked && <p className="field-hint">Pedido confirmado: precio, talle y color acordados quedan fijos.</p>}
        {o.items.map((i) => {
          const costChanged = i.product && i.costSnapshot !== null && i.product.costPrice !== null && i.product.costPrice !== i.costSnapshot;
          return (
            <div key={i.id} className="card">
              <strong>{i.brand} {i.model}</strong> <small>{i.internalSku}</small>{" "}
              {i.product ? <Link href={`/admin/productos/${i.product.id}`}><small>ver producto</small></Link> : <Badge>producto eliminado</Badge>}
              <dl className="kv" style={{ marginTop: ".5rem" }}>
                <dt>Talle / color</dt><dd>{i.size ?? <Badge tone="warn">falta talle</Badge>} · {i.color ?? <Badge tone="warn">falta color</Badge>}</dd>
                <dt>Cantidad</dt><dd>{i.quantity}</dd>
                <dt>Precio acordado</dt><dd><strong>{formatMoney(i.agreedPrice)}</strong></dd>
                <dt>Costo al cotizar</dt><dd>{formatMoney(i.costSnapshot)} <small>(consulta {formatDate(i.costConsultedAt)})</small>{costChanged && !locked && <> <Badge tone="warn">el costo actual es {formatMoney(i.product!.costPrice)}</Badge></>}</dd>
                <dt>Costo real pagado</dt><dd>{formatMoney(i.actualCost)}</dd>
                <dt>Inspección</dt>
                <dd>
                  {i.inspection === "APPROVED" ? <Badge tone="ok">aprobada</Badge> : i.inspection === "REJECTED" ? <Badge tone="bad">rechazada</Badge> : <Badge tone="warn">pendiente</Badge>}
                  {i.inspectionNotes && <small> · {i.inspectionNotes}</small>}{i.inspectedAt && <small> · {formatDateTime(i.inspectedAt)} {i.inspectedBy}</small>}
                </dd>
              </dl>
              {!locked && (
                <ActionForm action={updateItemAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="itemId" value={i.id} />
                  <div className="form-grid">
                    <Field label="Talle" hint={i.product?.sizesOffered.length ? `Oferta: ${i.product.sizesOffered.join(", ")}` : undefined}><input name="size" defaultValue={i.size ?? ""} /></Field>
                    <Field label="Color"><input name="color" defaultValue={i.color ?? ""} /></Field>
                    <Field label="Cantidad"><input type="number" min={1} name="quantity" defaultValue={i.quantity} /></Field>
                    <Field label="Precio acordado"><input name="agreedPrice" inputMode="decimal" defaultValue={moneyInputValue(i.agreedPrice)} /></Field>
                  </div>
                  <div className="actions"><SubmitButton variant="secondary">Guardar</SubmitButton></div>
                </ActionForm>
              )}
              {o.status === "RECEIVED_PENDING_INSPECTION" && i.inspection !== "APPROVED" && (
                <ActionForm action={inspectAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="itemId" value={i.id} />
                  <Field label="Inspección: modelo, talle, color y estado"><input name="notes" placeholder="Observaciones (obligatorio si se rechaza)" /></Field>
                  <div className="actions">
                    <SubmitButton name="result" value="APPROVED">Aprobar</SubmitButton>
                    <SubmitButton variant="danger" name="result" value="REJECTED">Rechazar</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </div>
          );
        })}
      </Card>

      <div className="grid grid-2">
        <Card title="Proveedor">
          <dl className="kv">
            <dt>Consultado</dt><dd>{formatDateTime(o.supplierQueriedAt)}</dd>
            <dt>Disponibilidad confirmada</dt><dd>{o.supplierConfirmedAt ? <>{formatDateTime(o.supplierConfirmedAt)} <Badge tone="ok">confirmada</Badge></> : <Badge tone="warn">sin confirmar</Badge>}</dd>
            {o.supplierConfirmNote && <><dt>Nota</dt><dd>{o.supplierConfirmNote}</dd></>}
            <dt>Compra</dt><dd>{o.purchasedAt ? formatDateTime(o.purchasedAt) : "pendiente"}</dd>
          </dl>
          {!finished && (
            <>
              <h3>Registrar confirmación del proveedor</h3>
              <ActionForm action={supplierConfirmationAction}>
                <input type="hidden" name="id" value={o.id} />
                <div className="form-grid">
                  <Field label="Fecha de la confirmación *"><input type="date" name="confirmedAt" defaultValue={today} required /></Field>
                  <Field label="Despacho confirmado" hint="Solo si el proveedor dio una fecha"><input type="date" name="confirmedDispatchDate" /></Field>
                  <Field label="Nota" wide><input name="note" placeholder="Ej.: confirmó 40 negro, despacha jueves" /></Field>
                </div>
                <div className="actions"><SubmitButton variant="secondary">Registrar confirmación</SubmitButton></div>
              </ActionForm>
            </>
          )}
          {!o.purchasedAt && ["CONFIRMED", "PURCHASE_PENDING"].includes(o.status) && (
            <>
              <h3>Registrar compra al proveedor</h3>
              <ActionForm action={purchaseAction}>
                <input type="hidden" name="id" value={o.id} />
                <div className="form-grid">
                  <Field label="Importe pagado *" hint={`Costo cotizado: ${formatMoney(o.items.reduce((s, i) => s + (i.costSnapshot ?? 0) * i.quantity, 0))}`}><input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Fecha"><input type="date" name="paidAt" defaultValue={today} /></Field>
                  <Field label="Medio"><PaymentMethodSelect /></Field>
                  <Field label="Nota"><input name="note" /></Field>
                </div>
                <div className="actions"><SubmitButton>Registrar compra</SubmitButton></div>
              </ActionForm>
            </>
          )}
        </Card>

        <Card title="Despacho y llegada">
          <p className="field-hint">Las fechas estimadas no son una garantía. Las confirmadas y reales se cargan a medida que ocurren.</p>
          <ActionForm action={logisticsAction}>
            <input type="hidden" name="id" value={o.id} />
            <div className="form-grid">
              <Field label="Despacho estimado"><input type="date" name="estimatedDispatchDate" defaultValue={d(o.estimatedDispatchDate)} /></Field>
              <Field label="Despacho confirmado"><input type="date" name="confirmedDispatchDate" defaultValue={d(o.confirmedDispatchDate)} /></Field>
              <Field label="Despacho real"><input type="date" name="actualDispatchDate" defaultValue={d(o.actualDispatchDate)} /></Field>
              <Field label="Llegada estimada (hasta)"><input type="date" name="estimatedArrivalDate" defaultValue={d(o.estimatedArrivalDate)} /></Field>
              <Field label="Llegada real"><input type="date" name="actualArrivalDate" defaultValue={d(o.actualArrivalDate)} /></Field>
              <Field label="Transporte"><input name="carrier" defaultValue={o.carrier ?? ""} /></Field>
              <Field label="Seguimiento"><input name="trackingCode" defaultValue={o.trackingCode ?? ""} /></Field>
            </div>
            <div className="actions"><SubmitButton variant="secondary">Guardar fechas</SubmitButton></div>
          </ActionForm>
          {["PURCHASED", "IN_TRANSIT"].includes(o.status) && (
            <ActionForm action={receivedAction} className="inline-form">
              <input type="hidden" name="id" value={o.id} />
              <input type="date" name="arrivedAt" defaultValue={today} required />
              <SubmitButton>Marcar recibido</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Cobros">
          {o.payments.length === 0 ? <p className="muted">Sin pagos.</p> : (
            <table>
              <tbody>
                {o.payments.map((p) => (
                  <tr key={p.id}><td>{formatDate(p.paidAt)}</td><td>{PAYMENT_METHOD_LABELS[p.method]}{p.reference && <small> · {p.reference}</small>}</td><td className="num">{formatMoney(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {!finished && t.balance > 0 && (
            <>
              <h3>Registrar pago</h3>
              <ActionForm action={paymentAction}>
                <input type="hidden" name="id" value={o.id} />
                {/* Una clave por formulario: si se envía dos veces, el segundo se rechaza. */}
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <div className="form-grid">
                  <Field label="Importe *" hint={`Saldo: ${formatMoney(t.balance)}`}><input name="amount" inputMode="decimal" required defaultValue={moneyInputValue(t.balance)} /></Field>
                  <Field label="Medio"><PaymentMethodSelect /></Field>
                  <Field label="Fecha"><input type="date" name="paidAt" defaultValue={today} /></Field>
                  <Field label="N° de operación"><input name="reference" /></Field>
                </div>
                <div className="actions"><SubmitButton>Registrar pago</SubmitButton></div>
              </ActionForm>
            </>
          )}
          {t.paid > 0 && (
            <details>
              <summary><small>Registrar devolución</small></summary>
              <ActionForm action={refundAction}>
                <input type="hidden" name="id" value={o.id} />
                <div className="form-grid">
                  <Field label="Importe *"><input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Motivo *"><input name="reason" required /></Field>
                  <Field label="Medio"><PaymentMethodSelect /></Field>
                  <Field label="Fecha"><input type="date" name="occurredAt" defaultValue={today} /></Field>
                </div>
                <div className="actions"><SubmitButton variant="danger">Registrar devolución</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card title="Entrega">
          <ActionForm action={deliveryAction}>
            <input type="hidden" name="id" value={o.id} />
            <div className="form-grid">
              <Field label="Método">
                <select name="method" defaultValue={o.deliveryMethod ?? ""}>
                  <option value="">—</option>
                  {Object.entries(DELIVERY_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Coordinada para"><input type="date" name="scheduledAt" defaultValue={dateInputValue(o.deliveryScheduledAt)} /></Field>
              <Field label="Entregado el"><input type="date" name="deliveredAt" defaultValue={dateInputValue(o.deliveredAt)} /></Field>
              <Field label="Dirección / punto de entrega" wide><input name="address" defaultValue={o.deliveryAddress ?? ""} /></Field>
            </div>
            {o.status === "READY_FOR_DELIVERY" && <Check name="markDelivered" label="Marcar como enviado/entregado" />}
            <div className="actions"><SubmitButton variant="secondary">Guardar entrega</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Gastos del pedido">
          {o.cashMovements.filter((m) => m.type !== "CUSTOMER_PAYMENT").length === 0 ? <p className="muted">Sin gastos ni pagos al proveedor.</p> : (
            <table>
              <tbody>
                {o.cashMovements.filter((m) => m.type !== "CUSTOMER_PAYMENT").map((m) => (
                  <tr key={m.id}><td>{formatDate(m.occurredAt)}</td><td>{CASH_TYPE_LABELS[m.type]}<br /><small>{m.description}</small></td><td className="num">{formatMoney(m.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Agregar gasto</h3>
          <ActionForm action={expenseAction}>
            <input type="hidden" name="id" value={o.id} />
            <div className="form-grid">
              <Field label="Concepto *"><input name="description" required placeholder="Envío, embalaje, comisión…" /></Field>
              <Field label="Importe *"><input name="amount" inputMode="decimal" required /></Field>
              <Field label="Fecha"><input type="date" name="occurredAt" defaultValue={today} /></Field>
            </div>
            <div className="actions"><SubmitButton variant="secondary">Agregar gasto</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="Incidencias">
          {o.incidents.map((inc) => (
            <div key={inc.id} className="card">
              <Badge tone={inc.resolvedAt ? "muted" : "bad"}>{INCIDENT_LABELS[inc.type]}</Badge> {inc.description} <small>· {formatDateTime(inc.createdAt)}</small>
              {inc.resolvedAt ? (
                <div><small>Resuelta {formatDateTime(inc.resolvedAt)}: {inc.resolution}</small></div>
              ) : (
                <ActionForm action={incidentAction} className="inline-form">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <input name="resolution" placeholder="Cómo se resolvió" required />
                  <SubmitButton variant="secondary">Resolver</SubmitButton>
                </ActionForm>
              )}
            </div>
          ))}
          <ActionForm action={incidentAction}>
            <input type="hidden" name="id" value={o.id} />
            <div className="form-grid">
              <Field label="Tipo">
                <select name="type" defaultValue="DELAY">{Object.entries(INCIDENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Field>
              <Field label="Descripción *"><input name="description" required /></Field>
            </div>
            <div className="actions"><SubmitButton variant="secondary">Registrar incidencia</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Notas internas">
          <ActionForm action={notesAction}>
            <input type="hidden" name="id" value={o.id} />
            <textarea name="internalNotes" defaultValue={o.internalNotes ?? ""} />
            <div className="actions"><SubmitButton variant="secondary">Guardar notas</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Historial de estados">
          <table>
            <tbody>
              {o.statusChanges.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: "nowrap" }}><small>{formatDateTime(c.createdAt)}</small></td>
                  <td>{c.from ? `${STATUS_LABELS[c.from]} → ` : ""}<strong>{STATUS_LABELS[c.to]}</strong>{c.note && <div><small>{c.note}</small></div>}</td>
                  <td><small>{c.userEmail}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
