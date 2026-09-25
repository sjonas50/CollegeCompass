import { and, gte, lte, sql, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { dailyCounts } from "@/db/schema";
import { assertAdmin } from "./access";

/*
 * Anonymous daily counts: how many people finished the free quiz, signed up and so on, each day.
 * Each is one number per UTC day and metric. Nothing links a count to anyone: no user ids, no
 * addresses, no browser ids. So a quiz finish and a signup can't be matched to each other, and the
 * ratios on the staff overview are totals divided by totals.
 *
 * Counts aren't personal data: they say nothing about any one person. That's why they aren't in
 * exportStudentData or exportHouseholdAccess, and aren't deleted with a student or a household.
 */

export const COUNT_METRICS = [
  "free_quiz_finished",
  "free_strengths_finished",
  "signup_student",
  "signup_student_with_quiz",
  "signup_parent",
  "child_added_with_quiz",
] as const;

export type CountMetric = (typeof COUNT_METRICS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day a count goes on, "2026-09-24". */
export function countDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Adds one to today's count for `metric`. Best effort: a count that fails is logged (without
 * details) and never stops what's being counted, like a signup.
 */
export async function recordCount(db: Db, metric: CountMetric, now = new Date()): Promise<void> {
  try {
    await db
      .insert(dailyCounts)
      .values({ day: countDay(now), metric, count: 1 })
      .onConflictDoUpdate({ target: [dailyCounts.day, dailyCounts.metric], set: { count: sql`${dailyCounts.count} + 1` } });
  } catch (error) {
    console.error("[counts] not recorded", metric, error instanceof Error ? error.name : "unknown");
  }
}

/** `part` as a share of `whole` (0–1), or null when there's nothing to divide by. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export type CountsReport = {
  /** The first and last UTC days counted, inclusive. */
  from: string;
  to: string;
  days: number;
  totals: Record<CountMetric, number>;
  /**
   * Totals divided by totals (see the note at the top): a signup counted today may come from a quiz
   * finished last week, so these are rough.
   */
  ratios: {
    /** Signups that brought the quiz along (a student's own, or a child's added by a parent), per quiz finish. */
    signupsWithQuizPerFinish: number | null;
    /** Strengths add-ons finished per quiz finish. */
    strengthsPerFinish: number | null;
    /** Student signups that brought the quiz along, of all student signups. */
    studentSignupsWithQuiz: number | null;
  };
};

/** Totals for the last `days` UTC days, today included, and the ratios between them. Staff only. */
export async function countsReport(
  db: Db,
  actorId: string,
  { days = 30, now = new Date() }: { days?: number; now?: Date } = {},
): Promise<CountsReport> {
  await assertAdmin(db, actorId);
  const to = countDay(now);
  const from = countDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  const rows = await db
    .select({ metric: dailyCounts.metric, total: sum(dailyCounts.count).mapWith(Number) })
    .from(dailyCounts)
    .where(and(gte(dailyCounts.day, from), lte(dailyCounts.day, to)))
    .groupBy(dailyCounts.metric);
  const byMetric = new Map(rows.map((r) => [r.metric, r.total]));
  const totals = Object.fromEntries(COUNT_METRICS.map((m) => [m, byMetric.get(m) ?? 0])) as Record<CountMetric, number>;
  return {
    from,
    to,
    days,
    totals,
    ratios: {
      signupsWithQuizPerFinish: share(totals.signup_student_with_quiz + totals.child_added_with_quiz, totals.free_quiz_finished),
      strengthsPerFinish: share(totals.free_strengths_finished, totals.free_quiz_finished),
      studentSignupsWithQuiz: share(totals.signup_student_with_quiz, totals.signup_student),
    },
  };
}
