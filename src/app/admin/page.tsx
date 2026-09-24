import type { Metadata } from "next";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { costReport } from "@/lib/admin/costs";
import { SEVERITIES, SEVERITY_LABELS, formatAgo, formatUsd, monthKeyOf, monthLabel } from "@/lib/admin/format";
import { queueSummary } from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminHome() {
  const admin = await requireUser(["admin"]);
  const db = await getDb();
  const now = new Date();
  const month = monthKeyOf(now);
  const [summary, costs] = await Promise.all([queueSummary(db, admin.id, now), costReport(db, admin.id, month, { now })]);
  const waitingBySeverity = SEVERITIES.filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${summary.bySeverity[s]} ${SEVERITY_LABELS[s].toLowerCase()}`)
    .join(", ");

  return (
    <div className="space-y-6">
      <PageHeading
        title={`Hi, ${admin.displayName}`}
        lead="Staff tools. Opening a safety event, and anything you show on it, is logged. The other staff pages show no student names or messages."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={summary.overdue > 0 ? "border-danger" : ""}>
          <h2 className="font-medium">Safety review</h2>
          {summary.waiting === 0 ? (
            <p className="mt-1 text-sm text-muted">Nothing is waiting for review.</p>
          ) : (
            <>
              <p className="mt-1 text-sm">
                {summary.waiting} waiting ({waitingBySeverity})
              </p>
              {summary.overdue > 0 && <p className="mt-1 text-sm font-semibold text-danger">{summary.overdue} overdue</p>}
              {summary.oldestWaitingAt && <p className="mt-1 text-sm text-muted">Oldest flagged {formatAgo(summary.oldestWaitingAt, now)}</p>}
            </>
          )}
          <div className="mt-3">
            <ButtonLink href="/admin/safety" variant={summary.waiting > 0 ? "primary" : "secondary"}>
              Open the queue
            </ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="font-medium">AI costs, {monthLabel(month)}</h2>
          <p className="mt-1 text-sm">
            {formatUsd(costs.totalMicros)} in total
            {costs.deletedAccountsMicros > 0 && `, including ${formatUsd(costs.deletedAccountsMicros)} from deleted accounts`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {costs.activeStudents} {costs.activeStudents === 1 ? "student" : "students"} with an account used AI
          </p>
          {costs.overBudget.length > 0 && (
            <p className="mt-1 text-sm text-muted">
              {costs.overBudget.length} at the {formatUsd(costs.budgetMicros)} budget
            </p>
          )}
          <div className="mt-3">
            <ButtonLink href="/admin/costs" variant="secondary">
              See the cost dashboard
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}
