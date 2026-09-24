import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as z from "zod";
import type { Db } from "@/db";
import {
  type SafetyReviewOutcome,
  auditLog,
  counselorConversations,
  counselorMessages,
  parentStudentLinks,
  safetyEvents,
  users,
} from "@/db/schema";
import type { SafetyCategory } from "@/lib/ai/safety/types";
import { audit } from "@/lib/audit";
import { currentGrade } from "@/lib/auth/age";
import { assertAdmin } from "./access";
import {
  type EventSeverity,
  type ModelTier,
  REVIEW_NOTE_MAX,
  REVIEW_OUTCOMES,
  SEVERITIES,
  gradeBandLabel,
  isRulesAloneMarker,
  median,
  modelTierOf,
  monthRange,
  rulesAlone,
} from "./format";

const HOUR_MS = 60 * 60_000;

/**
 * A stable reference for a family ("H-1a2b3c4d") that staff can put in review notes, tickets and
 * chat instead of a name. It comes from the household id (or the student's own id if they have no
 * household), which is random, so the reference can't be turned back into anything. It stays the
 * same unless the student moves to another household (accepting a parent invite can do that).
 */
export function familyReference(householdOrUserId: string): string {
  return `H-${createHash("sha256").update(`family:${householdOrUserId}`).digest("hex").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Review targets
// ---------------------------------------------------------------------------

/**
 * How soon a person should review each kind of event. Students see crisis resources right away
 * (high and imminent); these targets are for the human follow-up. Low events aren't queued today.
 */
export const REVIEW_TARGET_HOURS: Record<EventSeverity, number> = { imminent: 24, high: 24, medium: 72, low: 168 };

export type ReviewTiming =
  | { state: "waiting"; dueAt: Date; overdue: boolean; waitedMs: number }
  | { state: "reviewed"; dueAt: Date; onTime: boolean; tookMs: number };

export function reviewDueAt(event: { severity: EventSeverity; createdAt: Date }): Date {
  return new Date(event.createdAt.getTime() + REVIEW_TARGET_HOURS[event.severity] * HOUR_MS);
}

/** Whether an event is waiting (and overdue) or was reviewed (and on time). */
export function reviewTiming(
  event: { severity: EventSeverity; createdAt: Date; reviewedAt: Date | null },
  now: Date = new Date(),
): ReviewTiming {
  const dueAt = reviewDueAt(event);
  if (!event.reviewedAt) {
    return { state: "waiting", dueAt, overdue: now.getTime() > dueAt.getTime(), waitedMs: now.getTime() - event.createdAt.getTime() };
  }
  return {
    state: "reviewed",
    dueAt,
    onTime: event.reviewedAt.getTime() <= dueAt.getTime(),
    tookMs: event.reviewedAt.getTime() - event.createdAt.getTime(),
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type QueueFilter = "unreviewed" | "reviewed" | "all";
export const QUEUE_FILTERS: readonly QueueFilter[] = ["unreviewed", "reviewed", "all"];
export const QUEUE_PAGE_SIZE = 100;

export function parseQueueFilter(value: unknown): QueueFilter {
  return QUEUE_FILTERS.includes(value as QueueFilter) ? (value as QueueFilter) : "unreviewed";
}

export type QueueRow = {
  id: string;
  severity: EventSeverity;
  category: SafetyCategory;
  /** The classifier tiers that flagged the message ("rules", "model"). */
  sources: string[];
  /** Whether the AI model rated the message, and if not, why. */
  modelTier: ModelTier;
  /** True when the model couldn't be used and keyword rules alone decided (read these with extra care). */
  rulesAlone: boolean;
  createdAt: Date;
  /** The student's grade band when the message was sent. Never the name. */
  gradeBand: string;
  reviewedAt: Date | null;
  reviewOutcome: SafetyReviewOutcome | null;
  timing: ReviewTiming;
};

const eventColumns = {
  id: safetyEvents.id,
  severity: safetyEvents.severity,
  category: safetyEvents.category,
  sources: safetyEvents.sources,
  createdAt: safetyEvents.createdAt,
  reviewedAt: safetyEvents.reviewedAt,
  reviewOutcome: safetyEvents.reviewOutcome,
  grade: users.grade,
  gradeSchoolYear: users.gradeSchoolYear,
};

type EventRow = {
  id: string;
  severity: EventSeverity;
  category: SafetyCategory;
  sources: string[];
  createdAt: Date;
  reviewedAt: Date | null;
  reviewOutcome: SafetyReviewOutcome | null;
  grade: number | null;
  gradeSchoolYear: number | null;
};

function toQueueRow(row: EventRow, now: Date): QueueRow {
  const modelTier = modelTierOf(row.sources);
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    sources: row.sources.filter((s) => !isRulesAloneMarker(s)),
    modelTier,
    rulesAlone: rulesAlone(modelTier),
    createdAt: row.createdAt,
    gradeBand: gradeBandLabel(currentGrade({ grade: row.grade, gradeSchoolYear: row.gradeSchoolYear }, row.createdAt)),
    reviewedAt: row.reviewedAt,
    reviewOutcome: row.reviewOutcome,
    timing: reviewTiming(row, now),
  };
}

const severityRank = sql`case ${safetyEvents.severity} when 'imminent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end`;

function filterCondition(filter: QueueFilter) {
  if (filter === "unreviewed") return isNull(safetyEvents.reviewedAt);
  if (filter === "reviewed") return isNotNull(safetyEvents.reviewedAt);
  return undefined;
}

/**
 * The review queue. Unreviewed events come first, most severe first and then oldest first (the
 * longest wait at each level); reviewed events follow, most recently reviewed first.
 */
export async function listSafetyQueue(
  db: Db,
  actorId: string,
  opts: { filter?: QueueFilter; now?: Date; limit?: number } = {},
): Promise<{ rows: QueueRow[]; total: number }> {
  await assertAdmin(db, actorId);
  const { filter = "unreviewed", now = new Date(), limit = QUEUE_PAGE_SIZE } = opts;
  const where = filterCondition(filter);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(eventColumns)
      .from(safetyEvents)
      .innerJoin(users, eq(users.id, safetyEvents.userId))
      .where(where)
      .orderBy(
        sql`${safetyEvents.reviewedAt} is null desc`,
        sql`case when ${safetyEvents.reviewedAt} is null then ${severityRank} end desc nulls last`,
        sql`case when ${safetyEvents.reviewedAt} is null then ${safetyEvents.createdAt} end asc`,
        desc(safetyEvents.reviewedAt),
        asc(safetyEvents.id),
      )
      .limit(limit),
    db.select({ total: count() }).from(safetyEvents).where(where),
  ]);
  return { rows: rows.map((r) => toQueueRow(r, now)), total };
}

export type QueueSummary = {
  waiting: number;
  overdue: number;
  bySeverity: Record<EventSeverity, number>;
  oldestWaitingAt: Date | null;
};

/** Counts of events waiting for review, for the queue header and the admin home page. */
export async function queueSummary(db: Db, actorId: string, now: Date = new Date()): Promise<QueueSummary> {
  await assertAdmin(db, actorId);
  const rows = await db
    .select({ severity: safetyEvents.severity, createdAt: safetyEvents.createdAt })
    .from(safetyEvents)
    .where(isNull(safetyEvents.reviewedAt));
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<EventSeverity, number>;
  let overdue = 0;
  let oldest: Date | null = null;
  for (const row of rows) {
    bySeverity[row.severity]++;
    if (now.getTime() > reviewDueAt(row).getTime()) overdue++;
    if (!oldest || row.createdAt < oldest) oldest = row.createdAt;
  }
  return { waiting: rows.length, overdue, bySeverity, oldestWaitingAt: oldest };
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------

export type SafetyEventDetail = QueueRow & {
  /** The flagged message as the student wrote it (first 1,000 characters). */
  excerpt: string;
  reviewNote: string | null;
  /** The staff member who reviewed it (null if not reviewed, or their account is gone). */
  reviewerName: string | null;
  /** The family's reference for notes and follow-up, never a name. See familyReference. */
  familyRef: string;
};

const reviewer = alias(users, "reviewer");

/** What a staff view of an event showed, for the audit log. Never anything personal. */
type Revealed = "excerpt" | "conversation" | "parent_contact";

function auditView(db: Db, actorId: string, subjectUserId: string, eventId: string, revealed: Revealed) {
  return audit(db, "admin.viewed_safety_event", { actorUserId: actorId, subjectUserId, metadata: { eventId, revealed } });
}

/**
 * Opens an event for staff: the student's own words (the excerpt) and any review note. It leaves
 * out who the student is (see revealSafetyContext), but the words and notes can identify them, so
 * every open is audited, with the event id only, before anything is returned.
 */
export async function openSafetyEvent(
  db: Db,
  actorId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<SafetyEventDetail | null> {
  await assertAdmin(db, actorId);
  if (!z.uuid().safeParse(eventId).success) return null;
  const [row] = await db
    .select({
      ...eventColumns,
      userId: safetyEvents.userId,
      householdId: users.householdId,
      excerpt: safetyEvents.excerpt,
      reviewNote: safetyEvents.reviewNote,
      reviewerName: reviewer.displayName,
    })
    .from(safetyEvents)
    .innerJoin(users, eq(users.id, safetyEvents.userId))
    .leftJoin(reviewer, eq(reviewer.id, safetyEvents.reviewedByUserId))
    .where(eq(safetyEvents.id, eventId));
  if (!row) return null;
  await auditView(db, actorId, row.userId, eventId, "excerpt");
  return {
    ...toQueueRow(row, now),
    excerpt: row.excerpt,
    reviewNote: row.reviewNote,
    reviewerName: row.reviewerName,
    familyRef: familyReference(row.householdId ?? row.userId),
  };
}

// ---------------------------------------------------------------------------
// Conversation context (audited)
// ---------------------------------------------------------------------------

/** Messages shown on each side of the flagged one. */
export const CONTEXT_WINDOW = 6;
// The event is written while the message is being handled, so the stored message is seconds away.
const MATCH_WINDOW_MS = 10 * 60_000;
/** Excerpts keep the first 1,000 characters; a shorter one is the whole message. */
const EXCERPT_MAX = 1000;

export type ContextMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "support" | "notice";
  content: string;
  createdAt: Date;
  /** The message this event was raised for (for a best guess, the likely one). */
  flagged: boolean;
};

/**
 * The conversation around the flagged message:
 * - linked: the event names its conversation, and the message was found in it.
 * - best_guess: the event isn't linked to a conversation (recorded on a path that doesn't link, or
 *   the student deleted the conversation), so this is a saved message with the same words, sent
 *   around the same time. It may not be the flagged one.
 * - not_saved: the message was sent while the counselor was locked, so it was never saved.
 * - not_found: no saved message matches (for example, the student deleted the conversation).
 */
export type ConversationContext =
  | {
      state: "linked" | "best_guess";
      concernFlagged: boolean;
      messages: ContextMessage[];
      /** Messages before and after the ones shown. */
      earlier: number;
      later: number;
    }
  | { state: "not_saved" }
  | { state: "not_found" };

export type SafetyContext = {
  student: {
    displayName: string;
    /** A parent created and controls this account (the child was under 13 at signup). */
    parentManaged: boolean;
    /** At least one parent or guardian account is linked. */
    linkedParent: boolean;
  };
  conversation: ConversationContext;
};

/**
 * Reveals who the student is and the conversation around a flagged message, for follow-up.
 * Every call is audited (the event id and what was shown, nothing personal) before anything is
 * returned.
 */
export async function revealSafetyContext(
  db: Db,
  actorId: string,
  eventId: string,
  opts: { window?: number } = {},
): Promise<SafetyContext | null> {
  await assertAdmin(db, actorId);
  if (!z.uuid().safeParse(eventId).success) return null;
  const window = opts.window ?? CONTEXT_WINDOW;
  const [event] = await db
    .select({
      userId: safetyEvents.userId,
      excerpt: safetyEvents.excerpt,
      createdAt: safetyEvents.createdAt,
      conversationId: safetyEvents.conversationId,
      sources: safetyEvents.sources,
      displayName: users.displayName,
      parentManaged: users.parentManaged,
    })
    .from(safetyEvents)
    .innerJoin(users, eq(users.id, safetyEvents.userId))
    .where(eq(safetyEvents.id, eventId));
  if (!event) return null;

  await auditView(db, actorId, event.userId, eventId, "conversation");

  const [[link], conversation] = await Promise.all([
    db
      .select({ parentUserId: parentStudentLinks.parentUserId })
      .from(parentStudentLinks)
      .where(eq(parentStudentLinks.studentUserId, event.userId))
      .limit(1),
    conversationAround(db, event, window),
  ]);
  return {
    student: { displayName: event.displayName, parentManaged: event.parentManaged, linkedParent: Boolean(link) },
    conversation,
  };
}

/**
 * Finds the student's stored message the event was raised for, and the messages around it. A
 * linked event is looked up only in its own conversation. An unlinked one is matched by its words
 * and time (the closest, if they sent the same words twice) and marked as a best guess.
 */
async function conversationAround(
  db: Db,
  event: { userId: string; excerpt: string; createdAt: Date; conversationId: string | null; sources: string[] },
  window: number,
): Promise<ConversationContext> {
  // Messages sent while the counselor is locked are screened but never saved, so a text match could
  // only find a different message.
  if (event.sources.includes("locked")) return { state: "not_saved" };

  // Only a full-length excerpt was cut short; a shorter one must match the whole message. A cut can
  // end in half an emoji, which the database stores as U+FFFD.
  const prefix = event.excerpt.endsWith("�") ? event.excerpt.slice(0, -1) : event.excerpt;
  const sameWords =
    event.excerpt.length >= EXCERPT_MAX ? sql`starts_with(${counselorMessages.content}, ${prefix})` : eq(counselorMessages.content, event.excerpt);
  const at = event.createdAt.toISOString();
  const [match] = await db
    .select({ conversationId: counselorMessages.conversationId, seq: counselorMessages.seq, concernFlagged: counselorConversations.concernFlagged })
    .from(counselorMessages)
    .innerJoin(counselorConversations, eq(counselorConversations.id, counselorMessages.conversationId))
    .where(
      and(
        eq(counselorConversations.userId, event.userId),
        event.conversationId ? eq(counselorMessages.conversationId, event.conversationId) : undefined,
        eq(counselorMessages.role, "user"),
        sameWords,
        gte(counselorMessages.createdAt, new Date(event.createdAt.getTime() - MATCH_WINDOW_MS)),
        lte(counselorMessages.createdAt, new Date(event.createdAt.getTime() + MATCH_WINDOW_MS)),
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${counselorMessages.createdAt} - ${at}::timestamptz)))`, asc(counselorMessages.seq))
    .limit(1);
  if (!match) return { state: "not_found" };

  const columns = {
    id: counselorMessages.id,
    seq: counselorMessages.seq,
    role: counselorMessages.role,
    kind: counselorMessages.kind,
    content: counselorMessages.content,
    createdAt: counselorMessages.createdAt,
  };
  const inConversation = eq(counselorMessages.conversationId, match.conversationId);
  const [before, after, [counts]] = await Promise.all([
    db.select(columns).from(counselorMessages).where(and(inConversation, lt(counselorMessages.seq, match.seq))).orderBy(desc(counselorMessages.seq)).limit(window),
    db.select(columns).from(counselorMessages).where(and(inConversation, gte(counselorMessages.seq, match.seq))).orderBy(asc(counselorMessages.seq)).limit(window + 1),
    db
      .select({
        before: sql<number>`count(*) filter (where ${counselorMessages.seq} < ${match.seq})`.mapWith(Number),
        after: sql<number>`count(*) filter (where ${counselorMessages.seq} > ${match.seq})`.mapWith(Number),
      })
      .from(counselorMessages)
      .where(inConversation),
  ]);
  const messages = [...before.reverse(), ...after].map(({ seq, ...m }) => ({ ...m, flagged: seq === match.seq }));
  return {
    state: event.conversationId ? "linked" : "best_guess",
    concernFlagged: match.concernFlagged,
    messages,
    earlier: counts.before - before.length,
    later: counts.after - Math.max(0, after.length - 1),
  };
}

// ---------------------------------------------------------------------------
// Parent contact (audited)
// ---------------------------------------------------------------------------

export type ParentContact = {
  /** The family's reference, to use in notes instead of names. */
  familyRef: string;
  /** A parent created and controls this account (the child was under 13 at signup). */
  parentManaged: boolean;
  /** Each linked parent's email, earliest link first. Empty when no parent is linked. */
  parents: { email: string | null }[];
};

const parentUser = alias(users, "parent");

/**
 * Reveals how to reach the student's linked parents, for follow-up under the parent-notification
 * policy. Every call is audited (the event id and what was shown, never the email) before anything
 * is returned.
 */
export async function revealParentContact(db: Db, actorId: string, eventId: string): Promise<ParentContact | null> {
  await assertAdmin(db, actorId);
  if (!z.uuid().safeParse(eventId).success) return null;
  const [event] = await db
    .select({ userId: safetyEvents.userId, householdId: users.householdId, parentManaged: users.parentManaged })
    .from(safetyEvents)
    .innerJoin(users, eq(users.id, safetyEvents.userId))
    .where(eq(safetyEvents.id, eventId));
  if (!event) return null;

  await auditView(db, actorId, event.userId, eventId, "parent_contact");

  const parents = await db
    .select({ email: parentUser.email })
    .from(parentStudentLinks)
    .innerJoin(parentUser, eq(parentUser.id, parentStudentLinks.parentUserId))
    .where(eq(parentStudentLinks.studentUserId, event.userId))
    .orderBy(asc(parentStudentLinks.createdAt), asc(parentUser.email));
  return { familyRef: familyReference(event.householdId ?? event.userId), parentManaged: event.parentManaged, parents };
}

// ---------------------------------------------------------------------------
// Reviewing
// ---------------------------------------------------------------------------

export const ReviewSchema = z
  .object({
    outcome: z.enum(REVIEW_OUTCOMES as [SafetyReviewOutcome, ...SafetyReviewOutcome[]], { error: "Choose what you did." }),
    note: z
      .string()
      .trim()
      .max(REVIEW_NOTE_MAX, `Keep the note under ${REVIEW_NOTE_MAX.toLocaleString("en-US")} characters.`),
  })
  .refine((v) => v.outcome === "no_action" || v.note.length > 0, {
    path: ["note"],
    message: "Say what you did, so the next person knows.",
  });

export type ReviewInput = z.infer<typeof ReviewSchema>;
export type ReviewResult = { ok: true } | { ok: false; error: "not_found" | "already_reviewed" };

/**
 * Records a staff review. The first review stands: a second reviewer (or a double submit) gets
 * "already_reviewed" instead of overwriting it. The audit entry holds the outcome and what the
 * monthly numbers need (severity and times, never the note or the message), so a review still
 * counts after the family deletes their account and the event goes with it.
 */
export async function reviewSafetyEvent(
  db: Db,
  actorId: string,
  eventId: string,
  input: ReviewInput,
  now: Date = new Date(),
): Promise<ReviewResult> {
  await assertAdmin(db, actorId);
  if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "not_found" };
  const { outcome, note } = ReviewSchema.parse(input);
  const [updated] = await db
    .update(safetyEvents)
    .set({ reviewedAt: now, reviewedByUserId: actorId, reviewOutcome: outcome, reviewNote: note || null })
    .where(and(eq(safetyEvents.id, eventId), isNull(safetyEvents.reviewedAt)))
    .returning({ userId: safetyEvents.userId, severity: safetyEvents.severity, createdAt: safetyEvents.createdAt });
  if (!updated) {
    const [exists] = await db.select({ id: safetyEvents.id }).from(safetyEvents).where(eq(safetyEvents.id, eventId));
    return { ok: false, error: exists ? "already_reviewed" : "not_found" };
  }
  await audit(db, "safety.reviewed", {
    actorUserId: actorId,
    subjectUserId: updated.userId,
    metadata: { eventId, outcome, severity: updated.severity, flaggedAt: updated.createdAt.toISOString(), reviewedAt: now.toISOString() },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Monthly stats (the "handled within the target time" success metric)
// ---------------------------------------------------------------------------

export type SafetyMonthStats = {
  /** Events flagged during the month. */
  total: number;
  bySeverity: Record<EventSeverity, number>;
  reviewed: number;
  medianReviewMs: number | null;
  reviewedOnTime: number;
  reviewedLate: number;
  /** Still waiting, not yet past the target. */
  waiting: number;
  /** Still waiting and past the target. */
  overdue: number;
  /** Reviewed events (counted above) whose family has since deleted their account. */
  fromDeletedAccounts: number;
};

type StatsRow = { severity: EventSeverity; createdAt: Date; reviewedAt: Date | null };

/**
 * Reviewed events flagged in [start, end) whose family deleted their account (the event went with
 * it), rebuilt from the review's audit entry. Reviews saved before the entry held these fields
 * can't be counted.
 */
async function deletedReviewedEvents(db: Db, start: Date, end: Date): Promise<StatsRow[]> {
  const field = (name: string) => sql<string | null>`${auditLog.metadata}->>${name}`;
  const flaggedAt = sql`(${field("flaggedAt")})::timestamptz`;
  const rows = await db
    .select({ severity: field("severity"), flaggedAt: field("flaggedAt"), reviewedAt: field("reviewedAt") })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "safety.reviewed"),
        sql`${flaggedAt} >= ${start.toISOString()}::timestamptz`,
        sql`${flaggedAt} < ${end.toISOString()}::timestamptz`,
        sql`not exists (select 1 from ${safetyEvents} where ${safetyEvents.id}::text = ${field("eventId")})`,
      ),
    );
  return rows.flatMap((r) =>
    SEVERITIES.includes(r.severity as EventSeverity) && r.flaggedAt && r.reviewedAt
      ? [{ severity: r.severity as EventSeverity, createdAt: new Date(r.flaggedAt), reviewedAt: new Date(r.reviewedAt) }]
      : [],
  );
}

export async function safetyMonthStats(db: Db, actorId: string, month: string, now: Date = new Date()): Promise<SafetyMonthStats> {
  await assertAdmin(db, actorId);
  const { start, end } = monthRange(month);
  const [live, deleted] = await Promise.all([
    db
      .select({ severity: safetyEvents.severity, createdAt: safetyEvents.createdAt, reviewedAt: safetyEvents.reviewedAt })
      .from(safetyEvents)
      .where(and(gte(safetyEvents.createdAt, start), lt(safetyEvents.createdAt, end))),
    deletedReviewedEvents(db, start, end),
  ]);
  const rows: StatsRow[] = [...live, ...deleted];
  const stats: SafetyMonthStats = {
    total: rows.length,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<EventSeverity, number>,
    reviewed: 0,
    medianReviewMs: null,
    reviewedOnTime: 0,
    reviewedLate: 0,
    waiting: 0,
    overdue: 0,
    fromDeletedAccounts: deleted.length,
  };
  const took: number[] = [];
  for (const row of rows) {
    stats.bySeverity[row.severity]++;
    const timing = reviewTiming(row, now);
    if (timing.state === "reviewed") {
      stats.reviewed++;
      took.push(timing.tookMs);
      if (timing.onTime) stats.reviewedOnTime++;
      else stats.reviewedLate++;
    } else if (timing.overdue) stats.overdue++;
    else stats.waiting++;
  }
  stats.medianReviewMs = median(took);
  return stats;
}
