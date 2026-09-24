import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as z from "zod";
import type { Db } from "@/db";
import {
  type SafetyReviewOutcome,
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
import { type EventSeverity, REVIEW_NOTE_MAX, REVIEW_OUTCOMES, SEVERITIES, gradeBandLabel, median, monthRange } from "./format";

const HOUR_MS = 60 * 60_000;

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
  /** The classifier tiers that flagged the message ("rules", "model", "rate_limited"). */
  sources: string[];
  /** True when the AI model tier couldn't run and keyword rules alone decided. */
  modelUnavailable: boolean;
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
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    sources: row.sources.filter((s) => s !== "model_unavailable"),
    modelUnavailable: row.sources.includes("model_unavailable"),
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
};

const reviewer = alias(users, "reviewer");

/** An event's details for staff. Leaves out who the student is; see revealSafetyContext. */
export async function getSafetyEvent(
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
      excerpt: safetyEvents.excerpt,
      reviewNote: safetyEvents.reviewNote,
      reviewerName: reviewer.displayName,
    })
    .from(safetyEvents)
    .innerJoin(users, eq(users.id, safetyEvents.userId))
    .leftJoin(reviewer, eq(reviewer.id, safetyEvents.reviewedByUserId))
    .where(eq(safetyEvents.id, eventId));
  if (!row) return null;
  return { ...toQueueRow(row, now), excerpt: row.excerpt, reviewNote: row.reviewNote, reviewerName: row.reviewerName };
}

// ---------------------------------------------------------------------------
// Conversation context (audited)
// ---------------------------------------------------------------------------

/** Messages shown on each side of the flagged one. */
export const CONTEXT_WINDOW = 6;
// The event is written while the message is being handled, so the stored message is seconds away.
const MATCH_WINDOW_MS = 10 * 60_000;

export type ContextMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "support" | "notice";
  content: string;
  createdAt: Date;
  /** The message this event was raised for. */
  flagged: boolean;
};

export type SafetyContext = {
  student: {
    displayName: string;
    /** A parent created and controls this account (the child was under 13 at signup). */
    parentManaged: boolean;
    /** At least one parent or guardian account is linked. */
    linkedParent: boolean;
  };
  /** Null when the message isn't in a saved conversation (for example, the student deleted it). */
  conversation: {
    concernFlagged: boolean;
    messages: ContextMessage[];
    /** Messages before and after the ones shown. */
    earlier: number;
    later: number;
  } | null;
};

/**
 * Reveals who the student is and the conversation around a flagged message, for follow-up.
 * Every call is audited (with the event id only) before anything is returned.
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
      displayName: users.displayName,
      parentManaged: users.parentManaged,
    })
    .from(safetyEvents)
    .innerJoin(users, eq(users.id, safetyEvents.userId))
    .where(eq(safetyEvents.id, eventId));
  if (!event) return null;

  await audit(db, "admin.viewed_safety_event", { actorUserId: actorId, subjectUserId: event.userId, metadata: { eventId } });

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
 * Finds the student's stored message that the event's excerpt was cut from (the closest in time,
 * if they sent the same words twice), and the messages around it.
 */
async function conversationAround(
  db: Db,
  event: { userId: string; excerpt: string; createdAt: Date; conversationId: string | null },
  window: number,
): Promise<SafetyContext["conversation"]> {
  // A 1,000-character excerpt can end in half an emoji, which the database stores as U+FFFD.
  const prefix = event.excerpt.endsWith("�") ? event.excerpt.slice(0, -1) : event.excerpt;
  const at = event.createdAt.toISOString();
  const [match] = await db
    .select({ conversationId: counselorMessages.conversationId, seq: counselorMessages.seq, concernFlagged: counselorConversations.concernFlagged })
    .from(counselorMessages)
    .innerJoin(counselorConversations, eq(counselorConversations.id, counselorMessages.conversationId))
    .where(
      and(
        eq(counselorConversations.userId, event.userId),
        // Events recorded since the link existed name their conversation; older ones are matched by text and time.
        event.conversationId ? eq(counselorMessages.conversationId, event.conversationId) : undefined,
        eq(counselorMessages.role, "user"),
        sql`starts_with(${counselorMessages.content}, ${prefix})`,
        gte(counselorMessages.createdAt, new Date(event.createdAt.getTime() - MATCH_WINDOW_MS)),
        lte(counselorMessages.createdAt, new Date(event.createdAt.getTime() + MATCH_WINDOW_MS)),
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${counselorMessages.createdAt} - ${at}::timestamptz)))`, asc(counselorMessages.seq))
    .limit(1);
  if (!match) return null;

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
    concernFlagged: match.concernFlagged,
    messages,
    earlier: counts.before - before.length,
    later: counts.after - Math.max(0, after.length - 1),
  };
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
 * "already_reviewed" instead of overwriting it. The audit entry holds only the outcome.
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
    .returning({ userId: safetyEvents.userId });
  if (!updated) {
    const [exists] = await db.select({ id: safetyEvents.id }).from(safetyEvents).where(eq(safetyEvents.id, eventId));
    return { ok: false, error: exists ? "already_reviewed" : "not_found" };
  }
  await audit(db, "safety.reviewed", { actorUserId: actorId, subjectUserId: updated.userId, metadata: { outcome } });
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
};

export async function safetyMonthStats(db: Db, actorId: string, month: string, now: Date = new Date()): Promise<SafetyMonthStats> {
  await assertAdmin(db, actorId);
  const { start, end } = monthRange(month);
  const rows = await db
    .select({ severity: safetyEvents.severity, createdAt: safetyEvents.createdAt, reviewedAt: safetyEvents.reviewedAt })
    .from(safetyEvents)
    .where(and(gte(safetyEvents.createdAt, start), lt(safetyEvents.createdAt, end)));
  const stats: SafetyMonthStats = {
    total: rows.length,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<EventSeverity, number>,
    reviewed: 0,
    medianReviewMs: null,
    reviewedOnTime: 0,
    reviewedLate: 0,
    waiting: 0,
    overdue: 0,
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
