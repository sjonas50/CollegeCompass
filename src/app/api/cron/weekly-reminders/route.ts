import { getDb } from "@/db";
import { env } from "@/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { type ReminderRunResult, sendWeeklyReminders } from "@/lib/reminders";

export const maxDuration = 300;
/**
 * Stop starting sends with time to spare before `maxDuration`: one send can take over 30 seconds
 * when Resend is slow (three tries of up to 10 seconds each, plus the waits between them). The
 * next run picks up the rest.
 */
const BUDGET_MS = 240_000;

/**
 * Monday reminders: each student (or a younger student's parent) gets a look back and ahead.
 * Runs Mondays at 13:00 UTC (vercel.json), once, because Vercel's Hobby plan allows one run a day
 * per cron. A run sends what it can within its budget. On Vercel Pro, schedule it hourly
 * ("0 13-18 * * 1") so later runs finish a week too big for one run and retry failed sends; claims
 * and idempotency keys make every re-run safe.
 */
export async function GET(req: Request) {
  const deadline = Date.now() + BUDGET_MS;
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await sendWeeklyReminders(db, { appUrl: env().APP_URL, send: sendEmail, deadline });
  logRun(result);
  return Response.json(result);
}

/**
 * One line per run, with counts only, so the logs (or a log drain) show how each run went. A
 * warning when something is left to do: a re-run sends only what didn't go out.
 */
function logRun(result: ReminderRunResult) {
  const { sent, skipped, failed, uncertain, more } = result;
  const line = `[reminders] run sent=${sent} skipped=${skipped} failed=${failed} uncertain=${uncertain} more=${more}`;
  if (failed > 0 || uncertain > 0 || more) console.warn(`${line}; run it again to send the rest`);
  else console.info(line);
}
