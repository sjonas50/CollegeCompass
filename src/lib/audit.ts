import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "account.created"
  | "auth.login"
  | "auth.login_failed"
  | "consent.requested"
  | "consent.granted"
  | "consent.request_expired"
  | "student.created_by_parent"
  | "student.exported"
  | "student.deleted"
  | "parent.deleted";

/** Records who did what. Metadata must never contain personal data: it outlives deletion. */
export async function audit(
  db: Db,
  action: AuditAction,
  opts: {
    actorUserId?: string | null;
    subjectUserId?: string | null;
    metadata?: Record<string, string | number | boolean>;
  } = {},
) {
  await db.insert(auditLog).values({
    action,
    actorUserId: opts.actorUserId ?? null,
    subjectUserId: opts.subjectUserId ?? null,
    metadata: opts.metadata,
  });
}
