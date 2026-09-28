import { and, asc, count, eq, getTableColumns, sql } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type CourseTerm, studentCourses, users } from "@/db/schema";
import { scrubPii } from "../ai/privacy";
import { UNITS_PER_CREDIT, type PlannerState } from "../planner/common";
import { combinedHalves } from "../planner/course-type-guess";
import { isCourseTypeId } from "../planner/course-types";
import { type Checklist, CHECKLIST_CAVEAT, CHECKLIST_FRAMING, CTE_NOTE, collegePrepChecklist } from "./checklist";
import { GPA_CAVEAT, type GpaSummary, computeGpa } from "./gpa";
import { NOT_SURE } from "./kinds";
import { type CareerSuggestion, SUGGESTIONS_NOTE, courseSuggestions } from "./suggestions";
import { type CourseInput, courseTypeFitsSubject } from "./validation";

/** Generous for six grades of classes; stops scripted floods. */
export const MAX_COURSES = 120;

// Every column except the owner's id, which callers already know and never need to see.
const { userId: _userId, ...courseColumns } = getTableColumns(studentCourses);

export type Course = Omit<typeof studentCourses.$inferSelect, "userId">;

export type CourseError = "not_found" | "limit";
type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: CourseError };

const isUuid = (v: string) => z.uuid().safeParse(v).success;

/**
 * Only finished courses carry a final grade. A kind of class the student picked is theirs
 * ("student"); none means the planner guesses from the name, and guesses are never stored. The
 * forms' "Not sure" (NOT_SURE) is no kind with source "unsure": the planner keeps it a guess to
 * confirm, even when the name is an exact title.
 */
function values(input: CourseInput) {
  const unsure = input.courseTypeId === NOT_SURE;
  const courseTypeId = unsure ? null : (input.courseTypeId ?? null);
  return {
    ...input,
    finalGrade: input.status === "completed" ? input.finalGrade : null,
    courseTypeId,
    courseTypeSource: courseTypeId ? ("student" as const) : unsure ? ("unsure" as const) : null,
  };
}

/** The student's courses, by grade and then in the order they were added. */
export async function listCourses(db: Db, userId: string): Promise<Course[]> {
  return db
    .select(courseColumns)
    .from(studentCourses)
    .where(eq(studentCourses.userId, userId))
    .orderBy(asc(studentCourses.gradeLevel), asc(studentCourses.createdAt), asc(studentCourses.id));
}

export async function getCourse(db: Db, userId: string, courseId: string): Promise<Course | null> {
  if (!isUuid(courseId)) return null;
  const [row] = await db
    .select(courseColumns)
    .from(studentCourses)
    .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)));
  return row ?? null;
}

export async function addCourse(db: Db, userId: string, input: CourseInput): Promise<Result<Course>> {
  const [{ n }] = await db.select({ n: count() }).from(studentCourses).where(eq(studentCourses.userId, userId));
  if (n >= MAX_COURSES) return { ok: false, error: "limit" };
  const [row] = await db
    .insert(studentCourses)
    .values({ userId, ...values(input) })
    .returning(courseColumns);
  return { ok: true, value: row };
}

/** Updates a course only if it belongs to `userId`. */
export async function updateCourse(
  db: Db,
  userId: string,
  courseId: string,
  input: CourseInput,
  now = new Date(),
): Promise<Result<Course>> {
  if (!isUuid(courseId)) return { ok: false, error: "not_found" };
  const next = values(input);
  const [row] = await db
    .update(studentCourses)
    .set({
      ...next,
      // Unchanged, a type from the school's class list stays "catalog".
      courseTypeSource: next.courseTypeId
        ? sql`case when ${studentCourses.courseTypeId} = ${next.courseTypeId} and ${studentCourses.courseTypeSource} = 'catalog' then 'catalog' else 'student' end`
        : next.courseTypeSource,
      updatedAt: now,
    })
    .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)))
    .returning(courseColumns);
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
}

export type SetCourseTypeResult = { ok: true; value: Course } | { ok: false; error: "not_found" | "mismatch" };

/**
 * "Confirm your classes" on the path: records the kind of one of the student's classes as their own
 * choice (course_type_id, source "student"), only if the class is theirs and the kind fits its
 * subject (like the add and edit forms). Nothing else about the class changes.
 */
export async function setCourseType(db: Db, userId: string, courseId: string, typeId: string, now = new Date()): Promise<SetCourseTypeResult> {
  if (!isUuid(courseId)) return { ok: false, error: "not_found" };
  if (!isCourseTypeId(typeId)) return { ok: false, error: "mismatch" };
  const course = await getCourse(db, userId, courseId);
  if (!course) return { ok: false, error: "not_found" };
  if (!courseTypeFitsSubject(typeId, course.subject)) return { ok: false, error: "mismatch" };
  const [row] = await db
    .update(studentCourses)
    .set({ courseTypeId: typeId, courseTypeSource: "student", updatedAt: now })
    .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)))
    .returning(courseColumns);
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
}

export type SplitCourseResult = { ok: true; value: [Course, Course] } | { ok: false; error: "not_found" | "not_combined" | "limit" };

/**
 * "Confirm your classes" on the path: a class whose name joins two half-credit classes ("Gov/Econ",
 * "Economics/Personal Finance") becomes the two classes it names, each with half its credits and
 * its kind as the student's choice (a full-year row becomes a fall and a spring class). Everything
 * else about the class (grade, level, status, final grade) stays. Only the student's own class,
 * and only when its name joins two half-credit kinds of its subject (`combinedHalves`, decided
 * here from the stored row: the browser sends only its id).
 */
export async function splitCombinedCourse(db: Db, userId: string, courseId: string, state: PlannerState | null, now = new Date()): Promise<SplitCourseResult> {
  if (!isUuid(courseId)) return { ok: false, error: "not_found" };
  const course = await getCourse(db, userId, courseId);
  if (!course) return { ok: false, error: "not_found" };
  const halves = combinedHalves(course.name, course.subject, Math.round(course.credits * UNITS_PER_CREDIT), state);
  // Half the credits in the form's steps (a quarter credit).
  if (!halves || !Number.isInteger(course.credits * 2)) return { ok: false, error: "not_combined" };
  const [{ n }] = await db.select({ n: count() }).from(studentCourses).where(eq(studentCourses.userId, userId));
  if (n >= MAX_COURSES) return { ok: false, error: "limit" };
  const credits = course.credits / 2;
  const [first, second]: [CourseTerm, CourseTerm] = course.term === "full_year" ? ["fall", "spring"] : [course.term, course.term];
  const rows = await db.transaction(async (tx) => {
    const [a] = await tx
      .update(studentCourses)
      .set({ name: halves.names[0], credits, term: first, courseTypeId: halves.parts[0], courseTypeSource: "student", updatedAt: now })
      .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)))
      .returning(courseColumns);
    const [b] = await tx
      .insert(studentCourses)
      .values({
        userId,
        name: halves.names[1],
        subject: course.subject,
        level: course.level,
        gradeLevel: course.gradeLevel,
        term: second,
        credits,
        status: course.status,
        finalGrade: course.finalGrade,
        highSchoolCredit: course.highSchoolCredit,
        courseTypeId: halves.parts[1],
        courseTypeSource: "student",
      })
      .returning(courseColumns);
    return [a, b] as const;
  });
  return rows[0] && rows[1] ? { ok: true, value: [rows[0], rows[1]] } : { ok: false, error: "not_found" };
}

/** Deletes a course only if it belongs to `userId`. */
export async function deleteCourse(db: Db, userId: string, courseId: string): Promise<Result> {
  if (!isUuid(courseId)) return { ok: false, error: "not_found" };
  const deleted = await db
    .delete(studentCourses)
    .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)))
    .returning({ id: studentCourses.id });
  return deleted.length ? { ok: true, value: undefined } : { ok: false, error: "not_found" };
}

// ---------------------------------------------------------------------------
// Summary for the AI counselor
// ---------------------------------------------------------------------------

export type PlanSummary = {
  gpa: {
    unweighted: number | null;
    weighted: number | null;
    gpaCredits: number;
    creditsEarned: number;
    byGrade: GpaSummary["byGrade"];
    note: string;
  };
  coursesByGrade: {
    gradeLevel: number;
    courses: Pick<Course, "name" | "subject" | "level" | "term" | "status" | "finalGrade" | "highSchoolCredit">[];
  }[];
  checklist: {
    framing: string;
    areas: {
      subject: string;
      label: string;
      years: number;
      recommendedYears?: number;
      doneOrInProgress: number;
      planned: number;
      status: Checklist["items"][number]["status"];
    }[];
    algebra2: Checklist["algebra2"];
    cte: Checklist["cte"];
    notes: string[];
  };
  suggestions: {
    career: string;
    occupationCode: string;
    basis: CareerSuggestion["basis"];
    ideas: { title: string; inPlan: boolean }[];
  }[];
  suggestionsNote: string;
};

/**
 * A compact, JSON-able picture of the student's course plan for the AI counselor. Contains no
 * account or course ids, and course names (free text) are scrubbed of personal details.
 */
export async function planSummary(db: Db, userId: string): Promise<PlanSummary> {
  const [courses, [user]] = await Promise.all([
    listCourses(db, userId),
    db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, userId)),
  ]);
  const knownNames = [user?.displayName, user?.username].filter((n): n is string => Boolean(n));
  const gpa = computeGpa(courses);
  const checklist = collegePrepChecklist(courses);
  const suggestions = await courseSuggestions(db, userId, courses);

  const grades = [...new Set(courses.map((c) => c.gradeLevel))];
  return {
    gpa: {
      unweighted: gpa.unweighted,
      weighted: gpa.weighted,
      gpaCredits: gpa.gpaCredits,
      creditsEarned: gpa.creditsEarned,
      byGrade: gpa.byGrade,
      note: GPA_CAVEAT,
    },
    coursesByGrade: grades.map((gradeLevel) => ({
      gradeLevel,
      courses: courses
        .filter((c) => c.gradeLevel === gradeLevel)
        .map((c) => ({
          name: scrubPii(c.name, knownNames),
          subject: c.subject,
          level: c.level,
          term: c.term,
          status: c.status,
          finalGrade: c.finalGrade,
          highSchoolCredit: c.highSchoolCredit,
        })),
    })),
    checklist: {
      framing: CHECKLIST_FRAMING,
      areas: checklist.items.map(({ subject, label, years, recommendedYears, doneOrInProgress, planned, status }) => ({
        subject,
        label,
        years,
        ...(recommendedYears ? { recommendedYears } : {}),
        doneOrInProgress,
        planned,
        status,
      })),
      algebra2: checklist.algebra2,
      cte: checklist.cte,
      notes: [CHECKLIST_CAVEAT, CTE_NOTE],
    },
    suggestions: suggestions.map((s) => ({
      career: s.title,
      occupationCode: s.occupationCode,
      basis: s.basis,
      ideas: s.ideas.map((i) => ({ title: i.title, inPlan: i.inPlan })),
    })),
    suggestionsNote: SUGGESTIONS_NOTE,
  };
}
