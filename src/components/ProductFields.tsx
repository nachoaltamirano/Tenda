import type { Product, Supplier } from "@prisma/client";
import { dateInputValue, moneyInputValue } from "@/lib/format";
import { WEEKDAY_NAMES } from "@/lib/text";
import { AVAILABILITY_LABELS, DATA_SOURCE_LABELS } from "@/lib/validation/catalog";
import { Check, Field } from "./ui";

/** Campos generales del producto (alta y edición). El costo del proveedor se maneja aparte. */
export function ProductFields({ product, suppliers }: { product?: Product; suppliers: Supplier[] }) {
  const p = product;
  return (
    <>
      <fieldset>
        <legend>Identificación</legend>
        <div className="form-grid">
          <Field label="Marca *"><input name="brand" required defaultValue={p?.brand} /></Field>
          <Field label="Modelo *"><input name="model" required defaultValue={p?.model} /></Field>
          <Field label="SKU del proveedor"><input name="supplierSku" defaultValue={p?.supplierSku ?? ""} /></Field>
          <Field label="Categoría"><input name="category" defaultValue={p?.category ?? ""} placeholder="urbanas, running…" /></Field>
          <Field label="Proveedor">
            <select name="supplierId" defaultValue={p?.supplierId ?? suppliers[0]?.id ?? ""}>
              <option value="">— Sin proveedor —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Descripción" wide hint="Solo datos reales del producto. No inventar materiales ni características.">
            <textarea name="description" defaultValue={p?.description ?? ""} />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Oferta del proveedor</legend>
        <div className="form-grid">
          <Field label="Talles ofrecidos *" hint="Separados por coma (40.5 para medio talle)">
            <input name="sizesOffered" defaultValue={p?.sizesOffered.join(", ")} placeholder="38, 39, 40, 41, 42, 43" />
          </Field>
          <Field label="Colores" hint="Opcional. Separados por coma">
            <input name="colorsOffered" defaultValue={p?.colorsOffered.join(", ")} />
          </Field>
          <Field label="Nota de surtido" hint="Ej.: Surtidas (sueltas a elección)">
            <input name="assortmentNote" defaultValue={p?.assortmentNote ?? ""} />
          </Field>
        </div>
        <p className="field-hint">La disponibilidad de cada par se confirma con el proveedor cuando un cliente consulta.</p>
      </fieldset>

      <fieldset>
        <legend>Costos adicionales y precio de venta</legend>
        <div className="form-grid">
          <Field label="Moneda">
            <select name="currency" defaultValue={p?.currency ?? "ARS"}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Transporte desde el proveedor" hint="Vacío = usar el valor general configurado">
            <input name="transportCost" inputMode="decimal" defaultValue={moneyInputValue(p?.transportCost)} />
          </Field>
          <Field label="Accesorios / personalización"><input name="accessoriesCost" inputMode="decimal" defaultValue={moneyInputValue(p?.accessoriesCost)} /></Field>
          <Field label="Otros costos"><input name="otherCosts" inputMode="decimal" defaultValue={moneyInputValue(p?.otherCosts)} /></Field>
          <Field label="Precio de venta publicado"><input name="salePrice" inputMode="decimal" defaultValue={moneyInputValue(p?.salePrice)} /></Field>
        </div>
        <Check name="acceptLowMargin" label="Confirmo guardar aunque el margen quede por debajo del mínimo" />
      </fieldset>

      <fieldset>
        <legend>Disponibilidad y fuente del dato</legend>
        <div className="form-grid">
          <Field label="Estado de disponibilidad">
            <select name="availabilityStatus" defaultValue={p?.availabilityStatus ?? "PENDING_VERIFICATION"}>
              {Object.entries(AVAILABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Fuente del dato">
            <select name="dataSource" defaultValue={p?.dataSource ?? "MANUAL"}>
              {Object.entries(DATA_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Fecha del dato"><input type="date" name="dataDate" defaultValue={dateInputValue(p?.dataDate)} /></Field>
          <Field label="Fecha de última consulta"><input type="date" name="lastConsultedAt" defaultValue={dateInputValue(p?.lastConsultedAt)} /></Field>
          <Field label="Plazo estimado de entrega (días)" hint="Vacío = plazo general">
            <input type="number" min={0} max={90} name="estimatedDeliveryDays" defaultValue={p?.estimatedDeliveryDays ?? ""} />
          </Field>
        </div>
        <Check name="dataVerified" label="Datos verificados con el proveedor" defaultChecked={p?.dataVerified} />
      </fieldset>

      <fieldset>
        <legend>Próximo despacho informado</legend>
        <div className="form-grid">
          <Field label="Día">
            <select name="nextDispatchWeekday" defaultValue={p?.nextDispatchWeekday ?? ""}>
              <option value="">—</option>
              {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" name="nextDispatchDate" defaultValue={dateInputValue(p?.nextDispatchDate)} /></Field>
          <Field label="Modalidad"><input name="nextDispatchMode" defaultValue={p?.nextDispatchMode ?? ""} placeholder="transporte, encomienda…" /></Field>
        </div>
        <Check name="nextDispatchConfirmed" label="Despacho confirmado por el proveedor (si no, se muestra como estimado)" defaultChecked={p?.nextDispatchConfirmed} />
      </fieldset>

      <fieldset>
        <legend>Observaciones</legend>
        <div className="form-grid">
          <Field label="Observaciones internas" wide><textarea name="notes" defaultValue={p?.notes ?? ""} /></Field>
          <Field label="Condiciones particulares" wide><textarea name="conditions" defaultValue={p?.conditions ?? ""} /></Field>
        </div>
        <Check name="isTestData" label="Dato de prueba (no se muestra en tablero ni en tienda)" defaultChecked={p?.isTestData} />
      </fieldset>
    </>
  );
}
