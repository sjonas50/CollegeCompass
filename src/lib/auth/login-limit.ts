import type { Db } from "@/db";
import { consumeRateLimit, refundRateLimit } from "../rate-limit";
import { hashToken } from "./tokens";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Sign-in limits per 15 minutes. Only wrong passwords count, against the account and against the
 * network, so a family signing in and out of a shared computer, or a class signing in behind one
 * school IP, is never locked out. Once an account is over its limit, even the right password waits
 * for the window to pass.
 */
export const LOGIN_LIMITS = { account: 10, ip: 50, windowMs: WINDOW_MS };

const accountKey = (identifier: string) => `login:id:${hashToken(identifier)}`;
const networkKey = (ipKey: string) => `login:ip:${ipKey}`;

/**
 * Counts a sign-in attempt before the password is checked, and says whether it may go ahead. The
 * attempt is counted now, so attempts sent at the same moment can't all slip under the limit; a
 * correct password takes it back (see signInSucceeded). The account is checked first, so retries
 * on a locked account never use up the network's attempts; an attempt the network refuses checks
 * no password, so it doesn't count against the account either.
 */
export async function beginSignIn(db: Db, identifier: string, ipKey: string, now = new Date()): Promise<boolean> {
  if (!(await consumeRateLimit(db, accountKey(identifier), LOGIN_LIMITS.account, WINDOW_MS, now))) return false;
  if (await consumeRateLimit(db, networkKey(ipKey), LOGIN_LIMITS.ip, WINDOW_MS, now)) return true;
  await refundRateLimit(db, accountKey(identifier));
  return false;
}

/** The password was right: the attempt beginSignIn counted doesn't count, per account or per network. */
export async function signInSucceeded(db: Db, identifier: string, ipKey: string) {
  await refundRateLimit(db, accountKey(identifier));
  await refundRateLimit(db, networkKey(ipKey));
}
