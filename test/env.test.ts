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

  it("requires the webhook secret and a price when Stripe is on", () => {
    expect(issuesWith({ STRIPE_SECRET_KEY: "sk_live_x" })).toMatch(/STRIPE_WEBHOOK_SECRET[\s\S]*STRIPE_PRICE_MONTHLY|STRIPE_PRICE_MONTHLY[\s\S]*STRIPE_WEBHOOK_SECRET/);
  });
});
