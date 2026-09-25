import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  type ApplicationChecklist,
  type CollegeListStatus,
  type DeadlineType,
  assessmentAttempts,
  assessmentResults,
  careerMatches,
  collegeList,
  matchRuns,
  northStarGoals,
  studentCourses,
  studentMilestones,
  weeklySteps,
} from "@/db/schema";
import { listChildren } from "./accounts";
import { usToday } from "./applications/dates";
import { dueWithin } from "./applications/timeline";
import { strengthFor } from "./assessments/descriptions";
import { type BigFive, INSTRUMENTS, type InstrumentId, type Riasec } from "./assessments/instruments";
import {
  areaNames,
  codeTieText,
  fewAreasText,
  interestPattern,
  noLeadReason,
  strongAreas,
  tiedAreasText,
} from "./assessments/interest-pattern";
import type { InterestScores, PersonalityScores } from "./assessments/scoring";
import { MAX_GRADE } from "./auth/age";
import { type GpaCourse, computeGpa } from "./courses/gpa";
import { strengthsThatCount } from "./matching/match";
import type { MappedTrait } from "./reference/work-styles";
import { type MilestoneStatus, buildRoadmap, countedTotal, progressByGrade } from "./roadmap";
import { MILESTONES } from "./roadmap/milestones";
import type { Milestone } from "./roadmap/types";
import { weekStartOf } from "./steps";

// What a linked parent sees about each child. Built only from progress data and activity results:
// counselor conversations, memory notes and safety events are never read here. The results are
// the same ones a linked parent's data download has, for a teen who owns their account too (see
// exportStudentData): the latest interest scores, strengths, north stars and career matches.

/** Timely roadmap milestones shown per child (the same ones the student's dashboard shows first). */
export const PARENT_TIMELY_LIMIT = 3;
/** Upcoming application deadlines shown per child in grades 11 and up. */
export const PARENT_DEADLINE_LIMIT = 3;
/** Career matches shown per child: the highest-scoring ones in their latest matches. */
export const PARENT_TOP_MATCHES = 5;
/** How far ahead to look for those deadlines. */
const DEADLINE_LOOKAHEAD_DAYS = 365;

/** The order activities are suggested on the student's dashboard. */
const INSTRUMENT_ORDER: InstrumentId[] = ["interests", "personality", "values"];

export const PARENT_GPA_NOTE =
  "An estimate from the grades your child entered. Schools figure GPA in different ways, so their transcript shows the official GPA.";

export type AssessmentState = "not_started" | "in_progress" | "done";

/** A career by its O*NET code, so the page can link to /careers/<code>. */
export type CareerLink = { code: string; title: string };

/** A strength that counts (see strengthsThatCount), in the words the student sees: "Curiosity: Curious". */
export type ParentStrength = { trait: MappedTrait; name: string; label: string };

/** What a child's activities found so far. Each part is null until its activity is done. */
export type ChildResults = {
  /** What the latest interest scores say (see interestsForParent). */
  interests: { text: string; noLead: boolean } | null;
  /**
   * The strengths that count from the latest personality result, highest first: empty when no
   * trait is above the middle of the scale. Never emotional stability ("Staying calm"): that's
   * mood data about a minor, and MappedTrait leaves it out.
   */
  strengths: ParentStrength[] | null;
  /** The highest-scoring careers in the latest matches, at most PARENT_TOP_MATCHES. */
  topMatches: CareerLink[];
};

export type ChildProgress = {
  /** Current grade (advanced each August); above 12 means finished high school. */
  grade: number | null;
  graduated: boolean;
  assessments: { id: InstrumentId; title: string; state: AssessmentState }[];
  /** Null until the child finishes the interests or personality activity. */
  results: ChildResults | null;
  /** The careers the student is aiming for, for now, oldest first. */
  northStars: CareerLink[];
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

/**
 * What a child's latest interest scores say, for their parent: the same honest reading as the
 * student's results page (see interestPattern), about the child by name. When no area stands out
 * (`noLead`), it says so rather than naming the least-disliked areas as interests.
 */
export function interestsForParent(areas: Record<Riasec, number>, name: string): { text: string; noLead: boolean } {
  const pattern = interestPattern(areas);
  const who = { name, their: "their" };
  switch (pattern.kind) {
    case "flat":
      return { noLead: true, text: `No area stands out yet. ${name} ${noLeadReason(pattern)}, which can happen when they're not sure yet.` };
    case "low":
      return {
        noLead: true,
        text: `No area stands out yet. ${name} ${noLeadReason(pattern)}, which can happen before they've tried many of these activities.`,
      };
    case "few":
      return { noLead: false, text: fewAreasText(pattern, who) };
    case "tied":
      return { noLead: false, text: tiedAreasText(pattern, who) };
    case "code": {
      const tie = codeTieText(pattern);
      return { noLead: false, text: `${name}'s interest code is ${pattern.code}: ${areaNames(strongAreas(pattern))}.${tie ? ` ${tie}` : ""}` };
    }
  }
}

/**
 * The strengths that count (see strengthsThatCount), highest first, in the words the student sees
 * on their results page. Only the four traits linked to careers can be in it: emotional stability
 * ("Staying calm") never is, whatever its score.
 */
export function strengthsForParent(traits: Record<BigFive, number>): ParentStrength[] {
  return strengthsThatCount(traits).map((trait) => {
    const { name, label } = strengthFor(trait, traits[trait]);
    return { trait, name, label };
  });
}

type MatchRow = { code: string; title: string; score: number; rank: number };

/**
 * The highest-scoring careers in a set of matches. Matches are stored degree paths first, then
 * training paths (see rankForStudent), so this takes the best of both rather than the first five.
 * Equal scores keep their stored order.
 */
export function topMatches(rows: readonly MatchRow[], limit = PARENT_TOP_MATCHES): CareerLink[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, limit)
    .map(({ code, title }) => ({ code, title }));
}

type AttemptRow = { instrument: string; completedAt: Date | null; scores: unknown };

/** The scores of the latest finished attempt at `instrument`, like latestResult. */
function latestScores<T>(attempts: readonly AttemptRow[], instrument: InstrumentId): T | null {
  let latest: AttemptRow | null = null;
  for (const a of attempts) {
    if (a.instrument !== instrument || !a.completedAt || a.scores === null) continue;
    if (!latest || a.completedAt > latest.completedAt!) latest = a;
  }
  return (latest?.scores as T | undefined) ?? null;
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
 * Every child linked to `parentUserId`, with a progress summary each. The same eight queries run
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

  // Each child's latest set of career matches.
  const latestRuns = db
    .selectDistinctOn([matchRuns.userId], { id: matchRuns.id, userId: matchRuns.userId })
    .from(matchRuns)
    .where(inArray(matchRuns.userId, ids))
    .orderBy(matchRuns.userId, desc(matchRuns.createdAt))
    .as("latest_runs");

  const [attempts, stars, milestones, stepCounts, courses, list, matches] = await Promise.all([
    // Scores only for the results shown (interests and personality), never values.
    db
      .select({
        userId: assessmentAttempts.userId,
        instrument: assessmentAttempts.instrument,
        completedAt: assessmentAttempts.completedAt,
        scores: assessmentResults.scores,
      })
      .from(assessmentAttempts)
      .leftJoin(
        assessmentResults,
        and(eq(assessmentResults.attemptId, assessmentAttempts.id), inArray(assessmentAttempts.instrument, ["interests", "personality"])),
      )
      .where(inArray(assessmentAttempts.userId, ids)),
    db
      .select({ userId: northStarGoals.userId, code: northStarGoals.occupationCode, title: northStarGoals.title })
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
    db
      .select({
        userId: latestRuns.userId,
        code: careerMatches.occupationCode,
        title: careerMatches.title,
        score: careerMatches.score,
        rank: careerMatches.rank,
      })
      .from(careerMatches)
      .innerJoin(latestRuns, eq(careerMatches.runId, latestRuns.id)),
  ]);

  const byChild = {
    attempts: groupBy(attempts),
    stars: groupBy(stars),
    milestones: groupBy(milestones),
    steps: new Map(stepCounts.map((s) => [s.userId, s])),
    courses: groupBy(courses),
    list: groupBy(list),
    matches: groupBy(matches),
  };
  const today = usToday(now);

  return children.map((child) => {
    const id = child.id;
    const progress = new Map((byChild.milestones.get(id) ?? []).map((m) => [m.milestoneId, m.status]));
    return {
      ...child,
      progress: summarize({
        name: child.displayName,
        grade: child.grade,
        now,
        today,
        library,
        progress,
        attempts: byChild.attempts.get(id) ?? [],
        stars: (byChild.stars.get(id) ?? []).map(({ code, title }) => ({ code, title })),
        matches: byChild.matches.get(id) ?? [],
        steps: byChild.steps.get(id),
        courses: byChild.courses.get(id) ?? [],
        list: byChild.list.get(id) ?? [],
      }),
    };
  });
}

type SummaryInput = {
  name: string;
  grade: number | null;
  now: Date;
  today: string;
  library: readonly Milestone[];
  progress: Map<string, "done" | "skipped">;
  attempts: AttemptRow[];
  stars: CareerLink[];
  matches: MatchRow[];
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

function childResults(input: SummaryInput): ChildResults | null {
  const interests = latestScores<InterestScores>(input.attempts, "interests");
  const personality = latestScores<PersonalityScores>(input.attempts, "personality");
  const results: ChildResults = {
    interests: interests ? interestsForParent(interests.areas, input.name) : null,
    strengths: personality ? strengthsForParent(personality.traits) : null,
    topMatches: topMatches(input.matches),
  };
  return results.interests || results.strengths || results.topMatches.length ? results : null;
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
    results: childResults(input),
    northStars: input.stars,
    roadmap,
    steps,
    plan: { courses: input.courses.length, estimatedGpa: computeGpa(input.courses).unweighted },
    colleges: { count: input.list.length, nextDeadlines },
    fafsa,
    justStarted,
  };
}
