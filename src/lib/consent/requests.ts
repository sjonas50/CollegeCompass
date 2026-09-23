import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { consentRequests } from "@/db/schema";
import { env } from "@/env";
import { audit } from "../audit";
import { generateToken, hashToken } from "../auth/tokens";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An under-13 student asked us to contact their parent. We store only the parent's email
 * (COPPA's one-time-contact exception) and delete it if consent isn't completed in time.
 */
export async function createConsentRequest(db: Db, parentEmail: string, now = new Date()) {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + env().CONSENT_REQUEST_TTL_DAYS * DAY_MS);
  await db
    .insert(consentRequests)
    .values({ parentEmail: parentEmail.trim().toLowerCase(), tokenHash: hashToken(token), expiresAt });
  await audit(db, "consent.requested");
  return { token, expiresAt };
}

export async function findConsentRequest(db: Db, token: string, now = new Date()) {
  const [request] = await db
    .select({ id: consentRequests.id, parentEmail: consentRequests.parentEmail })
    .from(consentRequests)
    .where(and(eq(consentRequests.tokenHash, hashToken(token)), gt(consentRequests.expiresAt, now)));
  return request ?? null;
}

/** Called once the parent has created the child's account; the stored email is no longer needed. */
export async function completeConsentRequest(db: Db, requestId: string) {
  await db.delete(consentRequests).where(eq(consentRequests.id, requestId));
}

/** Deletes parent emails whose consent window has passed. Run daily. */
export async function sweepExpiredConsentRequests(db: Db, now = new Date()) {
  const deleted = await db
    .delete(consentRequests)
    .where(lte(consentRequests.expiresAt, now))
    .returning({ id: consentRequests.id });
  if (deleted.length > 0) {
    await audit(db, "consent.request_expired", { metadata: { count: deleted.length } });
  }
  return deleted.length;
}
