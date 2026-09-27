import type { CourseLevel, CourseSubject } from "@/db/schema";
import { COURSE_LEVEL_TO_TYPE_LEVEL, type CourseTypeId, type CourseTypeLevel, courseTypesForSubject, isCourseTypeId } from "../planner/course-types";
import { COURSE_LEVELS, COURSE_SUBJECTS } from "./catalog";

// "What kind of class is this?": the choices the add and edit forms and "Confirm your classes" on
// the path offer. Pure, so server and client components share it.

/**
 * The forms' "Not sure" choice: saved as no kind with source "unsure", so the planner keeps the
 * class a guess to confirm even when its name is an exact title (course-type-guess.ts).
 */
export const NOT_SURE = "unsure";

export const isCourseSubject = (s: string): s is CourseSubject => (COURSE_SUBJECTS as readonly string[]).includes(s);
const isCourseLevel = (s: string): s is CourseLevel => (COURSE_LEVELS as readonly string[]).includes(s);

/** The planner's level for a form's level (regular when none is chosen). */
export function typeLevelOf(level: string): CourseTypeLevel {
  return isCourseLevel(level) ? COURSE_LEVEL_TO_TYPE_LEVEL[level] : "regular";
}

/**
 * The kinds of class offered under a subject, at the chosen level when any are (an AP class lists
 * only types with an AP version), always keeping `keep` (the saved choice) in the list.
 */
export function courseTypeOptions(subject: string, level: string, keep: string): CourseTypeId[] {
  if (!isCourseSubject(subject)) return [];
  const all = courseTypesForSubject(subject);
  const typeLevel = typeLevelOf(level);
  const atLevel = all.filter((t) => t.levels.includes(typeLevel));
  const shown = (atLevel.length ? atLevel : all).map((t) => t.id);
  return isCourseTypeId(keep) && !shown.includes(keep) && all.some((t) => t.id === keep) ? [keep, ...shown] : shown;
}
