import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { type StudentSchoolChoice, type StudentSchoolRole, parentStudentLinks, studentSchools, users } from "@/db/schema";
import { currentGrade, schoolYearOf } from "../auth/age";
import { normalizeState } from "../colleges/states";
import { forgetSavedContexts } from "../counselor/saved-context";
import { isPlannerState, type PlannerState } from "../planner/common";
import { type SchoolOption, schoolsByRef } from "./search";

// Where a student goes to school: their home state (users.home_state) and their school
// (student_schools), set by the student in Settings or by a linked parent on /parent. Free: never
// gated. Privacy: the school never goes to the AI, into audit metadata, counts or staff views, and
// setting it writes no audit entry. The state may go to the AI (StudentAiContext.homeState).

export const NOT_LISTED_NAME_MAX = 120;

export type StudentSchoolView = {
  role: StudentSchoolRole;
  choice: StudentSchoolChoice;
  /** The school from the directory, when listed and still in it. */
  school: SchoolOption | null;
  /** Listed, but a newer directory release dropped the school. */
  noLongerListed: boolean;
  /** "My school isn't listed": the family's own words for it, if they gave any. */
  notListedName: string | null;
  fromSchoolYear: number;
  setBy: "student" | "parent";
  setAt: Date;
};

export type SchoolSettings = {
  homeState: string | null;
  /** The state's code when the planner covers it (UT, TN, TX), else null. */
  plannerState: PlannerState | null;
  current: StudentSchoolView | null;
  /** The high school they expect to go to, when their school ends before 12th grade. */
  next: StudentSchoolView | null;
};

/** State and school settings for each of these students (missing ids are left out). */
export async function schoolSettingsFor(db: Db, studentIds: readonly string[]): Promise<Map<string, SchoolSettings>> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map();
  const [people, rows] = await Promise.all([
    db.select({ id: users.id, homeState: users.homeState }).from(users).where(and(inArray(users.id, ids), eq(users.role, "student"))),
    db.select().from(studentSchools).where(inArray(studentSchools.userId, ids)),
  ]);
  const found = await schoolsByRef(
    db,
    rows.flatMap((r) => (r.schoolRef ? [r.schoolRef] : [])),
  );
  const view = (r: (typeof rows)[number]): StudentSchoolView => ({
    role: r.role,
    choice: r.choice,
    school: r.schoolRef ? (found.get(r.schoolRef) ?? null) : null,
    noLongerListed: Boolean(r.schoolRef && !found.has(r.schoolRef)),
    notListedName: r.notListedName,
    fromSchoolYear: r.fromSchoolYear,
    setBy: r.setBy,
    setAt: r.setAt,
  });
  return new Map(
    people.map((p) => {
      const mine = rows.filter((r) => r.userId === p.id);
      const pick = (role: StudentSchoolRole) => {
        const row = mine.find((r) => r.role === role);
        return row ? view(row) : null;
      };
      return [p.id, { homeState: p.homeState, plannerState: isPlannerState(p.homeState) ? p.homeState : null, current: pick("current"), next: pick("next") }];
    }),
  );
}

export async function schoolSettings(db: Db, studentId: string): Promise<SchoolSettings | null> {
  return (await schoolSettingsFor(db, [studentId])).get(studentId) ?? null;
}

/** A choice for one school: from the directory, "isn't listed" (with an optional name), or "rather not say". */
export type SchoolPick =
  | { choice: "listed"; schoolRef: string }
  | { choice: "not_listed"; name?: string | null }
  | { choice: "prefer_not_to_say" };

export type SchoolSettingsInput = {
  /** A postal code, or null to clear the state (and with it the school). */
  state: string | null;
  /** Undefined leaves the current school as it is. */
  current?: SchoolPick;
  /** Undefined leaves it; "clear" removes it ("Not sure yet"). */
  next?: SchoolPick | { choice: "clear" };
};

export type SaveSchoolError = "invalid_state" | "state_required" | "school_not_found" | "school_other_state" | "not_found";

/** The family's words for a school that isn't listed: one line, no control characters, at most 120 characters. */
function cleanName(name: string | null | undefined): string | null {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOT_LISTED_NAME_MAX);
  return cleaned || null;
}

/**
 * The school year a student starts at their next school: the year after their current school's
 * last grade, or its first grade if later, and never this year. Without a grade, next year.
 */
function nextSchoolStart(now: Date, grade: number | null, currentHigh: number | null, nextLow: number | null): number {
  const year = schoolYearOf(now);
  if (grade === null || grade > 12) return year + 1;
  const startGrade = Math.max(grade + 1, (currentHigh ?? grade) + 1, nextLow ?? 0);
  return year + Math.max(1, startGrade - grade);
}

/**
 * Saves a student's state and schools. A school from the directory must be in the chosen state;
 * changing the state clears schools from the old one. Setting a new current school keeps its
 * "from" year when it's the same school. Clears the counselor's saved contexts when the state
 * changes (the state may be part of what the AI knows). Writes no audit entry: the school is
 * personal data.
 */
export async function saveSchoolSettings(
  db: Db,
  studentId: string,
  input: SchoolSettingsInput,
  opts: { by: "student" | "parent"; now?: Date },
): Promise<{ ok: true } | { ok: false; error: SaveSchoolError }> {
  const now = opts.now ?? new Date();
  const state = input.state === null || input.state === "" ? null : normalizeState(input.state);
  if (input.state && !state) return { ok: false, error: "invalid_state" };

  const [student] = await db
    .select({ homeState: users.homeState, grade: users.grade, gradeSchoolYear: users.gradeSchoolYear })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student) return { ok: false, error: "not_found" };

  const picks = [input.current, input.next].filter((p): p is SchoolPick => Boolean(p && p.choice !== "clear"));
  if (!state && picks.some((p) => p.choice !== "prefer_not_to_say")) return { ok: false, error: "state_required" };
  const existing = await db.select().from(studentSchools).where(eq(studentSchools.userId, studentId));
  const stateChanged = student.homeState !== state;
  const oldCurrent = stateChanged ? undefined : existing.find((r) => r.role === "current");
  // The schools picked, and the current one (whose last grade says when the next one starts).
  const listed = await schoolsByRef(db, [
    ...picks.flatMap((p) => (p.choice === "listed" ? [p.schoolRef] : [])),
    ...(oldCurrent?.schoolRef ? [oldCurrent.schoolRef] : []),
  ]);
  for (const p of picks) {
    if (p.choice !== "listed") continue;
    const school = listed.get(p.schoolRef);
    if (!school) return { ok: false, error: "school_not_found" };
    if (school.state !== state) return { ok: false, error: "school_other_state" };
  }
  const grade = currentGrade(student, now);
  const currentRef = input.current ? (input.current.choice === "listed" ? input.current.schoolRef : null) : (oldCurrent?.schoolRef ?? null);
  const currentHigh = currentRef ? (listed.get(currentRef)?.gradeHigh ?? null) : null;

  await db.transaction(async (tx) => {
    await tx.update(users).set({ homeState: state }).where(eq(users.id, studentId));
    // Schools belong to a state: a new state (or none) starts over.
    if (stateChanged && existing.length) await tx.delete(studentSchools).where(eq(studentSchools.userId, studentId));

    const write = async (role: StudentSchoolRole, pick: SchoolPick, fromSchoolYear: number) => {
      const values = {
        choice: pick.choice,
        schoolRef: pick.choice === "listed" ? pick.schoolRef : null,
        notListedName: pick.choice === "not_listed" ? cleanName(pick.name) : null,
        fromSchoolYear,
        setBy: opts.by,
        setAt: now,
      };
      await tx
        .insert(studentSchools)
        .values({ userId: studentId, role, ...values })
        .onConflictDoUpdate({ target: [studentSchools.userId, studentSchools.role], set: values });
    };

    if (input.current) {
      const same = input.current.choice === "listed" && oldCurrent?.schoolRef === input.current.schoolRef;
      await write("current", input.current, same && oldCurrent ? oldCurrent.fromSchoolYear : schoolYearOf(now));
    }
    // "Not sure yet", or a new current school that goes through 12th grade: no next school.
    const nextNotNeeded = Boolean(input.current && currentHigh !== null && currentHigh >= 12 && !input.next);
    if (input.next?.choice === "clear" || nextNotNeeded) {
      await tx.delete(studentSchools).where(and(eq(studentSchools.userId, studentId), eq(studentSchools.role, "next")));
    } else if (input.next) {
      const nextLow = input.next.choice === "listed" ? (listed.get(input.next.schoolRef)?.gradeLow ?? null) : null;
      await write("next", input.next, nextSchoolStart(now, grade, currentHigh, nextLow));
    }
  });
  if (stateChanged) await forgetSavedContexts(db, studentId);
  return { ok: true };
}

/**
 * "Same school as" for a parent with two children: copies one child's state and schools to the
 * other. The caller checks the parent is linked to both.
 */
export async function copySchoolSettings(db: Db, fromStudentId: string, toStudentId: string, opts: { now?: Date } = {}) {
  const from = await schoolSettings(db, fromStudentId);
  if (!from || fromStudentId === toStudentId) return { ok: false as const, error: "not_found" as const };
  const pick = (v: StudentSchoolView | null): SchoolPick | undefined => {
    if (!v) return undefined;
    if (v.choice === "listed") return v.school ? { choice: "listed", schoolRef: v.school.ref } : undefined;
    return v.choice === "not_listed" ? { choice: "not_listed", name: v.notListedName } : { choice: "prefer_not_to_say" };
  };
  const current = pick(from.current);
  const next = pick(from.next);
  return saveSchoolSettings(db, toStudentId, { state: from.homeState, current, next: next ?? { choice: "clear" } }, { by: "parent", now: opts.now });
}

/**
 * The states whose programs a page should put first for this viewer: a student's own state, or
 * the states a parent's children live in. Empty for anyone else, or when none is set.
 */
export async function viewerStates(db: Db, user: { id: string; role: string; homeState?: string | null } | null): Promise<string[]> {
  if (!user) return [];
  if (user.role === "student") {
    if (user.homeState !== undefined) return user.homeState ? [user.homeState] : [];
    const [row] = await db.select({ homeState: users.homeState }).from(users).where(eq(users.id, user.id));
    return row?.homeState ? [row.homeState] : [];
  }
  if (user.role !== "parent") return [];
  const rows = await db
    .select({ homeState: users.homeState })
    .from(parentStudentLinks)
    .innerJoin(users, eq(users.id, parentStudentLinks.studentUserId))
    .where(eq(parentStudentLinks.parentUserId, user.id));
  return [...new Set(rows.flatMap((r) => (r.homeState ? [r.homeState] : [])))].sort();
}

/** The one state to default to (like /colleges' state filter): a single state, or null when there are several or none. */
export async function viewerHomeState(db: Db, user: Parameters<typeof viewerStates>[1]): Promise<string | null> {
  const states = await viewerStates(db, user);
  return states.length === 1 ? states[0] : null;
}

/**
 * The student's state and schools for their own or a parent's data download: the school's name
 * and place (as the directory has them) rather than bare ids, and whether it's still listed.
 */
export async function exportSchoolData(db: Db, studentId: string) {
  const settings = await schoolSettings(db, studentId);
  if (!settings) return { homeState: null, schools: [] };
  return {
    homeState: settings.homeState,
    schools: [settings.current, settings.next]
      .filter((v): v is StudentSchoolView => v !== null)
      .map((v) => ({
        role: v.role,
        choice: v.choice,
        school: v.school && { name: v.school.name, city: v.school.city, state: v.school.state, directoryId: v.school.ref },
        ...(v.noLongerListed && { note: "This school is no longer in the national school list." }),
        notListedName: v.notListedName,
        fromSchoolYear: v.fromSchoolYear,
        setBy: v.setBy,
        setAt: v.setAt,
      })),
  };
}
