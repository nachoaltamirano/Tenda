import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Card, Check, Field, Notice, PublicationBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { DATA_SOURCE_LABELS } from "@/lib/validation/catalog";
import { listPendingProposals, type ProposalImpact } from "@/server/catalog/prices";
import { approveProposalAction, rejectProposalAction } from "../../actions";

export const metadata = { title: "Precios pendientes" };

export default async function PricesPage() {
  const proposals = await listPendingProposals();
  return (
    <>
      <h1>Cambios de precio por aprobar <small>({proposals.length})</small></h1>
      {proposals.length === 0 && <p className="muted">No hay cambios pendientes.</p>}
      {proposals.map((prop) => {
        const impact = prop.impact as unknown as ProposalImpact;
        const cur = prop.product.currency;
        const diff = prop.oldCostPrice !== null ? prop.newCostPrice - prop.oldCostPrice : null;
        const pct = prop.oldCostPrice ? (diff! / prop.oldCostPrice) * 100 : null;
        const rows: [string, (s: ProposalImpact["before"]) => string][] = [
          ["Costo del proveedor", (s) => formatMoney(s.costPrice, cur)],
          ["Costo total", (s) => formatMoney(s.totalCost, cur)],
          ["Precio de venta", (s) => formatMoney(s.salePrice, cur)],
          ["Ganancia", (s) => formatMoney(s.profit, cur)],
          ["Margen", (s) => formatPercent(s.marginPercent)],
          ["Recargo", (s) => formatPercent(s.markupPercent)],
        ];
        return (
          <Card
            key={prop.id}
            title={<Link href={`/admin/productos/${prop.product.id}`}>{prop.product.brand} {prop.product.model}</Link>}
            actions={<PublicationBadge status={prop.product.publicationStatus} />}
          >
            <p>
              Costo {formatMoney(prop.oldCostPrice, cur)} <small>(consulta {formatDate(prop.oldConsultedAt)})</small> →{" "}
              <strong>{formatMoney(prop.newCostPrice, cur)}</strong> <small>(consulta {formatDate(prop.newConsultedAt)})</small>{" "}
              {diff !== null && <Badge tone={diff > 0 ? "bad" : "ok"}>{diff > 0 ? "+" : ""}{formatMoney(diff, cur)} ({formatPercent(pct)})</Badge>}
              <br /><small>Fuente: {DATA_SOURCE_LABELS[prop.source]}{prop.supplierMessageId && <> · <Link href={`/admin/importar/${prop.supplierMessageId}`}>ver mensaje</Link></>}</small>
            </p>
            {impact.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
            <div className="table-wrap">
              <table>
                <thead><tr><th></th><th className="num">Actual</th><th className="num">Costo nuevo, mismo precio</th><th className="num">Costo nuevo, precio sugerido</th></tr></thead>
                <tbody>
                  {rows.map(([label, f]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{f(impact.before)}</td>
                      <td className="num">{f(impact.afterKeepingPrice)}</td>
                      <td className="num">{f(impact.afterSuggested)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ActionForm action={approveProposalAction}>
              <input type="hidden" name="proposalId" value={prop.id} />
              <div className="form-grid" style={{ marginTop: ".75rem" }}>
                <Field label="Precio de venta al aprobar">
                  <select name="salePriceChoice" defaultValue={prop.proposedSalePrice !== null ? "suggested" : "keep"}>
                    <option value="keep">Mantener {formatMoney(prop.oldSalePrice, cur)}</option>
                    {prop.proposedSalePrice !== null && <option value="suggested">Usar sugerido {formatMoney(prop.proposedSalePrice, cur)}</option>}
                    <option value="custom">Otro precio…</option>
                  </select>
                </Field>
                <Field label="Otro precio"><input name="customSalePrice" inputMode="decimal" /></Field>
                <Field label="Nota"><input name="note" /></Field>
              </div>
              <Check name="acceptLowMargin" label="Confirmo aprobar aunque el margen quede por debajo del mínimo" />
              {impact.warnings.some((w) => w.includes("más antigua")) && <Check name="acceptOlderData" label="Confirmo aplicar un dato más antiguo que el vigente" />}
              <div className="actions"><SubmitButton>Aprobar y aplicar</SubmitButton></div>
            </ActionForm>
            <ActionForm action={rejectProposalAction} className="inline-form">
              <input type="hidden" name="proposalId" value={prop.id} />
              <input name="note" placeholder="Motivo del rechazo" />
              <SubmitButton variant="danger">Rechazar</SubmitButton>
            </ActionForm>
          </Card>
        );
      })}
    </>
  );
}
