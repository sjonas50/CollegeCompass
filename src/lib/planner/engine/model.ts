import type { CourseSubject, CourseTerm } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import type { SchoolGrade, SchoolYear } from "../common";
import { type CourseTypeId, type CourseTypeLevel, getCourseType } from "../course-types";
import type { CountedRef, CourseFact } from "../engine-io";
import { earnsNoCredit } from "./util";

// ---------------------------------------------------------------------------
// The engine's view of a class: a recorded class (always locked) or a class the planner
// suggests. Everything the audit, the ladder and the fill step look at goes through an Item.
// ---------------------------------------------------------------------------

export type Item = {
  /** "c:<courseId>" for the student's rows, "s:<n>" for suggestions. Unique in one plan. */
  key: string;
  ref: CountedRef;
  /** The student's own row (locked). */
  own: boolean;
  typeId: CourseTypeId;
  /** A guessed type: only `subjects` selectors match it. */
  assumed: boolean;
  level: CourseTypeLevel;
  subject: CourseSubject;
  grade: SchoolGrade;
  schoolYear: SchoolYear;
  term: CourseTerm;
  units: number;
  /** Finished or in progress (design §5.5 "firm"). */
  firm: boolean;
  completed: boolean;
  /** Earns high school credit: HS credit, and not F, W or I. */
  creditable: boolean;
  /** F, W or I on a finished class. */
  noCredit: boolean;
  hsCredit: boolean;
  letter: LetterGrade | null;
  cte: boolean;
  lectureOnly: boolean;
  /**
   * A guessed kind taken as confirmed (`asConfirmed`): it counts as that kind, but where a class
   * the student confirmed would do as well, that one counts first.
   */
  guess?: true;
  /**
   * A guess that fell to its subject's "Other" class, taken as the class its place in the plan
   * says it is (engine/guesses.ts): still a guess, flagged like any other.
   */
  provisional?: true;
};

export function itemFromFact(fact: CourseFact): Item {
  const completed = fact.status === "completed";
  const noCredit = completed && earnsNoCredit(fact.finalGrade);
  return {
    key: `c:${fact.id}`,
    ref: { kind: "course", courseId: fact.id },
    own: true,
    typeId: fact.typeId,
    assumed: fact.assumed,
    level: fact.level,
    subject: fact.subject,
    grade: fact.grade,
    schoolYear: fact.schoolYear,
    term: fact.term,
    units: fact.units,
    firm: fact.status !== "planned",
    completed,
    creditable: fact.highSchoolCredit && !noCredit && fact.units > 0,
    noCredit,
    hsCredit: fact.highSchoolCredit,
    letter: fact.finalGrade,
    cte: fact.cte,
    lectureOnly: fact.lectureOnly,
  };
}

export type SuggestionSpec = {
  n: number;
  key: string;
  typeId: CourseTypeId;
  level: CourseTypeLevel;
  grade: SchoolGrade;
  schoolYear: SchoolYear;
  term: CourseTerm;
  units: number;
  cte: boolean;
  lectureOnly: boolean;
};

export function itemFromSuggestion(s: SuggestionSpec): Item {
  return {
    key: `s:${s.n}`,
    ref: { kind: "suggestion", key: s.key },
    own: false,
    typeId: s.typeId,
    assumed: false,
    level: s.level,
    subject: getCourseType(s.typeId).subject,
    grade: s.grade,
    schoolYear: s.schoolYear,
    term: s.term,
    units: s.units,
    firm: false,
    completed: false,
    creditable: s.units > 0,
    noCredit: false,
    hsCredit: true,
    letter: null,
    cte: s.cte,
    lectureOnly: s.lectureOnly,
  };
}

/**
 * The student's classes as they most likely are: a guessed type counts as if the student had
 * confirmed it. The fill plans against this view, so it never adds a class the student probably
 * already has (a typed "Chemistry" with no kind picked is still Chemistry); the audit keeps the
 * guess visible ("Guessed class type") until the student confirms it. Other items keep their
 * identity.
 */
export function asConfirmed(items: readonly Item[]): Item[] {
  return items.map((i) => (i.own && i.assumed ? { ...i, assumed: false, guess: true } : i));
}

/**
 * The student's classes exactly as a student who confirmed every guessed kind would have them:
 * what the fill plans against, so a typed class and the same class with its kind picked get the
 * same plan (the same route through each rule set, the same classes added, the same reasons).
 * Unlike `asConfirmed`, a guess here doesn't give way to a confirmed class: that preference is
 * only for the audit, which asks to confirm a kind when it matters.
 */
export function asPlanned(items: readonly Item[]): Item[] {
  return items.map((i) => (i.own && i.assumed ? { ...i, assumed: false } : i));
}

/** A class taken (or planned) that can still be built on: not failed or withdrawn. */
export function countsForSequence(item: Item): boolean {
  return !item.noCredit;
}

/**
 * Class-year slots a class takes, in halves: a full-year credit takes 2 (one class all year), a
 * semester takes 1. Summer classes take none (they don't use the school year).
 */
export function slotHalves(term: CourseTerm, units: number): number {
  if (term === "summer") return 0;
  return Math.max(1, Math.ceil(units / 2));
}
