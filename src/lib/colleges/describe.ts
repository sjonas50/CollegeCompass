import { formatCount } from "./format";
import { SIZE_LABELS, sizeOf } from "./labels";

/**
 * The College Scorecard data release loaded by `npm run data:load` (scripts/load-reference.ts
 * downloads Most-Recent-Cohorts-Institution_06102026). Update both together.
 */
export const SCORECARD_RELEASE = "June 2026";

/**
 * Plain-language explanations of College Scorecard numbers, shared by the explorer pages (and
 * usable by the AI counselor) so every place explains a number the same way.
 */
export const MEANINGS = {
  netPrice:
    "Net price is what students paid for one year after grants and scholarships (money you don't pay back). It's the average for students who got federal financial aid, and it covers tuition, fees, books, housing and food. Your own price can be higher or lower. Each college's net price calculator gives you a personal estimate.",
  stickerPrice:
    "The sticker price (cost of attendance) is the full price for one year before any aid: tuition, fees, books, housing and food. Most students pay less than this.",
  completion:
    "The share of first-time, full-time students who finished within 1.5 times the usual length, like 6 years for a 4-year degree or 3 years for a 2-year degree.",
  earnings:
    "Typical (median) yearly earnings of former students 10 years after they started here, counting students who got federal aid, whether or not they finished.",
  debt: "Typical (median) federal student loan debt for students who finished here. Half owed more and half owed less. Private loans aren't included.",
  pell: "Pell Grants are federal grants for students from families with lower incomes. You don't pay them back.",
} as const;

export const FOR_PROFIT_NOTE =
  "This is a for-profit college. It's a good idea to compare its graduation rate, earnings and debt with other colleges before you decide.";

/** "Austin, TX", or whichever part is known, or null. */
export function locationText(city: string | null | undefined, state: string | null | undefined): string | null {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** "Medium (8,000 undergraduates)", or null when enrollment wasn't reported. */
export function sizeText(enrollment: number | null | undefined): string | null {
  const size = sizeOf(enrollment);
  const count = formatCount(enrollment);
  if (!size || count === null) return null;
  return `${SIZE_LABELS[size].label} (${count} ${enrollment === 1 ? "undergraduate" : "undergraduates"})`;
}

/**
 * Context for an admission rate. Most colleges admit most applicants, so a low rate is the
 * exception, and a missing rate often means the college takes everyone who applies.
 */
export function admissionContext(rate: number | null | undefined): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return "Colleges that accept everyone who applies (open admission), like most community colleges, usually don't report one.";
  }
  if (rate < 0.25) return "This college is very selective. Most colleges admit most of the students who apply.";
  if (rate < 0.5) return "This college admits fewer than half of applicants. Most colleges admit most of the students who apply.";
  return "Like most colleges, this one admits most of the students who apply.";
}

/** "Showing 21–40 of 1,234 colleges" numbers: the 1-based first and last result on a page. */
export function resultRange(total: number, page: number, pageSize: number): { from: number; to: number } | null {
  if (total <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  if (from > total) return null;
  return { from, to: Math.min(total, page * pageSize) };
}

export type PageItem = number | "gap";

/**
 * Page links to show: always the first and last page, plus the pages next to the current one,
 * with "gap" where pages are skipped. E.g. page 6 of 20 → [1, "gap", 5, 6, 7, "gap", 20].
 */
export function pageList(current: number, last: number): PageItem[] {
  if (last <= 1) return [];
  const wanted = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  // Show a page instead of a gap when the gap would hide only one page.
  if (wanted.has(3) && !wanted.has(2)) wanted.add(2);
  if (wanted.has(last - 2) && !wanted.has(last - 1)) wanted.add(last - 1);
  const pages = [...wanted].sort((a, b) => a - b);
  const items: PageItem[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) items.push("gap");
    items.push(p);
  });
  return items;
}
