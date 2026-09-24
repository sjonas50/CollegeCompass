import * as z from "zod";

const CONSENT_VERIFIERS = ["dev_attestation"] as const;

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

    EMAIL_FROM: z.string().default("College Compass <no-reply@localhost>"),
    // "log" prints emails to the server console (development only).
    EMAIL_TRANSPORT: z.enum(["log"]).default("log"),
    CRON_SECRET: z.string().min(16).optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_SAFETY: z.string().default("claude-opus-5"),
    // Tried when the primary safety model errors (outage, overload), before falling back to keyword
    // rules alone. Chosen from the safety eval: 0 misses on Opus 5, 1 borderline miss on Sonnet 5.
    AI_MODEL_SAFETY_BACKUP: z.string().default("claude-sonnet-5"),
    AI_MODEL_COUNSELOR: z.string().default("claude-opus-5"),
    // Per-student monthly AI spend ceiling, in US dollars.
    AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(3),
  })
  .superRefine((env, ctx) => {
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
