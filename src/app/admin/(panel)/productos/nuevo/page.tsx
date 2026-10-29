import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ProductFields } from "@/components/ProductFields";
import { Card, Check, Field } from "@/components/ui";
import { AVAILABILITY_LABELS } from "@/lib/validation/catalog";
import { db } from "@/server/db";
import { createProductAction } from "../../../actions";

export const metadata = { title: "Registrar producto" };

export default async function NewProductPage() {
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <h1>Registrar producto</h1>
      <Card>
        <ActionForm action={createProductAction}>
          <fieldset>
            <legend>Costo del proveedor</legend>
            <div className="form-grid">
              <Field label="Costo del proveedor" hint="Ej: 45000 o 45.000. Vacío si todavía no se confirmó.">
                <input name="costPrice" inputMode="decimal" />
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Talles y colores</legend>
            <div className="form-grid">
              <Field label="Colores" hint="Separados por coma"><input name="colors" placeholder="negro, blanco" /></Field>
              <Field label="Talles" hint="Separados por coma (40.5 para medio talle)"><input name="sizes" placeholder="39, 40, 41, 42" /></Field>
              <Field label="Estado de las variantes">
                <select name="variantStatus" defaultValue="PENDING_VERIFICATION">
                  {Object.entries(AVAILABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
            <Check name="confirmAllCombinations" label="Con varios colores: confirmo que todos los talles existen en todos los colores" />
          </fieldset>
          <ProductFields suppliers={suppliers} />
          <Check name="confirmDuplicate" label="Si el sistema detecta un posible duplicado, confirmo que es un producto distinto" />
          <div className="actions"><SubmitButton>Guardar producto</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
