import { and, asc, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { parentStudentLinks, reminderSends, studentMilestones, users, weeklySteps } from "@/db/schema";
import { formatDate, relativeDays } from "./applications/dates";
import { householdsWithFullAccess } from "./access/service";
import { upcomingDeadlinesFor } from "./applications/service";
import { MAX_GRADE, currentGrade, isUnder13 } from "./auth/age";
import { hashToken } from "./auth/tokens";
import type { Email } from "./email";
import { MILESTONES } from "./roadmap/milestones";
import { weekStartOf } from "./steps";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const SEND_CONCURRENCY = 5;
/** An unsent claim this old belongs to a run that died mid-send (a run lasts at most 300 s). */
const STALE_CLAIM_MS = 15 * 60 * 1000;
/** Sends recorded before per-recipient claims have no recipient and cover the student's whole week. */
const LEGACY_RECIPIENT = "";

export type Reminder = { userId: string; weekStart: string; recipientKey: string; email: Email };
type ReminderKey = Pick<Reminder, "userId" | "weekStart" | "recipientKey">;

/**
 * Who gets a student's reminder. Parents do for children under 13 and for any student without an
 * email of their own (e.g. accounts a parent created, even after the child turns 13). The dashboard
 * and parent page use this same rule to describe where reminders go.
 */
export function reminderGoesToParent(student: { email: string | null; birthDate: string | null }, now = new Date()) {
  return !student.email || (student.birthDate ? isUnder13(student.birthDate, now) : false);
}

export type ReminderSetting = { kind: "self" | "parent"; enabled: boolean } | { kind: "none" };

/**
 * What the student's dashboard says about reminders: they go to the student, or to a parent (who
 * controls them), or nowhere, when the student has no email and no linked parent has one (e.g. a
 * parent-created teen whose parent deleted their own account).
 */
export async function reminderSettingFor(db: Db, studentId: string, now = new Date()): Promise<ReminderSetting> {
  const [student] = await db
    .select({ email: users.email, birthDate: users.birthDate, enabled: users.remindersEnabled })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student) return { kind: "none" };
  if (!reminderGoesToParent(student, now)) return { kind: "self", enabled: student.enabled };
  const [parent] = await db
    .select({ id: users.id })
    .from(parentStudentLinks)
    .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
    .where(and(eq(parentStudentLinks.studentUserId, studentId), isNotNull(users.email)))
    .limit(1);
  return parent ? { kind: "parent", enabled: student.enabled } : { kind: "none" };
}

/**
 * A student's own reminder switch. Returns false without changing anything when reminders go to a
 * parent: those are the parent's to change on their page, whatever the child's form posts.
 */
export async function setOwnRemindersEnabled(db: Db, studentId: string, enabled: boolean, now = new Date()) {
  const [student] = await db
    .select({ email: users.email, birthDate: users.birthDate })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student || reminderGoesToParent(student, now)) return false;
  await setRemindersEnabled(db, studentId, enabled);
  return true;
}

type StudentRow = {
  id: string;
  email: string | null;
  displayName: string;
  birthDate: string | null;
  grade: number | null;
  gradeSchoolYear: number | null;
  householdId: string | null;
};

function group<T extends { userId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r]);
  return map;
}

/** Every reminder for the week containing `now`, built in memory. See `weeklyReminderBatches`. */
export async function buildWeeklyReminders(db: Db, appUrl: string, now = new Date()): Promise<Reminder[]> {
  const all: Reminder[] = [];
  for await (const batch of weeklyReminderBatches(db, appUrl, now)) all.push(...batch);
  return all;
}

/**
 * Builds reminder emails for the week containing `now`, one batch of students at a time (a batch
 * may be empty). The cron runs Monday, so each email looks back at last week (what they finished,
 * what's still open) and ahead at what's timely on their roadmap. Emails never include counselor
 * chats, assessment answers, or anything sensitive.
 */
export async function* weeklyReminderBatches(
  db: Db,
  appUrl: string,
  now = new Date(),
  batchSize = BATCH,
): AsyncGenerator<Reminder[]> {
  const weekStart = weekStartOf(now);
  const lastWeek = weekStartOf(new Date(now.getTime() - 7 * DAY_MS));
  const month = now.getUTCMonth() + 1;

  let afterId: string | null = null;
  while (true) {
    const reminders: Reminder[] = [];
    const students: StudentRow[] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        birthDate: users.birthDate,
        grade: users.grade,
        gradeSchoolYear: users.gradeSchoolYear,
        householdId: users.householdId,
      })
      .from(users)
      .where(
        and(
          eq(users.role, "student"),
          eq(users.remindersEnabled, true),
          isNotNull(users.grade),
          afterId ? gt(users.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(users.id))
      .limit(batchSize);
    if (!students.length) break;
    afterId = students[students.length - 1].id;
    const ids = students.map((s) => s.id);

    const [steps, progress, parentLinks, deadlinesBy, withAccess] = await Promise.all([
      db
        .select({ userId: weeklySteps.userId, weekStart: weeklySteps.weekStart, text: weeklySteps.text, status: weeklySteps.status })
        .from(weeklySteps)
        .where(and(inArray(weeklySteps.userId, ids), inArray(weeklySteps.weekStart, [lastWeek, weekStart]))),
      db
        .select({ userId: studentMilestones.userId, milestoneId: studentMilestones.milestoneId })
        .from(studentMilestones)
        .where(inArray(studentMilestones.userId, ids)),
      db
        .select({ userId: parentStudentLinks.studentUserId, parentEmail: users.email })
        .from(parentStudentLinks)
        .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
        .where(inArray(parentStudentLinks.studentUserId, ids)),
      upcomingDeadlinesFor(db, ids, now, 14),
      householdsWithFullAccess(db, students.flatMap((s) => (s.householdId ? [s.householdId] : [])), now),
    ]);
    const stepsBy = group(steps);
    const progressBy = group(progress);
    const parentsBy = group(parentLinks);

    for (const s of students) {
      // The roadmap, weekly steps and college list are locked without the family's plan, trial or
      // free access, so there's nothing for the email to point to.
      if (!s.householdId || !withAccess.has(s.householdId)) continue;
      const grade = currentGrade(s, now);
      if (grade === null) continue;

      // After high school the weekly roundup stops, except for deadlines on the college list:
      // graduates keep the full application tools (a gap-year applicant, say), so they still hear
      // about applications due soon.
      const graduated = grade > MAX_GRADE;
      const handled = new Set((progressBy.get(s.id) ?? []).map((p) => p.milestoneId));
      const timely = graduated
        ? []
        : MILESTONES.filter((m) => m.grade === grade && m.months.includes(month) && !handled.has(m.id)).slice(0, 3);
      const mine = graduated ? [] : (stepsBy.get(s.id) ?? []);
      const finished = mine.filter((st) => st.weekStart === lastWeek && st.status === "done");
      const carryOver = mine.filter((st) => st.weekStart === lastWeek && st.status === "open");
      const thisWeek = mine.filter((st) => st.weekStart === weekStart);
      const deadlines = deadlinesBy.get(s.id) ?? [];
      if (!finished.length && !carryOver.length && !thisWeek.length && !timely.length && !deadlines.length) continue;

      const toParent = reminderGoesToParent(s, now);
      const recipients = toParent
        ? [...new Set((parentsBy.get(s.id) ?? []).map((l) => l.parentEmail).filter((e): e is string => Boolean(e)))]
        : [s.email!];
      if (!recipients.length) continue;

      const they = toParent ? s.displayName : "you";
      const lines = [
        toParent ? `Hi! Here's ${s.displayName}'s week in College Compass.` : `Hi ${s.displayName}! Here's your week in College Compass.`,
        "",
      ];
      if (finished.length) {
        lines.push(`Last week ${they} finished:`);
        for (const st of finished) lines.push(`- ${st.text}`);
        lines.push("");
      }
      if (carryOver.length) {
        lines.push(`Still open from last week${toParent ? "" : " (no pressure, pick it up if it still fits)"}:`);
        for (const st of carryOver) lines.push(`- ${st.text}`);
        lines.push("");
      }
      if (thisWeek.length) {
        lines.push(toParent ? "Their steps this week:" : "Your steps this week:");
        for (const st of thisWeek) lines.push(`- ${st.status === "done" ? "[done] " : ""}${st.text}`);
        lines.push("");
      }
      if (deadlines.length) {
        lines.push(toParent ? "Deadlines on their college list in the next two weeks:" : "Deadlines on your college list in the next two weeks:");
        for (const d of deadlines) lines.push(`- ${d.name}: ${formatDate(d.deadline)} (${relativeDays(d.daysLeft)})`);
        lines.push("");
      }
      if (timely.length) {
        lines.push(`Timely for ${toParent ? "them" : "you"} this month:`);
        for (const m of timely) lines.push(`- ${m.title}`);
        lines.push("");
      }
      lines.push(`One small step at a time is how big goals happen. Open College Compass: ${new URL("/dashboard", appUrl)}`);
      lines.push("");
      lines.push(
        toParent
          ? `To stop these emails, open your parent page, choose Settings under ${s.displayName}, and turn off weekly reminders.`
          : "To stop these weekly emails, turn off reminders in Settings on your dashboard.",
      );

      for (const to of recipients) {
        reminders.push({
          userId: s.id,
          weekStart,
          recipientKey: hashToken(to.toLowerCase()),
          email: {
            to,
            subject: toParent ? `${s.displayName}'s week in College Compass` : "Your week in College Compass",
            text: lines.join("\n"),
          },
        });
      }
    }
    yield reminders;
    if (students.length < batchSize) break;
  }
}

const sendKey = (r: ReminderKey) =>
  and(eq(reminderSends.userId, r.userId), eq(reminderSends.weekStart, r.weekStart), eq(reminderSends.recipient, r.recipientKey));

/**
 * Claims a reminder before sending: a row with no send time yet. Returns false when it was already
 * sent (including a legacy send for the student's whole week) or another run claimed it less than
 * 15 minutes ago, so re-running the cron job never double-sends. An older unsent claim belongs to
 * a run that died mid-send, so it is taken over and retried.
 */
export async function claimReminder(db: Db, r: ReminderKey, now = new Date()) {
  const [legacy] = await db
    .select({ userId: reminderSends.userId })
    .from(reminderSends)
    .where(sendKey({ ...r, recipientKey: LEGACY_RECIPIENT }))
    .limit(1);
  if (legacy) return false;
  const rows = await db
    .insert(reminderSends)
    .values({ userId: r.userId, weekStart: r.weekStart, recipient: r.recipientKey, claimedAt: now })
    .onConflictDoUpdate({
      target: [reminderSends.userId, reminderSends.weekStart, reminderSends.recipient],
      set: { claimedAt: now },
      setWhere: and(isNull(reminderSends.sentAt), lt(reminderSends.claimedAt, new Date(now.getTime() - STALE_CLAIM_MS))),
    })
    .returning({ userId: reminderSends.userId });
  return rows.length > 0;
}

/** Records that a claimed reminder went out, so no later run sends it again. */
export async function markReminderSent(db: Db, r: ReminderKey, now = new Date()) {
  await db.update(reminderSends).set({ sentAt: now }).where(sendKey(r));
}

/** Releases a claim after a failed send so the next run retries this recipient only. Never undoes a send. */
export async function releaseReminder(db: Db, r: ReminderKey) {
  await db.delete(reminderSends).where(and(sendKey(r), isNull(reminderSends.sentAt)));
}

export type ReminderRunResult = { sent: number; skipped: number; failed: number; more: boolean };

export type ReminderRunOptions = {
  appUrl: string;
  send: (email: Email) => Promise<void>;
  /** When the run starts, which picks the week. Defaults to the current time. */
  now?: Date;
  /** No new send starts at or after this time (ms since epoch); the run then reports `more`. */
  deadline?: number;
  /** The current time in ms. Defaults to `now` plus the real time elapsed since the run started. */
  clock?: () => number;
  batchSize?: number;
  concurrency?: number;
};

/**
 * Sends this week's reminders one batch of students at a time, a few sends at once, until done or
 * the deadline passes (`more: true`). Every recipient is claimed before sending and marked sent
 * after, so a later run the same week sends exactly what is left: never claimed, released after a
 * failure, or claimed by a run that died. A failure for one recipient, whether the email provider
 * or the database, is counted and never stops the run.
 */
export async function sendWeeklyReminders(db: Db, opts: ReminderRunOptions): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const clock = opts.clock ?? (() => now.getTime() + (Date.now() - startedAt));
  const outOfTime = () => opts.deadline !== undefined && clock() >= opts.deadline;
  const result: ReminderRunResult = { sent: 0, skipped: 0, failed: 0, more: false };

  for await (const batch of weeklyReminderBatches(db, opts.appUrl, now, opts.batchSize)) {
    if (outOfTime()) {
      result.more = true;
      break;
    }
    const todo = await unsent(db, batch, clock());
    result.skipped += batch.length - todo.length;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !outOfTime()) result[await deliver(db, todo[next++], opts.send, clock)]++;
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? SEND_CONCURRENCY) }, worker));
    if (next < todo.length) {
      result.more = true;
      break;
    }
  }
  return result;
}

/** Drops a batch's reminders that were already sent or freshly claimed, so re-runs cost one query per batch. */
async function unsent(db: Db, batch: Reminder[], nowMs: number) {
  if (!batch.length) return batch;
  const rows = await db
    .select({ userId: reminderSends.userId, recipient: reminderSends.recipient, sentAt: reminderSends.sentAt, claimedAt: reminderSends.claimedAt })
    .from(reminderSends)
    .where(and(eq(reminderSends.weekStart, batch[0].weekStart), inArray(reminderSends.userId, [...new Set(batch.map((r) => r.userId))])))
    .catch((error: unknown) => logFailure("lookup", error));
  if (!rows) return batch; // Each claim still refuses anything already sent.
  const legacy = new Set(rows.filter((s) => s.recipient === LEGACY_RECIPIENT).map((s) => s.userId));
  const taken = new Set(
    rows.filter((s) => s.sentAt || s.claimedAt.getTime() > nowMs - STALE_CLAIM_MS).map((s) => `${s.userId}:${s.recipient}`),
  );
  return batch.filter((r) => !legacy.has(r.userId) && !taken.has(`${r.userId}:${r.recipientKey}`));
}

/** Claim, send, then mark sent (or release after a failed send), each guarded on its own. */
async function deliver(db: Db, r: Reminder, send: ReminderRunOptions["send"], clock: () => number) {
  try {
    if (!(await claimReminder(db, r, new Date(clock())))) return "skipped" as const;
  } catch (error) {
    logFailure("claim", error);
    return "failed" as const;
  }
  try {
    await send(r.email);
  } catch (error) {
    logFailure("send", error);
    // If the release fails too, the claim goes stale and a later run retries it.
    await releaseReminder(db, r).catch((releaseError: unknown) => logFailure("release", releaseError));
    return "failed" as const;
  }
  // The email went out, so it is never released. Retry the mark once: a claim left unmarked goes
  // stale and would be sent again by a later run.
  const sentAt = new Date(clock());
  await markReminderSent(db, r, sentAt)
    .catch(() => markReminderSent(db, r, sentAt))
    .catch((error: unknown) => logFailure("mark", error));
  return "sent" as const;
}

/** Logs the error's name only: messages can carry addresses. */
function logFailure(step: string, error: unknown) {
  console.error(`[reminders] ${step} failed`, error instanceof Error ? error.name : "unknown");
}

export async function setRemindersEnabled(db: Db, userId: string, enabled: boolean) {
  await db.update(users).set({ remindersEnabled: enabled }).where(and(eq(users.id, userId), eq(users.role, "student")));
}
