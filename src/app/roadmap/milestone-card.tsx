import { CATEGORY_LABELS, type MilestoneStatus, PATHWAY_LABELS, gradeName, monthList, monthsInSchoolYearOrder } from "@/lib/roadmap";
import type { Milestone } from "@/lib/roadmap/types";
import { MilestoneActions, type WeekState } from "./milestone-actions";

/** Official links only: http(s) URLs, labeled by their site name. */
function officialLinks(sources: string[]) {
  return sources.flatMap((href) => {
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      return [{ href: url.toString(), label: url.hostname.replace(/^www\./, "") }];
    } catch {
      return [];
    }
  });
}

const chip = "rounded-full px-2 py-0.5 text-xs";

export function MilestoneCard({
  milestone,
  status,
  studentGrade,
  actions,
  showMonths = false,
  headingLevel = 3,
}: {
  milestone: Milestone;
  status: MilestoneStatus;
  /** Adds a grade chip when the milestone is from a different grade (e.g. next grade in summer). */
  studentGrade?: number;
  /** Omit for a read-only card (peeking at other grades). */
  actions?: { week: WeekState; focusAfter: string };
  showMonths?: boolean;
  headingLevel?: 3 | 4;
}) {
  const m = milestone;
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const titleId = `m-${m.id}`;
  const links = officialLinks(m.sources);
  const months = monthsInSchoolYearOrder(m);

  return (
    <article aria-labelledby={titleId} className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${chip} bg-accent-soft`}>{CATEGORY_LABELS[m.category] ?? m.category}</span>
        {m.pathway !== "all" && <span className={`${chip} border border-border`}>{PATHWAY_LABELS[m.pathway]}</span>}
        {studentGrade !== undefined && m.grade !== studentGrade && (
          <span className={`${chip} border border-border`}>{gradeName(m.grade)}</span>
        )}
        {status === "done" && <span className={`${chip} bg-success-soft`}>Done</span>}
        {status === "skipped" && <span className={`${chip} border border-border text-muted`}>Set aside</span>}
      </div>

      <Heading id={titleId} tabIndex={-1} className="mt-2 font-medium focus:outline-none">
        {m.title}
      </Heading>
      {showMonths && months.length > 0 && <p className="text-sm text-muted">{monthList(months)}</p>}
      <p className="mt-1 text-sm text-muted">{m.detail}</p>

      <details className="mt-1 text-sm">
        <summary className="cursor-pointer py-3 font-medium underline-offset-2 hover:underline">Why it matters</summary>
        <p className="pb-2 text-muted">{m.why}</p>
      </details>

      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 text-sm">
          <span className="font-medium">Official info:</span>
          <ul className="flex flex-wrap gap-x-3">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center underline underline-offset-2"
                >
                  {l.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions && (
        <MilestoneActions id={m.id} title={m.title} status={status} week={actions.week} focusAfter={actions.focusAfter} />
      )}
    </article>
  );
}
