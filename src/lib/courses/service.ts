import { and, asc, count, eq, getTableColumns } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { studentCourses, users } from "@/db/schema";
import { scrubPii } from "../ai/privacy";
import { type Checklist, CHECKLIST_CAVEAT, CHECKLIST_FRAMING, CTE_NOTE, collegePrepChecklist } from "./checklist";
import { GPA_CAVEAT, type GpaSummary, computeGpa } from "./gpa";
import { type CareerSuggestion, SUGGESTIONS_NOTE, courseSuggestions } from "./suggestions";
import type { CourseInput } from "./validation";

/** Generous for six grades of classes; stops scripted floods. */
export const MAX_COURSES = 120;

// Every column except the owner's id, which callers already know and never need to see.
const { userId: _userId, ...courseColumns } = getTableColumns(studentCourses);

export type Course = Omit<typeof studentCourses.$inferSelect, "userId">;

export type CourseError = "not_found" | "limit";
type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: CourseError };

const isUuid = (v: string) => z.uuid().safeParse(v).success;

/** Only finished courses carry a final grade. */
function values(input: CourseInput) {
  return { ...input, finalGrade: input.status === "completed" ? input.finalGrade : null };
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
  const [row] = await db
    .update(studentCourses)
    .set({ ...values(input), updatedAt: now })
    .where(and(eq(studentCourses.id, courseId), eq(studentCourses.userId, userId)))
    .returning(courseColumns);
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
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
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)),
  ]);
  const knownNames = user ? [user.displayName] : [];
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
