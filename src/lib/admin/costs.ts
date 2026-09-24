import { createHash } from "node:crypto";
import { and, count, gte, lt, sql, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { aiUsage } from "@/db/schema";
import { env } from "@/env";
import { assertAdmin } from "./access";
import { median, monthKeyOf, monthRange } from "./format";

/** Students at or above this share of the monthly budget are listed as close to it. */
export const NEAR_BUDGET_SHARE = 0.8;

/**
 * A stable pseudonymous id for the cost dashboard ("S-1a2b3c4d"), so staff can spot the same heavy
 * user month to month without seeing who it is.
 */
export function studentShortId(userId: string): string {
  return `S-${createHash("sha256").update(`cost-dashboard:${userId}`).digest("hex").slice(0, 8)}`;
}

export type StudentSpend = { shortId: string; micros: number; percentOfBudget: number };

export type SpendBreakdown = {
  key: string;
  micros: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Share of the month's total spend, 0–1. */
  share: number;
};

export type CostReport = {
  month: string;
  budgetMicros: number;
  /** Everything spent this month, including by accounts deleted since. */
  totalMicros: number;
  calls: number;
  /** The part of totalMicros spent by accounts deleted since (their usage is kept, unlinked). */
  deletedAccountsMicros: number;
  /** Students with any AI use this month who still have an account. */
  activeStudents: number;
  /** Per-student average and median, over activeStudents only. */
  averageMicros: number | null;
  medianMicros: number | null;
  /** From NEAR_BUDGET_SHARE up to (not including) the budget, highest first. */
  nearBudget: StudentSpend[];
  /** At or over the budget, highest first. */
  overBudget: StudentSpend[];
  byFeature: SpendBreakdown[];
  byModel: SpendBreakdown[];
  /** Every day of the month (through today for the current month), UTC. */
  daily: { date: string; micros: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * AI spend for one UTC month (the same months the per-student budget uses): totals, per-student
 * spread against the budget, and spend by feature, model and day. Students appear only as short
 * pseudonymous ids.
 */
export async function costReport(
  db: Db,
  actorId: string,
  month: string,
  opts: { now?: Date; budgetUsd?: number } = {},
): Promise<CostReport> {
  await assertAdmin(db, actorId);
  const now = opts.now ?? new Date();
  const budgetMicros = Math.round((opts.budgetUsd ?? env().AI_MONTHLY_BUDGET_USD) * 1_000_000);
  const { start, end, days } = monthRange(month);
  const inMonth = and(gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, end));
  const micros = sum(aiUsage.costMicros).mapWith(Number);
  const totals = {
    micros,
    calls: count(),
    inputTokens: sum(aiUsage.inputTokens).mapWith(Number),
    outputTokens: sum(aiUsage.outputTokens).mapWith(Number),
  };
  const day = sql<string>`to_char(${aiUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

  const [perStudent, features, models, dailyRows] = await Promise.all([
    db.select({ userId: aiUsage.userId, micros }).from(aiUsage).where(inMonth).groupBy(aiUsage.userId),
    db.select({ key: aiUsage.feature, ...totals }).from(aiUsage).where(inMonth).groupBy(aiUsage.feature),
    db.select({ key: aiUsage.model, ...totals }).from(aiUsage).where(inMonth).groupBy(aiUsage.model),
    db.select({ day, micros }).from(aiUsage).where(inMonth).groupBy(day),
  ]);

  const totalMicros = perStudent.reduce((t, s) => t + s.micros, 0);
  // Rows of deleted students (no user) count toward totals but not as anyone's spend.
  const deletedAccountsMicros = perStudent.find((s) => s.userId === null)?.micros ?? 0;
  const studentsMicros = totalMicros - deletedAccountsMicros;
  const spends = perStudent
    .flatMap((s) => (s.userId ? [{ userId: s.userId, micros: s.micros }] : []))
    .map((s) => ({ shortId: studentShortId(s.userId), micros: s.micros, percentOfBudget: budgetMicros ? (s.micros / budgetMicros) * 100 : 0 }))
    .sort((a, b) => b.micros - a.micros || a.shortId.localeCompare(b.shortId));
  const breakdown = (rows: typeof features) =>
    rows
      .map((r) => ({ ...r, share: totalMicros ? r.micros / totalMicros : 0 }))
      .sort((a, b) => b.micros - a.micros || a.key.localeCompare(b.key));

  // Days with no use show as zero. The current month stops at today.
  const byDay = new Map(dailyRows.map((r) => [r.day, r.micros]));
  const shownDays = monthKeyOf(now) === month ? now.getUTCDate() : days;
  const daily = Array.from({ length: shownDays }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { date, micros: byDay.get(date) ?? 0 };
  });

  return {
    month,
    budgetMicros,
    totalMicros,
    calls: features.reduce((t, f) => t + f.calls, 0),
    deletedAccountsMicros,
    activeStudents: spends.length,
    averageMicros: spends.length ? studentsMicros / spends.length : null,
    medianMicros: median(spends.map((s) => s.micros)),
    nearBudget: spends.filter((s) => s.micros >= budgetMicros * NEAR_BUDGET_SHARE && s.micros < budgetMicros),
    overBudget: spends.filter((s) => s.micros >= budgetMicros),
    byFeature: breakdown(features),
    byModel: breakdown(models),
    daily,
  };
}
