import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { studentMilestones, users } from "@/db/schema";
import { scrubPii } from "../ai/privacy";
import { MAX_GRADE, MIN_GRADE } from "../auth/age";
import { type AddStepResult, MAX_STEPS_PER_WEEK, STEP_TEXT_MAX, addStep, listWeek, weekStartOf } from "../steps";
import { MILESTONES } from "./milestones";
import type { Milestone, MilestoneCategory, MilestonePathway } from "./types";

export type { Milestone } from "./types";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Calendar months (1 = January) in school-year order: August starts the year, July ends it. */
export const SCHOOL_YEAR_MONTHS = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7] as const;

export const CATEGORY_LABELS: Record<MilestoneCategory, string> = {
  academics: "Classes",
  testing: "Tests",
  activities_summer: "Activities and summer",
  career_exploration: "Exploring careers",
  college_search: "College search",
  applications: "Applications",
  financial_aid: "Paying for school",
  habits: "Good habits",
};

export const PATHWAY_LABELS: Record<Exclude<MilestonePathway, "all">, string> = {
  degree: "College degree path",
  training: "Career training path",
};

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

/** "10th grade". Every grade we serve (7–12) takes "th". */
export function gradeName(grade: number): string {
  return `${grade}th grade`;
}

/** "October", "October and November", "September, October and November". */
export function monthList(months: readonly number[]): string {
  const names = months.map(monthName).filter(Boolean);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Where each milestone falls in the school year (pure; the library and date are injected)
// ---------------------------------------------------------------------------

/** 0 for August through 11 for July. */
export function schoolYearIndex(month: number): number {
  return (month + 4) % 12;
}

function monthOf(date: Date): number {
  return date.getUTCMonth() + 1;
}

/** A milestone's valid months as sorted, unique school-year indexes. */
function yearIndexes(m: Milestone): number[] {
  const valid = m.months.filter((mo) => Number.isInteger(mo) && mo >= 1 && mo <= 12);
  return [...new Set(valid.map(schoolYearIndex))].sort((a, b) => a - b);
}

export type MilestoneStatus = "open" | "done" | "skipped";
export type ProgressMap = ReadonlyMap<string, "done" | "skipped">;

/**
 * - now: one of its months is this month
 * - coming_up: one of its months is in the next two months (running past July into the next
 *   grade's August and September during the summer)
 * - later: its next month is further off this school year (also milestones with no months)
 * - earlier: all of its months have passed this school year
 */
export type Timing = "now" | "coming_up" | "later" | "earlier";

export type RoadmapItem = Milestone & { status: MilestoneStatus; timing: Timing };

/** When `m` falls for a student in `grade` on `date`, or null if it isn't part of their year. */
export function milestoneTiming(m: Milestone, grade: number, date: Date): Timing | null {
  return placement(m, grade, schoolYearIndex(monthOf(date)))?.timing ?? null;
}

/** Timing plus a sort key (school-year index of the month that placed it). */
function placement(m: Milestone, grade: number, current: number): { timing: Timing; key: number } | null {
  const idx = yearIndexes(m);
  if (m.grade === grade) {
    if (idx.length === 0) return { timing: "later", key: 12 };
    if (idx.includes(current)) return { timing: "now", key: current };
    const soon = idx.find((x) => x > current && x <= current + 2);
    if (soon !== undefined) return { timing: "coming_up", key: soon };
    const later = idx.find((x) => x > current + 2);
    if (later !== undefined) return { timing: "later", key: later };
    return { timing: "earlier", key: idx.at(-1)! };
  }
  if (m.grade === grade + 1) {
    // Next grade's months, counted from the end of this school year.
    const soon = idx.map((x) => x + 12).find((x) => x > current && x <= current + 2);
    if (soon !== undefined) return { timing: "coming_up", key: soon };
  }
  return null;
}

export type Roadmap = {
  grade: number;
  /** Calendar month (1–12) of the date the roadmap was built for. */
  month: number;
  /** June or July: the summer after `grade`. */
  summer: boolean;
  graduated: boolean;
  /** Calendar months counted as "coming up" (the next two in school-year order). */
  comingUpMonths: number[];
  now: RoadmapItem[];
  comingUp: RoadmapItem[];
  /** Earlier this school year and neither done nor skipped. */
  catchUp: RoadmapItem[];
  later: RoadmapItem[];
  /** Done or skipped ("not for me"), so they're out of the way but can be undone. */
  done: RoadmapItem[];
  /** Every milestone above, in school-year order, whatever its status. */
  items: RoadmapItem[];
};

/**
 * Sorts a student's milestones into now / coming up / catch up / later / done for `date`.
 * `grade` is the current grade (above 12 means graduated). Each milestone lands in one bucket.
 */
export function buildRoadmap(
  library: readonly Milestone[],
  grade: number,
  date: Date,
  progress: ProgressMap = new Map(),
): Roadmap {
  const month = monthOf(date);
  const current = schoolYearIndex(month);
  const graduated = grade > MAX_GRADE;
  const roadmap: Roadmap = {
    grade,
    month,
    summer: month === 6 || month === 7,
    graduated,
    comingUpMonths: [current + 1, current + 2]
      .filter((x) => x <= 11 || grade < MAX_GRADE)
      .map((x) => SCHOOL_YEAR_MONTHS[x % 12]),
    now: [],
    comingUp: [],
    catchUp: [],
    later: [],
    done: [],
    items: [],
  };
  if (graduated) {
    roadmap.comingUpMonths = [];
    return roadmap;
  }

  const placed = library
    .map((m, order) => ({ m, order, place: placement(m, grade, current) }))
    .filter((p): p is typeof p & { place: NonNullable<typeof p.place> } => p.place !== null)
    .sort((a, b) => a.place.key - b.place.key || a.order - b.order);

  for (const { m, place } of placed) {
    const item: RoadmapItem = { ...m, status: progress.get(m.id) ?? "open", timing: place.timing };
    roadmap.items.push(item);
    if (item.status !== "open") roadmap.done.push(item);
    else if (place.timing === "now") roadmap.now.push(item);
    else if (place.timing === "coming_up") roadmap.comingUp.push(item);
    else if (place.timing === "later") roadmap.later.push(item);
    else roadmap.catchUp.push(item);
  }
  return roadmap;
}

export type GradeProgress = { grade: number; done: number; skipped: number; total: number };

/** Done / skipped / total milestones for each grade 7–12. */
export function progressByGrade(library: readonly Milestone[], progress: ProgressMap): GradeProgress[] {
  const grades: GradeProgress[] = [];
  for (let grade = MIN_GRADE; grade <= MAX_GRADE; grade++) {
    const items = library.filter((m) => m.grade === grade);
    grades.push({
      grade,
      total: items.length,
      done: items.filter((m) => progress.get(m.id) === "done").length,
      skipped: items.filter((m) => progress.get(m.id) === "skipped").length,
    });
  }
  return grades;
}

export type MonthGroup = { month: number | null; items: (Milestone & { status: MilestoneStatus })[] };

/**
 * One grade's milestones grouped by the first month they apply, in school-year order, for
 * browsing other grades. Milestones without months come last under `month: null`.
 */
export function milestonesByMonth(library: readonly Milestone[], grade: number, progress: ProgressMap = new Map()): MonthGroup[] {
  const groups = new Map<number, MonthGroup["items"]>();
  for (const m of library) {
    if (m.grade !== grade) continue;
    const key = yearIndexes(m)[0] ?? 12;
    const items = groups.get(key) ?? [];
    items.push({ ...m, status: progress.get(m.id) ?? "open" });
    groups.set(key, items);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, items]) => ({ month: key === 12 ? null : SCHOOL_YEAR_MONTHS[key], items }));
}

/** A milestone's valid months in school-year order (for display). */
export function monthsInSchoolYearOrder(m: Milestone): number[] {
  return yearIndexes(m).map((x) => SCHOOL_YEAR_MONTHS[x]);
}

export function findMilestone(id: string, library: readonly Milestone[] = MILESTONES): Milestone | undefined {
  return library.find((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// Progress (student data)
// ---------------------------------------------------------------------------

export async function getMilestoneProgress(db: Db, userId: string): Promise<Map<string, "done" | "skipped">> {
  const rows = await db
    .select({ milestoneId: studentMilestones.milestoneId, status: studentMilestones.status })
    .from(studentMilestones)
    .where(eq(studentMilestones.userId, userId));
  return new Map(rows.map((r) => [r.milestoneId, r.status]));
}

export type MarkMilestoneResult = { ok: true } | { ok: false; error: "not_found" | "invalid_status" };

/** Marks one of the student's milestones done or skipped, or resets it (null). */
export async function markMilestone(
  db: Db,
  userId: string,
  milestoneId: string,
  status: "done" | "skipped" | null,
  opts: { now?: Date; library?: readonly Milestone[] } = {},
): Promise<MarkMilestoneResult> {
  if (status !== null && status !== "done" && status !== "skipped") return { ok: false, error: "invalid_status" };
  if (!findMilestone(milestoneId, opts.library)) return { ok: false, error: "not_found" };

  if (status === null) {
    await db
      .delete(studentMilestones)
      .where(and(eq(studentMilestones.userId, userId), eq(studentMilestones.milestoneId, milestoneId)));
    return { ok: true };
  }
  const updatedAt = opts.now ?? new Date();
  await db
    .insert(studentMilestones)
    .values({ userId, milestoneId, status, updatedAt })
    .onConflictDoUpdate({ target: [studentMilestones.userId, studentMilestones.milestoneId], set: { status, updatedAt } });
  return { ok: true };
}

/** The weekly-step text for a milestone: its title, shortened to fit if needed. */
export function stepTextFor(m: Milestone): string {
  const title = m.title.trim();
  return title.length <= STEP_TEXT_MAX ? title : `${title.slice(0, STEP_TEXT_MAX - 1).trimEnd()}…`;
}

/** "Add to this week": adds a milestone to the student's weekly steps (once per week). */
export async function addMilestoneStep(
  db: Db,
  userId: string,
  milestoneId: string,
  opts: { now?: Date; library?: readonly Milestone[] } = {},
): Promise<AddStepResult> {
  const milestone = findMilestone(milestoneId, opts.library);
  if (!milestone) return { ok: false, error: "milestone_not_found" };
  return addStep(db, userId, { text: stepTextFor(milestone), milestoneId }, opts);
}

// ---------------------------------------------------------------------------
// Compact summary for the AI counselor
// ---------------------------------------------------------------------------

export type RoadmapSummary = {
  grade: number | null;
  graduated: boolean;
  month: string;
  summer: boolean;
  now: { id: string; title: string; status: MilestoneStatus }[];
  comingUp: { id: string; title: string; status: MilestoneStatus }[];
  catchUp: { id: string; title: string }[];
  /** This grade's roadmap, not counting milestones the student set aside. */
  gradeProgress: { done: number; total: number } | null;
  thisWeek: { text: string; done: boolean; milestoneId: string | null }[];
  weeklyStepLimit: number;
};

/**
 * What the AI counselor may know about a student's roadmap. JSON-safe, no user ids, and step
 * text (typed by the student) is scrubbed of personal details, including their own name.
 */
export async function roadmapSummary(
  db: Db,
  userId: string,
  grade: number | null,
  now: Date = new Date(),
  library: readonly Milestone[] = MILESTONES,
): Promise<RoadmapSummary> {
  const [progress, steps, [who]] = await Promise.all([
    getMilestoneProgress(db, userId),
    listWeek(db, userId, weekStartOf(now)),
    db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, userId)),
  ]);
  const knownNames = [who?.displayName, who?.username].filter((n): n is string => Boolean(n));
  const brief = (m: RoadmapItem) => ({ id: m.id, title: m.title, status: m.status });

  const roadmap = grade === null ? null : buildRoadmap(library, grade, now, progress);
  const all = roadmap?.items ?? [];
  const gradeCounts = grade === null ? undefined : progressByGrade(library, progress).find((g) => g.grade === grade);

  return {
    grade,
    graduated: roadmap?.graduated ?? false,
    month: monthName(monthOf(now)),
    summer: roadmap?.summer ?? false,
    now: all.filter((m) => m.timing === "now").map(brief),
    comingUp: all.filter((m) => m.timing === "coming_up").map(brief),
    catchUp: (roadmap?.catchUp ?? []).map((m) => ({ id: m.id, title: m.title })),
    gradeProgress: gradeCounts ? { done: gradeCounts.done, total: gradeCounts.total - gradeCounts.skipped } : null,
    thisWeek: steps.map((s) => ({ text: scrubPii(s.text, knownNames), done: s.status === "done", milestoneId: s.milestoneId })),
    weeklyStepLimit: MAX_STEPS_PER_WEEK,
  };
}
