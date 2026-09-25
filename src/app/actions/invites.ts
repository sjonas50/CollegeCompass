"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { env } from "@/env";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/cookies";
import { requireUser } from "@/lib/auth/dal";
import { invalidateSession } from "@/lib/auth/sessions";
import { sendEmail } from "@/lib/email";
import { type FormState, fieldErrors } from "@/lib/forms";
import { type CreateInviteError, InviteEmailSchema, MAX_PENDING_INVITES, acceptInvite, cancelInvite, createInvite } from "@/lib/invites";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpKey } from "@/lib/request";
import { deleteEmptyHousehold } from "@/lib/privacy";

const HOUR = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The invite card's one state for sending and cancelling, so its notice is always about the last
 * thing the student did. `delayed`: the email may take a few minutes (the email service didn't
 * answer in time).
 */
export type InviteFormState = { sent: true; delayed?: true } | { cancelled: true } | FormState;

const SEND_MESSAGES: Record<CreateInviteError, string> = {
  not_eligible: "Your account can't send invitations.",
  has_parent: "A parent or guardian is already linked to your account.",
  own_email: "That's your own email. Enter your parent's or guardian's email instead.",
  too_many_pending: `You have ${MAX_PENDING_INVITES} invitations waiting. Cancel one to send another.`,
  rate_limited: "We can't send more invitations right now. Please try again tomorrow.",
  send_failed: "We couldn't send the email. Check the address and try again.",
};

/** The student dashboard's invite card (use with useFormAction). */
export async function sendParentInviteAction(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const student = await requireUser(["student"]);
  const parsed = InviteEmailSchema.safeParse({ parentEmail: formData.get("parentEmail") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const db = await getDb();
  if (!(await consumeRateLimit(db, `parent_invite:ip:${await clientIpKey()}`, 20, HOUR))) {
    return { message: "Too many invitations from here. Please try again later." };
  }
  const res = await createInvite(db, student.id, parsed.data.parentEmail, { appUrl: env().APP_URL, send: sendEmail });
  if (!res.ok) {
    return res.error === "own_email" ? { errors: { parentEmail: [SEND_MESSAGES.own_email] } } : { message: SEND_MESSAGES[res.error] };
  }
  refresh();
  return res.delayed ? { sent: true, delayed: true } : { sent: true };
}

/** "Yes, cancel it" on a waiting invitation (after the card asks to confirm). */
export async function cancelParentInviteAction(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const student = await requireUser(["student"]);
  const cancelled = await cancelInvite(await getDb(), student.id, String(formData.get("inviteId") ?? ""));
  refresh();
  // Accepted, or cancelled from another tab: the refreshed list shows what's still waiting.
  return cancelled ? { cancelled: true } : { message: "That invitation was already used or cancelled." };
}

function tokenFrom(formData: FormData): string | null {
  const token = formData.get("token");
  return typeof token === "string" && TOKEN.test(token) ? token : null;
}

/** The Accept button on /invite/[token]. Only parents get this far; anyone else is sent home. */
export async function acceptParentInviteAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const token = tokenFrom(formData);
  if (!token) redirect("/parent");
  const db = await getDb();
  const res = await acceptInvite(db, token, parent.id);
  if (!res.ok) redirect(`/invite/${token}?error=${res.error}`);
  // The student's old household is empty but still holds a plan the accepting parent doesn't pay
  // for. Its paid time already came along as a grant (merge.paidUntil); close the Stripe customer
  // (or queue that, if Stripe is down).
  if (res.merge.parkedHouseholdId) await deleteEmptyHousehold(db, res.merge.parkedHouseholdId);
  redirect("/parent?linked=1");
}

/** Someone else is signed in on this device: sign them out and show the invitation again. */
export async function signOutForInviteAction(formData: FormData) {
  const token = tokenFrom(formData);
  const session = await readSessionToken();
  if (session) await invalidateSession(await getDb(), session);
  await clearSessionCookie();
  redirect(token ? `/invite/${token}` : "/login");
}
