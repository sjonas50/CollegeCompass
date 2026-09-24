import { and, asc, count, countDistinct, eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { users, weeklySteps } from "@/db/schema";
import { MILESTONES } from "./roadmap/milestones";
import type { Milestone } from "./roadmap/types";

/** Small on purpose: one to three things a student can actually finish this week. */
export const MAX_STEPS_PER_WEEK = 3;
export const STEP_TEXT_MAX = 140;

export const StepTextSchema = z
  .string()
  .trim()
  .min(1, "Write a short step, like “Ask my counselor about summer programs.”")
  .max(STEP_TEXT_MAX, `Keep it to ${STEP_TEXT_MAX} characters or fewer.`);

export type WeeklyStep = {
  id: string;
  weekStart: string;
  text: string;
  milestoneId: string | null;
  status: "open" | "done";
  createdAt: Date;
  completedAt: Date | null;
};

export type StepStats = {
  /** Every step ever finished. Never goes down because a week was missed. */
  stepsCompleted: number;
  /** Weeks with at least one finished step (not necessarily in a row). */
  weeksWithProgress: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday of `date`'s week (UTC) as YYYY-MM-DD. */
export function weekStartOf(date: Date = new Date()): string {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysSinceMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

const stepColumns = {
  id: weeklySteps.id,
  weekStart: weeklySteps.weekStart,
  text: weeklySteps.text,
  milestoneId: weeklySteps.milestoneId,
  status: weeklySteps.status,
  createdAt: weeklySteps.createdAt,
  completedAt: weeklySteps.completedAt,
};

/** A student's steps for one week (this week by default), oldest first. */
export async function listWeek(db: Db, userId: string, weekStart: string = weekStartOf()): Promise<WeeklyStep[]> {
  return db
    .select(stepColumns)
    .from(weeklySteps)
    .where(and(eq(weeklySteps.userId, userId), eq(weeklySteps.weekStart, weekStart)))
    .orderBy(asc(weeklySteps.createdAt), asc(weeklySteps.id));
}

export type AddStepError = "invalid_text" | "milestone_not_found" | "week_full" | "already_added" | "not_found";
export type AddStepResult = { ok: true; step: WeeklyStep } | { ok: false; error: AddStepError; message?: string };

/**
 * Adds a step to this week. Text is trimmed and 1–140 characters; a linked milestone must exist
 * in the library and can only be added once per week; a week holds at most three steps.
 */
export async function addStep(
  db: Db,
  userId: string,
  input: { text: unknown; milestoneId?: string | null },
  opts: { now?: Date; library?: readonly Milestone[] } = {},
): Promise<AddStepResult> {
  const parsed = StepTextSchema.safeParse(input.text);
  if (!parsed.success) return { ok: false, error: "invalid_text", message: parsed.error.issues[0]?.message };

  const milestoneId = input.milestoneId ?? null;
  const library = opts.library ?? MILESTONES;
  if (milestoneId !== null && !library.some((m) => m.id === milestoneId)) {
    return { ok: false, error: "milestone_not_found" };
  }

  const weekStart = weekStartOf(opts.now ?? new Date());
  return db.transaction(async (tx) => {
    // Lock the student's row so two quick submissions can't both slip under the weekly limit.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) return { ok: false as const, error: "not_found" as const };

    const week = await tx
      .select({ milestoneId: weeklySteps.milestoneId })
      .from(weeklySteps)
      .where(and(eq(weeklySteps.userId, userId), eq(weeklySteps.weekStart, weekStart)));
    if (week.length >= MAX_STEPS_PER_WEEK) return { ok: false as const, error: "week_full" as const };
    if (milestoneId !== null && week.some((s) => s.milestoneId === milestoneId)) {
      return { ok: false as const, error: "already_added" as const };
    }

    const [step] = await tx
      .insert(weeklySteps)
      .values({ userId, weekStart, text: parsed.data, milestoneId })
      .returning(stepColumns);
    return { ok: true as const, step };
  });
}

const StepId = z.uuid();

/** Updates one of the student's own steps; false if it doesn't exist or isn't theirs. */
async function updateOwnStep(db: Db, userId: string, stepId: string, set: Partial<typeof weeklySteps.$inferInsert>) {
  if (!StepId.safeParse(stepId).success) return false;
  const rows = await db
    .update(weeklySteps)
    .set(set)
    .where(and(eq(weeklySteps.id, stepId), eq(weeklySteps.userId, userId)))
    .returning({ id: weeklySteps.id });
  return rows.length > 0;
}

export async function completeStep(db: Db, userId: string, stepId: string, now: Date = new Date()) {
  return updateOwnStep(db, userId, stepId, { status: "done", completedAt: now });
}

export async function reopenStep(db: Db, userId: string, stepId: string) {
  return updateOwnStep(db, userId, stepId, { status: "open", completedAt: null });
}

export async function removeStep(db: Db, userId: string, stepId: string) {
  if (!StepId.safeParse(stepId).success) return false;
  const rows = await db
    .delete(weeklySteps)
    .where(and(eq(weeklySteps.id, stepId), eq(weeklySteps.userId, userId)))
    .returning({ id: weeklySteps.id });
  return rows.length > 0;
}

/** Lifetime totals. There are no streaks: a quiet week never takes anything away. */
export async function stepStats(db: Db, userId: string): Promise<StepStats> {
  const [row] = await db
    .select({ stepsCompleted: count(), weeksWithProgress: countDistinct(weeklySteps.weekStart) })
    .from(weeklySteps)
    .where(and(eq(weeklySteps.userId, userId), eq(weeklySteps.status, "done")));
  return { stepsCompleted: Number(row?.stepsCompleted ?? 0), weeksWithProgress: Number(row?.weeksWithProgress ?? 0) };
}

/** Everything the weekly steps card needs for one student. */
export async function weeklyStepsView(db: Db, userId: string, now: Date = new Date()) {
  const weekStart = weekStartOf(now);
  const [steps, stats] = await Promise.all([listWeek(db, userId, weekStart), stepStats(db, userId)]);
  return { weekStart, steps, stats, max: MAX_STEPS_PER_WEEK };
}
