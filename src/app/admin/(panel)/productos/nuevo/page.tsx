import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ProductFields } from "@/components/ProductFields";
import { Card, Check, Field } from "@/components/ui";
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
          <ProductFields suppliers={suppliers} />
          <Check name="confirmDuplicate" label="Si el sistema detecta un posible duplicado, confirmo que es un producto distinto" />
          <div className="actions"><SubmitButton>Guardar producto</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
