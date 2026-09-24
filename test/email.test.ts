import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/env";
import {
  type Email,
  EmailSendError,
  RESEND_API_URL,
  type SendDeps,
  isUncertainSend,
  sendEmail,
  sendWithResend,
  startLimiter,
} from "@/lib/email";

const email: Email = {
  to: "rosa.parent@example.com",
  subject: "Your child asked to join College Compass",
  text: "Hello Rosa, here is the private consent link: https://example.test/parent/consent/secret-token",
};
const config = { apiKey: "re_test_key", from: "College Compass <hello@mail.example.org>" };
const PRIVATE = [email.to, "Rosa", "secret-token", email.subject];

type Call = { url: string; init: RequestInit };

/** A stubbed fetch that answers each call with the next scripted response (or throws it). */
function scriptedFetch(...script: (Response | Error | "hang")[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = script.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next === "hang") {
      // Like a real fetch: never answers, rejects with the signal's reason when aborted.
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const rateLimited = (headers: Record<string, string> = {}) =>
  json(429, { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }, headers);
const busy = () => json(409, { name: "concurrent_idempotent_requests", message: "Another request is in progress" });

let logs: string[];
const sleeps: number[] = [];
let limiterCalls: number;
const deps = (fetch: typeof globalThis.fetch): SendDeps => ({
  fetch,
  sleep: async (ms) => void sleeps.push(ms),
  limiter: async () => void limiterCalls++,
});
const keysOf = (calls: Call[]) => calls.map((c) => new Headers(c.init.headers).get("idempotency-key"));

beforeEach(() => {
  logs = [];
  sleeps.length = 0;
  limiterCalls = 0;
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

function expectNothingPrivateIn(text: string) {
  for (const secret of PRIVATE) expect(text).not.toContain(secret);
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EmailSendError);
  return error as EmailSendError;
}

describe("sendWithResend", () => {
  it("posts the email to Resend's API with the key, sender and an idempotency key", async () => {
    const { fetch, calls } = scriptedFetch(json(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }));
    await sendWithResend(email, config, deps(fetch));

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test_key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toMatch(/^cc-[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      from: config.from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(logs).toEqual([]);
  });

  it("uses the email's own idempotency key on every try, and never sends it in the body", async () => {
    const { fetch, calls } = scriptedFetch(json(500, { name: "application_error" }), json(200, { id: "abc" }));
    await sendWithResend({ ...email, idempotencyKey: "cc-reminder-0123abcd" }, config, deps(fetch));
    expect(keysOf(calls)).toEqual(["cc-reminder-0123abcd", "cc-reminder-0123abcd"]);
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("idempotencyKey");
  });

  it("retries after a 5xx, with the same idempotency key, and succeeds", async () => {
    const { fetch, calls } = scriptedFetch(
      json(500, { statusCode: 500, name: "application_error", message: "Something went wrong" }),
      json(200, { id: "abc" }),
    );
    await sendWithResend(email, config, deps(fetch));

    expect(calls).toHaveLength(2);
    const keys = keysOf(calls);
    expect(keys[0]).toBe(keys[1]);
    expect(sleeps).toEqual([1_000]);
    expect(logs).toEqual(["[email] resend send failed: status=500 code=application_error; retrying"]);
  });

  it("uses a fresh idempotency key for each email", async () => {
    const { fetch, calls } = scriptedFetch(json(200, {}), json(200, {}));
    await sendWithResend(email, config, deps(fetch));
    await sendWithResend(email, config, deps(fetch));
    const keys = keysOf(calls);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("gives up after three 5xx, and the error and logs say only the status and code", async () => {
    const { fetch, calls } = scriptedFetch(
      json(503, { name: "service_unavailable", message: `Could not send to ${email.to}` }),
      json(500, { name: "application_error", message: `Could not send to ${email.to}` }),
      json(502, "<html>Bad gateway</html>"),
    );
    const error = await failure(sendWithResend(email, config, deps(fetch)));

    expect(calls).toHaveLength(3);
    expect(error.status).toBe(502);
    expect(error.code).toBe("http_error");
    expect(error.uncertain).toBe(false);
    expect(error.message).toBe("resend send failed: status=502 code=http_error");
    expectNothingPrivateIn(`${error.message} ${error.stack} ${JSON.stringify(error)}`);
    expect(logs).toHaveLength(3);
    expectNothingPrivateIn(logs.join("\n"));
  });

  it("does not retry a request Resend rejects, and never logs the provider's message", async () => {
    const { fetch, calls } = scriptedFetch(
      json(422, {
        statusCode: 422,
        name: "validation_error",
        message: `Invalid \`to\` field: ${email.to}`,
      }),
    );
    const error = await failure(sendWithResend(email, config, deps(fetch)));

    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect([error.status, error.code, error.retryable, error.uncertain]).toEqual([422, "validation_error", false, false]);
    expect(logs).toEqual(["[email] resend send failed: status=422 code=validation_error"]);
    expectNothingPrivateIn(`${error.message} ${logs.join("\n")}`);
  });

  it("retries a rate limit after the wait Resend asks for, with the same idempotency key", async () => {
    const { fetch, calls } = scriptedFetch(rateLimited({ "retry-after": "2" }), json(200, { id: "abc" }));
    await sendWithResend(email, config, deps(fetch));
    expect(calls).toHaveLength(2);
    const keys = keysOf(calls);
    expect(keys[0]).toBe(keys[1]);
    expect(sleeps).toEqual([2_000]);
    expect(logs).toEqual(["[email] resend send failed: status=429 code=rate_limit_exceeded; retrying"]);
  });

  it("falls back to ratelimit-reset, then to one second, when a rate limit doesn't say how long to wait", async () => {
    const { fetch } = scriptedFetch(rateLimited({ "ratelimit-reset": "1" }), rateLimited(), json(200, {}));
    await sendWithResend(email, config, deps(fetch));
    expect(sleeps).toEqual([1_000, 1_000]);
  });

  it("gives up on a rate limit after three tries, or when the wait is too long to be a per-second limit", async () => {
    const three = scriptedFetch(rateLimited({ "retry-after": "1" }), rateLimited({ "retry-after": "1" }), rateLimited({ "retry-after": "1" }));
    const error = await failure(sendWithResend(email, config, deps(three.fetch)));
    expect(three.calls).toHaveLength(3);
    expect([error.status, error.code, error.uncertain]).toEqual([429, "rate_limit_exceeded", false]);

    const long = scriptedFetch(rateLimited({ "retry-after": "3600" }));
    await failure(sendWithResend(email, config, deps(long.fetch)));
    expect(long.calls).toHaveLength(1);
  });

  it("does not retry quota errors (the caller retries after the quota resets)", async () => {
    const { fetch, calls } = scriptedFetch(json(429, { name: "daily_quota_exceeded" }, { "retry-after": "1" }));
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect(calls).toHaveLength(1);
    expect([error.status, error.code, error.retryable]).toEqual([429, "daily_quota_exceeded", false]);
  });

  it("ignores an error name that isn't a plain code", async () => {
    const { fetch } = scriptedFetch(json(400, { name: `bad ${email.to}` }));
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect(error.code).toBe("http_error");
    expectNothingPrivateIn(logs.join("\n"));
  });

  it("retries after a network error", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: new Error(`connect ECONNRESET while sending to ${email.to}`),
    });
    const { fetch, calls } = scriptedFetch(networkError, json(200, { id: "abc" }));
    await sendWithResend(email, config, deps(fetch));
    expect(calls).toHaveLength(2);
    expect(logs).toEqual(["[email] resend send failed: status=none code=network_error; retrying"]);
  });

  it("fails with a network error after three, without passing the original error along", async () => {
    const networkError = new TypeError(`fetch failed for ${email.to}`);
    const { fetch } = scriptedFetch(networkError, networkError, networkError);
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect([error.status, error.code, error.uncertain]).toEqual([null, "network_error", false]);
    expect(error.cause).toBeUndefined();
    expectNothingPrivateIn(`${error.message} ${error.stack} ${logs.join("\n")}`);
  });

  it("times out an attempt that hangs, retries, and says the email may still arrive when no try is answered", async () => {
    const { fetch, calls } = scriptedFetch("hang", "hang", "hang");
    const error = await failure(sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 }));
    expect(calls).toHaveLength(3);
    expect([error.status, error.code, error.uncertain]).toEqual([null, "timeout", true]);
    expect(isUncertainSend(error)).toBe(true);
    expect(logs).toEqual([
      "[email] resend send failed: status=none code=timeout; retrying",
      "[email] resend send failed: status=none code=timeout; retrying",
      "[email] resend send uncertain: status=none code=timeout",
    ]);
  });

  it("recovers when only the first attempt times out", async () => {
    const { fetch, calls } = scriptedFetch("hang", json(200, { id: "abc" }));
    await sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 });
    expect(calls).toHaveLength(2);
  });

  it("waits while Resend is still sending the first try, then gets its answer (same key, no second email)", async () => {
    // The first try reached Resend but timed out here; the retry finds it still in progress.
    const { fetch, calls } = scriptedFetch("hang", busy(), json(200, { id: "abc" }));
    await sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 });
    expect(calls).toHaveLength(3);
    expect(new Set(keysOf(calls)).size).toBe(1);
    expect(sleeps).toEqual([1_000, 3_000]);
  });

  it("reports an uncertain send when Resend is still busy with the email after every try", async () => {
    const { fetch } = scriptedFetch("hang", busy(), busy());
    const error = await failure(sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 }));
    expect([error.status, error.code, error.uncertain]).toEqual([409, "concurrent_idempotent_requests", true]);
    expect(error.message).toBe("resend send uncertain: status=409 code=concurrent_idempotent_requests");
  });

  it("is sure the email didn't go out when a retry is refused outright, even after a timeout", async () => {
    const { fetch } = scriptedFetch("hang", json(422, { name: "validation_error" }));
    const error = await failure(sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 }));
    expect([error.code, error.uncertain]).toEqual(["validation_error", false]);
    expect(isUncertainSend(error)).toBe(false);
  });

  it("does not retry an idempotency key used earlier for a different email", async () => {
    const { fetch, calls } = scriptedFetch(json(409, { name: "invalid_idempotent_request" }));
    const error = await failure(sendWithResend({ ...email, idempotencyKey: "cc-reminder-x" }, config, deps(fetch)));
    expect(calls).toHaveLength(1);
    expect([error.status, error.code, error.retryable, error.uncertain]).toEqual([409, "invalid_idempotent_request", false, false]);
  });

  it("waits for the rate limiter before every try", async () => {
    const { fetch } = scriptedFetch(json(500, { name: "application_error" }), rateLimited(), json(200, {}));
    await sendWithResend(email, config, deps(fetch));
    expect(limiterCalls).toBe(3);
  });

  it("gives each attempt 10 seconds by default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fetch } = scriptedFetch(json(200, {}));
    await sendWithResend(email, config, deps(fetch));
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("refuses to send without an API key", async () => {
    const { fetch, calls } = scriptedFetch();
    const error = await failure(sendWithResend(email, { ...config, apiKey: undefined }, deps(fetch)));
    expect(calls).toHaveLength(0);
    expect(error.code).toBe("missing_api_key");
  });

  it("paces all sends through one shared limiter by default: no more than 8 start in a second", async () => {
    const starts: number[] = [];
    const fetch = (async () => {
      starts.push(performance.now());
      return json(200, {});
    }) as unknown as typeof globalThis.fetch;
    await Promise.all(Array.from({ length: 10 }, () => sendWithResend(email, config, { fetch })));
    expect(starts).toHaveLength(10);
    // The nth start comes at least n × 125 ms after the first (less a millisecond or two of timer rounding).
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[0]).toBeGreaterThanOrEqual(125 * i - 5);
  });
});

describe("startLimiter", () => {
  it("spaces starts 1000/perSecond ms apart across everyone waiting, and doesn't wait once there's room", async () => {
    let now = 5_000;
    const waits: number[] = [];
    const limiter = startLimiter(8, () => now, async (ms) => void waits.push(ms));
    await Promise.all([limiter(), limiter(), limiter(), limiter()]);
    expect(waits).toEqual([125, 250, 375]);

    now += 1_000; // well past the last start
    await limiter();
    expect(waits).toHaveLength(3);
  });
});

describe("sendEmail", () => {
  it("prints to the console with the log transport (development)", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "log");
    resetEnvCache();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await sendEmail(email);
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(email.subject);
  });

  it("sends through Resend with EMAIL_TRANSPORT=resend, using RESEND_API_KEY and EMAIL_FROM", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_from_env");
    vi.stubEnv("EMAIL_FROM", "College Compass <hello@mail.example.org>");
    resetEnvCache();
    const { fetch, calls } = scriptedFetch(json(200, { id: "abc" }));
    vi.stubGlobal("fetch", fetch);

    await sendEmail({ ...email, idempotencyKey: "cc-reminder-abc" });

    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer re_from_env");
    expect(new Headers(calls[0].init.headers).get("idempotency-key")).toBe("cc-reminder-abc");
    expect(JSON.parse(String(calls[0].init.body)).from).toBe("College Compass <hello@mail.example.org>");
    expect(logs).toEqual([]);
  });

  it("throws EmailSendError so callers can count or report the failure", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_from_env");
    vi.stubEnv("EMAIL_FROM", "College Compass <hello@mail.example.org>");
    resetEnvCache();
    vi.stubGlobal("fetch", scriptedFetch(json(401, { name: "missing_api_key" })).fetch);
    const error = await failure(sendEmail(email));
    expect([error.status, error.code]).toEqual([401, "missing_api_key"]);
  });
});
