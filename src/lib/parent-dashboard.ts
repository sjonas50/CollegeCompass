import { asc, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  type ApplicationChecklist,
  type CollegeListStatus,
  type DeadlineType,
  assessmentAttempts,
  collegeList,
  northStarGoals,
  studentCourses,
  studentMilestones,
  weeklySteps,
} from "@/db/schema";
import { listChildren } from "./accounts";
import { usToday } from "./applications/dates";
import { dueWithin } from "./applications/timeline";
import { INSTRUMENTS, type InstrumentId } from "./assessments/instruments";
import { MAX_GRADE } from "./auth/age";
import { type GpaCourse, computeGpa } from "./courses/gpa";
import { type MilestoneStatus, buildRoadmap, countedTotal, progressByGrade } from "./roadmap";
import { MILESTONES } from "./roadmap/milestones";
import type { Milestone } from "./roadmap/types";
import { weekStartOf } from "./steps";

// What a linked parent sees about each child. Built only from progress data: counselor
// conversations, memory notes and safety events are never read here.

/** Timely roadmap milestones shown per child (the same ones the student's dashboard shows first). */
export const PARENT_TIMELY_LIMIT = 3;
/** Upcoming application deadlines shown per child in grades 11 and up. */
export const PARENT_DEADLINE_LIMIT = 3;
/** How far ahead to look for those deadlines. */
const DEADLINE_LOOKAHEAD_DAYS = 365;

/** The order activities are suggested on the student's dashboard. */
const INSTRUMENT_ORDER: InstrumentId[] = ["interests", "personality", "values"];

export const PARENT_GPA_NOTE =
  "An estimate from the grades your child entered. Schools figure GPA in different ways, so their transcript shows the official GPA.";

export type AssessmentState = "not_started" | "in_progress" | "done";

export type ChildProgress = {
  /** Current grade (advanced each August); above 12 means finished high school. */
  grade: number | null;
  graduated: boolean;
  assessments: { id: InstrumentId; title: string; state: AssessmentState }[];
  /** Titles of the careers the student is aiming for, for now. */
  northStars: string[];
  /** This grade's roadmap, not counting milestones set aside. Null when there's no grade or they've graduated. */
  roadmap: { done: number; total: number; timely: { id: string; title: string }[] } | null;
  steps: { thisWeekDone: number; thisWeekTotal: number; lifetimeDone: number };
  plan: { courses: number; estimatedGpa: number | null };
  colleges: {
    count: number;
    /** Next unsent deadlines, soonest first. Null before 11th grade. */
    nextDeadlines: { name: string; deadlineType: DeadlineType | null; deadline: string; daysLeft: number }[] | null;
  };
  /** Senior-year FAFSA and aid milestones with their status. Null unless in 12th grade. */
  fafsa: { id: string; title: string; status: MilestoneStatus; months: number[] }[] | null;
  /** Nothing done or saved anywhere yet. */
  justStarted: boolean;
};

export type ChildOverview = Awaited<ReturnType<typeof listChildren>>[number] & { progress: ChildProgress };

/** 12th-grade money milestones that involve the FAFSA (filing it, state aid, comparing offers). */
export function fafsaMilestones(library: readonly Milestone[] = MILESTONES): Milestone[] {
  return library.filter(
    (m) => m.grade === MAX_GRADE && m.category === "financial_aid" && /\bFAFSA\b/i.test(`${m.title} ${m.detail} ${m.why}`),
  );
}

function groupBy<T extends { userId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.userId);
    if (list) list.push(row);
    else map.set(row.userId, [row]);
  }
  return map;
}

/**
 * Every child linked to `parentUserId`, with a progress summary each. The same seven queries run
 * however many children there are (one per table, for all of them at once).
 */
export async function parentDashboard(
  db: Db,
  parentUserId: string,
  now: Date = new Date(),
  library: readonly Milestone[] = MILESTONES,
): Promise<ChildOverview[]> {
  const children = await listChildren(db, parentUserId, now);
  if (children.length === 0) return [];
  const ids = children.map((c) => c.id);
  const week = weekStartOf(now);

  const [attempts, stars, milestones, stepCounts, courses, list] = await Promise.all([
    db
      .select({ userId: assessmentAttempts.userId, instrument: assessmentAttempts.instrument, completedAt: assessmentAttempts.completedAt })
      .from(assessmentAttempts)
      .where(inArray(assessmentAttempts.userId, ids)),
    db
      .select({ userId: northStarGoals.userId, title: northStarGoals.title })
      .from(northStarGoals)
      .where(inArray(northStarGoals.userId, ids))
      .orderBy(asc(northStarGoals.createdAt)),
    db
      .select({ userId: studentMilestones.userId, milestoneId: studentMilestones.milestoneId, status: studentMilestones.status })
      .from(studentMilestones)
      .where(inArray(studentMilestones.userId, ids)),
    db
      .select({
        userId: weeklySteps.userId,
        thisWeekTotal: sql<number>`count(*) filter (where ${weeklySteps.weekStart} = ${week})`.mapWith(Number),
        thisWeekDone: sql<number>`count(*) filter (where ${weeklySteps.weekStart} = ${week} and ${weeklySteps.status} = 'done')`.mapWith(Number),
        lifetimeDone: sql<number>`count(*) filter (where ${weeklySteps.status} = 'done')`.mapWith(Number),
      })
      .from(weeklySteps)
      .where(inArray(weeklySteps.userId, ids))
      .groupBy(weeklySteps.userId),
    db
      .select({
        userId: studentCourses.userId,
        gradeLevel: studentCourses.gradeLevel,
        level: studentCourses.level,
        credits: studentCourses.credits,
        status: studentCourses.status,
        finalGrade: studentCourses.finalGrade,
        highSchoolCredit: studentCourses.highSchoolCredit,
      })
      .from(studentCourses)
      .where(inArray(studentCourses.userId, ids)),
    // Only the columns the summary needs (never notes or aid offers).
    db
      .select({
        userId: collegeList.userId,
        name: collegeList.name,
        status: collegeList.status,
        checklist: collegeList.checklist,
        deadline: collegeList.deadline,
        deadlineType: collegeList.deadlineType,
      })
      .from(collegeList)
      .where(inArray(collegeList.userId, ids)),
  ]);

  const byChild = {
    attempts: groupBy(attempts),
    stars: groupBy(stars),
    milestones: groupBy(milestones),
    steps: new Map(stepCounts.map((s) => [s.userId, s])),
    courses: groupBy(courses),
    list: groupBy(list),
  };
  const today = usToday(now);

  return children.map((child) => {
    const id = child.id;
    const progress = new Map((byChild.milestones.get(id) ?? []).map((m) => [m.milestoneId, m.status]));
    return {
      ...child,
      progress: summarize({
        grade: child.grade,
        now,
        today,
        library,
        progress,
        attempts: byChild.attempts.get(id) ?? [],
        stars: (byChild.stars.get(id) ?? []).map((s) => s.title),
        steps: byChild.steps.get(id),
        courses: byChild.courses.get(id) ?? [],
        list: byChild.list.get(id) ?? [],
      }),
    };
  });
}

type SummaryInput = {
  grade: number | null;
  now: Date;
  today: string;
  library: readonly Milestone[];
  progress: Map<string, "done" | "skipped">;
  attempts: { instrument: string; completedAt: Date | null }[];
  stars: string[];
  steps: { thisWeekTotal: number; thisWeekDone: number; lifetimeDone: number } | undefined;
  courses: GpaCourse[];
  list: ListRow[];
};

type ListRow = {
  name: string;
  status: CollegeListStatus;
  checklist: ApplicationChecklist | null;
  deadline: string | null;
  deadlineType: DeadlineType | null;
};

function assessmentState(attempts: SummaryInput["attempts"], instrument: InstrumentId): AssessmentState {
  const mine = attempts.filter((a) => a.instrument === instrument);
  if (mine.some((a) => a.completedAt !== null)) return "done";
  return mine.length > 0 ? "in_progress" : "not_started";
}

function summarize(input: SummaryInput): ChildProgress {
  const { grade, library, progress } = input;
  const graduated = grade !== null && grade > MAX_GRADE;

  const assessments = INSTRUMENT_ORDER.map((id) => ({ id, title: INSTRUMENTS[id].title, state: assessmentState(input.attempts, id) }));

  let roadmap: ChildProgress["roadmap"] = null;
  if (grade !== null && !graduated) {
    const built = buildRoadmap(library, grade, input.now, progress);
    const counts = progressByGrade(library, progress).find((g) => g.grade === grade);
    roadmap = {
      done: counts?.done ?? 0,
      total: counts ? countedTotal(counts) : 0,
      timely: [...built.now, ...built.catchUp].slice(0, PARENT_TIMELY_LIMIT).map((m) => ({ id: m.id, title: m.title })),
    };
  }

  const steps = {
    thisWeekDone: input.steps?.thisWeekDone ?? 0,
    thisWeekTotal: input.steps?.thisWeekTotal ?? 0,
    lifetimeDone: input.steps?.lifetimeDone ?? 0,
  };

  const launching = grade !== null && grade >= 11;
  const nextDeadlines = launching
    ? dueWithin(input.list, input.today, DEADLINE_LOOKAHEAD_DAYS)
        .slice(0, PARENT_DEADLINE_LIMIT)
        .map(({ entry, deadline, daysLeft }) => ({ name: entry.name, deadlineType: entry.deadlineType, deadline, daysLeft }))
    : null;

  const fafsa =
    grade === MAX_GRADE
      ? fafsaMilestones(library).map((m) => ({ id: m.id, title: m.title, status: progress.get(m.id) ?? ("open" as const), months: m.months }))
      : null;

  const anyAssessment = assessments.some((a) => a.state !== "not_started");
  const justStarted =
    !anyAssessment &&
    input.stars.length === 0 &&
    progress.size === 0 &&
    steps.thisWeekTotal === 0 &&
    steps.lifetimeDone === 0 &&
    input.courses.length === 0 &&
    input.list.length === 0;

  return {
    grade,
    graduated,
    assessments,
    northStars: input.stars,
    roadmap,
    steps,
    plan: { courses: input.courses.length, estimatedGpa: computeGpa(input.courses).unweighted },
    colleges: { count: input.list.length, nextDeadlines },
    fafsa,
    justStarted,
  };
}
