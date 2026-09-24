import type { CourseLevel, CourseStatus } from "@/db/schema";
import { type LetterGrade, isLetterGrade } from "./catalog";

/**
 * GPA estimate from the courses a student enters. Schools calculate GPA in different ways (which
 * classes count, how much honors/AP adds, rounding), so this is always shown as an estimate.
 */

/** Unweighted 4.0 scale. P, W and I have no grade points and don't count toward GPA. */
export const GRADE_POINTS: Record<LetterGrade, number | null> = {
  "A+": 4, A: 4, "A-": 3.7,
  "B+": 3.3, B: 3, "B-": 2.7,
  "C+": 2.3, C: 2, "C-": 1.7,
  "D+": 1.3, D: 1, "D-": 0.7,
  F: 0,
  P: null, W: null, I: null,
};

/** Added to passing grades for the weighted GPA (never to an F). */
export const LEVEL_BONUS: Record<CourseLevel, number> = {
  regular: 0,
  honors: 0.5,
  ap: 1,
  ib: 1,
  dual_enrollment: 1,
};

/** Grades that mean the credit wasn't earned. */
const NOT_EARNED: ReadonlySet<string> = new Set<LetterGrade>(["F", "W", "I"]);

export const GPA_CAVEAT =
  "This is an estimate. Schools calculate GPA differently — some weight honors, AP, IB or dual enrollment classes differently, and some don't count every class. Your transcript shows your official GPA.";

export type GpaCourse = {
  gradeLevel: number;
  level: CourseLevel;
  credits: number;
  status: CourseStatus;
  finalGrade: string | null;
  highSchoolCredit: boolean;
};

export type GpaFigures = {
  /** Null until at least one finished high school course has a letter grade. */
  unweighted: number | null;
  weighted: number | null;
  /** Credits that count toward the GPA (finished, high school credit, letter grade). */
  gpaCredits: number;
  /** High school credits earned: finished courses not failed, withdrawn or incomplete. */
  creditsEarned: number;
};

export type GpaSummary = GpaFigures & { byGrade: (GpaFigures & { gradeLevel: number })[] };

/** Grade points for a course, or null when it doesn't count toward GPA. */
export function gradePoints(course: GpaCourse, weighted: boolean): number | null {
  if (course.status !== "completed" || !course.highSchoolCredit || !isLetterGrade(course.finalGrade)) return null;
  const base = GRADE_POINTS[course.finalGrade];
  if (base === null) return null;
  return weighted && base > 0 ? base + LEVEL_BONUS[course.level] : base;
}

export function countsTowardGpa(course: GpaCourse) {
  return gradePoints(course, false) !== null;
}

export function earnsCredit(course: GpaCourse) {
  return course.status === "completed" && course.highSchoolCredit && !NOT_EARNED.has(course.finalGrade ?? "");
}

// Grade points have one decimal place (x10) and credits are quarter steps (x4), so sums stay
// integers and rounding to two decimals is exact.
const toTenths = (n: number) => Math.round(n * 10);
const toQuarters = (n: number) => Math.round(n * 4);

function average(qualityTenthsQuarters: number, quarters: number): number | null {
  if (quarters === 0) return null;
  // GPA * 100 = quality / (10 * quarters) * 100
  return Math.round((qualityTenthsQuarters * 10) / quarters) / 100;
}

function figures(courses: GpaCourse[]): GpaFigures {
  let quarters = 0;
  let unweighted = 0;
  let weighted = 0;
  let earnedQuarters = 0;
  for (const c of courses) {
    const q = toQuarters(c.credits);
    if (earnsCredit(c)) earnedQuarters += q;
    const u = gradePoints(c, false);
    const w = gradePoints(c, true);
    if (u === null || w === null) continue;
    quarters += q;
    unweighted += toTenths(u) * q;
    weighted += toTenths(w) * q;
  }
  return {
    unweighted: average(unweighted, quarters),
    weighted: average(weighted, quarters),
    gpaCredits: quarters / 4,
    creditsEarned: earnedQuarters / 4,
  };
}

/** Credit-weighted GPA overall and per grade level (only grades with finished high school courses). */
export function computeGpa(courses: GpaCourse[]): GpaSummary {
  const counted = courses.filter((c) => c.status === "completed" && c.highSchoolCredit);
  const grades = [...new Set(counted.map((c) => c.gradeLevel))].sort((a, b) => a - b);
  return {
    ...figures(counted),
    byGrade: grades.map((gradeLevel) => ({ gradeLevel, ...figures(counted.filter((c) => c.gradeLevel === gradeLevel)) })),
  };
}

/** "3.50", or null. GPAs are displayed with two decimals. */
export function formatGpa(value: number | null) {
  return value === null ? null : value.toFixed(2);
}
