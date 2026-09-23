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
