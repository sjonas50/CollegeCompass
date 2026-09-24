import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { CATEGORY_LABELS, RULES_ALONE_REASONS, SEVERITIES, SEVERITY_LABELS, formatAgo, sourceLabel } from "@/lib/admin/format";
import {
  QUEUE_FILTERS,
  type QueueFilter,
  REVIEW_TARGET_HOURS,
  listSafetyQueue,
  parseQueueFilter,
  queueSummary,
} from "@/lib/admin/safety-review";
import { requireUser } from "@/lib/auth/dal";
import { OverdueBadge, SeverityBadge, TimingText } from "../ui";

export const metadata: Metadata = { title: "Safety review" };

const FILTER_LABELS: Record<QueueFilter, string> = { unreviewed: "Needs review", reviewed: "Reviewed", all: "All" };

const EMPTY: Record<QueueFilter, string> = {
  unreviewed: "Nothing is waiting for review.",
  reviewed: "No events have been reviewed yet.",
  all: "No messages have been flagged yet.",
};

/** "Imminent and high within 24 hours, medium within 3 days." */
function targetText() {
  const hours = (h: number) => (h % 24 === 0 && h > 24 ? `${h / 24} days` : `${h} hours`);
  const groups = new Map<number, string[]>();
  for (const s of SEVERITIES.filter((s) => s !== "low")) {
    groups.set(REVIEW_TARGET_HOURS[s], [...(groups.get(REVIEW_TARGET_HOURS[s]) ?? []), SEVERITY_LABELS[s].toLowerCase()]);
  }
  const parts = [...groups].map(([h, names]) => `${names.join(" and ")} within ${hours(h)}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function SafetyQueuePage({ searchParams }: PageProps<"/admin/safety">) {
  const admin = await requireUser(["admin"]);
  const filter = parseQueueFilter((await searchParams).filter);
  const db = await getDb();
  const now = new Date();
  const [{ rows, total }, summary] = await Promise.all([listSafetyQueue(db, admin.id, { filter, now }), queueSummary(db, admin.id, now)]);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Safety review"
        lead="Student messages our safety check flagged. Students already saw support resources when it mattered; this is the human follow-up. Start at the top."
      />

      <Card>
        <h2 className="font-medium">Review target</h2>
        <p className="mt-1 text-sm text-muted">{targetText()} of the message.</p>
        <p className="mt-3 text-sm">
          <span className="font-medium">{summary.waiting}</span> waiting
          {summary.overdue > 0 ? (
            <>
              {" · "}
              <span className="font-semibold text-danger">{summary.overdue} overdue</span>
            </>
          ) : (
            summary.waiting > 0 && " · none overdue"
          )}
          {summary.oldestWaitingAt && <> · oldest flagged {formatAgo(summary.oldestWaitingAt, now)}</>}
        </p>
      </Card>

      <nav aria-label="Filter events" className="flex flex-wrap gap-2">
        {QUEUE_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "unreviewed" ? "/admin/safety" : `/admin/safety?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium ${
              f === filter ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-background"
            }`}
          >
            {FILTER_LABELS[f]}
            {f === "unreviewed" && summary.waiting > 0 && ` (${summary.waiting})`}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted">{EMPTY[filter]}</p>
      ) : (
        <>
          <ul className="space-y-3" aria-label={FILTER_LABELS[filter]}>
            {rows.map((row) => (
              <li key={row.id}>
                {/* Opening an event is audited, so never load one before the reviewer clicks it. */}
                <Link
                  href={`/admin/safety/${row.id}`}
                  prefetch={false}
                  className={`block rounded-xl border bg-surface p-4 hover:border-accent ${
                    row.timing.state === "waiting" && row.timing.overdue ? "border-danger" : "border-border"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={row.severity} />
                    <span className="font-medium">{CATEGORY_LABELS[row.category]}</span>
                    {row.timing.state === "waiting" && row.timing.overdue && <OverdueBadge />}
                  </span>
                  <span className="mt-2 block text-sm text-muted">
                    Flagged {formatAgo(row.createdAt, now)} · {row.gradeBand} · {row.sources.map(sourceLabel).join(", ") || "No tier recorded"}
                  </span>
                  {row.rulesAlone && (
                    <span className="mt-1 block text-sm font-medium">{RULES_ALONE_REASONS[row.modelTier]}: keyword rules alone decided</span>
                  )}
                  <span className="mt-1 block text-sm">
                    <TimingText timing={row.timing} outcome={row.reviewOutcome} now={now} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {total > rows.length && (
            <p className="text-sm text-muted">
              Showing the first {rows.length} of {total}. Review these and the rest will move up.
            </p>
          )}
        </>
      )}
    </div>
  );
}
