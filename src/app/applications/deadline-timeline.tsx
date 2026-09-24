import Link from "next/link";
import { formatDate } from "@/lib/applications/dates";
import { deadlineName, dueText } from "@/lib/applications/display";
import type { ListEntry } from "@/lib/applications/service";
import { SOON_DAYS, type Timeline, type TimelineItem } from "@/lib/applications/timeline";

type Entry = Pick<ListEntry, "id" | "name" | "deadlineType">;

function Item({ item }: { item: TimelineItem<Entry> }) {
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <time dateTime={item.deadline} className="shrink-0 text-sm font-medium sm:w-40">
        {formatDate(item.deadline)}
      </time>
      <div className="min-w-0 text-sm">
        <Link href={`/applications/${item.entry.id}`} className="inline-flex min-h-11 items-center font-medium break-words underline underline-offset-2 sm:min-h-0">
          {item.entry.name}
        </Link>
        <span className="text-muted">
          {" "}
          · {deadlineName(item.entry.deadlineType)} · {item.submitted ? "Sent" : dueText(item.daysLeft)}
        </span>
      </div>
    </li>
  );
}

/**
 * Deadlines in date order: anything that slipped by (gently), the next 30 days (highlighted),
 * then later ones.
 */
export function DeadlineTimeline({ timeline }: { timeline: Timeline<Entry> }) {
  const { pastDue, soon, later } = timeline;
  const empty = pastDue.length + soon.length + later.length === 0;
  return (
    <section aria-labelledby="deadlines-heading" className="space-y-4">
      <h2 id="deadlines-heading" className="text-xl font-semibold">
        Upcoming deadlines
      </h2>
      {empty && (
        <p className="text-sm text-muted">
          When you save a deadline for a college or program, it shows up here in date order.
        </p>
      )}

      {pastDue.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="font-medium">Dates that have passed</h3>
          <p className="mt-1 text-sm text-muted">
            These dates went by before the application was marked as sent. That happens! Some schools still take applications
            after their date, so it&apos;s worth checking with them. If you already sent it, update it on your list.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {pastDue.map((item) => (
              <Item key={item.entry.id} item={item} />
            ))}
          </ul>
        </div>
      )}

      {soon.length > 0 && (
        <div className="rounded-xl bg-accent-soft p-4">
          <h3 className="font-medium">Next {SOON_DAYS} days</h3>
          <ul className="mt-2 divide-y divide-border">
            {soon.map((item) => (
              <Item key={item.entry.id} item={item} />
            ))}
          </ul>
        </div>
      )}

      {later.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="font-medium">Later</h3>
          <ul className="mt-2 divide-y divide-border">
            {later.map((item) => (
              <Item key={item.entry.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
