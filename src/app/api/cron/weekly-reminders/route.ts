import { getDb } from "@/db";
import { env } from "@/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { sendWeeklyReminders } from "@/lib/reminders";

export const maxDuration = 300;
/** Stop starting sends with time to spare before `maxDuration`; the next run picks up the rest. */
const BUDGET_MS = 270_000;

/**
 * Monday reminders: each student (or a younger student's parent) gets a look back and ahead.
 * Runs Mondays at 13:00 UTC (vercel.json), once, because Vercel's Hobby plan allows one run a day
 * per cron. A run sends what it can within its budget. On Vercel Pro, schedule it hourly
 * ("0 13-18 * * 1") so later runs finish a week too big for one run and retry failed sends; claims
 * make every re-run safe.
 */
export async function GET(req: Request) {
  const deadline = Date.now() + BUDGET_MS;
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await sendWeeklyReminders(db, { appUrl: env().APP_URL, send: sendEmail, deadline });
  if (result.more) console.info("[reminders] time budget reached; the next scheduled run continues this week");
  return Response.json(result);
}
