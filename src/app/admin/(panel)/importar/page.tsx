import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Card, Check, Field, Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { DATA_SOURCE_LABELS } from "@/lib/validation/catalog";
import { listMessages } from "@/server/catalog/import";
import { db } from "@/server/db";
import { createMessageAction } from "../../actions";

export const metadata = { title: "Importar mensaje" };

const STATUS: Record<string, [string, "warn" | "info" | "ok" | "muted"]> = {
  PENDING_REVIEW: ["Por revisar", "warn"],
  PARTIALLY_APPLIED: ["Aplicado en parte", "info"],
  APPLIED: ["Aplicado", "ok"],
  DISCARDED: ["Descartado", "muted"],
};

function nowLocal() {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 16).replace(" ", "T");
}

export default async function ImportPage() {
  const [suppliers, messages] = await Promise.all([db.supplier.findMany({ orderBy: { name: "asc" } }), listMessages()]);
  return (
    <>
      <h1>Importar mensaje del proveedor</h1>
      <Card>
        <p className="muted" style={{ marginTop: 0 }}>
          Copiá el mensaje de WhatsApp (grupo de ofertas o chat directo) y pegalo acá. El sistema propone los campos, pero no guarda nada en el catálogo
          hasta que revises cada producto. El texto original se conserva tal cual.
        </p>
        {suppliers.length === 0 ? (
          <Notice tone="warn">Primero cargá el proveedor en <Link href="/admin/configuracion">Configuración</Link>.</Notice>
        ) : (
          <ActionForm action={createMessageAction}>
            <div className="form-grid">
              <Field label="Proveedor *">
                <select name="supplierId" defaultValue={suppliers[0].id}>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Origen *">
                <select name="source" defaultValue="WHATSAPP_GROUP">
                  {Object.entries(DATA_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Fecha de consulta *" hint="Cuándo leíste o consultaste el dato">
                <input type="datetime-local" name="consultedAt" required defaultValue={nowLocal()} />
              </Field>
              <Field label="Fecha del mensaje" hint="Cuándo lo envió el proveedor, si la sabés">
                <input type="datetime-local" name="receivedAt" />
              </Field>
              <Field label="Mensaje *" wide hint={'Ej.: "Modelo: … Color: negro. Talles: 39, 40, 41 y 42. Precio: 45000. Despacho: jueves." o una lista de ofertas con precio en $.'}>
                <textarea name="rawText" required rows={10} />
              </Field>
            </div>
            <Check name="isTestData" label="Es un mensaje de prueba" />
            <div className="actions"><SubmitButton>Interpretar mensaje</SubmitButton></div>
          </ActionForm>
        )}
      </Card>

      <Card title="Mensajes cargados">
        {messages.length === 0 ? <p className="muted">Todavía no hay mensajes.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Consulta</th><th>Origen</th><th>Texto</th><th>Estado</th></tr></thead>
              <tbody>
                {messages.map((m) => {
                  const [label, tone] = STATUS[m.status];
                  return (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}><Link href={`/admin/importar/${m.id}`}>{formatDateTime(m.consultedAt)}</Link></td>
                      <td><small>{DATA_SOURCE_LABELS[m.source]}<br />{m.supplier.name}</small></td>
                      <td><small>{m.rawText.slice(0, 140)}{m.rawText.length > 140 ? "…" : ""}</small></td>
                      <td><Badge tone={tone}>{label}</Badge> {m.isTestData && <Badge>prueba</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
