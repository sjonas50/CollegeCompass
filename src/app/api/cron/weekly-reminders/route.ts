import { getDb } from "@/db";
import { env } from "@/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { buildWeeklyReminders, claimReminder, releaseReminder } from "@/lib/reminders";

export const maxDuration = 300;

/** Monday mornings: each student (or a younger student's parent) gets a look back and ahead. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const reminders = await buildWeeklyReminders(db, env().APP_URL);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of reminders) {
    if (!(await claimReminder(db, r))) {
      skipped++;
      continue;
    }
    try {
      await sendEmail(r.email);
      sent++;
    } catch (error) {
      failed++;
      await releaseReminder(db, r);
      console.error("[reminders] send failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return Response.json({ sent, skipped, failed });
}
