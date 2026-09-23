import { timingSafeEqual } from "node:crypto";
import { lte } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits, sessions } from "@/db/schema";
import { env } from "@/env";
import { sweepExpiredConsentRequests } from "@/lib/consent/requests";

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Daily cleanup: expired consent requests (parent emails), sessions and rate-limit windows. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const now = new Date();
  const consentRequests = await sweepExpiredConsentRequests(db, now);
  const expiredSessions = await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
  await db.delete(rateLimits).where(lte(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));

  return Response.json({ consentRequests, sessions: expiredSessions.length });
}
