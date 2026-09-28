import type { SchoolGrade, SchoolYear } from "./common";
import type { CohortOverrideReason, StudentCohort } from "./engine-io";
import type { CohortKey } from "./rules";

// Which cohort a student belongs to, from their grade now (design §2.2 step 4, §5.3). Setup shows
// "You started 9th grade in fall 2026 (class of 2030). Is that right?" from the same numbers the
// engine uses, so both must come from here.

export type CohortOverrides = {
  grade9Entry?: { year: SchoolYear; reason: CohortOverrideReason };
  classYear?: { year: number; reason: CohortOverrideReason };
};

/**
 * `grade` and `schoolYear` are `currentGrade()` and `schoolYearOf()` for the same day (June and
 * July count as the year just ended). A 10th grader in 2026-27 started 9th grade in fall 2025
 * and is the class of 2029. The two overrides are independent: a student who repeated 9th grade
 * overrides the entry year; an early graduate overrides only the class year.
 */
export function deriveCohort(grade: SchoolGrade, schoolYear: SchoolYear, overrides: CohortOverrides = {}): StudentCohort {
  const grade9EntryYear = overrides.grade9Entry?.year ?? schoolYear - (grade - 9);
  const classYear = overrides.classYear?.year ?? schoolYear + (12 - grade) + 1;
  return {
    grade9EntryYear,
    classYear,
    grade7EntryYear: grade9EntryYear - 2,
    overrides: {
      ...(overrides.grade9Entry ? { grade9Entry: overrides.grade9Entry.reason } : {}),
      ...(overrides.classYear ? { classYear: overrides.classYear.reason } : {}),
    },
  };
}

/** The number a rule set's variants are keyed by. */
export function cohortValue(cohort: StudentCohort, key: CohortKey): number {
  switch (key) {
    case "class_year":
      return cohort.classYear;
    case "grade9_entry_year":
      return cohort.grade9EntryYear;
    case "grade7_entry_year":
      return cohort.grade7EntryYear;
  }
}

/** The school year a class in `grade` is (or was) taken, counted from the grade-9 entry year. */
export function schoolYearForGrade(cohort: StudentCohort, grade: SchoolGrade): SchoolYear {
  return cohort.grade9EntryYear + (grade - 9);
}
