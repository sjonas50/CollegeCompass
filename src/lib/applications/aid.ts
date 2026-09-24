import type { AidOffer } from "@/db/schema";
import { AID_FIELDS, type AidField } from "./labels";

// Aid offer math. Pure functions only, so pages, the counselor summary and tests share one version.
//
// Sources for the plain-language explanations (checked September 2026):
// - Gift aid vs loans, and "subtracting grants and scholarships" from costs to compare offers:
//   https://bigfuture.collegeboard.org/pay-for-college/get-help-paying-for-college/scholarships-grants-institutional-aid/how-review-compare-financial-aid-awards
//   ("Grants and scholarships are free money you do not have to repay.")
// - Parent PLUS loans are the parent's debt: https://studentaid.gov/understand-aid/types/loans/plus/parent
//   ("No, a Direct PLUS Loan made to a parent cannot be transferred to the child.")
// - Private loans vs federal loans: https://studentaid.gov/understand-aid/types/loans/federal-vs-private
//   ("Private student loans are generally more expensive than federal student loans." Federal loans
//   "include many benefits (such as fixed interest rates and income-driven repayment plans) not
//   typically offered with private loans.")
// - Work-study is earned by working: FSA Handbook 2026–27, Vol. 6 Ch. 2,
//   https://fsapartners.ed.gov/knowledge-center/fsa-handbook/2026-2027/vol6/ch2-federal-work-study-program
//   ("A student's FWS compensation is earned when the student performs the work, and the school must
//   ensure that the student is paid FWS compensation at least once a month.")

/** The most any single aid-offer amount can be. */
export const MAX_AID_AMOUNT = 200_000;

export const GIFT_AID_NOTE = "Grants and scholarships don't need to be paid back. Loans do.";

export const PARENT_LOAN_WARNING =
  "This offer includes a Parent PLUS loan. It's a loan your parent takes out, so it's your parent's debt to pay back, and it can't be moved to you later. It isn't free money.";

export const OTHER_LOAN_WARNING =
  "This offer includes other loans, like private loans. They must be paid back. Private loans usually cost more than federal student loans and have fewer ways to pay them back.";

export const WORK_STUDY_NOTE =
  "Work-study isn't taken off your bill up front. It's money you earn at a part-time job during the year, paid as you work.";

export type AidComparison = {
  /** Null when the offer doesn't list a total cost. */
  costOfAttendance: number | null;
  grants: number;
  scholarships: number;
  /** Grants plus scholarships: money that doesn't need to be paid back. */
  giftAid: number;
  /** Cost minus gift aid, never below 0. Null without a total cost. */
  netPrice: number | null;
  /** True when grants and scholarships add up to more than the cost (net price shows as $0). */
  giftExceedsCost: boolean;
  workStudy: number;
  federalLoans: number;
  parentLoans: number;
  otherLoans: number;
  /** Federal plus parent plus other loans. */
  loans: number;
  /** Net price minus loans and work-study, never below 0. Null without a total cost. */
  paidNow: number | null;
  hasParentLoans: boolean;
  hasOtherLoans: boolean;
  /** Plain warnings to show with the offer (parent and private loans). */
  warnings: string[];
  /** Amounts the student left blank. */
  missing: AidField[];
};

/** A stored amount as whole, non-negative dollars (0 when missing or unusable). */
function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function hasAmount(offer: AidOffer, field: AidField): boolean {
  const v = offer[field];
  return typeof v === "number" && Number.isFinite(v);
}

export function compareAidOffer(offer: AidOffer | null | undefined): AidComparison {
  const o = offer ?? {};
  const costOfAttendance = hasAmount(o, "costOfAttendance") ? amount(o.costOfAttendance) : null;
  const grants = amount(o.grants);
  const scholarships = amount(o.scholarships);
  const giftAid = grants + scholarships;
  const workStudy = amount(o.workStudy);
  const federalLoans = amount(o.federalLoans);
  const parentLoans = amount(o.parentLoans);
  const otherLoans = amount(o.otherLoans);
  const loans = federalLoans + parentLoans + otherLoans;
  const netPrice = costOfAttendance === null ? null : Math.max(0, costOfAttendance - giftAid);
  const paidNow = netPrice === null ? null : Math.max(0, netPrice - loans - workStudy);
  const hasParentLoans = parentLoans > 0;
  const hasOtherLoans = otherLoans > 0;
  return {
    costOfAttendance,
    grants,
    scholarships,
    giftAid,
    netPrice,
    giftExceedsCost: costOfAttendance !== null && giftAid > costOfAttendance,
    workStudy,
    federalLoans,
    parentLoans,
    otherLoans,
    loans,
    paidNow,
    hasParentLoans,
    hasOtherLoans,
    warnings: [...(hasParentLoans ? [PARENT_LOAN_WARNING] : []), ...(hasOtherLoans ? [OTHER_LOAN_WARNING] : [])],
    missing: AID_FIELDS.filter((f) => !hasAmount(o, f)),
  };
}

/** True when at least one amount was entered. */
export function hasAidOffer(offer: AidOffer | null | undefined): offer is AidOffer {
  return Boolean(offer) && AID_FIELDS.some((f) => hasAmount(offer as AidOffer, f));
}

/** Whole dollars like "$12,345". Never negative: anything below zero shows as $0. */
export function formatDollars(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return `$${n.toLocaleString("en-US")}`;
}
