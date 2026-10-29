import type { ReactNode } from "react";
import { AVAILABILITY_LABELS, PUBLICATION_LABELS } from "@/lib/validation/catalog";

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: ReactNode; defaultChecked?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} /> <span>{label}</span>
    </label>
  );
}

const AVAIL_TONE: Record<string, string> = {
  PENDING_VERIFICATION: "warn",
  AVAILABLE_LAST_CHECK: "info",
  CONFIRMED_FOR_ORDER: "ok",
  SOLD_OUT_CONFIRMED: "bad",
  DISCONTINUED: "muted",
};

export function AvailabilityBadge({ status }: { status: string }) {
  return <span className={`badge badge-${AVAIL_TONE[status] ?? "muted"}`}>{AVAILABILITY_LABELS[status as keyof typeof AVAILABILITY_LABELS] ?? status}</span>;
}

export function PublicationBadge({ status }: { status: string }) {
  const tone = status === "PUBLISHED" ? "ok" : status === "PAUSED" ? "warn" : "muted";
  return <span className={`badge badge-${tone}`}>{PUBLICATION_LABELS[status as keyof typeof PUBLICATION_LABELS] ?? status}</span>;
}

export function Badge({ tone = "muted", children }: { tone?: "ok" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: "error" | "warn" | "ok" | "info"; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}
