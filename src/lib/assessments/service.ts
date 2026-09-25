import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { assessmentAttempts, assessmentResponses, assessmentResults } from "@/db/schema";
import { INSTRUMENTS, type InstrumentId, isValidResponse } from "./instruments";
import { type Responses, SCORING_VERSION, type ScoresFor, missingItems, score } from "./scoring";
import { forgetSavedContexts } from "../counselor/saved-context";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Interests shift during adolescence; students can retake after this long. */
export const RETAKE_AFTER_DAYS = 90;

export type AttemptView = {
  id: string;
  instrument: InstrumentId;
  responses: Responses;
  completedAt: Date | null;
};

async function responsesFor(db: Db, attemptId: string): Promise<Responses> {
  const rows = await db
    .select({ itemId: assessmentResponses.itemId, value: assessmentResponses.value })
    .from(assessmentResponses)
    .where(eq(assessmentResponses.attemptId, attemptId));
  return Object.fromEntries(rows.map((r) => [r.itemId, r.value]));
}

async function latestAttempt(db: Db, userId: string, instrument: InstrumentId, completed: boolean) {
  const [row] = await db
    .select()
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.userId, userId),
        eq(assessmentAttempts.instrument, instrument),
        completed ? isNotNull(assessmentAttempts.completedAt) : isNull(assessmentAttempts.completedAt),
      ),
    )
    .orderBy(desc(assessmentAttempts.startedAt))
    .limit(1);
  return row ?? null;
}

export function nextRetakeDate(completedAt: Date) {
  return new Date(completedAt.getTime() + RETAKE_AFTER_DAYS * DAY_MS);
}

export type StartResult =
  | { ok: true; attempt: AttemptView }
  | { ok: false; error: "too_soon"; retakeAfter: Date };

/** Resumes an unfinished attempt, or starts a new one if the student is allowed to (re)take it. */
export async function startOrResumeAttempt(
  db: Db,
  userId: string,
  instrument: InstrumentId,
  now = new Date(),
): Promise<StartResult> {
  const open = await latestAttempt(db, userId, instrument, false);
  if (open) {
    return {
      ok: true,
      attempt: { id: open.id, instrument, responses: await responsesFor(db, open.id), completedAt: null },
    };
  }
  const done = await latestAttempt(db, userId, instrument, true);
  if (done?.completedAt && now < nextRetakeDate(done.completedAt)) {
    return { ok: false, error: "too_soon", retakeAfter: nextRetakeDate(done.completedAt) };
  }
  const [created] = await db
    .insert(assessmentAttempts)
    .values({ userId, instrument, instrumentVersion: INSTRUMENTS[instrument].version, startedAt: now })
    .returning();
  return { ok: true, attempt: { id: created.id, instrument, responses: {}, completedAt: null } };
}

async function ownedOpenAttempt(db: Db, userId: string, attemptId: string) {
  const [attempt] = await db
    .select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId)));
  if (!attempt || attempt.completedAt) return null;
  return attempt as typeof attempt & { instrument: InstrumentId };
}

/** Autosaves answers. Invalid item ids or values are rejected wholesale. */
export async function saveResponses(db: Db, userId: string, attemptId: string, answers: Responses) {
  const attempt = await ownedOpenAttempt(db, userId, attemptId);
  if (!attempt) return { ok: false as const, error: "not_found" as const };
  const entries = Object.entries(answers);
  if (entries.length === 0) return { ok: true as const };
  if (!entries.every(([itemId, value]) => isValidResponse(attempt.instrument, itemId, value))) {
    return { ok: false as const, error: "invalid" as const };
  }
  for (const [itemId, value] of entries) {
    await db
      .insert(assessmentResponses)
      .values({ attemptId, itemId, value })
      .onConflictDoUpdate({
        target: [assessmentResponses.attemptId, assessmentResponses.itemId],
        set: { value, answeredAt: new Date() },
      });
  }
  return { ok: true as const };
}

export type CompleteResult =
  | { ok: true; instrument: InstrumentId }
  | { ok: false; error: "not_found" | "incomplete"; missing?: string[] };

export async function completeAttempt(db: Db, userId: string, attemptId: string, now = new Date()): Promise<CompleteResult> {
  const attempt = await ownedOpenAttempt(db, userId, attemptId);
  if (!attempt) return { ok: false, error: "not_found" };
  const responses = await responsesFor(db, attemptId);
  const missing = missingItems(attempt.instrument, responses);
  if (missing.length > 0) return { ok: false, error: "incomplete", missing };

  let scores: ScoresFor[InstrumentId];
  try {
    scores = score(attempt.instrument, responses);
  } catch {
    return { ok: false, error: "incomplete" };
  }
  await db.transaction(async (tx) => {
    await tx.update(assessmentAttempts).set({ completedAt: now }).where(eq(assessmentAttempts.id, attemptId));
    await tx.insert(assessmentResults).values({ attemptId, scores, scoringVersion: SCORING_VERSION });
  });
  await forgetSavedContexts(db, userId);
  return { ok: true, instrument: attempt.instrument };
}

export type LatestResult<I extends InstrumentId> = { attemptId: string; completedAt: Date; scores: ScoresFor[I] };

/** Scored attempts, as latestResult and resultOfAttempt give them. */
function scoredAttempts(db: Db) {
  return db
    .select({
      attemptId: assessmentAttempts.id,
      completedAt: assessmentAttempts.completedAt,
      scores: assessmentResults.scores,
    })
    .from(assessmentAttempts)
    .innerJoin(assessmentResults, eq(assessmentResults.attemptId, assessmentAttempts.id))
    .$dynamic();
}

function toResult<I extends InstrumentId>(row: { attemptId: string; completedAt: Date | null; scores: unknown } | undefined) {
  if (!row?.completedAt) return null;
  return { attemptId: row.attemptId, completedAt: row.completedAt, scores: row.scores as ScoresFor[I] } satisfies LatestResult<I>;
}

export async function latestResult<I extends InstrumentId>(
  db: Db,
  userId: string,
  instrument: I,
): Promise<LatestResult<I> | null> {
  const [row] = await scoredAttempts(db)
    .where(and(eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.instrument, instrument)))
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1);
  return toResult<I>(row);
}

/**
 * The result of one of the student's attempts, as latestResult gives it, whether or not it's the
 * latest (a match run's inputs, see refillMatches). Null when that attempt isn't theirs, isn't for
 * `instrument`, or isn't scored.
 */
export async function resultOfAttempt<I extends InstrumentId>(
  db: Db,
  userId: string,
  instrument: I,
  attemptId: string,
): Promise<LatestResult<I> | null> {
  const [row] = await scoredAttempts(db)
    .where(
      and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.instrument, instrument)),
    )
    .limit(1);
  return toResult<I>(row);
}

export type InstrumentStatus =
  | { state: "not_started" }
  | { state: "in_progress"; answered: number; total: number }
  | { state: "done"; completedAt: Date; retakeAfter: Date };

export async function instrumentStatuses(db: Db, userId: string): Promise<Record<InstrumentId, InstrumentStatus>> {
  const out = {} as Record<InstrumentId, InstrumentStatus>;
  for (const instrument of Object.keys(INSTRUMENTS) as InstrumentId[]) {
    const open = await latestAttempt(db, userId, instrument, false);
    if (open) {
      const answered = Object.keys(await responsesFor(db, open.id)).length;
      out[instrument] = { state: "in_progress", answered, total: INSTRUMENTS[instrument].itemIds.length };
      continue;
    }
    const done = await latestAttempt(db, userId, instrument, true);
    out[instrument] = done?.completedAt
      ? { state: "done", completedAt: done.completedAt, retakeAfter: nextRetakeDate(done.completedAt) }
      : { state: "not_started" };
  }
  return out;
}
