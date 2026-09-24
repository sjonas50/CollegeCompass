import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { safetyEvents } from "@/db/schema";
import { getAnthropic } from "../client";
import { modelFor } from "../models";
import { scrubPii } from "../privacy";
import { recordMessageUsage } from "../usage";
import { classifyWithModel } from "./classifier";
import { supportResponse } from "./responses";
import { classifyWithRules } from "./rules";
import { SEVERITY_ORDER, type SafetySignal, type Severity, combineSignals } from "./types";

export type SafetyAssessment = {
  severity: Severity;
  category: SafetySignal["category"] | null;
  /** Which tiers flagged the message. */
  sources: ("rules" | "model")[];
  /** True when the model tier couldn't run; rules alone decided. */
  degraded: boolean;
  /** At high/imminent, the counselor replies with this instead of continuing normally. */
  supportMessage: string | null;
};

type Options = {
  client?: Pick<Anthropic, "beta">;
  /** The student's own name(s), removed before the text reaches the model. */
  knownNames?: string[];
};

// Each safety call gets a deadline, so the primary, the backup and the rules fallback all finish
// well inside the counselor route's 60-second limit.
const MODEL_REQUESTS = {
  safety: { timeout: 15_000, maxRetries: 1 },
  safety_backup: { timeout: 12_000, maxRetries: 0 },
} as const;

/**
 * Screens a student's message before the counselor answers. Runs the rules tier and the model
 * tier, keeps the higher rating, and queues medium-or-higher messages for human review.
 * Never throws for model failures: a safety check must not break the conversation.
 */
export async function assessMessage(
  db: Db,
  userId: string,
  text: string,
  opts: Options = {},
): Promise<SafetyAssessment> {
  const rules = { explicit: classifyWithRules(text, "explicit"), all: classifyWithRules(text) };

  let model: SafetySignal | null = null;
  let degraded = true;
  // A plain statement the rules already rate urgent gets resources right away: the model can't
  // lower that rating, so there's no reason to wait on it (or on an outage).
  const rulesUrgent = rules.explicit !== null && SEVERITY_ORDER[rules.explicit.severity] >= SEVERITY_ORDER.high;
  let client: Pick<Anthropic, "beta"> | null = null;
  if (!rulesUrgent) {
    try {
      client = opts.client ?? getAnthropic();
    } catch (error) {
      console.error("[safety] model tier unavailable", error instanceof Error ? error.name : "unknown");
    }
  }
  // Primary model, then a backup model if the primary errors; keyword rules alone only if both fail.
  for (const feature of ["safety", "safety_backup"] as const) {
    if (!client) break;
    const modelId = modelFor(feature);
    try {
      const result = await classifyWithModel(client, modelId, scrubPii(text, opts.knownNames), MODEL_REQUESTS[feature]);
      // Billed with or without a verdict. A failed usage write must not throw away the verdict.
      await recordMessageUsage(db, userId, "safety", modelId, result.message).catch((error) =>
        console.error("[safety] failed to record usage", error instanceof Error ? error.name : "unknown"),
      );
      if (result.verdict) {
        model = result.signal;
        degraded = false;
        break;
      }
      if (result.declined) break; // declined: don't retry, flag the gap
      console.error(`[safety] ${feature} model returned no verdict`); // cut off or malformed: try the backup
    } catch (error) {
      console.error(`[safety] ${feature} model failed`, error instanceof Error ? error.name : "unknown");
    }
  }

  // Skipping the model because the rules were enough isn't an outage.
  const modelRan = !degraded || rulesUrgent;
  const signal = combineSignals(rules, model, modelRan);
  const sources: SafetyAssessment["sources"] = [];
  const counted = modelRan ? (rulesUrgent ? rules.explicit : null) : rules.all;
  if (counted) sources.push("rules");
  if (model) sources.push("model");

  if (signal && SEVERITY_ORDER[signal.severity] >= SEVERITY_ORDER.medium) {
    try {
      await db.insert(safetyEvents).values({
        userId,
        category: signal.category,
        severity: signal.severity,
        sources: modelRan ? sources : [...sources, "model_unavailable"],
        excerpt: text.slice(0, 1000),
      });
    } catch (error) {
      // Never let a failed write keep crisis resources from the student. Log no message text.
      console.error("[safety] failed to record event", error instanceof Error ? error.name : "unknown");
    }
  }

  const urgent = signal && SEVERITY_ORDER[signal.severity] >= SEVERITY_ORDER.high;
  return {
    severity: signal?.severity ?? "none",
    category: signal?.category ?? null,
    sources,
    degraded: !modelRan,
    supportMessage: urgent ? supportResponse(signal.category) : null,
  };
}

/** Keyword-rules-only screening: no model call and no writes. Used when a request is rate-limited. */
export function screenWithRulesOnly(text: string): Pick<SafetyAssessment, "severity" | "category" | "supportMessage"> {
  const rules = classifyWithRules(text);
  const urgent = rules && SEVERITY_ORDER[rules.severity] >= SEVERITY_ORDER.high;
  return {
    severity: rules?.severity ?? "none",
    category: rules?.category ?? null,
    supportMessage: urgent ? supportResponse(rules.category) : null,
  };
}
