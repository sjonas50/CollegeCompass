import { afterEach, describe, expect, it, vi } from "vitest";
import { env, resetEnvCache } from "@/env";

// Production refuses to start with settings that would send families broken or local links.
const PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@db.example.com/cc",
  APP_URL: "https://collegecompass.example.org",
  // The only verifier until counsel picks a real one; production reports it too.
  CONSENT_VERIFIER: "dev_attestation",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "College Compass <hello@collegecompass.example.org>",
  CRON_SECRET: "a-long-enough-cron-secret",
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

function issuesWith(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...PRODUCTION, ...overrides })) vi.stubEnv(key, value);
  resetEnvCache();
  try {
    env();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("production environment", () => {
  it("requires a public https app address", () => {
    expect(issuesWith({ APP_URL: "http://localhost:3000" })).toMatch(/APP_URL/);
    expect(issuesWith({ APP_URL: "http://collegecompass.example.org" })).toMatch(/APP_URL/);
    expect(issuesWith({ APP_URL: "https://collegecompass.example.org" })).not.toMatch(/APP_URL/);
  });

  it("requires a real sending address with Resend", () => {
    expect(issuesWith({ EMAIL_FROM: "College Compass <no-reply@localhost>" })).toMatch(/EMAIL_FROM/);
    expect(issuesWith({ RESEND_API_KEY: "" })).toMatch(/RESEND_API_KEY/);
  });

  it("refuses a sender that isn't an address on a real domain, in any letter case", () => {
    for (const from of [
      "College Compass",
      "College Compass <>",
      "College Compass <hello@>",
      "hello",
      "College Compass <no-reply@LOCALHOST>",
      "no-reply@Localhost",
      "College Compass <hello@mail.localhost>",
      "College Compass <hello@mailserver>",
      "College Compass\r\nBcc: someone <hello@collegecompass.example.org>",
      "College Compass <hello@collegecompass.example.org> extra",
    ]) {
      expect(issuesWith({ EMAIL_FROM: from }), from).toMatch(/EMAIL_FROM/);
    }
  });

  it("accepts an address alone or with a name", () => {
    for (const from of [
      "College Compass <hello@collegecompass.example.org>",
      "hello@mail.collegecompass.example.org",
      "  College Compass <Hello@Mail.CollegeCompass.example.org>  ",
      '"College Compass, Pilot" <hello@collegecompass.example.org>',
    ]) {
      expect(issuesWith({ EMAIL_FROM: from }), from).not.toMatch(/EMAIL_FROM/);
    }
  });

  it("reports a bad sender along with the other problems, so one deploy shows them all", () => {
    const issues = issuesWith({ EMAIL_FROM: "College Compass", APP_URL: "http://localhost:3000" });
    expect(issues).toMatch(/EMAIL_FROM/);
    expect(issues).toMatch(/APP_URL/);
  });

  it("requires the webhook secret and a price when Stripe is on", () => {
    expect(issuesWith({ STRIPE_SECRET_KEY: "sk_live_x" })).toMatch(/STRIPE_WEBHOOK_SECRET[\s\S]*STRIPE_PRICE_MONTHLY|STRIPE_PRICE_MONTHLY[\s\S]*STRIPE_WEBHOOK_SECRET/);
  });
});

describe("development environment", () => {
  function devIssuesWith(overrides: Record<string, string | undefined>) {
    const base = { NODE_ENV: "development", EMAIL_TRANSPORT: "log", EMAIL_FROM: undefined, RESEND_API_KEY: undefined };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
      vi.stubEnv(key, value);
    }
    resetEnvCache();
    try {
      env();
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  }

  it("keeps the local sender that prints emails to the console", () => {
    expect(devIssuesWith({})).toBe("");
    expect(env().EMAIL_FROM).toBe("College Compass <no-reply@localhost>");
  });

  it("still needs EMAIL_FROM to be an address", () => {
    expect(devIssuesWith({ EMAIL_FROM: "College Compass" })).toMatch(/EMAIL_FROM/);
  });

  it("needs a real sending domain when a developer sends through Resend", () => {
    expect(devIssuesWith({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" })).toMatch(/EMAIL_FROM/);
    expect(
      devIssuesWith({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test", EMAIL_FROM: "Dev <dev@mail.example.org>" }),
    ).toBe("");
  });
});
