import { lte } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits, sessions, stripeEvents } from "@/db/schema";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepExpiredConsentRequests } from "@/lib/consent/requests";

/**
 * Daily cleanup: expired consent requests (parent emails), sessions, rate-limit windows, and
 * processed Stripe event ids older than 30 days (Stripe stops retrying after three).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const now = new Date();
  const consentRequests = await sweepExpiredConsentRequests(db, now);
  const expiredSessions = await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
  await db.delete(rateLimits).where(lte(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  await db.delete(stripeEvents).where(lte(stripeEvents.processedAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)));

  return Response.json({ consentRequests, sessions: expiredSessions.length });
}
