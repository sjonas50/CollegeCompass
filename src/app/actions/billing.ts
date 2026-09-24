"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { BILLING_PATH } from "@/lib/access/describe";
import { openBillingPortal, startCheckout } from "@/lib/billing/checkout";
import { isPlan } from "@/lib/billing/plans";
import { errorName, getStripe } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/auth/dal";

// Parents only. Payment details go straight to Stripe's pages; we never see or store them.

/** Runs a Stripe call; a failure is logged by error name only and becomes null. */
async function tryStripe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[billing] ${label} failed`, errorName(error));
    return null;
  }
}

/** "Choose monthly/yearly": sends the parent to Stripe Checkout. */
export async function startCheckoutAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const plan = formData.get("plan");
  const stripe = getStripe();
  if (!stripe || !isPlan(plan)) redirect(`${BILLING_PATH}?error=unavailable`);

  const db = await getDb();
  const result = await tryStripe("checkout", () => startCheckout(db, stripe, parent.id, plan));
  if (!result) redirect(`${BILLING_PATH}?error=stripe`);
  if (!result.ok) {
    const error = result.error === "already_subscribed" ? "subscribed" : result.error === "not_payer" ? "not_payer" : "unavailable";
    redirect(`${BILLING_PATH}?error=${error}`);
  }
  redirect(result.url);
}

/** "Manage billing": the Stripe Customer Portal (change plan, update card, cancel, see invoices). */
export async function openPortalAction() {
  const parent = await requireUser(["parent"]);
  const stripe = getStripe();
  if (!stripe) redirect(`${BILLING_PATH}?error=unavailable`);

  const db = await getDb();
  const result = await tryStripe("portal", () => openBillingPortal(db, stripe, parent.id));
  if (!result) redirect(`${BILLING_PATH}?error=stripe`);
  if (!result.ok) redirect(`${BILLING_PATH}?error=${result.error === "not_payer" ? "not_payer" : "unavailable"}`);
  redirect(result.url);
}
