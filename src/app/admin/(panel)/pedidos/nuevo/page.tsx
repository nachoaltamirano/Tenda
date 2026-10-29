import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, Check, Field } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { CHANNEL_LABELS } from "@/lib/validation/catalog";
import { db } from "@/server/db";
import { createOrderAction } from "../../../order-actions";

export const metadata = { title: "Crear pedido" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const [customers, products] = await Promise.all([
    db.customer.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.product.findMany({
      where: { availabilityStatus: { notIn: ["DISCONTINUED"] } },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      select: { id: true, brand: true, model: true, internalSku: true, salePrice: true, sizesOffered: true, colorsOffered: true, assortmentNote: true, isTestData: true },
    }),
  ]);
  return (
    <>
      <h1>Crear pedido</h1>
      <p className="muted">Empieza como “Consulta recibida”. El precio y el costo del producto se copian al pedido y quedan fijos al confirmarlo.</p>
      <Card>
        <ActionForm action={createOrderAction}>
          <fieldset>
            <legend>Cliente</legend>
            <div className="form-grid">
              <Field label="Cliente existente">
                <select name="customerId" defaultValue="">
                  <option value="">— Nuevo cliente —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Nombre (cliente nuevo)"><input name="customerName" /></Field>
              <Field label="Teléfono / WhatsApp" hint="Si ya existe, se reutiliza el cliente"><input name="customerPhone" inputMode="tel" /></Field>
              <Field label="Canal">
                <select name="channel" defaultValue="WHATSAPP">
                  {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
          </fieldset>
          {[0, 1, 2].map((i) => (
            <fieldset key={i}>
              <legend>Producto {i + 1}{i > 0 && " (opcional)"}</legend>
              <div className="form-grid">
                <Field label="Producto" wide>
                  <select name={`item${i}.productId`} defaultValue={i === 0 ? product ?? "" : ""}>
                    <option value="">—</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.brand} {p.model} · {formatMoney(p.salePrice)} · talles {p.sizesOffered.join(", ") || "?"}
                        {p.colorsOffered.length ? ` · ${p.colorsOffered.join("/")}` : p.assortmentNote ? ` · ${p.assortmentNote}` : ""}
                        {p.isTestData ? " · [prueba]" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Talle"><input name={`item${i}.size`} inputMode="decimal" placeholder="40" /></Field>
                <Field label="Color elegido"><input name={`item${i}.color`} /></Field>
                <Field label="Cantidad"><input type="number" min={1} max={20} name={`item${i}.quantity`} defaultValue={1} /></Field>
                <Field label="Precio acordado" hint="Vacío = precio publicado"><input name={`item${i}.agreedPrice`} inputMode="decimal" /></Field>
              </div>
            </fieldset>
          ))}
          <Field label="Notas internas"><textarea name="internalNotes" /></Field>
          <Check name="isTestData" label="Pedido de prueba" />
          <div className="actions"><SubmitButton>Crear pedido</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
