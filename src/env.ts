import * as z from "zod";

const CONSENT_VERIFIERS = ["dev_attestation"] as const;

// "Name <address>" or a bare address. The name can't hold angle brackets or line breaks.
const SENDER = /^(?:[^<>\u0000-\u001f\u007f]*<([^<>\s]+)>|([^<>\s]+))$/;
const DOMAIN_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const ADDRESS = new RegExp(`^[^\\s@<>()[\\]\\\\,;:"]{1,64}@(${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*)$`, "i");

/** The sender address's domain, lowercased, or null when EMAIL_FROM isn't a sender address. */
function senderDomainOf(from: string): string | null {
  const sender = SENDER.exec(from);
  const address = ADDRESS.exec(sender?.[1] ?? sender?.[2] ?? "");
  return address ? address[1].toLowerCase() : null;
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Postgres connection string. When unset (dev/test), an embedded PGlite database is used.
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DATA_DIR: z.string().default(".data/pglite"),
    APP_URL: z.string().url().default("http://localhost:3000"),

    // Verifiable parental consent method for under-13 accounts. Real methods are chosen with counsel;
    // "dev_attestation" is a click-through stand-in and is rejected in production.
    CONSENT_VERIFIER: z.enum(CONSENT_VERIFIERS).default("dev_attestation"),
    CONSENT_REQUEST_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),

    // The sender: an address, alone or with a name ("College Compass <hello@mail.example.org>").
    EMAIL_FROM: z.string().trim().default("College Compass <no-reply@localhost>"),
    // "log" prints emails to the server console (development only); "resend" sends through Resend.
    EMAIL_TRANSPORT: z.enum(["log", "resend"]).default("log"),
    RESEND_API_KEY: z.string().optional(),
    CRON_SECRET: z.string().min(16).optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_SAFETY: z.string().default("claude-opus-5"),
    // Tried when the primary safety model errors (outage, overload), before falling back to keyword
    // rules alone. Chosen from the safety eval: 0 misses on Opus 5, 1 borderline miss on Sonnet 5.
    AI_MODEL_SAFETY_BACKUP: z.string().default("claude-sonnet-5"),
    AI_MODEL_COUNSELOR: z.string().default("claude-opus-5"),
    // Per-student monthly AI spend ceiling, in US dollars.
    AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(3),

    // Access and billing. Every new household gets a free trial; after it, a parent's subscription
    // or the free-access path (self-report, no documents) keeps full access. Without Stripe keys,
    // paid checkout is off and families can still use the trial and free access.
    TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
    FREE_ACCESS_MONTHS: z.coerce.number().int().min(1).max(24).default(12),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // Stripe Price ids for the family plan (prices are set after the pilot).
    STRIPE_PRICE_MONTHLY: z.string().optional(),
    STRIPE_PRICE_ANNUAL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Checked everywhere: a broken sender makes every email fail, while the site looks healthy.
    const senderDomain = senderDomainOf(env.EMAIL_FROM);
    if (senderDomain === null) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: 'must be an email address, alone or with a name, like "College Compass <hello@mail.example.org>"',
      });
    } else if (env.EMAIL_TRANSPORT === "resend" && (!senderDomain.includes(".") || /(^|\.)localhost$/.test(senderDomain))) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "use an address on your verified sending domain" });
    }

    if (env.NODE_ENV !== "production") return;
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "required in production" });
    }
    if (env.CONSENT_VERIFIER === "dev_attestation") {
      ctx.addIssue({
        code: "custom",
        path: ["CONSENT_VERIFIER"],
        message: "dev_attestation is not verifiable parental consent; configure a real verifier",
      });
    }
    if (env.EMAIL_TRANSPORT === "log") {
      ctx.addIssue({ code: "custom", path: ["EMAIL_TRANSPORT"], message: "configure a real email provider" });
    }
    // Email links and Stripe return addresses are built from APP_URL.
    if (!env.APP_URL.startsWith("https://") || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.APP_URL)) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must be the site's public https address in production" });
    }
    if (env.EMAIL_TRANSPORT === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required when EMAIL_TRANSPORT is resend" });
    }
    if (env.STRIPE_SECRET_KEY) {
      for (const key of ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when STRIPE_SECRET_KEY is set" });
      }
    }
    if (!env.CRON_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "required in production" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnvCache() {
  cached = undefined;
}
