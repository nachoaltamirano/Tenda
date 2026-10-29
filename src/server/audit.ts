import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Compara dos objetos y devuelve solo los campos modificados. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Changes {
  const changes: Changes = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) changes[key] = { from: norm(a), to: norm(b) };
  }
  return changes;
}

export async function audit(
  tx: Tx,
  entry: { entityType: string; entityId: string; action: string; changes?: Changes | Record<string, unknown>; reason?: string; userEmail?: string | null },
) {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: entry.reason,
      userEmail: entry.userEmail ?? null,
    },
  });
}
