// Pure helpers for the staff pages: labels, months, money and durations. Admin pages show times in
// UTC, the same clock the AI budget and the daily cost buckets use.

import type { SafetyReviewOutcome } from "@/db/schema";
import { type GradeBand, gradeBand } from "@/lib/auth/age";
import type { SafetyCategory } from "@/lib/ai/safety/types";

export type EventSeverity = "low" | "medium" | "high" | "imminent";

export const SEVERITY_LABELS: Record<EventSeverity, string> = {
  imminent: "Imminent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Most urgent first. */
export const SEVERITIES: readonly EventSeverity[] = ["imminent", "high", "medium", "low"];

export const CATEGORY_LABELS: Record<SafetyCategory, string> = {
  self_harm: "Self-harm",
  abuse: "Abuse",
  violence: "Violence",
  sexual_content: "Sexual content",
  eating_disorder: "Eating disorder",
  substance_use: "Substance use",
  bullying: "Bullying",
  distress: "Distress",
};

const SOURCE_LABELS: Record<string, string> = {
  rules: "Keyword rules",
  model: "AI model",
  model_unavailable: "AI model unavailable",
  rate_limited: "Sent while rate-limited (rules only)",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export const OUTCOME_LABELS: Record<SafetyReviewOutcome, string> = {
  no_action: "No action needed",
  followed_up: "Followed up",
  escalated: "Escalated",
};

export const REVIEW_OUTCOMES: readonly SafetyReviewOutcome[] = ["no_action", "followed_up", "escalated"];

/** Longest review note, in characters. */
export const REVIEW_NOTE_MAX = 2000;

const FEATURE_LABELS: Record<string, string> = {
  counselor: "AI counselor",
  safety: "Safety check",
  safety_backup: "Safety check (backup model)",
  explain: "Career match explanations",
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

const BAND_LABELS: Record<GradeBand, string> = {
  explore: "Grades 7–8",
  build: "Grades 9–10",
  launch: "Grades 11–12",
};

/** A student's grade band, never anything more specific. */
export function gradeBandLabel(grade: number | null): string {
  if (grade === null) return "Grade not set";
  if (grade > 12) return "Finished high school";
  return BAND_LABELS[gradeBand(grade)];
}

// ---------------------------------------------------------------------------
// Months (UTC, like the per-student AI budget)
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-09" for the UTC month containing `date`. */
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A requested month ("YYYY-MM"), or the current month when it's missing, malformed or in the future. */
export function parseMonth(value: unknown, now: Date = new Date()): string {
  const current = monthKeyOf(now);
  if (typeof value !== "string") return current;
  const match = MONTH_KEY.exec(value);
  if (!match || Number(match[1]) < 2000 || value > current) return current;
  return value;
}

/** The month's first instant and the next month's first instant, in UTC. */
export function monthRange(month: string): { start: Date; end: Date; days: number } {
  const match = MONTH_KEY.exec(month);
  if (!match) throw new Error(`Not a month: ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index, 1));
  const end = new Date(Date.UTC(year, index + 1, 1));
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

/** The last `count` months, newest first. */
export function recentMonths(now: Date = new Date(), count = 12): string[] {
  return Array.from({ length: count }, (_, i) => monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "September 2026". */
export function monthLabel(month: string): string {
  return MONTH_LABEL.format(monthRange(month).start);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The middle value (the mean of the two middle values for an even count), or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Millionths of a dollar as dollars: "$1.25". Amounts under a cent (but not zero) show as "<$0.01". */
export function formatUsd(micros: number): string {
  if (micros > 0 && micros < 5_000) return "<$0.01";
  return `$${(micros / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole percent, e.g. 83.4 → "83%". */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

// ---------------------------------------------------------------------------
// Durations and times
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "under a minute", "12 minutes", "5 hours", "3 days". Hours up to two days, then days. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MINUTE_MS) return "under a minute";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (abs < HOUR_MS) return plural(Math.floor(abs / MINUTE_MS), "minute");
  if (abs < 2 * DAY_MS) return plural(Math.floor(abs / HOUR_MS), "hour");
  return plural(Math.floor(abs / DAY_MS), "day");
}

/** "just now", "5 hours ago". */
export function formatAgo(from: Date, now: Date = new Date()): string {
  const ms = now.getTime() - from.getTime();
  return ms < MINUTE_MS ? "just now" : `${formatDuration(ms)} ago`;
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** "Sep 24, 2026, 6:05 PM UTC". */
export function formatDateTime(date: Date): string {
  return `${DATE_TIME.format(date)} UTC`;
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Sep 24" for a YYYY-MM-DD day. */
export function formatDay(isoDate: string): string {
  return SHORT_DAY.format(new Date(`${isoDate}T00:00:00Z`));
}
