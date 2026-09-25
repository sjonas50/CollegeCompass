import type { Metadata } from "next";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { costReport } from "@/lib/admin/costs";
import { type CountsReport, countsReport } from "@/lib/admin/counts";
import { SEVERITIES, SEVERITY_LABELS, formatAgo, formatDay, formatPercent, formatUsd, monthKeyOf, monthLabel } from "@/lib/admin/format";
import { queueSummary } from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";
import { StatTile } from "./ui";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminHome() {
  const admin = await requireUser(["admin"]);
  const db = await getDb();
  const now = new Date();
  const month = monthKeyOf(now);
  const [summary, costs, counts] = await Promise.all([
    queueSummary(db, admin.id, now),
    costReport(db, admin.id, month, { now }),
    countsReport(db, admin.id, { now }),
  ]);
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
      <FreeQuizCounts counts={counts} />
    </div>
  );
}

/** A share as a whole percent, or a dash when there's nothing to divide by yet. */
function percent(share: number | null): string {
  return share === null ? "–" : formatPercent(share * 100);
}

/** Anonymous totals for the free quiz and signups (see src/lib/admin/counts.ts). */
function FreeQuizCounts({ counts }: { counts: CountsReport }) {
  const { totals, ratios } = counts;
  const withQuiz = totals.signup_student_with_quiz + totals.child_added_with_quiz;
  return (
    <Card>
      <h2 className="font-medium">Free quiz, last {counts.days} days</h2>
      <p className="mt-1 text-sm text-muted">
        {formatDay(counts.from)} to {formatDay(counts.to)} (UTC). Daily totals only: nobody is tracked, so a quiz finish
        and a signup can&apos;t be matched up, and the ratios are rough.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Quiz finishes" value={totals.free_quiz_finished} />
        <StatTile
          label="Strengths finishes"
          value={totals.free_strengths_finished}
          detail={`${percent(ratios.strengthsPerFinish)} of quiz finishes`}
        />
        <StatTile
          label="Signups with the quiz, per quiz finish"
          value={percent(ratios.signupsWithQuizPerFinish)}
          detail={`${withQuiz} ${withQuiz === 1 ? "account" : "accounts"} made with the quiz, by students or parents`}
        />
        <StatTile
          label="Student signups"
          value={totals.signup_student}
          detail={`${totals.signup_student_with_quiz} with the quiz (${percent(ratios.studentSignupsWithQuiz)})`}
        />
        <StatTile label="Children added with the quiz" value={totals.child_added_with_quiz} />
        <StatTile label="Parent signups" value={totals.signup_parent} />
      </dl>
    </Card>
  );
}
