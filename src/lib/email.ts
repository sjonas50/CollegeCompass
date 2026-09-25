import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { outboundFetch } from "./outbound-fetch";

export type Email = {
  to: string;
  subject: string;
  text: string;
  /**
   * Resend sends one email per key within 24 hours: a repeat with the same key gets the first
   * answer back instead of a second email. Give one that belongs to the email itself (like a
   * reminder's student, week and recipient) when a later run may try it again. Without one, each
   * call gets a fresh key, still shared by that call's retries.
   */
  idempotencyKey?: string;
};

/** Resend's send endpoint: https://resend.com/docs/api-reference/emails/send-email */
export const RESEND_API_URL = "https://api.resend.com/emails";
/** How long one attempt may take before it is abandoned. */
export const EMAIL_TIMEOUT_MS = 10_000;
/** Tries per email, the first one included. */
export const EMAIL_MAX_ATTEMPTS = 3;
/** Pause before retrying a server error, timeout or network error, so a brief hiccup can clear. */
export const EMAIL_RETRY_DELAY_MS = 1_000;
/** Pause before retrying while Resend is still working on the same email (409 concurrent_idempotent_requests). */
export const EMAIL_BUSY_RETRY_DELAY_MS = 3_000;
/** A rate limit that asks us to wait longer than this isn't a per-second limit, so we don't wait. */
export const EMAIL_MAX_RATE_LIMIT_WAIT_MS = 10_000;
/**
 * Resend allows 10 requests a second per team. Requests from this server start at most 8 a
 * second, which leaves room for other servers sending at the same moment.
 */
export const RESEND_REQUESTS_PER_SECOND = 8;

const QUOTA_CODES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);
/** Resend's answers for an API key it won't take (401 or 403): every email fails until the key is fixed. */
const API_KEY_CODES = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "suspended_api_key", "invalid_permission"]);

/**
 * A failed send. The message holds only the provider, HTTP status and the provider's error code
 * (like "validation_error"), never the recipient, subject or body, so it is safe to log.
 */
export class EmailSendError extends Error {
  override name = "EmailSendError";

  constructor(
    readonly provider: "resend",
    /** The HTTP status, or null when no response came back (timeout, network error, bad config). */
    readonly status: number | null,
    /** A short machine code: the provider's error name, "timeout", "network_error" or "missing_api_key". */
    readonly code: string,
    /**
     * The email may still arrive: Resend got a request for it but we never learned how it ended
     * (an attempt timed out, or Resend was still working on it when we stopped asking).
     */
    readonly uncertain = false,
  ) {
    super(`${provider} send ${uncertain ? "uncertain" : "failed"}: status=${status ?? "none"} code=${code}`);
  }

  /**
   * Worth another try with the same idempotency key: a server error, no answer, a per-second rate
   * limit, or Resend still busy with the same email. Never a quota, a bad request or a bad key.
   */
  get retryable() {
    if (this.status === null) return this.code === "timeout" || this.code === "network_error";
    if (this.status === 429) return !QUOTA_CODES.has(this.code);
    if (this.status === 409) return this.code === "concurrent_idempotent_requests";
    return this.status >= 500;
  }

  /**
   * Resend refused this email itself (a 4xx such as 422 validation_error, often for an address it
   * won't take), so sending it again would fail the same way. Not an outage, a timeout, a network
   * error, a rate limit or quota (429), a missing or bad API key, or Resend still busy with the
   * email: those say nothing about this email.
   */
  get refused() {
    if (this.status === null || this.status < 400 || this.status >= 500 || this.status === 429) return false;
    return !this.retryable && this.status !== 401 && !API_KEY_CODES.has(this.code);
  }
}

/** The send failed, but the email may still arrive (see EmailSendError.uncertain). */
export function isUncertainSend(error: unknown): boolean {
  return error instanceof EmailSendError && error.uncertain;
}

/** Resend refused this particular email, rather than failing to send (see EmailSendError.refused). */
export function isRefusedSend(error: unknown): boolean {
  return error instanceof EmailSendError && error.refused;
}

/** Waits for this caller's turn to start a request. */
export type StartLimiter = () => Promise<void>;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Spaces out request starts: every caller that shares the limiter starts at least
 * 1000 / perSecond ms after the one before, however many are waiting at once.
 */
export function startLimiter(perSecond: number, clock: () => number = Date.now, sleep: (ms: number) => Promise<void> = wait): StartLimiter {
  const gapMs = 1000 / perSecond;
  let nextStart = Number.NEGATIVE_INFINITY;
  return async () => {
    const now = clock();
    const start = Math.max(now, nextStart);
    nextStart = start + gapMs;
    if (start > now) await sleep(start - now);
  };
}

/** Shared by every Resend request this server makes, retries included. */
const resendLimiter = startLimiter(RESEND_REQUESTS_PER_SECOND);

export type ResendConfig = { apiKey: string | undefined; from: string };

export type SendDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Paces request starts. Defaults to the one limiter all Resend sends share. */
  limiter?: StartLimiter;
};

/**
 * Sends transactional email with the configured transport. "log" prints to the server console
 * (development only; env() refuses it in production). "resend" sends through Resend's HTTP API.
 * Throws EmailSendError when the email could not be sent, with `uncertain` set when it may still
 * arrive.
 */
export async function sendEmail(email: Email): Promise<void> {
  const config = env();
  switch (config.EMAIL_TRANSPORT) {
    case "log":
      console.info(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
      return;
    case "resend":
      return sendWithResend(email, { apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM });
  }
}

type Failure = { error: EmailSendError; retryAfterMs: number | null };

/**
 * Sends one email through Resend, trying up to 3 times with the same idempotency key, so Resend
 * never sends it twice however the tries end:
 *
 * - A server error, a timeout or a network error is tried again after a second.
 * - A rate limit (429) is tried again after the wait Resend asks for (Retry-After). Quota errors
 *   and waits over 10 seconds are not.
 * - "Still working on this email" (409 concurrent_idempotent_requests, which follows a timeout)
 *   is tried again after 3 seconds, and then gets the first try's answer.
 * - Anything else (a bad address, a bad key) fails at once.
 *
 * Every try waits its turn in a limiter shared by all sends, so requests start at most 8 a second.
 * Each try times out after 10 seconds. Logs never include the recipient, subject or body: only the
 * error name, status and code.
 */
export async function sendWithResend(email: Email, config: ResendConfig, deps: SendDeps = {}): Promise<void> {
  if (!config.apiKey) throw logged(new EmailSendError("resend", null, "missing_api_key"));
  const doFetch = deps.fetch ?? outboundFetch();
  const sleep = deps.sleep ?? wait;
  const limiter = deps.limiter ?? resendLimiter;
  const timeoutMs = deps.timeoutMs ?? EMAIL_TIMEOUT_MS;
  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.idempotencyKey ?? `cc-${randomUUID()}`,
    },
    body: JSON.stringify({ from: config.from, to: [email.to], subject: email.subject, text: email.text }),
  };

  const attempt = async (): Promise<Failure | null> => {
    await limiter();
    let response: Response;
    try {
      response = await doFetch(RESEND_API_URL, { ...request, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return { error: new EmailSendError("resend", null, isTimeout(error) ? "timeout" : "network_error"), retryAfterMs: null };
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    return {
      error: new EmailSendError("resend", response.status, await providerErrorName(response)),
      retryAfterMs: response.status === 429 ? retryAfterMs(response.headers) : null,
    };
  };

  // Set once Resend may have taken the email: an answer we never got, or Resend saying it's busy with it.
  let mayHaveSent = false;
  for (let tries = 1; ; tries++) {
    let failure: Failure | null;
    try {
      failure = await attempt();
    } catch {
      failure = { error: new EmailSendError("resend", null, "unexpected_error"), retryAfterMs: null };
    }
    if (!failure) return;
    const { error } = failure;
    if (error.code === "timeout" || error.code === "concurrent_idempotent_requests") mayHaveSent = true;
    const delay = retryDelay(failure, deps.retryDelayMs ?? EMAIL_RETRY_DELAY_MS);
    if (delay === null || tries >= EMAIL_MAX_ATTEMPTS) {
      // A definite refusal (a bad address, say) settles it; otherwise an earlier try may have gone through.
      throw logged(mayHaveSent && error.retryable ? new EmailSendError("resend", error.status, error.code, true) : error);
    }
    console.warn(`[email] ${error.message}; retrying`);
    await sleep(delay);
  }
}

/** How long to wait before trying again, or null when another try can't help. */
function retryDelay({ error, retryAfterMs }: Failure, defaultDelayMs: number): number | null {
  if (!error.retryable) return null;
  if (error.status === 429) {
    const ms = retryAfterMs ?? 1_000;
    return ms <= EMAIL_MAX_RATE_LIMIT_WAIT_MS ? ms : null;
  }
  if (error.code === "concurrent_idempotent_requests") return EMAIL_BUSY_RETRY_DELAY_MS;
  return defaultDelayMs;
}

/** Resend's Retry-After (or ratelimit-reset), both in seconds. */
function retryAfterMs(headers: Headers): number | null {
  for (const name of ["retry-after", "ratelimit-reset"]) {
    const value = headers.get(name)?.trim();
    if (value && /^\d+(\.\d+)?$/.test(value)) return Math.ceil(Number(value) * 1000);
  }
  return null;
}

function logged(error: EmailSendError) {
  console.error(`[email] ${error.message}`);
  return error;
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * Resend's error name ("validation_error", "rate_limit_exceeded"...). Its `message` can quote the
 * request, including the recipient, so it is never read or logged.
 */
async function providerErrorName(response: Response) {
  try {
    const body: unknown = await response.json();
    const name = body && typeof body === "object" && "name" in body ? body.name : undefined;
    return typeof name === "string" && /^[a-z_]{1,64}$/.test(name) ? name : "http_error";
  } catch {
    return "http_error";
  }
}
