import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";

export type Email = { to: string; subject: string; text: string };

/** Resend's send endpoint: https://resend.com/docs/api-reference/emails/send-email */
export const RESEND_API_URL = "https://api.resend.com/emails";
/** How long one attempt may take before it is abandoned. */
export const EMAIL_TIMEOUT_MS = 10_000;
/** Pause before the single retry, so a brief provider hiccup can clear. */
export const EMAIL_RETRY_DELAY_MS = 1_000;

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
  ) {
    super(`${provider} send failed: status=${status ?? "none"} code=${code}`);
  }

  /** Worth one more try: the provider had a server error or we never got an answer. */
  get retryable() {
    return this.status === null ? this.code === "timeout" || this.code === "network_error" : this.status >= 500;
  }
}

export type ResendConfig = { apiKey: string | undefined; from: string };

export type SendDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
};

/**
 * Sends transactional email with the configured transport. "log" prints to the server console
 * (development only; env() refuses it in production). "resend" sends through Resend's HTTP API.
 * Throws EmailSendError when the email could not be sent.
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

/**
 * Sends one email through Resend. Each attempt times out after 10 seconds. A 5xx answer, a timeout
 * or a network error gets one retry; anything else (a bad address, a bad key, a quota) fails at
 * once. Both attempts share an idempotency key, so if the first one went through but its answer
 * was lost, Resend does not send the email twice.
 *
 * Logs never include the recipient, subject or body: only the error name, status and code.
 */
export async function sendWithResend(email: Email, config: ResendConfig, deps: SendDeps = {}): Promise<void> {
  if (!config.apiKey) throw logged(new EmailSendError("resend", null, "missing_api_key"));
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? EMAIL_TIMEOUT_MS;
  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `cc-${randomUUID()}`,
    },
    body: JSON.stringify({ from: config.from, to: [email.to], subject: email.subject, text: email.text }),
  };

  const attempt = async () => {
    let response: Response;
    try {
      response = await doFetch(RESEND_API_URL, { ...request, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new EmailSendError("resend", null, isTimeout(error) ? "timeout" : "network_error");
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return;
    }
    throw new EmailSendError("resend", response.status, await providerErrorName(response));
  };

  try {
    await attempt();
  } catch (first) {
    if (!(first instanceof EmailSendError) || !first.retryable) throw logged(asSendError(first));
    console.warn(`[email] ${first.message}; retrying once`);
    await sleep(deps.retryDelayMs ?? EMAIL_RETRY_DELAY_MS);
    try {
      await attempt();
    } catch (second) {
      throw logged(asSendError(second));
    }
  }
}

function asSendError(error: unknown) {
  return error instanceof EmailSendError ? error : new EmailSendError("resend", null, "unexpected_error");
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
