import type { PlannedPath } from "../../engine-io";
import { suggestions } from "./helpers";

// Test helper: the claims a path makes that a guessed class kind must never create on its own
// (engine/confirm.ts): a requirement short with no room ("doesn't fit"), a required credit a senior
// "needs a plan now", and a class "Required by" a rule. Keyed by requirement, not by class or
// grade, so two plans that place the same requirement's class differently make the same claim.

export type Claim = string;

export function claims(path: PlannedPath, planId: "A" | "B" = "A"): Set<Claim> {
  const plan = path.plans.find((p) => p.id === planId);
  const out = new Set<Claim>();
  for (const g of plan?.gaps ?? path.gaps) {
    // A shortfall with no room: "doesn't fit", "would take more than one math class a year" or
    // "Needs a plan now".
    if (g.kind === "doesnt_fit" || g.kind === "ladder_infeasible" || /doesn't fit|Needs a plan now/.test(g.text)) out.add(`gap:${g.demandId ?? g.id}`);
  }
  for (const s of suggestions(path, planId)) {
    for (const r of s.reasons) {
      if (r.kind === "requirement" && r.text.startsWith("Required by") && r.ruleSetId) out.add(`required:${r.ruleSetId}/${r.reqId}`);
    }
    if (s.needsPlanNow) {
      const req = s.reasons.find((r) => r.kind === "requirement" && r.ruleSetId);
      out.add(`now:${req?.ruleSetId}/${req?.reqId}`);
    }
  }
  return out;
}

/** The requirement a claim is about ("gap:tx.dla/dla.alg2" → "tx.dla/dla.alg2"). */
function about(c: Claim): string {
  return c.slice(c.indexOf(":") + 1);
}

/**
 * Claims in `path` about requirements `truth` (the same student with every class's kind confirmed)
 * makes no claim about: a requirement a guess made look missing. (Where the requirement really is
 * missing, the two plans may place its class differently, or not have room for it: "Required by"
 * in one and "doesn't fit" in the other are the same claim.) Only rule sets both plans follow are
 * compared: a guessed career class never picks the plan's Texas endorsement, so a typed student's
 * default endorsement can differ from the one the confirmed class picks.
 */
export function extraClaims(path: PlannedPath, truth: PlannedPath): Claim[] {
  const real = new Set([...claims(truth)].map(about));
  const both = new Set(truth.audit.map((a) => a.ruleSetId));
  const compared = (c: Claim) => about(c).startsWith("prep:") || both.has(about(c).slice(0, about(c).indexOf("/")).replace(/^gap:/, ""));
  return [...claims(path)].filter((c) => compared(c) && !real.has(about(c)));
}

/**
 * Gaps and "needs a plan now" about requirements the audit says are waiting on the student to
 * confirm a class: a requirement a guess decides is never also called missing or impossible. (A
 * class can still be "Required by" one, when it's needed whatever the row turns out to be: a
 * Chemistry next to a typed Biology for "two lab sciences".)
 */
export function claimsOnWaiting(path: PlannedPath): Claim[] {
  const waiting = new Set(path.audit.flatMap((rs) => rs.requirements.filter((r) => r.status === "waiting_confirm").map((r) => `${rs.ruleSetId}/${r.reqId}`)));
  return [...claims(path)].filter((c) => !c.startsWith("required:") && waiting.has(about(c)));
}
