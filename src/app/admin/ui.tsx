import type { ReactNode } from "react";
import { type EventSeverity, OUTCOME_LABELS, SEVERITY_LABELS, formatDuration } from "@/lib/admin/format";
import type { ReviewTiming } from "@/lib/admin/safety-review";
import type { SafetyReviewOutcome } from "@/db/schema";

// Small pieces shared by the staff pages. Status always has words, never color alone.

const SEVERITY_STYLES: Record<EventSeverity, string> = {
  imminent: "bg-danger text-danger-foreground",
  high: "bg-danger-soft text-danger",
  medium: "bg-accent-soft text-foreground",
  low: "border border-border text-muted",
};

export function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[severity]}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-danger px-2.5 py-0.5 text-xs font-semibold text-danger">
      Overdue
    </span>
  );
}

/** "Due in 5 hours", "Overdue by 2 hours", or how a reviewed event was handled. */
export function TimingText({ timing, outcome, now }: { timing: ReviewTiming; outcome: SafetyReviewOutcome | null; now: Date }) {
  if (timing.state === "waiting") {
    const left = timing.dueAt.getTime() - now.getTime();
    return timing.overdue ? (
      <span className="font-medium text-danger">Overdue by {formatDuration(-left)}</span>
    ) : (
      <span>Due in {formatDuration(left)}</span>
    );
  }
  return (
    <span>
      {outcome ? OUTCOME_LABELS[outcome] : "Reviewed"} · took {formatDuration(timing.tookMs)}
      {timing.onTime ? " (on time)" : <span className="text-danger"> (after the target)</span>}
    </span>
  );
}

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-sm text-muted">{detail}</dd>}
    </div>
  );
}
