import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Card, Field } from "@/components/ui";
import { dateInputValue, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { CASH_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/validation/catalog";
import { cashSummary } from "@/server/orders/cash";
import { cashMovementAction } from "../../order-actions";

export const metadata = { title: "Caja" };

export default async function CashPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; test?: string }> }) {
  const sp = await searchParams;
  const from = sp.from ? new Date(`${sp.from}T00:00:00-03:00`) : undefined;
  const to = sp.to ? new Date(`${sp.to}T23:59:59-03:00`) : undefined;
  const s = await cashSummary({ from, to }, sp.test === "1");
  return (
    <>
      <h1>Caja</h1>
      <form className="filters">
        <Field label="Desde"><input type="date" name="from" defaultValue={sp.from} /></Field>
        <Field label="Hasta"><input type="date" name="to" defaultValue={sp.to} /></Field>
        <label className="check"><input type="checkbox" name="test" value="1" defaultChecked={sp.test === "1"} /> Incluir pruebas</label>
        <button className="btn btn-secondary" type="submit">Ver</button>
      </form>
      <div className="stats">
        <div className="stat"><div className="value">{formatMoney(s.collected)}</div><div className="label">Dinero cobrado{from || to ? " (período)" : ""}</div></div>
        <div className="stat"><div className="value">{formatMoney(s.costsPaid)}</div><div className="label">Costos pagados (proveedor, gastos, devoluciones)</div></div>
        <div className="stat"><div className="value">{formatMoney(s.net)}</div><div className="label">Saldo de caja</div></div>
        <div className={`stat${s.receivables > 0 ? " attention" : ""}`}><div className="value">{formatMoney(s.receivables)}</div><div className="label">Saldos pendientes de clientes</div></div>
        <div className="stat"><div className="value">{formatMoney(s.committed)}</div><div className="label">Capital comprometido en pedidos abiertos</div></div>
        <div className="stat"><div className="value">{formatMoney(s.realProfit)}</div><div className="label">Ganancia real (pedidos entregados)</div></div>
        <div className="stat"><div className="value">{formatMoney(s.realProfitAfterOperating)}</div><div className="label">Ganancia real menos gastos operativos</div></div>
      </div>
      <p className="field-hint">
        Ganancia real: lo cobrado menos lo pagado al proveedor y los gastos, solo de pedidos entregados o cerrados. Capital comprometido: lo que LOBBY ya pagó
        en pedidos abiertos y todavía no recuperó con cobros. Saldos pendientes y capital no dependen del período.
      </p>
      <div className="grid grid-2">
        <Card title="Movimientos">
          {s.movements.length === 0 ? <p className="muted">Sin movimientos.</p> : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {s.movements.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDate(m.occurredAt)}</td>
                      <td>
                        {CASH_TYPE_LABELS[m.type]} {m.isTestData && <Badge>prueba</Badge>}
                        <br /><small>{m.description}{m.method && ` · ${PAYMENT_METHOD_LABELS[m.method]}`}</small>
                        {m.order && <> · <Link href={`/admin/pedidos/${m.order.id}`}><small>{m.order.code}</small></Link></>}
                      </td>
                      <td className="num" style={{ color: m.income ? "var(--ok)" : "var(--bad)" }}>{m.income ? "+" : "−"}{formatMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Registrar movimiento general">
          <p className="field-hint">Cobros, compras, gastos de un pedido y devoluciones se registran desde el pedido.</p>
          <ActionForm action={cashMovementAction}>
            <div className="form-grid">
              <Field label="Tipo">
                <select name="type" defaultValue="OPERATING_EXPENSE">
                  <option value="OPERATING_EXPENSE">{CASH_TYPE_LABELS.OPERATING_EXPENSE}</option>
                  <option value="OTHER_INCOME">{CASH_TYPE_LABELS.OTHER_INCOME}</option>
                </select>
              </Field>
              <Field label="Importe *"><input name="amount" inputMode="decimal" required /></Field>
              <Field label="Fecha"><input type="date" name="occurredAt" defaultValue={dateInputValue(new Date())} /></Field>
              <Field label="Medio">
                <select name="method" defaultValue="">
                  <option value="">—</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Concepto *" wide><input name="description" required placeholder="Publicidad, packaging, etc." /></Field>
            </div>
            <div className="actions"><SubmitButton>Registrar</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
