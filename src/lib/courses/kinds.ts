import type { CourseLevel, CourseSubject } from "@/db/schema";
import { COURSE_LEVEL_TO_TYPE_LEVEL, type CourseTypeId, courseTypesForSubject, isCourseTypeId } from "../planner/course-types";
import { COURSE_LEVELS, COURSE_SUBJECTS } from "./catalog";

// "What kind of class is this?": the choices the add and edit forms and "Confirm your classes" on
// the path offer. Pure, so server and client components share it.

export const isCourseSubject = (s: string): s is CourseSubject => (COURSE_SUBJECTS as readonly string[]).includes(s);
const isCourseLevel = (s: string): s is CourseLevel => (COURSE_LEVELS as readonly string[]).includes(s);

/**
 * The kinds of class offered under a subject, at the chosen level when any are (an AP class lists
 * only types with an AP version), always keeping `keep` (the saved choice) in the list.
 */
export function courseTypeOptions(subject: string, level: string, keep: string): CourseTypeId[] {
  if (!isCourseSubject(subject)) return [];
  const all = courseTypesForSubject(subject);
  const typeLevel = isCourseLevel(level) ? COURSE_LEVEL_TO_TYPE_LEVEL[level] : "regular";
  const atLevel = all.filter((t) => t.levels.includes(typeLevel));
  const shown = (atLevel.length ? atLevel : all).map((t) => t.id);
  return isCourseTypeId(keep) && !shown.includes(keep) && all.some((t) => t.id === keep) ? [keep, ...shown] : shown;
}
