import type { PathResult, PlannedPath, PlanYear } from "../../engine-io";

// Test helper: a short, human-readable rendering of a path, for golden snapshots a person can
// review ("10: English II (H) | Algebra II | …"). Not used by the app.

const LEVEL_SHORT: Record<string, string> = { regular: "", honors: " (H)", ap: " (AP)", ib: " (IB)", cambridge: " (Cambridge)", dual_enrollment: " (dual)" };

export function yearLine(y: PlanYear): string {
  const parts = y.slots.map((s) => {
    if (s.kind === "yours") return `[${s.title}]`;
    if (s.kind === "your_choice") return "Your choice";
    const star = s.needsPlanNow ? "!" : "";
    return `${star}${s.genericTitle.replace(/ \(.*\)$/, "")}${LEVEL_SHORT[s.level] ?? ""}${s.term === "summer" ? " [summer]" : ""}`;
  });
  const load = y.load.warning ? ` ⚠ load ${y.load.collegeLevel}` : "";
  return `${y.grade}: ${parts.join(" | ")} (${y.capacity.used}/${y.capacity.classes})${load}`;
}

export function planLines(path: PlannedPath): string[] {
  return path.plans.flatMap((p) => [`${p.label}`, ...p.years.map((y) => `  ${yearLine(y)}`)]);
}

export function auditLines(path: PlannedPath): string[] {
  return path.audit.flatMap((rs) => [
    `${rs.ruleSetId} [${rs.status}]${rs.projected ? " projected" : ""}${rs.stale ? " stale" : ""}`,
    ...rs.requirements.map(
      (r) => `  ${r.reqId}: ${r.status}${r.modifiers.length ? ` (${r.modifiers.join(", ")})` : ""} ${r.firm}+${r.planned}/${r.required}${r.conflicts.length ? " conflict" : ""}`,
    ),
    ...rs.checks.map((c) => `  check ${c.checkId}: ${c.status}`),
  ]);
}

export function summary(result: PathResult): string {
  if (result.mode === "no_state") return `no_state ${result.homeState ?? "-"}: ${result.comingLater ?? ""}`;
  const lines = [
    `${result.state} ${result.mode} ${result.stage}${result.planChoice ? ` choice=${result.planChoice.kind}` : ""}`,
    ...planLines(result),
    "Deadlines:",
    ...result.deadlines.map((d) => `  ${d.kind} ${d.by.grade}/${d.by.point}: ${d.text}`),
    "Decisions:",
    ...result.decisions.map((d) => `  ${d.key}: ${d.text}`),
    "Gaps:",
    ...result.gaps.map((g) => `  P${g.priority} ${g.kind}: ${g.text} -> ${g.options.map((o) => o.kind).join(", ")}`),
  ];
  return lines.join("\n");
}
