import { and, asc, count, eq, getTableColumns, gte, inArray, lte, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import * as z from "zod";
import type { Db } from "@/db";
import { collegeList, colleges, users } from "@/db/schema";
import { scrubPii } from "../ai/privacy";
import { type AidComparison, compareAidOffer, hasAidOffer } from "./aid";
import { addDays, daysBetween, usToday } from "./dates";
import type { AidField } from "./labels";
import { checklistProgress, isSubmitted } from "./timeline";
import { CustomEntrySchema, type FieldErrors, UnitIdSchema, entryPatchSchema, issueErrors } from "./validation";

// A student's college list: colleges from the Scorecard plus custom colleges and programs
// (apprenticeships, training programs). Every function is scoped to `userId`; entry ids that come
// from forms are only ever used together with it.

/** Room for a full list of reach, target and likely schools plus programs; stops scripted floods. */
export const MAX_LIST_ENTRIES = 30;

// Every column except the owner's id, which callers already know and never need to see.
const { userId: _userId, ...entryColumns } = getTableColumns(collegeList);

export type ListEntry = Omit<typeof collegeList.$inferSelect, "userId">;

export type ListFailure =
  | { ok: false; error: "not_found" | "college_not_found" | "limit" }
  | { ok: false; error: "invalid"; errors: FieldErrors };

const isUuid = (v: string) => z.uuid().safeParse(v).success;

const invalid = (error: z.ZodError): ListFailure => ({ ok: false, error: "invalid", errors: issueErrors(error) });

/** The student's list, in the order entries were added. */
export async function listEntries(db: Db, userId: string): Promise<ListEntry[]> {
  return db
    .select(entryColumns)
    .from(collegeList)
    .where(eq(collegeList.userId, userId))
    .orderBy(asc(collegeList.createdAt), asc(collegeList.id));
}

/**
 * College Scorecard context for a listed college. `found` is false when the college is no longer
 * in the reference data. `avgNetPrice` is null when the Scorecard has no figure (not reported or
 * hidden for privacy), and can be below zero when aid averaged more than the cost.
 */
export type ScorecardContext = { found: boolean; avgNetPrice: number | null; city: string | null; state: string | null };

export type ListEntryWithScorecard = ListEntry & { scorecard: ScorecardContext | null };

/** The list with Scorecard context for each college (null for custom entries). */
export async function listEntriesWithScorecard(db: Db, userId: string): Promise<ListEntryWithScorecard[]> {
  const rows = await db
    .select({
      ...entryColumns,
      collegeUnitId: colleges.unitId,
      avgNetPrice: colleges.avgNetPrice,
      city: colleges.city,
      state: colleges.state,
    })
    .from(collegeList)
    .leftJoin(colleges, eq(colleges.unitId, collegeList.unitId))
    .where(eq(collegeList.userId, userId))
    .orderBy(asc(collegeList.createdAt), asc(collegeList.id));
  return rows.map(({ collegeUnitId, avgNetPrice, city, state, ...entry }) => ({
    ...entry,
    scorecard: entry.unitId === null ? null : { found: collegeUnitId !== null, avgNetPrice, city, state },
  }));
}

/** One entry, only if it belongs to `userId`. */
export async function getEntry(db: Db, userId: string, entryId: string): Promise<ListEntry | null> {
  if (!isUuid(entryId)) return null;
  const [row] = await db
    .select(entryColumns)
    .from(collegeList)
    .where(and(eq(collegeList.id, entryId), eq(collegeList.userId, userId)));
  return row ?? null;
}

/** Whether a college is on the student's list, and whether the list has room for more. */
export async function listStatusFor(
  db: Db,
  userId: string,
  unitId: number,
): Promise<{ listed: boolean; entryId: string | null; count: number; full: boolean }> {
  const validId = UnitIdSchema.safeParse(unitId);
  const [[existing], [{ n }]] = await Promise.all([
    validId.success
      ? db
          .select({ id: collegeList.id })
          .from(collegeList)
          .where(and(eq(collegeList.userId, userId), eq(collegeList.unitId, validId.data)))
      : Promise.resolve([]),
    db.select({ n: count() }).from(collegeList).where(eq(collegeList.userId, userId)),
  ]);
  return { listed: Boolean(existing), entryId: existing?.id ?? null, count: n, full: n >= MAX_LIST_ENTRIES };
}

/**
 * Adds a Scorecard college, saving its name as it is today. Adding one that's already listed is
 * fine: it returns the saved entry with `alreadyListed: true`.
 */
export async function addCollege(
  db: Db,
  userId: string,
  unitId: number,
): Promise<{ ok: true; value: ListEntry; alreadyListed: boolean } | ListFailure> {
  const parsed = UnitIdSchema.safeParse(unitId);
  if (!parsed.success) return { ok: false, error: "college_not_found" };
  const [college] = await db.select({ name: colleges.name }).from(colleges).where(eq(colleges.unitId, parsed.data));
  if (!college) return { ok: false, error: "college_not_found" };

  return db.transaction(async (tx) => {
    // Locks the student's row so two quick adds can't slip past the limit together.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) return { ok: false as const, error: "not_found" as const };
    const [existing] = await tx
      .select(entryColumns)
      .from(collegeList)
      .where(and(eq(collegeList.userId, userId), eq(collegeList.unitId, parsed.data)));
    if (existing) return { ok: true as const, value: existing, alreadyListed: true };
    const [{ n }] = await tx.select({ n: count() }).from(collegeList).where(eq(collegeList.userId, userId));
    if (n >= MAX_LIST_ENTRIES) return { ok: false as const, error: "limit" as const };
    const [row] = await tx
      .insert(collegeList)
      .values({ userId, unitId: parsed.data, name: college.name, kind: "college" })
      .returning(entryColumns);
    return { ok: true as const, value: row, alreadyListed: false };
  });
}

/** Adds a college or program that isn't in the Scorecard, like an apprenticeship. */
export async function addCustom(
  db: Db,
  userId: string,
  input: unknown,
): Promise<{ ok: true; value: ListEntry } | ListFailure> {
  const parsed = CustomEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) return { ok: false as const, error: "not_found" as const };
    const [{ n }] = await tx.select({ n: count() }).from(collegeList).where(eq(collegeList.userId, userId));
    if (n >= MAX_LIST_ENTRIES) return { ok: false as const, error: "limit" as const };
    const [row] = await tx
      .insert(collegeList)
      .values({ userId, unitId: null, name: parsed.data.name, kind: parsed.data.kind })
      .returning(entryColumns);
    return { ok: true as const, value: row };
  });
}

/**
 * Updates an entry the student owns. `patch` is checked with `entryPatchSchema` (see there for
 * what each field accepts); fields it leaves out stay as they are.
 */
export async function updateEntry(
  db: Db,
  userId: string,
  entryId: string,
  patch: unknown,
  now = new Date(),
): Promise<{ ok: true; value: ListEntry } | ListFailure> {
  const current = await getEntry(db, userId, entryId);
  if (!current) return { ok: false, error: "not_found" };
  const parsed = entryPatchSchema(usToday(now), current.deadline).safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);

  const p = parsed.data;
  const set: PgUpdateSetSource<typeof collegeList> = { updatedAt: now };
  if (p.status !== undefined) set.status = p.status;
  if (p.deadlineType !== undefined) set.deadlineType = p.deadlineType;
  if (p.deadline !== undefined) set.deadline = p.deadline;
  if (p.notes !== undefined) set.notes = p.notes;
  if (p.aidOffer !== undefined) set.aidOffer = p.aidOffer;
  // Merged in the database, so two quick checkbox saves can't undo each other.
  if (p.checklist !== undefined) set.checklist = sql`${collegeList.checklist} || ${JSON.stringify(p.checklist)}::jsonb`;

  const [row] = await db
    .update(collegeList)
    .set(set)
    .where(and(eq(collegeList.id, entryId), eq(collegeList.userId, userId)))
    .returning(entryColumns);
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
}

/** Removes an entry the student owns. Returns its name for the "removed" message. */
export async function removeEntry(
  db: Db,
  userId: string,
  entryId: string,
): Promise<{ ok: true; value: { name: string } } | ListFailure> {
  if (!isUuid(entryId)) return { ok: false, error: "not_found" };
  const [row] = await db
    .delete(collegeList)
    .where(and(eq(collegeList.id, entryId), eq(collegeList.userId, userId)))
    .returning({ name: collegeList.name });
  return row ? { ok: true, value: row } : { ok: false, error: "not_found" };
}

// ---------------------------------------------------------------------------
// Aid offer comparison
// ---------------------------------------------------------------------------

export type AidOfferRow = {
  id: string;
  name: string;
  kind: ListEntry["kind"];
  unitId: number | null;
  comparison: AidComparison;
  /** The College Scorecard's average net price, for context. Null for custom entries. */
  scorecard: ScorecardContext | null;
};

/** Entries with an aid offer, with the math done and Scorecard context attached. */
export async function listAidOffers(db: Db, userId: string): Promise<AidOfferRow[]> {
  const rows = await listEntriesWithScorecard(db, userId);
  return rows
    .filter((r) => hasAidOffer(r.aidOffer))
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      unitId: r.unitId,
      comparison: compareAidOffer(r.aidOffer),
      scorecard: r.scorecard,
    }));
}

/** Ids of the offers with the lowest net price, when at least two offers have one to compare. */
export function lowestNetPriceIds(rows: readonly Pick<AidOfferRow, "id" | "comparison">[]): Set<string> {
  const priced = rows.filter((r) => r.comparison.netPrice !== null);
  if (priced.length < 2) return new Set();
  const lowest = Math.min(...priced.map((r) => r.comparison.netPrice as number));
  return new Set(priced.filter((r) => r.comparison.netPrice === lowest).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Summaries for the AI counselor. JSON-able, with no notes, row ids or account details.
// ---------------------------------------------------------------------------

export type AidSummary = Pick<
  AidComparison,
  | "costOfAttendance"
  | "grants"
  | "scholarships"
  | "giftAid"
  | "netPrice"
  | "giftExceedsCost"
  | "workStudy"
  | "federalLoans"
  | "parentLoans"
  | "otherLoans"
  | "loans"
  | "paidNow"
  | "hasParentLoans"
  | "hasOtherLoans"
> & { notEntered: AidField[] };

export type ListSummaryEntry = {
  name: string;
  kind: ListEntry["kind"];
  unitId: number | null;
  status: ListEntry["status"];
  submitted: boolean;
  deadlineType: ListEntry["deadlineType"];
  deadline: string | null;
  checklist: { done: number; total: number };
  aid: AidSummary | null;
};

export type UpcomingDeadline = {
  name: string;
  kind: ListEntry["kind"];
  unitId: number | null;
  status: ListEntry["status"];
  deadlineType: ListEntry["deadlineType"];
  deadline: string;
  /** 0 means today. */
  daysLeft: number;
};

async function knownNames(db: Db, userId: string): Promise<string[]> {
  const [user] = await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, userId));
  return [user?.displayName, user?.username].filter((n): n is string => Boolean(n));
}

/** Custom names are typed by the student, so they're scrubbed; Scorecard names are public data. */
function summaryName(entry: Pick<ListEntry, "name" | "unitId">, names: string[]): string {
  return entry.unitId === null ? scrubPii(entry.name, names) : entry.name;
}

function aidSummary(entry: Pick<ListEntry, "aidOffer">): AidSummary | null {
  if (!hasAidOffer(entry.aidOffer)) return null;
  const { warnings: _warnings, missing, ...numbers } = compareAidOffer(entry.aidOffer);
  return { ...numbers, notEntered: missing };
}

/** The whole list, for the counselor. */
export async function listSummary(db: Db, userId: string): Promise<ListSummaryEntry[]> {
  const [entries, names] = await Promise.all([listEntries(db, userId), knownNames(db, userId)]);
  return entries.map((e) => ({
    name: summaryName(e, names),
    kind: e.kind,
    unitId: e.unitId,
    status: e.status,
    submitted: isSubmitted(e),
    deadlineType: e.deadlineType,
    deadline: e.deadline,
    checklist: checklistProgress(e.checklist),
    aid: aidSummary(e),
  }));
}

/** Deadlines from today through `days` from now whose applications aren't marked as sent, soonest first. */
export async function upcomingDeadlines(db: Db, userId: string, now = new Date(), days = 14): Promise<UpcomingDeadline[]> {
  const window = Math.max(0, Math.min(366, Math.floor(Number.isFinite(days) ? days : 14)));
  const today = usToday(now);
  const last = addDays(today, window);
  const [entries, names] = await Promise.all([listEntries(db, userId), knownNames(db, userId)]);
  return entries
    .filter((e): e is ListEntry & { deadline: string } => e.deadline !== null && e.deadline >= today && e.deadline <= last)
    .filter((e) => !isSubmitted(e))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.name.localeCompare(b.name))
    .map((e) => ({
      name: summaryName(e, names),
      kind: e.kind,
      unitId: e.unitId,
      status: e.status,
      deadlineType: e.deadlineType,
      deadline: e.deadline,
      daysLeft: daysBetween(today, e.deadline),
    }));
}

/**
 * Upcoming unsent deadlines for many students in one query, for the weekly reminder emails. Names
 * are the student's own list entries (no AI provider involved), so they're used as entered.
 */
export async function upcomingDeadlinesFor(
  db: Db,
  userIds: string[],
  now = new Date(),
  days = 14,
): Promise<Map<string, { name: string; deadline: string; daysLeft: number }[]>> {
  const out = new Map<string, { name: string; deadline: string; daysLeft: number }[]>();
  if (!userIds.length) return out;
  const today = usToday(now);
  const rows = await db
    .select()
    .from(collegeList)
    .where(and(inArray(collegeList.userId, userIds), gte(collegeList.deadline, today), lte(collegeList.deadline, addDays(today, days))))
    .orderBy(asc(collegeList.deadline), asc(collegeList.name));
  for (const row of rows) {
    if (row.deadline === null || isSubmitted(row)) continue;
    const list = out.get(row.userId) ?? [];
    list.push({ name: row.name, deadline: row.deadline, daysLeft: daysBetween(today, row.deadline) });
    out.set(row.userId, list);
  }
  return out;
}
