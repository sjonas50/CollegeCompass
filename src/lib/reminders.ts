import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { parentStudentLinks, reminderSends, studentMilestones, users, weeklySteps } from "@/db/schema";
import { currentGrade, isUnder13 } from "./auth/age";
import { weekStartOf } from "./counselor/prompt";
import type { Email } from "./email";
import { MILESTONES } from "./roadmap/milestones";

export type Reminder = { userId: string; weekStart: string; email: Email };

/**
 * Builds this week's reminder emails. Students 13+ get their own; for children under 13 the
 * reminder goes to their linked parent(s). Emails never include counselor chats, assessment
 * answers, or anything sensitive: just this week's steps and what's timely on the roadmap.
 */
export async function buildWeeklyReminders(db: Db, appUrl: string, now = new Date()): Promise<Reminder[]> {
  const weekStart = weekStartOf(now);
  const month = now.getUTCMonth() + 1;
  const students = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      birthDate: users.birthDate,
      grade: users.grade,
      gradeSchoolYear: users.gradeSchoolYear,
    })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.remindersEnabled, true), isNotNull(users.grade)));
  if (!students.length) return [];
  const ids = students.map((s) => s.id);

  const [sent, steps, progress, parentLinks] = await Promise.all([
    db.select({ userId: reminderSends.userId }).from(reminderSends).where(and(eq(reminderSends.weekStart, weekStart), inArray(reminderSends.userId, ids))),
    db.select({ userId: weeklySteps.userId, text: weeklySteps.text, status: weeklySteps.status }).from(weeklySteps).where(and(eq(weeklySteps.weekStart, weekStart), inArray(weeklySteps.userId, ids))),
    db.select({ userId: studentMilestones.userId, milestoneId: studentMilestones.milestoneId }).from(studentMilestones).where(inArray(studentMilestones.userId, ids)),
    db
      .select({ studentId: parentStudentLinks.studentUserId, parentEmail: users.email })
      .from(parentStudentLinks)
      .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
      .where(inArray(parentStudentLinks.studentUserId, ids)),
  ]);
  const alreadySent = new Set(sent.map((s) => s.userId));

  const reminders: Reminder[] = [];
  for (const s of students) {
    if (alreadySent.has(s.id)) continue;
    const grade = currentGrade(s, now);
    if (grade === null || grade > 12) continue;

    const handled = new Set(progress.filter((p) => p.userId === s.id).map((p) => p.milestoneId));
    const timely = MILESTONES.filter((m) => m.grade === grade && m.months.includes(month) && !handled.has(m.id)).slice(0, 3);
    const open = steps.filter((st) => st.userId === s.id && st.status === "open");
    const done = steps.filter((st) => st.userId === s.id && st.status === "done");
    if (!open.length && !timely.length) continue;

    const child = s.birthDate ? isUnder13(s.birthDate, now) : false;
    const recipients = child
      ? parentLinks.filter((l) => l.studentId === s.id && l.parentEmail).map((l) => l.parentEmail!)
      : s.email
        ? [s.email]
        : [];
    if (!recipients.length) continue;

    const lines = [
      child ? `Hi! Here's what ${s.displayName} is working on this week in College Compass.` : `Hi ${s.displayName}! Here's your week in College Compass.`,
      "",
    ];
    if (open.length || done.length) {
      lines.push(child ? "Their steps this week:" : "Your steps this week:");
      for (const st of [...done, ...open]) lines.push(`- ${st.status === "done" ? "[done] " : ""}${st.text}`);
      lines.push("");
    }
    if (timely.length) {
      lines.push(`Timely for ${child ? "them" : "you"} this month:`);
      for (const m of timely) lines.push(`- ${m.title}`);
      lines.push("");
    }
    lines.push(`One small step at a time is how big goals happen. Open College Compass: ${new URL("/dashboard", appUrl)}`);
    lines.push("");
    lines.push(`To stop these weekly emails, turn off reminders on ${child ? `${s.displayName}'s` : "your"} dashboard.`);

    for (const to of recipients) {
      reminders.push({
        userId: s.id,
        weekStart,
        email: { to, subject: child ? `${s.displayName}'s week in College Compass` : `Your week in College Compass`, text: lines.join("\n") },
      });
    }
  }
  return reminders;
}

export async function markReminderSent(db: Db, userId: string, weekStart: string) {
  await db.insert(reminderSends).values({ userId, weekStart }).onConflictDoNothing();
}

export async function setRemindersEnabled(db: Db, userId: string, enabled: boolean) {
  await db.update(users).set({ remindersEnabled: enabled }).where(and(eq(users.id, userId), eq(users.role, "student")));
}
