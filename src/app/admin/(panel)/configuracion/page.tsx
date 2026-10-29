import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, Field, Notice } from "@/components/ui";
import { formatDateTime, moneyInputValue } from "@/lib/format";
import { WEEKDAY_NAMES } from "@/lib/text";
import { db } from "@/server/db";
import { getDispatchSettings, getPricingSettings } from "@/server/settings";
import { saveDispatchSettingsAction, savePricingSettingsAction, saveSupplierAction } from "../../actions";
import { holidayAction } from "../../order-actions";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const [s, d, suppliers, holidays] = await Promise.all([
    getPricingSettings(),
    getDispatchSettings(),
    db.supplier.findMany({ orderBy: { createdAt: "asc" } }),
    db.holiday.findMany({ where: { date: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { date: "asc" } }),
  ]);
  const pct = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
  return (
    <>
      <h1>Configuración</h1>
      <Card title="Motor de precios">
        {!s.configured && <Notice tone="warn">Valores sin revisar. Completá con tus datos reales y guardá: los campos vacíos se informan como “sin dato” en cada producto.</Notice>}
        <ActionForm action={savePricingSettingsAction}>
          <fieldset>
            <legend>Costos generales por par</legend>
            <div className="form-grid">
              <Field label="Transporte desde el proveedor" hint="Se usa si el producto no tiene uno propio"><input name="defaultTransportCost" inputMode="decimal" defaultValue={moneyInputValue(s.defaultTransportCost)} /></Field>
              <Field label="Embalaje"><input name="packagingCost" inputMode="decimal" defaultValue={moneyInputValue(s.packagingCost)} /></Field>
              <Field label="Envío al cliente asumido por LOBBY" hint="0 si lo paga el cliente"><input name="deliveryCostAssumed" inputMode="decimal" defaultValue={moneyInputValue(s.deliveryCostAssumed)} /></Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Comisiones e impuestos sobre el precio de venta</legend>
            <div className="form-grid">
              <Field label="Comisión de cobro (%)" hint="Ej. Mercado Pago. 0 si cobrás en efectivo/transferencia"><input name="paymentFeePercent" inputMode="decimal" defaultValue={pct(s.paymentFeePercent)} /></Field>
              <Field label="Comisión fija por cobro ($)"><input name="paymentFeeFixed" inputMode="decimal" defaultValue={moneyInputValue(s.paymentFeeFixed)} /></Field>
              <Field label="Impuestos (%)" hint="Ej. Ingresos Brutos según tu régimen"><input name="taxPercent" inputMode="decimal" defaultValue={pct(s.taxPercent)} /></Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Objetivo de ganancia</legend>
            <div className="form-grid">
              <Field label="Modo">
                <select name="targetMode" defaultValue={s.targetMode}>
                  <option value="MARGIN_PERCENT">Margen % sobre precio de venta</option>
                  <option value="MARKUP_PERCENT">Recargo % sobre costo total</option>
                  <option value="FIXED_PROFIT">Ganancia fija en $ por par</option>
                </select>
              </Field>
              <Field label="Valor objetivo" hint="Porcentaje, o pesos si es ganancia fija">
                <input name="targetValue" inputMode="decimal" defaultValue={s.targetValue === null ? "" : s.targetMode === "FIXED_PROFIT" ? moneyInputValue(s.targetValue) : pct(s.targetValue)} />
              </Field>
              <Field label="Margen mínimo (%)" hint="Debajo de este valor se exige confirmación"><input name="minMarginPercent" inputMode="decimal" defaultValue={pct(s.minMarginPercent)} /></Field>
              <Field label="Costo desactualizado después de (días)"><input type="number" min={1} name="stalePriceDays" defaultValue={s.stalePriceDays} /></Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Redondeo del precio sugerido</legend>
            <div className="form-grid">
              <Field label="Redondear a múltiplos de ($)" hint="Ej. 1000. 0 = sin redondeo"><input name="roundingStep" inputMode="decimal" defaultValue={moneyInputValue(s.roundingStep)} /></Field>
              <Field label="Dirección">
                <select name="roundingMode" defaultValue={s.roundingMode}>
                  <option value="UP">Hacia arriba (recomendado)</option>
                  <option value="NEAREST">Al más cercano</option>
                  <option value="DOWN">Hacia abajo</option>
                </select>
              </Field>
              <Field label="Restar al redondear ($)" hint="Ej. 100 para precios terminados en 900"><input name="roundingOffsetDown" inputMode="decimal" defaultValue={moneyInputValue(-s.roundingOffset)} /></Field>
            </div>
          </fieldset>
          <div className="actions"><SubmitButton>Guardar configuración de precios</SubmitButton> <small>Última modificación: {formatDateTime(s.updatedAt)}</small></div>
        </ActionForm>
      </Card>

      <div className="grid grid-2">
        <Card title="Días de despacho del proveedor">
          <ActionForm action={saveDispatchSettingsAction}>
            <div className="actions">
              {WEEKDAY_NAMES.map((name, i) => (
                <label key={name} className="check"><input type="checkbox" name="weekdays" value={i} defaultChecked={d.weekdays.includes(i)} /> {name}</label>
              ))}
            </div>
            <Field label="Plazo máximo estimado (días)"><input type="number" min={1} max={60} name="maxEstimatedDays" defaultValue={d.maxEstimatedDays} /></Field>
            <div className="actions"><SubmitButton>Guardar</SubmitButton></div>
          </ActionForm>
          <h3>Feriados y días sin despacho</h3>
          {holidays.map((h) => (
            <ActionForm key={h.id} action={holidayAction} className="inline-form">
              <input type="hidden" name="removeId" value={h.id} />
              <span>{h.date.toISOString().slice(0, 10).split("-").reverse().join("/")} · {h.description}</span>
              <SubmitButton variant="secondary">Quitar</SubmitButton>
            </ActionForm>
          ))}
          <ActionForm action={holidayAction} className="inline-form">
            <input type="date" name="date" required />
            <input name="description" placeholder="Feriado / el proveedor no despacha" />
            <SubmitButton variant="secondary">Agregar</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Proveedores">
          {suppliers.map((sup) => (
            <ActionForm key={sup.id} action={saveSupplierAction}>
              <input type="hidden" name="id" value={sup.id} />
              <div className="form-grid">
                <Field label="Nombre *"><input name="name" defaultValue={sup.name} required /></Field>
                <Field label="Ciudad"><input name="city" defaultValue={sup.city ?? ""} /></Field>
                <Field label="Contacto (referencia)" wide><input name="contactNote" defaultValue={sup.contactNote ?? ""} /></Field>
                <Field label="Notas" wide><input name="notes" defaultValue={sup.notes ?? ""} /></Field>
              </div>
              <div className="actions"><SubmitButton variant="secondary">Guardar</SubmitButton></div>
              <hr />
            </ActionForm>
          ))}
          <h3>Agregar proveedor</h3>
          <ActionForm action={saveSupplierAction}>
            <div className="form-grid">
              <Field label="Nombre *"><input name="name" required /></Field>
              <Field label="Ciudad"><input name="city" /></Field>
            </div>
            <div className="actions"><SubmitButton variant="secondary">Agregar</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
