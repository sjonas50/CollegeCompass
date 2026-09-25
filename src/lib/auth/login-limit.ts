import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rateLimits } from "@/db/schema";
import { consumeRateLimit } from "../rate-limit";
import { hashToken } from "./tokens";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Sign-in limits per 15 minutes. Only wrong passwords count against an account, so a family that
 * signs in and out of a shared computer is never locked out; once an account is over its limit,
 * even the right password waits for the window to pass. Every attempt counts against the network.
 */
export const LOGIN_LIMITS = { account: 10, ip: 50, windowMs: WINDOW_MS };

const accountKey = (identifier: string) => `login:id:${hashToken(identifier)}`;

/**
 * Counts a sign-in attempt before the password is checked, and says whether it may go ahead. The
 * account's attempt is counted now, so attempts sent at the same moment can't all slip under the
 * limit; a correct password takes it back (see signInSucceeded).
 */
export async function beginSignIn(db: Db, identifier: string, ipKey: string, now = new Date()): Promise<boolean> {
  if (!(await consumeRateLimit(db, `login:ip:${ipKey}`, LOGIN_LIMITS.ip, WINDOW_MS, now))) return false;
  return consumeRateLimit(db, accountKey(identifier), LOGIN_LIMITS.account, WINDOW_MS, now);
}

/** The password was right: the attempt beginSignIn counted against the account doesn't count. */
export async function signInSucceeded(db: Db, identifier: string) {
  await db
    .update(rateLimits)
    .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
    .where(eq(rateLimits.key, accountKey(identifier)));
}
