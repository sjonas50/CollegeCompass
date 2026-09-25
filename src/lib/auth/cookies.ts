import "server-only";
import { cookies } from "next/headers";
import { isFixedSessionToken } from "./sessions";

export const SESSION_COOKIE = "cc_session";
/** Remembers an under-13 answer so the age gate can't be retried with a different birthday. */
export const AGE_GATE_COOKIE = "cc_age_gate";
// Upper bound for the browser; the database session (14 days, sliding) is authoritative.
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/**
 * `expiresAt` is the session's end. Sessions that slide keep a 30-day cookie (the proxy renews it);
 * staff sessions are never extended, so their cookie ends with the session.
 */
export async function setSessionCookie(token: string, expiresAt: Date, now = new Date()) {
  const maxAge = isFixedSessionToken(token)
    ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
    : SESSION_COOKIE_MAX_AGE;
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieOptions, maxAge });
}

export async function readSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setUnder13Gate() {
  (await cookies()).set(AGE_GATE_COOKIE, "under13", { ...cookieOptions, maxAge: 24 * 60 * 60 });
}

export async function hasUnder13Gate() {
  return (await cookies()).get(AGE_GATE_COOKIE)?.value === "under13";
}
