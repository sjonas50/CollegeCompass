import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { type CourseLevel, collegeList, colleges, users } from "@/db/schema";
import { usToday } from "../applications/dates";
import { currentGrade, schoolYearOf } from "../auth/age";
import { defaultHighSchoolCredit, defaultStatusFor, isLetterGrade } from "../courses/catalog";
import { type Course, addCourse, listCourses } from "../courses/service";
import { CourseInputSchema } from "../courses/validation";
import { type SchoolSettings, schoolSettings } from "../schools/student";
import { deriveCohort, schoolYearForGrade } from "./cohort";
import { isPlannerState, isSchoolGrade, type PlannerState, type SchoolGrade, toCredits, UNITS_PER_CREDIT } from "./common";
import { majorFamiliesContent, plannerContentFor } from "./content";
import { resolveRowCourseType } from "./course-type-guess";
import { type CourseTypeId, type CourseTypeLevel, getCourseType } from "./course-types";
import type {
  CollegeTarget,
  CourseFact,
  FamilyTarget,
  NoStatePath,
  PlannedPath,
  PlannerInput,
  PlanSlot,
  StudentCohort,
  SuggestionKey,
} from "./engine-io";
import { MAX_FAMILY_TARGETS } from "./engine-io";
import { plan } from "./engine";
import type { FamilyId } from "./families";
import { northStarFamilyTargets } from "./north-stars";
import { addDismissed, getPlanPrefs, isSuggestionKey, type PlanPrefs, removeDismissed, updatePlanPrefs, type PlanPrefsPatch } from "./prefs";
import type { PathKind } from "./rules";
import { confirmTypeText } from "./view";

// "Your path" for one student (design §2.6-2.10, §5.3): gathers the planner's input from the
// database (grade and cohort, state, recorded classes, north stars routed to major families, the
// college list, the student's choices) and runs the engine. Plans are computed on every request
// and never stored; only the student's choices and the classes they add are.
//
// Privacy: the school never reaches the engine or its output (the class list is the state's
// generic list for now), so nothing here can carry the school into an AI payload. The school is
// read only for the student's (or their parent's) own "Built from" line. The AI isn't involved
// anywhere: planning is code.

/** What a student's path is built from, besides the engine's own input. */
export type PathContext = {
  grade: number;
  state: PlannerState | null;
  homeState: string | null;
  prefs: PlanPrefs;
  /** The kind of path planned for, and whether it was inferred (the student hasn't picked). */
  path: PathKind;
  pathInferred: boolean;
  /** What the student's goals point to, whether or not they picked another. */
  inferredPath: PathKind;
  /** Families the student's north stars route to (whether or not they chose another). */
  northStarFamilies: FamilyTarget[];
  courses: Course[];
  /** For the student's or parent's own "Built from" line only. Never sent anywhere else. */
  school: SchoolSettings | null;
  cohort: StudentCohort | null;
  /** The cohort from the grade alone (before the student's corrections), for "Is that right?". */
  cohortDefault: StudentCohort | null;
};

export type StudentPath =
  | { kind: "no_grade" }
  | { kind: "graduated"; ctx: PathContext }
  | { kind: "no_state"; result: NoStatePath; ctx: PathContext }
  | { kind: "planned"; result: PlannedPath; input: PlannerInput; ctx: PathContext };

/** A student row, resolved for planning. Rows outside grades 7-12 (none are allowed) are skipped. */
export function courseFacts(courses: readonly Course[], cohort: StudentCohort, state: PlannerState | null): CourseFact[] {
  return courses.flatMap((row): CourseFact[] => {
    if (!isSchoolGrade(row.gradeLevel)) return [];
    const resolved = resolveRowCourseType(row, state);
    const type = getCourseType(resolved.typeId);
    const units = Math.max(1, Math.round(row.credits * UNITS_PER_CREDIT));
    return [
      {
        id: row.id,
        name: row.name,
        typeId: resolved.typeId,
        typeSource: resolved.source,
        assumed: resolved.assumed,
        level: resolved.level,
        subject: resolved.assumed ? row.subject : type.subject,
        grade: row.gradeLevel,
        schoolYear: schoolYearForGrade(cohort, row.gradeLevel),
        term: row.term,
        units,
        status: row.status,
        finalGrade: isLetterGrade(row.finalGrade) ? row.finalGrade : null,
        highSchoolCredit: row.highSchoolCredit,
        cte: type.cte === "always" || (type.cte === "sometimes" && row.subject === "career_technical"),
        lectureOnly: false,
        catalogCourseId: null,
        origin: "typed",
      },
    ];
  });
}

/** Colleges on the student's list that are in the College Scorecard, as planning targets. */
async function collegeTargets(db: Db, userId: string): Promise<CollegeTarget[]> {
  const rows = await db
    .select({ unitId: colleges.unitId, name: colleges.name, state: colleges.state, control: colleges.control, admissionRate: colleges.admissionRate })
    .from(collegeList)
    .innerJoin(colleges, eq(colleges.unitId, collegeList.unitId))
    .where(and(eq(collegeList.userId, userId), eq(collegeList.kind, "college"), isNotNull(collegeList.unitId)))
    .orderBy(asc(collegeList.createdAt), asc(collegeList.id));
  return rows.map((r) => ({
    unitId: r.unitId,
    name: r.name,
    state: r.state ?? "",
    public: r.control === 1,
    admissionRate: r.admissionRate,
    // Scorecard's open-admission flag isn't loaded yet; the engine treats null as unknown.
    openAdmission: null,
  }));
}

/**
 * The kind of path to plan for when the student hasn't said: training when every goal is a
 * career-training family, a 4-year college when a goal or a college on their list points there,
 * otherwise "not sure yet".
 */
function inferPath(families: FamilyTarget[], targets: CollegeTarget[]): PathKind {
  const content = majorFamiliesContent().families;
  const paths = families.map((f) => content.find((c) => c.id === f.familyId)?.path ?? "both");
  if (paths.length > 0 && paths.every((p) => p === "training")) return "training";
  if (paths.some((p) => p === "degree") || targets.length > 0) return "degree";
  return "undecided";
}

/** The chosen family first ("planned around"), then the north-star families as "also check". */
function familyTargets(chosen: FamilyId | null, northStars: FamilyTarget[]): FamilyTarget[] {
  if (!chosen) return northStars.slice(0, MAX_FAMILY_TARGETS);
  const first: FamilyTarget = { familyId: chosen, source: "chosen", cip6: null, because: null };
  return [first, ...northStars.filter((f) => f.familyId !== chosen)].slice(0, MAX_FAMILY_TARGETS);
}

/**
 * The student's path today: the engine's result with its input and context, or why there is none
 * (no grade, finished high school). Students outside UT, TN and TX get the engine's "no state"
 * result ("coming later"), and the page keeps today's checklist.
 */
export async function studentPath(db: Db, userId: string, now = new Date()): Promise<StudentPath> {
  const [user] = await db
    .select({ grade: users.grade, gradeSchoolYear: users.gradeSchoolYear, homeState: users.homeState })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "student")));
  const grade = user ? currentGrade(user, now) : null;
  if (!user || grade === null) return { kind: "no_grade" };

  const state = isPlannerState(user.homeState) ? user.homeState : null;
  const [prefs, courses, northStarFamilies, targets, school] = await Promise.all([
    getPlanPrefs(db, userId),
    listCourses(db, userId),
    northStarFamilyTargets(db, userId),
    collegeTargets(db, userId),
    schoolSettings(db, userId),
  ]);
  const families = familyTargets(prefs.familyId, northStarFamilies);
  const inferredPath = inferPath(families, targets);
  const path = prefs.path ?? inferredPath;
  const schoolYear = schoolYearOf(now);
  const cohort = isSchoolGrade(grade) ? deriveCohort(grade, schoolYear, prefs.cohort) : null;
  const ctx: PathContext = {
    grade,
    state,
    homeState: user.homeState,
    prefs,
    path,
    pathInferred: prefs.path === null,
    inferredPath,
    northStarFamilies,
    courses,
    school,
    cohort,
    cohortDefault: isSchoolGrade(grade) ? deriveCohort(grade, schoolYear) : null,
  };
  if (grade > 12) return { kind: "graduated", ctx };
  if (!isSchoolGrade(grade) || !cohort) return { kind: "no_grade" };

  const input: PlannerInput = {
    asOf: { today: usToday(now), schoolYear, month: now.getUTCMonth() + 1 },
    student: { grade, cohort },
    state,
    homeState: user.homeState,
    // Generic lists for now: "classes most <State> high schools offer" for every grade.
    catalogs: {},
    courses: courseFacts(courses, cohort, state),
    targets: { path, families, colleges: targets },
    prefs: { choices: prefs.choices, limits: prefs.limits, dismissed: prefs.dismissed },
    content: state ? plannerContentFor(state) : null,
  };
  const result = plan(input);
  if (result.mode === "no_state") return { kind: "no_state", result, ctx };
  return { kind: "planned", result, input, ctx };
}

// Suggestions ------------------------------------------------------------------------------------

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;

export type FoundSuggestion = {
  grade: SchoolGrade;
  typeId: CourseTypeId;
  level: CourseTypeLevel;
  title: string;
  term: Suggested["term"];
  units: number;
};

/** A suggestion (or one of its "Other choices") in either plan, by its stable key. */
export function findSuggestion(result: PlannedPath, key: SuggestionKey): FoundSuggestion | null {
  const years = [...result.plans.flatMap((p) => p.years), ...(result.middleSchool?.ninthGradeSketch ? [result.middleSchool.ninthGradeSketch] : [])];
  for (const year of years) {
    for (const slot of year.slots) {
      if (slot.kind !== "suggested") continue;
      if (slot.key === key) return { grade: year.grade, typeId: slot.typeId, level: slot.level, title: slot.title, term: slot.term, units: slot.units };
      const alt = slot.alternatives.find((a) => a.key === key);
      if (alt) {
        const units = getCourseType(alt.typeId).units;
        const term = slot.term === "summer" ? "summer" : units <= 2 ? (slot.term === "full_year" ? "fall" : slot.term) : "full_year";
        return { grade: year.grade, typeId: alt.typeId, level: alt.level, title: alt.title, term, units };
      }
    }
  }
  return null;
}

const STORED_LEVEL: Partial<Record<CourseTypeLevel, CourseLevel>> = {
  regular: "regular",
  honors: "honors",
  ap: "ap",
  ib: "ib",
  dual_enrollment: "dual_enrollment",
};

export type AcceptError = "not_found" | "limit" | "unsupported";

/**
 * "Add" on a suggestion: the class goes into the student's own plan as a planned row with its
 * kind of class set, and from then on it's theirs (locked; the planner suggests around it). The
 * key is looked up in today's plan, so nothing the browser sends decides what's added.
 */
export async function acceptSuggestion(
  db: Db,
  userId: string,
  key: string,
  now = new Date(),
): Promise<{ ok: true; name: string; grade: SchoolGrade } | { ok: false; error: AcceptError }> {
  if (!isSuggestionKey(key)) return { ok: false, error: "not_found" };
  const current = await studentPath(db, userId, now);
  if (current.kind !== "planned") return { ok: false, error: "not_found" };
  const found = findSuggestion(current.result, key);
  if (!found) return { ok: false, error: "not_found" };
  const level = STORED_LEVEL[found.level];
  if (!level) return { ok: false, error: "unsupported" };
  const type = getCourseType(found.typeId);
  const credits = toCredits(found.units);
  const parsed = CourseInputSchema.safeParse({
    name: found.title.slice(0, 80),
    subject: type.subject,
    level,
    gradeLevel: found.grade,
    term: found.term,
    credits: Math.min(2, Math.max(0.25, credits)),
    status: defaultStatusFor(found.grade, current.ctx.grade),
    finalGrade: null,
    highSchoolCredit: defaultHighSchoolCredit(found.grade),
    courseTypeId: found.typeId,
  });
  if (!parsed.success) return { ok: false, error: "unsupported" };
  const res = await addCourse(db, userId, parsed.data);
  if (!res.ok) return { ok: false, error: "limit" };
  if (current.ctx.prefs.dismissed.includes(key)) await removeDismissed(db, userId, key, now);
  return { ok: true, name: res.value.name, grade: found.grade };
}

/** "Not for me" on a suggestion that's in today's plan. The planner then suggests something else. */
export async function dismissSuggestion(db: Db, userId: string, key: string, now = new Date()): Promise<{ ok: boolean }> {
  if (!isSuggestionKey(key)) return { ok: false };
  const current = await studentPath(db, userId, now);
  if (current.kind !== "planned" || !findSuggestion(current.result, key)) return { ok: false };
  await addDismissed(db, userId, key, now);
  return { ok: true };
}

/** Brings back every suggestion the student set aside. */
export async function restoreSuggestions(db: Db, userId: string, now = new Date()): Promise<void> {
  await removeDismissed(db, userId, "all", now);
}

/** Saves the student's planning choices (kind of path, family, limits, choices a rule depends on). */
export async function savePlanSettings(db: Db, userId: string, patch: Omit<PlanPrefsPatch, "dismissed">, now = new Date()): Promise<PlanPrefs> {
  return updatePlanPrefs(db, userId, patch, now);
}

// Summaries --------------------------------------------------------------------------------------

export type PathSummary = {
  state: PlannerState;
  stage: PlannedPath["stage"];
  classYear: number;
  /**
   * Requirements of the state's graduation rules, by status. `confirmType`: requirements a class
   * with a guessed kind would likely meet once its kind is set ("What kind of class is this?"),
   * left out of "room to add".
   */
  counts: { done: number; planned: number; roomToAdd: number; ask: number; confirmType: number };
  /** The next thing to do: a choice to make, else the first gap, else the soonest deadline. */
  next: string | null;
};

/** The short line a parent sees on their dashboard ("4 done, 3 planned, 2 to add, 1 to ask about"). */
export function summarizePath(result: PlannedPath, cohort: StudentCohort): PathSummary {
  const counts = { done: 0, planned: 0, roomToAdd: 0, ask: 0, confirmType: 0 };
  for (const rs of result.audit.filter((r) => r.kind === "state_graduation")) {
    for (const req of rs.requirements) {
      if (req.status === "waiting_confirm") counts.confirmType++;
      else if (req.status === "done") counts.done++;
      else if (req.status === "planned") counts.planned++;
      else if (req.status === "room_to_add") counts.roomToAdd++;
      else if (req.status === "ask_counselor") counts.ask++;
    }
  }
  const next = result.decisions[0]?.text ?? (counts.confirmType ? confirmTypeText(counts.confirmType) : null) ?? result.gaps[0]?.text ?? result.deadlines[0]?.text ?? null;
  return { state: result.state, stage: result.stage, classYear: cohort.classYear, counts, next };
}


export type PathOverview =
  | { kind: "planned"; summary: PathSummary }
  | { kind: "coming_later"; homeState: string }
  | { kind: "no_state" }
  | { kind: "graduated" };

/** What a parent's dashboard shows about a child's path (no school, no class names). */
export async function pathOverview(db: Db, studentId: string, now = new Date()): Promise<PathOverview> {
  const p = await studentPath(db, studentId, now);
  if (p.kind === "planned" && p.ctx.cohort) return { kind: "planned", summary: summarizePath(p.result, p.ctx.cohort) };
  if (p.kind === "graduated") return { kind: "graduated" };
  if (p.kind === "no_state" && p.ctx.homeState) return { kind: "coming_later", homeState: p.ctx.homeState };
  return { kind: "no_state" };
}
