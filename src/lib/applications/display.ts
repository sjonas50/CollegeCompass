import type { DeadlineType } from "@/db/schema";
import { MAX_GRADE } from "../auth/age";
import { type AidComparison, formatDollars } from "./aid";
import type { AidField } from "./labels";

// Plain-language wording for the list pages. No database code, so client components can use it.

export type ListMode = {
  /** Show application tools (status, deadline type, checklist, aid offer) up front. */
  applying: boolean;
  /** Show "Key dates this year" (11th and 12th grade only). */
  showKeyDates: boolean;
  graduated: boolean;
};

/**
 * Grades 7–10 collect ideas ("Colleges and programs I'm curious about"); 11–12 apply. Graduates
 * (grade above 12) and students without a grade keep the full tools but not this year's key dates.
 */
export function listMode(grade: number | null): ListMode {
  if (grade === null) return { applying: true, showKeyDates: false, graduated: false };
  if (grade > MAX_GRADE) return { applying: true, showKeyDates: false, graduated: true };
  if (grade >= 11) return { applying: true, showKeyDates: true, graduated: false };
  return { applying: false, showKeyDates: false, graduated: false };
}

const DEADLINE_NAMES: Record<DeadlineType, string> = {
  early_decision: "Early decision deadline",
  early_action: "Early action deadline",
  regular: "Regular deadline",
  rolling: "Rolling admission (apply by)",
  priority: "Priority deadline",
};

/** "Regular deadline", or just "Deadline" when the type isn't set. */
export function deadlineName(type: DeadlineType | null): string {
  return type ? DEADLINE_NAMES[type] : "Deadline";
}

/** "Due today", "Due in 5 days", "Was due 3 days ago". */
export function dueText(daysLeft: number): string {
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  if (daysLeft > 1) return `Due in ${daysLeft} days`;
  if (daysLeft === -1) return "Was due yesterday";
  return `Was due ${-daysLeft} days ago`;
}

export type ScorecardPrice = { amount: string | null; note: string | null };

/**
 * The College Scorecard's average net price as page text. Missing or privacy-suppressed figures
 * get a plain explanation, and a below-zero average shows as $0.
 */
export function scorecardPrice(scorecard: { found: boolean; avgNetPrice: number | null } | null): ScorecardPrice {
  if (!scorecard) {
    return { amount: null, note: "This one isn't in the College Scorecard, so there's no federal average to show." };
  }
  if (!scorecard.found) return { amount: null, note: "We don't have College Scorecard numbers for this college right now." };
  if (scorecard.avgNetPrice === null || !Number.isFinite(scorecard.avgNetPrice)) {
    return {
      amount: null,
      note: "The College Scorecard doesn't list an average net price here. Sometimes it isn't reported, or it's left out to protect students' privacy.",
    };
  }
  if (scorecard.avgNetPrice < 0) return { amount: "$0", note: "On average, aid here was more than the cost." };
  return { amount: formatDollars(scorecard.avgNetPrice), note: null };
}

export type AidLine = {
  key: AidField | "giftAid" | "netPrice" | "paidNow";
  label: string;
  value: string;
  note?: string;
  /** Totals the student should look at first. */
  strong?: boolean;
};

/**
 * One offer as label/value lines, in the order they're compared. Blank amounts read "Not listed"
 * and totals that need the cost say so, so nothing ever shows as null, NaN or a negative.
 */
export function aidOfferLines(c: AidComparison): AidLine[] {
  const amount = (field: AidField, value: number) => (c.missing.includes(field) ? "Not listed" : formatDollars(value));
  const needsCost = "Needs the total cost";
  return [
    { key: "costOfAttendance", label: "Total cost for one year", value: c.costOfAttendance === null ? "Not listed" : formatDollars(c.costOfAttendance) },
    { key: "grants", label: "Grants", value: amount("grants", c.grants) },
    { key: "scholarships", label: "Scholarships", value: amount("scholarships", c.scholarships) },
    { key: "giftAid", label: "Free money (grants plus scholarships)", value: formatDollars(c.giftAid), strong: true },
    {
      key: "netPrice",
      label: "Net price (total cost minus free money)",
      value: c.netPrice === null ? needsCost : formatDollars(c.netPrice),
      note: c.giftExceedsCost
        ? "Grants and scholarships add up to more than the cost, so the net price is $0."
        : c.netPrice === null
          ? "Add the total cost to see the net price."
          : undefined,
      strong: true,
    },
    { key: "federalLoans", label: "Federal student loans", value: amount("federalLoans", c.federalLoans) },
    { key: "parentLoans", label: "Parent PLUS loans", value: amount("parentLoans", c.parentLoans) },
    { key: "otherLoans", label: "Other loans", value: amount("otherLoans", c.otherLoans) },
    { key: "workStudy", label: "Work-study", value: amount("workStudy", c.workStudy) },
    {
      key: "paidNow",
      label: "Left to pay after loans and work-study",
      value: c.paidNow === null ? needsCost : formatDollars(c.paidNow),
      strong: true,
    },
  ];
}

/** "1 aid offer", "3 aid offers". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
