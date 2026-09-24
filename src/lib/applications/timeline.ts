import type { ApplicationChecklist, CollegeListStatus } from "@/db/schema";
import { daysBetween } from "./dates";
import { CHECKLIST_KEYS, SUBMITTED_STATUSES } from "./labels";

// Deadline timeline for the list page and the counselor. Pure functions, no database.

/** Deadlines this close (in days) are highlighted as coming up soon. */
export const SOON_DAYS = 30;

type HasProgress = { status: CollegeListStatus; checklist: ApplicationChecklist | null };

/** True once the application went in (by status or the checklist), so its deadline is handled. */
export function isSubmitted(entry: HasProgress): boolean {
  return SUBMITTED_STATUSES.includes(entry.status) || entry.checklist?.applicationSubmitted === true;
}

/** How many of the checklist items are checked. Unknown keys don't count. */
export function checklistProgress(checklist: ApplicationChecklist | null | undefined): { done: number; total: number } {
  return {
    done: CHECKLIST_KEYS.filter((k) => checklist?.[k] === true).length,
    total: CHECKLIST_KEYS.length,
  };
}

export type TimelineItem<T> = { entry: T; deadline: string; daysLeft: number; submitted: boolean };

export type Timeline<T> = {
  /** Deadlines that passed while the application still wasn't sent. */
  pastDue: TimelineItem<T>[];
  /** Today through the next 30 days. */
  soon: TimelineItem<T>[];
  /** More than 30 days away. */
  later: TimelineItem<T>[];
};

/**
 * Every entry with a deadline, soonest first. Past deadlines are only kept when the application
 * wasn't marked as sent (those get a gentle reminder); upcoming ones are kept either way, marked
 * `submitted` so the page can show they're handled.
 */
export function buildTimeline<T extends HasProgress & { deadline: string | null; name: string }>(
  entries: readonly T[],
  today: string,
): Timeline<T> {
  const items = entries
    .filter((e): e is T & { deadline: string } => Boolean(e.deadline))
    .map((entry) => ({ entry, deadline: entry.deadline, daysLeft: daysBetween(today, entry.deadline), submitted: isSubmitted(entry) }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.entry.name.localeCompare(b.entry.name));
  return {
    pastDue: items.filter((i) => i.daysLeft < 0 && !i.submitted),
    soon: items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= SOON_DAYS),
    later: items.filter((i) => i.daysLeft > SOON_DAYS),
  };
}
