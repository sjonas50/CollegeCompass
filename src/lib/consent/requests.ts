import { and, eq, gt, lte, ne } from "drizzle-orm";
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

/**
 * A finished request keeps its row, with the parent's email erased, until its link would have
 * expired: opening the link again then says setup is done instead of inviting a second account.
 */
const USED = "";

/** A request still waiting for its parent, or null (used, expired or unknown). */
export async function findConsentRequest(db: Db, token: string, now = new Date()) {
  const [request] = await db
    .select({ id: consentRequests.id, parentEmail: consentRequests.parentEmail })
    .from(consentRequests)
    .where(and(eq(consentRequests.tokenHash, hashToken(token)), gt(consentRequests.expiresAt, now), ne(consentRequests.parentEmail, USED)));
  return request ?? null;
}

/**
 * What a consent link is for the page it opens: `open` (waiting for its parent), `used` (a parent
 * already set up the child's account with it) or `unavailable` (expired, or never a link of ours;
 * after the daily sweep these can't be told apart). Nothing about the account set up with it.
 */
export type ConsentLinkStatus = "open" | "used" | "unavailable";

export async function consentLinkStatus(db: Db, token: string, now = new Date()): Promise<ConsentLinkStatus> {
  const [row] = await db
    .select({ parentEmail: consentRequests.parentEmail })
    .from(consentRequests)
    .where(and(eq(consentRequests.tokenHash, hashToken(token)), gt(consentRequests.expiresAt, now)));
  if (!row) return "unavailable";
  return row.parentEmail === USED ? "used" : "open";
}

/** Drops a request whose email couldn't be sent, so we don't keep an address we never used. */
export async function cancelConsentRequest(db: Db, token: string) {
  await db.delete(consentRequests).where(eq(consentRequests.tokenHash, hashToken(token)));
}

/**
 * Called once the parent has created the child's account. The stored email is no longer needed, so
 * it's erased now; the rest of the row goes with the daily sweep (see USED).
 */
export async function completeConsentRequest(db: Db, requestId: string) {
  await db.update(consentRequests).set({ parentEmail: USED }).where(eq(consentRequests.id, requestId));
}

/**
 * Deletes requests whose link has expired: parent emails whose consent window passed, and finished
 * requests (no email left). Run daily. Returns how many requests expired unfinished.
 */
export async function sweepExpiredConsentRequests(db: Db, now = new Date()) {
  const deleted = await db
    .delete(consentRequests)
    .where(lte(consentRequests.expiresAt, now))
    .returning({ parentEmail: consentRequests.parentEmail });
  const unfinished = deleted.filter((r) => r.parentEmail !== USED).length;
  if (unfinished > 0) {
    await audit(db, "consent.request_expired", { metadata: { count: unfinished } });
  }
  return unfinished;
}
