import type { Metadata } from "next";
import { Button, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { type CostReport, NEAR_BUDGET_SHARE, type SpendBreakdown, type StudentSpend, costReport } from "@/lib/admin/costs";
import {
  SEVERITIES,
  SEVERITY_LABELS,
  featureLabel,
  formatDay,
  formatDuration,
  formatPercent,
  formatUsd,
  monthLabel,
  parseMonth,
  recentMonths,
} from "@/lib/admin/format";
import { type SafetyMonthStats, safetyMonthStats } from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";
import { StatTile } from "../ui";

export const metadata: Metadata = { title: "AI costs" };

const numberFormat = new Intl.NumberFormat("en-US");
const n = (value: number) => numberFormat.format(value);

function ofBudget(micros: number | null, budgetMicros: number) {
  if (micros === null || budgetMicros === 0) return null;
  return `${formatPercent((micros / budgetMicros) * 100)} of the ${formatUsd(budgetMicros)} budget`;
}

function StudentList({ title, students, empty }: { title: string; students: StudentSpend[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium">
        {title} ({students.length})
      </h3>
      {students.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border text-sm">
          {students.map((s) => (
            <li key={s.shortId} className="flex justify-between gap-4 py-1.5">
              <span className="font-mono">{s.shortId}</span>
              <span className="tabular-nums">
                {formatUsd(s.micros)} · {formatPercent(s.percentOfBudget)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BreakdownTable({ caption, keyLabel, rows, label }: { caption: string; keyLabel: string; rows: SpendBreakdown[]; label: (key: string) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="mb-2 text-left font-medium">{caption}</caption>
        <thead className="text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-3 font-normal">{keyLabel}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Spend</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Share</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Calls</th>
            <th scope="col" className="py-1.5 text-right font-normal">Tokens in / out</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              <th scope="row" className="py-1.5 pr-3 font-normal">{label(r.key)}</th>
              <td className="py-1.5 pr-3 text-right">{formatUsd(r.micros)}</td>
              <td className="py-1.5 pr-3 text-right">{formatPercent(r.share * 100)}</td>
              <td className="py-1.5 pr-3 text-right">{n(r.calls)}</td>
              <td className="py-1.5 text-right">
                {n(r.inputTokens)} / {n(r.outputTokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One bar per day, anchored to the baseline, with the numbers in a table for screen readers. */
function DailyChart({ daily }: { daily: CostReport["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.micros));
  const peak = daily.reduce((best, d) => (d.micros > best.micros ? d : best), daily[0]);
  return (
    <figure>
      <figcaption className="font-medium">Spend by day (UTC)</figcaption>
      <div aria-hidden className="mt-3 flex h-40 items-end gap-0.5 border-b border-border">
        {daily.map((d) => (
          <div key={d.date} className="flex h-full min-w-0 flex-1 items-end" title={`${formatDay(d.date)}: ${formatUsd(d.micros)}`}>
            <div
              className="w-full rounded-t bg-accent"
              style={{ height: d.micros > 0 ? `max(2px, ${(d.micros / max) * 100}%)` : 0 }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-xs text-muted">
        <span>{formatDay(daily[0].date)}</span>
        <span>{formatDay(daily[daily.length - 1].date)}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {peak.micros > 0 ? `Highest day: ${formatDay(peak.date)}, ${formatUsd(peak.micros)}.` : "No AI use this month yet."}
      </p>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer content-center text-sm">Show as a table</summary>
        <table className="mt-2 w-full text-left text-sm tabular-nums">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-1 font-normal">Day</th>
              <th scope="col" className="py-1 text-right font-normal">Spend</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-b border-border last:border-0">
                <th scope="row" className="py-1 font-normal">{formatDay(d.date)}</th>
                <td className="py-1 text-right">{formatUsd(d.micros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function SafetySection({ stats }: { stats: SafetyMonthStats }) {
  const onTimeShare = stats.reviewed ? ` (${formatPercent((stats.reviewedOnTime / stats.reviewed) * 100)})` : "";
  return (
    <Card>
      <h2 className="font-medium">Safety reviews for messages flagged this month</h2>
      {stats.total === 0 ? (
        <p className="mt-1 text-sm text-muted">No messages were flagged.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            {n(stats.total)} flagged:{" "}
            {SEVERITIES.filter((s) => stats.bySeverity[s] > 0)
              .map((s) => `${n(stats.bySeverity[s])} ${SEVERITY_LABELS[s].toLowerCase()}`)
              .join(", ")}
            .
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label="Reviewed" value={`${n(stats.reviewed)} of ${n(stats.total)}`} />
            <StatTile label="Median time to review" value={stats.medianReviewMs === null ? "None yet" : formatDuration(stats.medianReviewMs)} />
            <StatTile
              label="Reviewed within the target"
              value={`${n(stats.reviewedOnTime)}${onTimeShare}`}
              detail={stats.reviewedLate > 0 ? `${n(stats.reviewedLate)} after the target` : undefined}
            />
            <StatTile
              label="Overdue now"
              value={<span className={stats.overdue > 0 ? "text-danger" : undefined}>{n(stats.overdue)}</span>}
              detail={stats.waiting > 0 ? `${n(stats.waiting)} more waiting, not yet due` : undefined}
            />
          </dl>
        </>
      )}
    </Card>
  );
}

export default async function CostsPage({ searchParams }: PageProps<"/admin/costs">) {
  const admin = await requireUser(["admin"]);
  const now = new Date();
  const month = parseMonth((await searchParams).month, now);
  const db = await getDb();
  const [report, safety] = await Promise.all([costReport(db, admin.id, month, { now }), safetyMonthStats(db, admin.id, month, now)]);
  const months = recentMonths(now, 12);
  if (!months.includes(month)) months.push(month);
  const nearPercent = formatPercent(NEAR_BUDGET_SHARE * 100);

  return (
    <div className="space-y-6">
      <PageHeading
        title="AI costs"
        lead={`What AI features cost each month, against the ${formatUsd(report.budgetMicros)} monthly budget per student. Students show only as anonymous ids.`}
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="month" className="block text-sm font-medium">
            Month (UTC)
          </label>
          <select key={month} id="month" name="month" defaultValue={month} className="mt-1 block min-h-11 rounded-lg border border-border bg-surface px-3">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <section aria-labelledby="totals-heading" className="space-y-3">
        <h2 id="totals-heading" className="text-lg font-medium">
          {monthLabel(month)}
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          <StatTile label="Total AI spend" value={formatUsd(report.totalMicros)} detail={`${n(report.calls)} AI calls`} />
          <StatTile label="Students using AI" value={n(report.activeStudents)} />
          <StatTile
            label="Average per student"
            value={report.averageMicros === null ? "—" : formatUsd(report.averageMicros)}
            detail={ofBudget(report.averageMicros, report.budgetMicros)}
          />
          <StatTile
            label="Median per student"
            value={report.medianMicros === null ? "—" : formatUsd(report.medianMicros)}
            detail={ofBudget(report.medianMicros, report.budgetMicros)}
          />
        </dl>
        <p className="text-xs text-muted">Averages count only students who used AI this month.</p>
      </section>

      <Card>
        <h2 className="font-medium">Students near or over the budget</h2>
        <p className="mt-1 text-sm text-muted">
          At the budget, AI chats pause until next month; safety checks always run.
        </p>
        <div className="mt-3 space-y-4">
          <StudentList title="At or over 100%" students={report.overBudget} empty="No one reached the budget." />
          <StudentList title={`${nearPercent} to 99%`} students={report.nearBudget} empty={`No one is between ${nearPercent} and the budget.`} />
        </div>
      </Card>

      {report.totalMicros > 0 && (
        <Card className="space-y-6">
          <BreakdownTable caption="Spend by feature" keyLabel="Feature" rows={report.byFeature} label={featureLabel} />
          <BreakdownTable caption="Spend by model" keyLabel="Model" rows={report.byModel} label={(k) => k} />
        </Card>
      )}

      <Card>
        <DailyChart daily={report.daily} />
      </Card>

      <SafetySection stats={safety} />
    </div>
  );
}
