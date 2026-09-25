import { lte } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits, sessions, stripeEvents } from "@/db/schema";
import { runStripeCleanup, sweepBillingWithoutParent } from "@/lib/billing/cleanup";
import { getStripe } from "@/lib/billing/stripe";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepExpiredConsentRequests } from "@/lib/consent/requests";
import { forgetExpiredInviteAddresses } from "@/lib/invites";

/**
 * Daily cleanup: expired consent requests (parent emails), the addresses on parent invitations that
 * expired unanswered, sessions, rate-limit windows, processed Stripe event ids older than 30 days
 * (Stripe stops retrying after three), Stripe clean-up that failed earlier (retried with backoff),
 * and Stripe customers nobody can use any more (a household whose last parent left, once its plan
 * has ended).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const now = new Date();
  const consentRequests = await sweepExpiredConsentRequests(db, now);
  const inviteAddresses = await forgetExpiredInviteAddresses(db, now);
  const expiredSessions = await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
  await db.delete(rateLimits).where(lte(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  await db.delete(stripeEvents).where(lte(stripeEvents.processedAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)));
  const stripe = getStripe();
  const stripeCleanup = await runStripeCleanup(db, stripe, now);
  const billingClosed = await sweepBillingWithoutParent(db, stripe, now);

  const result = { consentRequests, inviteAddresses, sessions: expiredSessions.length, stripeCleanup, billingClosed };
  // Counts only, so the run can be checked in the logs.
  console.info("[sweep] done", JSON.stringify(result));
  return Response.json(result);
}
