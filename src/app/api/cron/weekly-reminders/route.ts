import { getDb } from "@/db";
import { env } from "@/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { buildWeeklyReminders, markReminderSent } from "@/lib/reminders";

export const maxDuration = 300;

/** Weekly: emails each student (or a younger student's parent) their steps and timely milestones. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const reminders = await buildWeeklyReminders(db, env().APP_URL);
  let sent = 0;
  let failed = 0;
  const done = new Set<string>();
  for (const r of reminders) {
    try {
      await sendEmail(r.email);
      sent++;
      if (!done.has(r.userId)) {
        await markReminderSent(db, r.userId, r.weekStart);
        done.add(r.userId);
      }
    } catch (error) {
      failed++;
      console.error("[reminders] send failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return Response.json({ sent, failed });
}
