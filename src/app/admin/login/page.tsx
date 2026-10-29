import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="login">
      <h1>LOBBY · Panel</h1>
      <div className="card">
        <ActionForm action={loginAction}>
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="grid">
            <Field label="Email">
              <input type="email" name="email" required autoComplete="username" />
            </Field>
            <Field label="Contraseña">
              <input type="password" name="password" required autoComplete="current-password" />
            </Field>
          </div>
          <div className="actions">
            <SubmitButton>Ingresar</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
