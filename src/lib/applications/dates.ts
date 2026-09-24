// Calendar-date helpers for deadlines. Deadlines are plain dates (YYYY-MM-DD) with no time zone.

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's date for a US student. College deadlines usually run to the end of the day, local
 * time, so we use Pacific time: it's the latest mainland US time zone, and a deadline is never
 * called "passed" while it's still that day for most students.
 */
export function usToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True for a real calendar date written as YYYY-MM-DD (so no February 30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The same calendar day `years` later (or earlier). February 29 rolls to March 1. */
export function shiftYears(isoDate: string, years: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** The calendar day `days` after (or before) `isoDate`. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** How far from today a deadline may be: two years either way. */
export const DEADLINE_WINDOW_YEARS = 2;

export function deadlineWindow(today: string): { min: string; max: string } {
  return { min: shiftYears(today, -DEADLINE_WINDOW_YEARS), max: shiftYears(today, DEADLINE_WINDOW_YEARS) };
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "November 1, 2026". */
export function formatDate(isoDate: string): string {
  return LONG_DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
