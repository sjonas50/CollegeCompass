import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { assessmentAttempts, assessmentResponses, assessmentResults, users } from "@/db/schema";
import { env } from "@/env";
import { isLinkedParent } from "../accounts";
import { audit } from "../audit";
import { forgetSavedContexts } from "../counselor/saved-context";
import { templateExplanation } from "../matching/explain";
import { type Pathway, fitLabel, pathwayFor, rankForStudent } from "../matching/match";
import { computeMatches, loadOccupationProfiles } from "../matching/service";
import { consumeRateLimit } from "../rate-limit";
import { type SavedAssessmentError, validateAreaScores, validateSavedAssessment } from "./anonymous";
import { INSTRUMENTS, RIASEC, type Riasec } from "./instruments";
import { SCORING_VERSION, score } from "./scoring";

/**
 * Server side of the free interest quiz (see ./anonymous.ts): career matches for visitors without
 * an account, and bringing a visitor's saved answers into their new (or existing) account.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Matches for visitors
// ---------------------------------------------------------------------------

/** Fewer than a signed-in student sees; saving the results shows the full list. */
export const FREE_MATCH_LIMITS = { degree: 6, training: 6 } as const;
/**
 * Per internet connection, not per person: a family, a classroom or a whole library can share one
 * address. The results page keeps the matches it found for the tab, so a visitor uses about one
 * lookup per set of answers. Each lookup is cheap and the data is public (O*NET); this only stops
 * a script from hammering the server.
 */
export const FREE_MATCH_RATE_LIMIT = { limit: 300, windowMs: HOUR } as const;

/** Used only in development and tests, where CRON_SECRET may be unset (production requires it). */
const DEV_RATE_KEY_SECRET = "college-compass-dev-rate-key";

export function rateKeySecret(): string {
  return env().CRON_SECRET ?? DEV_RATE_KEY_SECRET;
}

/**
 * Rate-limit key for a visitor. The IP address is never stored: the key is a keyed hash of the
 * address and today's date (UTC), so it can't be reversed without the server secret and can't be
 * linked from one day to the next. Rate-limit rows are swept daily.
 */
export function anonymousRateKey(ip: string, secret: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `try:match:${createHmac("sha256", secret).update(`${day}\n${ip}`).digest("base64url")}`;
}

/** Top three areas, highest first; ties keep RIASEC order (as in scoreInterests). */
export function interestCode(areas: Record<Riasec, number>): string {
  return [...RIASEC]
    .sort((a, b) => areas[b] - areas[a])
    .slice(0, 3)
    .join("");
}

export type FreeCareer = {
  code: string;
  title: string;
  pathway: Pathway;
  fit: ReturnType<typeof fitLabel>;
  why: string;
};

export type FreeMatchesResult =
  | { ok: true; code: string; overview: string; careers: FreeCareer[] }
  | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

/**
 * Career matches from a visitor's six interest area scores (never their answers). Uses the same
 * ranking as signed-in students, with interests only, and plain reasons written in code (no AI).
 * Stores nothing except the hashed rate-limit counter.
 */
export async function matchFreeAssessment(
  db: Db,
  rawScores: unknown,
  { rateKey, now = new Date() }: { rateKey: string; now?: Date },
): Promise<FreeMatchesResult> {
  const areas = validateAreaScores(rawScores);
  if (!areas) return { ok: false, error: "invalid" };
  const { limit, windowMs } = FREE_MATCH_RATE_LIMIT;
  if (!(await consumeRateLimit(db, rateKey, limit, windowMs, now))) return { ok: false, error: "rate_limited" };

  const profiles = await loadOccupationProfiles(db);
  if (profiles.length === 0) return { ok: false, error: "unavailable" };
  const ranked = rankForStudent({ interests: areas }, profiles, FREE_MATCH_LIMITS);
  const interestsByCode = new Map(profiles.map((p) => [p.code, p.interests]));
  const code = interestCode(areas);
  const explanation = templateExplanation(
    code,
    ranked.map((r) => ({ occupationCode: r.code, interests: interestsByCode.get(r.code) })),
  );
  const why = new Map(explanation.careers.map((c) => [c.code, c.why]));
  return {
    ok: true,
    code,
    overview: explanation.overview,
    careers: ranked.map((r) => ({
      code: r.code,
      title: r.title,
      pathway: pathwayFor(r.jobZone),
      fit: fitLabel(r.score),
      why: why.get(r.code) ?? "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Bringing saved answers into an account
// ---------------------------------------------------------------------------

/** Where the import came from, for the audit log. */
export type ImportSource = "signup" | "dashboard" | "parent";

export type ImportResult =
  | { ok: true; attemptId: string; runId: string | null }
  | { ok: false; error: SavedAssessmentError | "not_allowed" | "already_done" };

/**
 * Creates a completed interests attempt from a visitor's saved answers: the responses, a result
 * scored here (client scores are never accepted) and a fresh match run, all or nothing.
 *
 * - `actorUserId` is the student themself, or a parent linked to them.
 * - Refused when the student already has a finished interests result, so results are never
 *   imported twice. An unfinished in-account attempt is replaced by the saved answers.
 */
export async function importSavedAssessment(
  db: Db,
  actorUserId: string,
  studentUserId: string,
  saved: unknown,
  { via, now = new Date() }: { via: ImportSource; now?: Date },
): Promise<ImportResult> {
  const parsed = validateSavedAssessment(saved);
  if (!parsed.ok) return parsed;
  if (actorUserId !== studentUserId && !(await isLinkedParent(db, actorUserId, studentUserId))) {
    return { ok: false, error: "not_allowed" };
  }
  const scores = score("interests", parsed.answers);

  const outcome = await db.transaction(async (tx): Promise<ImportResult> => {
    // Locks the student, so two imports at once (a double click, two tabs) can't both go in.
    const [student] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentUserId), eq(users.role, "student")))
      .for("update");
    if (!student) return { ok: false, error: "not_allowed" };

    const interestsOf = and(eq(assessmentAttempts.userId, studentUserId), eq(assessmentAttempts.instrument, "interests"));
    const [done] = await tx
      .select({ id: assessmentAttempts.id })
      .from(assessmentAttempts)
      .where(and(interestsOf, isNotNull(assessmentAttempts.completedAt)))
      .limit(1);
    if (done) return { ok: false, error: "already_done" };

    await tx.delete(assessmentAttempts).where(and(interestsOf, isNull(assessmentAttempts.completedAt)));
    const [attempt] = await tx
      .insert(assessmentAttempts)
      .values({
        userId: studentUserId,
        instrument: "interests",
        instrumentVersion: INSTRUMENTS.interests.version,
        // Started and finished at the same moment: that's how an import is recognized later
        // (see isImported).
        startedAt: now,
        completedAt: now,
      })
      .returning({ id: assessmentAttempts.id });
    await tx.insert(assessmentResponses).values(
      Object.entries(parsed.answers).map(([itemId, value]) => ({ attemptId: attempt.id, itemId, value, answeredAt: now })),
    );
    await tx.insert(assessmentResults).values({ attemptId: attempt.id, scores, scoringVersion: SCORING_VERSION });
    // Also forgets the counselor's saved context, which described the student before these results.
    const runId = await computeMatches(tx, studentUserId);
    return { ok: true, attemptId: attempt.id, runId };
  });
  if (!outcome.ok) return outcome;

  await audit(db, "assessment.imported", {
    actorUserId,
    subjectUserId: studentUserId,
    metadata: { instrument: "interests", via },
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Taking an import back
// ---------------------------------------------------------------------------

/**
 * How long results brought in from the free quiz can be taken back. On a shared computer, someone
 * else's quiz can end up in an account; without this, the student couldn't take the interests
 * activity themselves until the 90-day retake date.
 */
export const IMPORT_UNDO_DAYS = 14;

/**
 * Imports are created finished in one step, so they start and finish at the same moment. An attempt
 * taken in the account is always started (one request) before it's finished (a later one).
 */
function isImported(attempt: { startedAt: Date; completedAt: Date | null }): boolean {
  return attempt.completedAt !== null && attempt.startedAt.getTime() === attempt.completedAt.getTime();
}

export type UndoableImport = { attemptId: string; code: string; undoUntil: Date };

/** The student's interest results, when they came from the free quiz and can still be taken back. */
export async function undoableImport(db: Db, studentUserId: string, now = new Date()): Promise<UndoableImport | null> {
  const [latest] = await db
    .select({
      id: assessmentAttempts.id,
      startedAt: assessmentAttempts.startedAt,
      completedAt: assessmentAttempts.completedAt,
      scores: assessmentResults.scores,
    })
    .from(assessmentAttempts)
    .innerJoin(assessmentResults, eq(assessmentResults.attemptId, assessmentAttempts.id))
    .where(
      and(
        eq(assessmentAttempts.userId, studentUserId),
        eq(assessmentAttempts.instrument, "interests"),
        isNotNull(assessmentAttempts.completedAt),
      ),
    )
    .orderBy(desc(assessmentAttempts.completedAt))
    .limit(1);
  if (!latest?.completedAt || !isImported(latest)) return null;
  const undoUntil = new Date(latest.completedAt.getTime() + IMPORT_UNDO_DAYS * DAY);
  if (now >= undoUntil) return null;
  return { attemptId: latest.id, code: String(latest.scores.code), undoUntil };
}

export type RemoveImportResult = { ok: true } | { ok: false; error: "not_allowed" | "not_undoable" };

/**
 * "These weren't my answers": deletes interest results brought in from the free quiz, with their
 * answers and career matches, so the student can take the interests activity themselves right
 * away. Only the import named, only while it's the student's latest interest result, and only for
 * IMPORT_UNDO_DAYS. `actorUserId` is the student themself, or a parent linked to them.
 */
export async function removeImportedAssessment(
  db: Db,
  actorUserId: string,
  studentUserId: string,
  attemptId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<RemoveImportResult> {
  if (actorUserId !== studentUserId && !(await isLinkedParent(db, actorUserId, studentUserId))) {
    return { ok: false, error: "not_allowed" };
  }
  return db.transaction(async (tx): Promise<RemoveImportResult> => {
    // Locks the student, as the import does.
    const [student] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentUserId), eq(users.role, "student")))
      .for("update");
    if (!student) return { ok: false, error: "not_allowed" };
    const imported = await undoableImport(tx, studentUserId, now);
    if (imported?.attemptId !== attemptId) return { ok: false, error: "not_undoable" };
    // Its answers, result and career matches go with it.
    await tx.delete(assessmentAttempts).where(eq(assessmentAttempts.id, attemptId));
    // The counselor's saved context described the student with these results.
    await forgetSavedContexts(tx, studentUserId);
    return { ok: true };
  });
}
