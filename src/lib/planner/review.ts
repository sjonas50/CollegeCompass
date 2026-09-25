import { createHash } from "node:crypto";
import { type IsoDate, type SchoolYear, schoolYearLabel } from "./common";
import type { ContentHeader, Review } from "./rules";

// Review status, fingerprints and staleness for planner content. For the proof of concept nothing
// is hidden on review status: draft content shows to everyone with the "not yet reviewed" label.
// Stale content is labeled at runtime and can't show Done; dates never fail CI (design §5.3).

/** JSON with object keys sorted, so the same content always gives the same string. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A short fingerprint of everything in a content file except its review block (so recording a
 * review doesn't change it, and any later edit does). Same scheme as the aid guide's.
 */
export function contentFingerprint(file: ContentHeader): string {
  const { review: _review, ...rest } = file;
  return createHash("sha256").update(stableJson(rest)).digest("hex").slice(0, 16);
}

export const REVIEW_LABELS = {
  draft: "Not yet reviewed by a school counselor",
  reviewed: (on: IsoDate) => `Reviewed by a school counselor on ${on}`,
} as const;

export function reviewLabel(review: Review): string {
  return review.status === "counselor-reviewed" && review.reviewedOn ? REVIEW_LABELS.reviewed(review.reviewedOn) : REVIEW_LABELS.draft;
}

/** The last day content checked for `year` counts as current: July 31 after that school year. */
export function staleAfter(year: SchoolYear): IsoDate {
  return `${year + 1}-07-31`;
}

/** Past the file's school year, or past a rule set's own re-check date. ISO dates compare as strings. */
export function isStale(today: IsoDate, verifiedForSchoolYear: SchoolYear, recheckBy?: IsoDate): boolean {
  return today > staleAfter(verifiedForSchoolYear) || (recheckBy !== undefined && today > recheckBy);
}

/** "Checked for 2026-27; being re-checked. Ask your counselor." */
export function staleLabel(verifiedForSchoolYear: SchoolYear): string {
  return `Checked for ${schoolYearLabel(verifiedForSchoolYear)}; being re-checked. Ask your counselor.`;
}
