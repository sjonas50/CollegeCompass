/**
 * Display helpers for College Scorecard numbers. Each returns null for missing or unusable data
 * (null, NaN, privacy-suppressed values the loader already turned into null) so pages can show
 * plain words instead.
 */

/** Shown for a missing number, with more detail nearby where it helps. */
export const NOT_REPORTED = "Not reported";
/** Field-of-study earnings and debt are only published when enough students graduated. */
export const PROGRAM_NOT_REPORTED = "Not enough graduates to report";

const DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whole dollars, like "$12,345". Never negative: anything below zero shows as "$0". */
export function formatDollars(value: number | null | undefined): string | null {
  if (!isNumber(value)) return null;
  return DOLLARS.format(Math.max(0, Math.round(value)));
}

/**
 * A net price for display. Scorecard net prices can be negative when grants and scholarships
 * were more than the cost; we show $0 and say so rather than a negative price.
 */
export function formatNetPrice(value: number | null | undefined): { text: string; aidExceedsCost: boolean } | null {
  const text = formatDollars(value);
  if (text === null) return null;
  return { text, aidExceedsCost: (value as number) < 0 };
}

export const AID_EXCEEDS_COST = "On average, grants and scholarships were more than the cost here.";

/** A 0–1 rate as a whole percent, like "46%". Tiny non-zero rates read "Less than 1%". */
export function formatPercent(rate: number | null | undefined): string | null {
  if (!isNumber(rate) || rate < 0) return null;
  const clamped = Math.min(1, rate);
  if (clamped > 0 && clamped < 0.005) return "Less than 1%";
  return `${Math.round(clamped * 100)}%`;
}

/** A whole number with commas, like "12,345". */
export function formatCount(value: number | null | undefined): string | null {
  if (!isNumber(value) || value < 0) return null;
  return COUNT.format(Math.round(value));
}

/** The formatted value, or plain words when it's missing. */
export function orNotReported(text: string | null, fallback: string = NOT_REPORTED): string {
  return text ?? fallback;
}

/** Scorecard titles often end with a period ("Computer Science."). */
export function cleanTitle(title: string): string {
  return title.trim().replace(/\.+$/, "");
}
