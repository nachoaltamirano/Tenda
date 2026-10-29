"use client";

import { createContext, useActionState, useContext, useTransition, type ReactNode } from "react";

type Result = { ok: boolean; error?: string; message?: string } | null;

const PendingContext = createContext(false);

/**
 * Formulario conectado a una acción de servidor. Se envía manualmente (en lugar de
 * `<form action>`) para que React no vacíe los campos: si la acción devuelve un
 * error, el administrador conserva lo que cargó.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  // `never`: acepta acciones con cualquier tipo de estado previo.
  action: (prev: never, fd: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action as (prev: Result, fd: FormData) => Promise<Result>, null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state && !state.ok && <p className="alert alert-error" role="alert">{state.error}</p>}
      {state && state.ok && state.message && <p className="alert alert-ok" role="status">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", name, value }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; name?: string; value?: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" className={`btn btn-${variant}`} disabled={pending} name={name} value={value}>
      {pending ? "Procesando…" : children}
    </button>
  );
}
