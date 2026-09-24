import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/env";
import { type Email, EmailSendError, RESEND_API_URL, type SendDeps, sendEmail, sendWithResend } from "@/lib/email";

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let logs: string[];
const sleeps: number[] = [];
const deps = (fetch: typeof globalThis.fetch): SendDeps => ({
  fetch,
  sleep: async (ms) => void sleeps.push(ms),
});

beforeEach(() => {
  logs = [];
  sleeps.length = 0;
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

  it("retries once after a 5xx, with the same idempotency key, and succeeds", async () => {
    const { fetch, calls } = scriptedFetch(
      json(500, { statusCode: 500, name: "application_error", message: "Something went wrong" }),
      json(200, { id: "abc" }),
    );
    await sendWithResend(email, config, deps(fetch));

    expect(calls).toHaveLength(2);
    const keys = calls.map((c) => new Headers(c.init.headers).get("idempotency-key"));
    expect(keys[0]).toBe(keys[1]);
    expect(sleeps).toEqual([1_000]);
    expect(logs).toEqual(["[email] resend send failed: status=500 code=application_error; retrying once"]);
  });

  it("uses a fresh idempotency key for each email", async () => {
    const { fetch, calls } = scriptedFetch(json(200, {}), json(200, {}));
    await sendWithResend(email, config, deps(fetch));
    await sendWithResend(email, config, deps(fetch));
    const keys = calls.map((c) => new Headers(c.init.headers).get("idempotency-key"));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("gives up after a second 5xx, and the error and logs say only the status and code", async () => {
    const { fetch, calls } = scriptedFetch(
      json(503, { name: "service_unavailable", message: `Could not send to ${email.to}` }),
      json(502, "<html>Bad gateway</html>"),
    );
    const error = await failure(sendWithResend(email, config, deps(fetch)));

    expect(calls).toHaveLength(2);
    expect(error.status).toBe(502);
    expect(error.code).toBe("http_error");
    expect(error.message).toBe("resend send failed: status=502 code=http_error");
    expectNothingPrivateIn(`${error.message} ${error.stack} ${JSON.stringify(error)}`);
    expect(logs).toHaveLength(2);
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
    expect([error.status, error.code, error.retryable]).toEqual([422, "validation_error", false]);
    expect(logs).toEqual(["[email] resend send failed: status=422 code=validation_error"]);
    expectNothingPrivateIn(`${error.message} ${logs.join("\n")}`);
  });

  it("does not retry rate limits or quota errors (the caller retries later)", async () => {
    const { fetch, calls } = scriptedFetch(json(429, { name: "rate_limit_exceeded", message: "Too many requests" }));
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect(calls).toHaveLength(1);
    expect([error.status, error.code]).toEqual([429, "rate_limit_exceeded"]);
  });

  it("ignores an error name that isn't a plain code", async () => {
    const { fetch } = scriptedFetch(json(400, { name: `bad ${email.to}` }));
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect(error.code).toBe("http_error");
    expectNothingPrivateIn(logs.join("\n"));
  });

  it("retries once after a network error", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: new Error(`connect ECONNRESET while sending to ${email.to}`),
    });
    const { fetch, calls } = scriptedFetch(networkError, json(200, { id: "abc" }));
    await sendWithResend(email, config, deps(fetch));
    expect(calls).toHaveLength(2);
    expect(logs).toEqual(["[email] resend send failed: status=none code=network_error; retrying once"]);
  });

  it("fails with a network error after two, without passing the original error along", async () => {
    const networkError = new TypeError(`fetch failed for ${email.to}`);
    const { fetch } = scriptedFetch(networkError, networkError);
    const error = await failure(sendWithResend(email, config, deps(fetch)));
    expect([error.status, error.code]).toEqual([null, "network_error"]);
    expect(error.cause).toBeUndefined();
    expectNothingPrivateIn(`${error.message} ${error.stack} ${logs.join("\n")}`);
  });

  it("times out an attempt that hangs, retries once, then fails", async () => {
    const { fetch, calls } = scriptedFetch("hang", "hang");
    const error = await failure(sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 }));
    expect(calls).toHaveLength(2);
    expect([error.status, error.code]).toEqual([null, "timeout"]);
    expect(logs).toEqual([
      "[email] resend send failed: status=none code=timeout; retrying once",
      "[email] resend send failed: status=none code=timeout",
    ]);
  });

  it("recovers when only the first attempt times out", async () => {
    const { fetch, calls } = scriptedFetch("hang", json(200, { id: "abc" }));
    await sendWithResend(email, config, { ...deps(fetch), timeoutMs: 20 });
    expect(calls).toHaveLength(2);
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

    await sendEmail(email);

    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer re_from_env");
    expect(JSON.parse(String(calls[0].init.body)).from).toBe("College Compass <hello@mail.example.org>");
    expect(logs).toEqual([]);
  });

  it("throws EmailSendError so callers can count or report the failure", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_from_env");
    resetEnvCache();
    vi.stubGlobal("fetch", scriptedFetch(json(401, { name: "missing_api_key" })).fetch);
    const error = await failure(sendEmail(email));
    expect([error.status, error.code]).toEqual([401, "missing_api_key"]);
  });
});
