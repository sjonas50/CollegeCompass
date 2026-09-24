import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { safetyEvents } from "@/db/schema";
import { getAnthropic } from "../client";
import { modelFor } from "../models";
import { scrubPii } from "../privacy";
import { recordUsage } from "../usage";
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
  const rules = classifyWithRules(text);

  let model: SafetySignal | null = null;
  let degraded = false;
  try {
    const client = opts.client ?? getAnthropic();
    const modelId = modelFor("safety");
    const result = await classifyWithModel(client, modelId, scrubPii(text, opts.knownNames));
    if (result) {
      model = result.signal;
      // A failed usage write must not throw away the model's verdict.
      await recordUsage(db, userId, "safety", modelId, result.usage).catch((error) =>
        console.error("[safety] failed to record usage", error instanceof Error ? error.name : "unknown"),
      );
    } else {
      degraded = true;
    }
  } catch (error) {
    degraded = true;
    console.error("[safety] model tier unavailable", error instanceof Error ? error.name : "unknown");
  }

  const signal = combineSignals(rules, model, !degraded);
  const sources: SafetyAssessment["sources"] = [];
  if (rules && (degraded || SEVERITY_ORDER[rules.severity] >= SEVERITY_ORDER.high)) sources.push("rules");
  if (model) sources.push("model");

  if (signal && SEVERITY_ORDER[signal.severity] >= SEVERITY_ORDER.medium) {
    try {
      await db.insert(safetyEvents).values({
        userId,
        category: signal.category,
        severity: signal.severity,
        sources: degraded ? [...sources, "model_unavailable"] : sources,
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
    degraded,
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
