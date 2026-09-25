import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { assessmentAttempts, assessmentResponses, assessmentResults, users } from "@/db/schema";
import { env } from "@/env";
import { isLinkedParent } from "../accounts";
import { audit } from "../audit";
import { forgetSavedContexts } from "../counselor/saved-context";
import { occupationDescriptions, templateExplanation } from "../matching/explain";
import { type Pathway, fitLabel, pathwayFor, rankForStudent } from "../matching/match";
import { computeMatches, loadOccupationProfiles } from "../matching/service";
import { type CountMetric, recordCount } from "../admin/counts";
import { consumeRateLimit } from "../rate-limit";
import {
  type FreeInstrument,
  type SavedAssessmentError,
  validateAreaScores,
  validateSavedAssessment,
  validateSavedStrengths,
} from "./anonymous";
import { INSTRUMENTS, RIASEC, type Riasec } from "./instruments";
import { interestPattern, noAreaStandsOut } from "./interest-pattern";
import { type InterestScores, type Responses, SCORING_VERSION, score } from "./scoring";

/**
 * Server side of the free interest quiz (see ./anonymous.ts): career matches for visitors without
 * an account, counting finishes, and bringing a visitor's saved answers (with the strengths add-on,
 * when they took it) into their new (or existing) account.
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
 * Rate-limit key for a visitor, for career lookups (`match`) or counting finishes (`count`). The IP
 * address is never stored: the key is a keyed hash of the address and today's date (UTC), so it
 * can't be reversed without the server secret and can't be linked from one day to the next.
 * Rate-limit rows are swept daily.
 */
export function anonymousRateKey(ip: string, secret: string, now = new Date(), use: "match" | "count" = "match"): string {
  const day = now.toISOString().slice(0, 10);
  return `try:${use}:${createHmac("sha256", secret).update(`${day}\n${ip}`).digest("base64url")}`;
}

// ---------------------------------------------------------------------------
// Counting finishes
// ---------------------------------------------------------------------------

/**
 * Finishes counted per internet connection per hour. A classroom finishing together shares one
 * address; past this, a script is inflating the numbers, and the extra finishes aren't counted.
 */
export const FREE_FINISH_COUNT_LIMIT = { limit: 60, windowMs: HOUR } as const;

const FINISH_METRICS = { interests: "free_quiz_finished", personality: "free_strengths_finished" } as const satisfies Record<
  FreeInstrument,
  CountMetric
>;

/**
 * Counts one finish of the free quiz (`interests`) or its strengths add-on (`personality`) in
 * today's anonymous totals (see src/lib/admin/counts.ts). Nothing about the visitor is kept but the
 * hashed rate-limit counter. The browser asks once per finished set of answers; the limit per
 * connection keeps a script from inflating the count. Returns whether it was counted.
 */
export async function countFreeFinish(
  db: Db,
  activity: unknown,
  { rateKey, now = new Date() }: { rateKey: string; now?: Date },
): Promise<boolean> {
  if (activity !== "interests" && activity !== "personality") return false;
  const { limit, windowMs } = FREE_FINISH_COUNT_LIMIT;
  if (!(await consumeRateLimit(db, rateKey, limit, windowMs, now))) return false;
  await recordCount(db, FINISH_METRICS[activity], now);
  return true;
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
  const descriptions = await occupationDescriptions(
    db,
    ranked.map((r) => r.code),
  );
  const explanation = templateExplanation(
    areas,
    ranked.map((r) => ({
      occupationCode: r.code,
      interests: interestsByCode.get(r.code),
      title: r.title,
      description: descriptions.get(r.code),
      jobZone: r.jobZone,
    })),
  );
  const why = new Map(explanation.careers.map((c) => [c.code, c.why]));
  const noLead = noAreaStandsOut(interestPattern(areas));
  return {
    ok: true,
    code: interestCode(areas),
    overview: explanation.overview,
    careers: ranked.map((r) => ({
      code: r.code,
      title: r.title,
      pathway: pathwayFor(r.jobZone),
      fit: fitLabel(r.score, { noLead }),
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
  | { ok: true; attemptId: string; runId: string | null; strengthsAttemptId: string | null }
  | { ok: false; error: SavedAssessmentError | "not_allowed" | "already_done" };

/**
 * Inserts a completed attempt from answers checked by validateSaved, with its result scored here.
 * Started and finished at the same moment: that's how an import is recognized later (see
 * isImported), and how the strengths imported with a quiz are found again (see
 * removeImportedAssessment). An unfinished in-account attempt is replaced.
 */
async function insertImportedAttempt(tx: Db, userId: string, instrument: FreeInstrument, answers: Responses, now: Date) {
  await tx
    .delete(assessmentAttempts)
    .where(and(eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.instrument, instrument), isNull(assessmentAttempts.completedAt)));
  const [attempt] = await tx
    .insert(assessmentAttempts)
    .values({ userId, instrument, instrumentVersion: INSTRUMENTS[instrument].version, startedAt: now, completedAt: now })
    .returning({ id: assessmentAttempts.id });
  await tx
    .insert(assessmentResponses)
    .values(Object.entries(answers).map(([itemId, value]) => ({ attemptId: attempt.id, itemId, value, answeredAt: now })));
  await tx.insert(assessmentResults).values({ attemptId: attempt.id, scores: score(instrument, answers), scoringVersion: SCORING_VERSION });
  return attempt.id;
}

async function hasFinished(tx: Db, userId: string, instrument: FreeInstrument): Promise<boolean> {
  const [done] = await tx
    .select({ id: assessmentAttempts.id })
    .from(assessmentAttempts)
    .where(
      and(eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.instrument, instrument), isNotNull(assessmentAttempts.completedAt)),
    )
    .limit(1);
  return Boolean(done);
}

/**
 * Creates a completed interests attempt from a visitor's saved answers: the responses, a result
 * scored here (client scores are never accepted) and a fresh match run, all or nothing.
 *
 * - `actorUserId` is the student themself, or a parent linked to them.
 * - Refused when the student already has a finished interests result, so results are never
 *   imported twice. An unfinished in-account attempt is replaced by the saved answers.
 * - `strengths`: the strengths add-on's saved answers, when the visitor took it. Checked just as
 *   strictly and imported with the quiz, before matching. Answers that don't check out are left out
 *   without stopping the quiz's import, as are strengths when the account already has a finished
 *   personality result.
 */
export async function importSavedAssessment(
  db: Db,
  actorUserId: string,
  studentUserId: string,
  saved: unknown,
  { via, strengths, now = new Date() }: { via: ImportSource; strengths?: unknown; now?: Date },
): Promise<ImportResult> {
  const parsed = validateSavedAssessment(saved);
  if (!parsed.ok) return parsed;
  const strengthsParsed = strengths === undefined || strengths === null || strengths === "" ? null : validateSavedStrengths(strengths);
  if (actorUserId !== studentUserId && !(await isLinkedParent(db, actorUserId, studentUserId))) {
    return { ok: false, error: "not_allowed" };
  }

  const outcome = await db.transaction(async (tx): Promise<ImportResult> => {
    // Locks the student, so two imports at once (a double click, two tabs) can't both go in.
    const [student] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentUserId), eq(users.role, "student")))
      .for("update");
    if (!student) return { ok: false, error: "not_allowed" };
    if (await hasFinished(tx, studentUserId, "interests")) return { ok: false, error: "already_done" };

    const attemptId = await insertImportedAttempt(tx, studentUserId, "interests", parsed.answers, now);
    const strengthsAttemptId =
      strengthsParsed?.ok && !(await hasFinished(tx, studentUserId, "personality"))
        ? await insertImportedAttempt(tx, studentUserId, "personality", strengthsParsed.answers, now)
        : null;
    // Also forgets the counselor's saved context, which described the student before these results.
    const runId = await computeMatches(tx, studentUserId);
    return { ok: true, attemptId, runId, strengthsAttemptId };
  });
  if (!outcome.ok) return outcome;

  await audit(db, "assessment.imported", {
    actorUserId,
    subjectUserId: studentUserId,
    metadata: { instrument: "interests", via },
  });
  if (outcome.strengthsAttemptId) {
    await audit(db, "assessment.imported", {
      actorUserId,
      subjectUserId: studentUserId,
      metadata: { instrument: "personality", via },
    });
  }
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

export type UndoableImport = {
  attemptId: string;
  code: string;
  areas: Record<Riasec, number>;
  undoUntil: Date;
  /** The strengths add-on brought in with the quiz, which goes with it. */
  strengthsAttemptId: string | null;
};

/** The strengths imported together with a quiz: a personality import from the very same moment. */
async function strengthsImportedAt(db: Db, studentUserId: string, importedAt: Date): Promise<string | null> {
  const [row] = await db
    .select({ id: assessmentAttempts.id })
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.userId, studentUserId),
        eq(assessmentAttempts.instrument, "personality"),
        eq(assessmentAttempts.startedAt, importedAt),
        eq(assessmentAttempts.completedAt, importedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

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
  const { code, areas } = latest.scores as InterestScores;
  return { attemptId: latest.id, code, areas, undoUntil, strengthsAttemptId: await strengthsImportedAt(db, studentUserId, latest.completedAt) };
}

export type RemoveImportResult = { ok: true } | { ok: false; error: "not_allowed" | "not_undoable" };

/**
 * "These weren't my answers": deletes interest results brought in from the free quiz, with their
 * answers and career matches, and the strengths brought in with them, so the student can take both
 * activities themselves right away. Only the import named, only while it's the student's latest
 * interest result, and only for IMPORT_UNDO_DAYS. `actorUserId` is the student themself, or a
 * parent linked to them.
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
  const removed = await db.transaction(async (tx): Promise<RemoveImportResult & { strengths?: boolean }> => {
    // Locks the student, as the import does.
    const [student] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentUserId), eq(users.role, "student")))
      .for("update");
    if (!student) return { ok: false, error: "not_allowed" };
    const imported = await undoableImport(tx, studentUserId, now);
    if (imported?.attemptId !== attemptId) return { ok: false, error: "not_undoable" };
    // Its answers, result and career matches go with it, and so do the strengths imported with it.
    const ids = [attemptId, ...(imported.strengthsAttemptId ? [imported.strengthsAttemptId] : [])];
    await tx.delete(assessmentAttempts).where(inArray(assessmentAttempts.id, ids));
    // The counselor's saved context described the student with these results.
    await forgetSavedContexts(tx, studentUserId);
    return { ok: true, strengths: Boolean(imported.strengthsAttemptId) };
  });
  if (!removed.ok) return removed;
  await audit(db, "assessment.import_removed", { actorUserId, subjectUserId: studentUserId, metadata: { instrument: "interests" } });
  if (removed.strengths) {
    await audit(db, "assessment.import_removed", { actorUserId, subjectUserId: studentUserId, metadata: { instrument: "personality" } });
  }
  return { ok: true };
}
