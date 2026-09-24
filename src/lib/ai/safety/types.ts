import type { safetyCategoryEnum } from "@/db/schema";

export type SafetyCategory = (typeof safetyCategoryEnum.enumValues)[number];
export const SAFETY_CATEGORIES: readonly SafetyCategory[] = [
  "self_harm", "abuse", "violence", "sexual_content", "eating_disorder", "substance_use", "bullying", "distress",
];

export type Severity = "none" | "low" | "medium" | "high" | "imminent";
export const SEVERITY_ORDER: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3, imminent: 4 };

export type SafetySignal = { category: SafetyCategory; severity: Exclude<Severity, "none"> };

export function maxSignal(a: SafetySignal | null, b: SafetySignal | null): SafetySignal | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_ORDER[b.severity] > SEVERITY_ORDER[a.severity] ? b : a;
}

/**
 * Combines the two tiers. When the model ran, it decides, except that explicit rule matches at high
 * or imminent always stand (the net for plain statements the model might under-call). When it
 * didn't run, every rule counts, including the broad outage-only ones.
 */
export function combineSignals(
  rules: { explicit: SafetySignal | null; all: SafetySignal | null },
  model: SafetySignal | null,
  modelRan: boolean,
) {
  if (!modelRan) return rules.all;
  const explicit = rules.explicit && SEVERITY_ORDER[rules.explicit.severity] >= SEVERITY_ORDER.high ? rules.explicit : null;
  return maxSignal(explicit, model);
}
