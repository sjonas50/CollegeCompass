import type { CourseLevel, CourseStatus, CourseSubject, CourseTerm } from "@/db/schema";

/**
 * Course vocabulary shared by validation, GPA math, the planner UI and the AI counselor summary.
 * Pure data only, so client components can import it.
 */

export const SUBJECT_LABELS: Record<CourseSubject, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  social_studies: "Social studies",
  world_language: "World language",
  arts: "Arts",
  computer_science: "Computer science",
  career_technical: "Career & technical (CTE)",
  health_pe: "Health & PE",
  other: "Other",
};

export const LEVEL_LABELS: Record<CourseLevel, string> = {
  regular: "Regular",
  honors: "Honors",
  ap: "AP",
  ib: "IB",
  dual_enrollment: "Dual enrollment",
};

export const TERM_LABELS: Record<CourseTerm, string> = {
  full_year: "Full year",
  fall: "Fall semester",
  spring: "Spring semester",
  summer: "Summer",
};

export const STATUS_LABELS: Record<CourseStatus, string> = {
  planned: "Planned",
  in_progress: "Taking now",
  completed: "Finished",
};

// Object key order is insertion order, so these keep the order written above.
export const COURSE_SUBJECTS = Object.keys(SUBJECT_LABELS) as [CourseSubject, ...CourseSubject[]];
export const COURSE_LEVELS = Object.keys(LEVEL_LABELS) as [CourseLevel, ...CourseLevel[]];
export const COURSE_TERMS = Object.keys(TERM_LABELS) as [CourseTerm, ...CourseTerm[]];
export const COURSE_STATUSES = Object.keys(STATUS_LABELS) as [CourseStatus, ...CourseStatus[]];

/** Final grades a student can record. P (pass), W (withdrew) and I (incomplete) have no grade points. */
export const LETTER_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "W", "I"] as const;
export type LetterGrade = (typeof LETTER_GRADES)[number];

export const GRADE_LABELS: Record<LetterGrade, string> = {
  "A+": "A+", A: "A", "A-": "A-", "B+": "B+", B: "B", "B-": "B-", "C+": "C+", C: "C", "C-": "C-",
  "D+": "D+", D: "D", "D-": "D-", F: "F", P: "P (pass)", W: "W (withdrew)", I: "I (incomplete)",
};

export function isLetterGrade(value: unknown): value is LetterGrade {
  return typeof value === "string" && (LETTER_GRADES as readonly string[]).includes(value);
}

export const MIN_CREDITS = 0.25;
export const MAX_CREDITS = 2;
export const CREDIT_STEP = 0.25;
export const CREDIT_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const COURSE_GRADE_LEVELS = [7, 8, 9, 10, 11, 12] as const;

/** "9th grade". Every grade we support (7–12) takes "th". */
export function gradeName(gradeLevel: number) {
  return `${gradeLevel}th grade`;
}

/**
 * High school courses count for high school credit; middle school courses usually don't, unless
 * the school says so (e.g. Algebra I or a world language in 8th grade).
 */
export function defaultHighSchoolCredit(gradeLevel: number) {
  return gradeLevel >= 9;
}

/** A sensible starting status for a course added to `gradeLevel` by a student now in `currentGrade`. */
export function defaultStatusFor(gradeLevel: number, currentGrade: number): CourseStatus {
  if (gradeLevel < currentGrade) return "completed";
  if (gradeLevel === currentGrade) return "in_progress";
  return "planned";
}
