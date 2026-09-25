import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "account.created"
  | "account.password_changed"
  | "auth.login"
  | "auth.login_failed"
  | "consent.requested"
  | "consent.granted"
  | "consent.request_expired"
  | "student.created_by_parent"
  | "student.exported"
  | "student.deleted"
  | "parent.deleted"
  | "access.trial_started"
  | "access.free_access_granted"
  | "access.granted_by_staff"
  | "billing.checkout_started"
  | "billing.subscription_changed"
  | "billing.customer_deleted"
  | "parent_invite.sent"
  | "parent_invite.accepted"
  | "parent_invite.cancelled"
  | "parent_link.removed_by_student"
  | "assessment.imported"
  | "assessment.import_removed"
  | "safety.reviewed"
  | "safety.deleted_unreviewed"
  | "admin.viewed_safety_event"
  | "admin.created";

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
