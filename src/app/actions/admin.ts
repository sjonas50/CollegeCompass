"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  type ParentContact,
  type SafetyContext,
  ReviewSchema,
  revealParentContact,
  revealSafetyContext,
  reviewSafetyEvent,
} from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";
import { type FormState, fieldErrors } from "@/lib/forms";

// Staff-only actions. Each checks the session here and the account's role again in src/lib/admin.

export type ContextState = { context?: SafetyContext; message?: string } | undefined;
export type ParentContactState = { contact?: ParentContact; message?: string } | undefined;

const GONE = "We couldn't find this event. It may have been deleted along with the student's account.";

/** Shows who the student is and the conversation around a flagged message. Audited in the lib. */
export async function revealSafetyContextAction(_prev: ContextState, formData: FormData): Promise<ContextState> {
  const admin = await requireUser(["admin"]);
  const context = await revealSafetyContext(await getDb(), admin.id, String(formData.get("eventId") ?? ""));
  return context ? { context } : { message: GONE };
}

/** Shows the linked parents' emails, for follow-up. Audited in the lib. */
export async function revealParentContactAction(_prev: ParentContactState, formData: FormData): Promise<ParentContactState> {
  const admin = await requireUser(["admin"]);
  const contact = await revealParentContact(await getDb(), admin.id, String(formData.get("eventId") ?? ""));
  return contact ? { contact } : { message: GONE };
}

export async function reviewSafetyEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireUser(["admin"]);
  const eventId = String(formData.get("eventId") ?? "");
  const parsed = ReviewSchema.safeParse({ outcome: formData.get("outcome") ?? undefined, note: formData.get("note") ?? "" });
  if (!parsed.success) return fieldErrors(parsed.error);

  const result = await reviewSafetyEvent(await getDb(), admin.id, eventId, parsed.data);
  if (!result.ok) {
    return {
      message:
        result.error === "already_reviewed" ? "Someone else already reviewed this event. Reload the page to see their review." : GONE,
    };
  }
  redirect(`/admin/safety/${eventId}?reviewed=1`);
}
