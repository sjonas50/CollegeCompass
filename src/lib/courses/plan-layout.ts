import { MAX_GRADE, MIN_GRADE } from "../auth/age";
import { COURSE_GRADE_LEVELS, gradeName } from "./catalog";

/**
 * How the planner lays out its grade sections for a student. `current` is the student's grade
 * today, which goes above 12 once they graduate (see currentGrade in auth/age).
 */

export function isGraduated(current: number) {
  return current > MAX_GRADE;
}

/**
 * The grade section shown first and expanded: the student's grade, kept within 7–12 so a
 * graduate sees their senior year first. Use it only for order and expanding, never for labels
 * or default statuses (for a graduate, 12th grade is last year, not this year).
 */
export function focusGrade(current: number) {
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, current));
}

/** The focus grade first, then the years ahead, then earlier years (most recent first). */
export function gradeOrder(current: number): number[] {
  const focus = focusGrade(current);
  const later = COURSE_GRADE_LEVELS.filter((g) => g > focus);
  const earlier = COURSE_GRADE_LEVELS.filter((g) => g < focus).reverse();
  return [focus, ...later, ...earlier];
}

/** "This year", "Next year", "In 3 years", "Last year", "2 years ago". */
export function whenLabel(grade: number, current: number) {
  const diff = grade - current;
  if (diff === 0) return "This year";
  if (diff === 1) return "Next year";
  if (diff === -1) return "Last year";
  return diff > 0 ? `In ${diff} years` : `${-diff} years ago`;
}

/** What an empty grade section says, depending on whether that grade is now, ahead or behind. */
export function emptyText(grade: number, current: number) {
  if (grade === current) return "What are you taking this year? Add your classes to see how they fit your goals.";
  if (grade > current) return "Thinking ahead? Add classes you might take. It's just a plan — you can change it anytime.";
  if (grade <= 8) return "Took a class for high school credit, like Algebra I or a world language? You can add it here.";
  return "Add classes you finished to include their grades in your GPA estimate.";
}

type Notice = { text: string; moveFocus: boolean };

/**
 * What a grade's status line says after a course edit is saved. `after` is what was submitted.
 * A course moved to another grade leaves the section it was in, so that section takes focus
 * (`moveFocus`) rather than the row's Edit button, which is gone.
 */
export function savedNotice(before: { name: string; gradeLevel: number }, after: { name: string; gradeLevel: number }): Notice {
  // Same clean-up as validation, so the notice names the course as it was saved.
  const name = after.name.replace(/\s+/g, " ").trim() || before.name;
  if (Number.isInteger(after.gradeLevel) && after.gradeLevel !== before.gradeLevel) {
    return { text: `Moved ${name} to ${gradeName(after.gradeLevel)}.`, moveFocus: true };
  }
  return { text: `Saved ${name}.`, moveFocus: false };
}

export function removedNotice(name: string) {
  return `Removed ${name}.`;
}
