import type { StudentSchoolChoice } from "@/db/schema";
import { stateName } from "../colleges/states";
import { isPlannerState } from "../planner/common";
import { comingLaterNote } from "../planner/copy";
import { SCHOOL_KIND_LABELS, gradeSpanLabel } from "./names";
import type { SchoolOption } from "./search";

// How schools and school choices read on the pickers and the parent page. Pure: server and client
// components both use these.

/** A saved school choice, as the pickers show it (from schoolSettings). */
export type SavedSchool = {
  choice: StudentSchoolChoice;
  school: SchoolOption | null;
  noLongerListed: boolean;
  notListedName: string | null;
};

/** "Plano · Grades 9–12 · Public", for a search result or a saved school. */
export function schoolDetails(s: SchoolOption): string {
  return [s.city, gradeSpanLabel(s.gradeLow, s.gradeHigh), SCHOOL_KIND_LABELS[s.kind], s.careerCenter ? "Career and technical center" : null, s.virtual ? "Online" : null]
    .filter(Boolean)
    .join(" · ");
}

/** How a saved choice reads: the school's name, "Not in our list: <their words>", or "You'd rather not say". */
export function savedSchoolLabel(saved: SavedSchool): string {
  if (saved.choice === "listed") return saved.school?.name ?? "A school that's no longer in the national school list";
  if (saved.choice === "not_listed") return saved.notListedName ? `Not in our list: ${saved.notListedName}` : "Not in our list";
  return "You'd rather not say";
}

/**
 * The state's line under the picker: full planning, or colleges and aid now and planning later.
 * `whose` is "your" for the student, "the" for a parent.
 */
export function stateCoverageNote(code: string, whose: "your" | "the" = "your"): string | null {
  const name = stateName(code);
  if (!name) return null;
  return isPlannerState(code)
    ? `Full class planning is available for ${name}. We'll also use ${whose} state for colleges and aid.`
    : `We'll use ${whose} state for colleges and aid. ${comingLaterNote(name)}`;
}
