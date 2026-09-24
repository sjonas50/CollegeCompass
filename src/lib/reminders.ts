import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { parentStudentLinks, reminderSends, studentMilestones, users, weeklySteps } from "@/db/schema";
import { currentGrade, isUnder13 } from "./auth/age";
import { hashToken } from "./auth/tokens";
import type { Email } from "./email";
import { MILESTONES } from "./roadmap/milestones";
import { weekStartOf } from "./steps";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

export type Reminder = { userId: string; weekStart: string; recipientKey: string; email: Email };

/**
 * Who gets a student's reminder. Parents do for children under 13 and for any student without an
 * email of their own (e.g. accounts a parent created, even after the child turns 13). The dashboard
 * and parent page use this same rule to describe where reminders go.
 */
export function reminderGoesToParent(student: { email: string | null; birthDate: string | null }, now = new Date()) {
  return !student.email || (student.birthDate ? isUnder13(student.birthDate, now) : false);
}

type StudentRow = {
  id: string;
  email: string | null;
  displayName: string;
  birthDate: string | null;
  grade: number | null;
  gradeSchoolYear: number | null;
};

function group<T extends { userId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r]);
  return map;
}

/**
 * Builds reminder emails for the week containing `now`. The cron runs Monday morning, so each
 * email looks back at last week (what they finished, what's still open) and ahead at what's timely
 * on their roadmap. Emails never include counselor chats, assessment answers, or anything sensitive.
 */
export async function buildWeeklyReminders(db: Db, appUrl: string, now = new Date()): Promise<Reminder[]> {
  const weekStart = weekStartOf(now);
  const lastWeek = weekStartOf(new Date(now.getTime() - 7 * DAY_MS));
  const month = now.getUTCMonth() + 1;
  const reminders: Reminder[] = [];

  let afterId: string | null = null;
  while (true) {
    const students: StudentRow[] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        birthDate: users.birthDate,
        grade: users.grade,
        gradeSchoolYear: users.gradeSchoolYear,
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
      .limit(BATCH);
    if (!students.length) break;
    afterId = students[students.length - 1].id;
    const ids = students.map((s) => s.id);

    const [steps, progress, parentLinks] = await Promise.all([
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
    ]);
    const stepsBy = group(steps);
    const progressBy = group(progress);
    const parentsBy = group(parentLinks);

    for (const s of students) {
      const grade = currentGrade(s, now);
      if (grade === null || grade > 12) continue;

      const handled = new Set((progressBy.get(s.id) ?? []).map((p) => p.milestoneId));
      const timely = MILESTONES.filter((m) => m.grade === grade && m.months.includes(month) && !handled.has(m.id)).slice(0, 3);
      const mine = stepsBy.get(s.id) ?? [];
      const finished = mine.filter((st) => st.weekStart === lastWeek && st.status === "done");
      const carryOver = mine.filter((st) => st.weekStart === lastWeek && st.status === "open");
      const thisWeek = mine.filter((st) => st.weekStart === weekStart);
      if (!finished.length && !carryOver.length && !thisWeek.length && !timely.length) continue;

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
    if (students.length < BATCH) break;
  }
  return reminders;
}

/**
 * Claims a reminder before sending. Returns false if it was already sent (or claimed by a
 * concurrent run), so re-running the cron job never double-sends.
 */
export async function claimReminder(db: Db, r: Pick<Reminder, "userId" | "weekStart" | "recipientKey">) {
  const rows = await db
    .insert(reminderSends)
    .values({ userId: r.userId, weekStart: r.weekStart, recipient: r.recipientKey })
    .onConflictDoNothing()
    .returning({ userId: reminderSends.userId });
  return rows.length > 0;
}

/** Releases a claim after a failed send so the next run retries this recipient only. */
export async function releaseReminder(db: Db, r: Pick<Reminder, "userId" | "weekStart" | "recipientKey">) {
  await db
    .delete(reminderSends)
    .where(and(eq(reminderSends.userId, r.userId), eq(reminderSends.weekStart, r.weekStart), eq(reminderSends.recipient, r.recipientKey)));
}

export async function setRemindersEnabled(db: Db, userId: string, enabled: boolean) {
  await db.update(users).set({ remindersEnabled: enabled }).where(and(eq(users.id, userId), eq(users.role, "student")));
}
