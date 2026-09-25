import { expect } from "vitest";
import type { PathResult, PlannedPath, PlanSlot, PlanYear, RequirementAudit, RuleSetAudit } from "../../engine-io";

// Test helpers for reading a PathResult.

export function planned(result: PathResult): PlannedPath {
  if (result.mode === "no_state") throw new Error("expected a planned path");
  return result;
}

export type Suggested = Extract<PlanSlot, { kind: "suggested" }> & { grade: number };

export function suggestions(path: PlannedPath, planId: "A" | "B" = "A"): Suggested[] {
  const plan = path.plans.find((p) => p.id === planId);
  if (!plan) return [];
  return plan.years.flatMap((y) => y.slots.filter((s): s is Extract<PlanSlot, { kind: "suggested" }> => s.kind === "suggested").map((s) => ({ ...s, grade: y.grade })));
}

export function typesIn(path: PlannedPath, grade: number, planId: "A" | "B" = "A"): string[] {
  return suggestions(path, planId)
    .filter((s) => s.grade === grade)
    .map((s) => s.typeId);
}

export function year(path: PlannedPath, grade: number, planId: "A" | "B" = "A"): PlanYear {
  const y = path.plans.find((p) => p.id === planId)?.years.find((x) => x.grade === grade);
  if (!y) throw new Error(`no year ${grade}`);
  return y;
}

export function ruleSet(path: PlannedPath, id: string): RuleSetAudit {
  const rs = path.audit.find((r) => r.ruleSetId === id);
  if (!rs) throw new Error(`rule set ${id} isn't in the audit (has ${path.audit.map((r) => r.ruleSetId).join(", ")})`);
  return rs;
}

export function requirement(path: PlannedPath, ruleSetId: string, reqId: string): RequirementAudit {
  const r = ruleSet(path, ruleSetId).requirements.find((x) => x.reqId === reqId);
  if (!r) throw new Error(`requirement ${reqId} isn't in ${ruleSetId}`);
  return r;
}

/** Words a plan must never use about itself (design: labeled by difference, never "better" or "harder"). */
export function expectNeutralLabels(path: PlannedPath): void {
  for (const p of path.plans) expect(p.label).not.toMatch(/\b(better|harder|more competitive|best|stronger|easier)\b/i);
}

export function allText(path: PlannedPath): string {
  return JSON.stringify(path);
}
