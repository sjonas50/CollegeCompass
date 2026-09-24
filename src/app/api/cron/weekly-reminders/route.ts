import { getDb } from "@/db";
import { env } from "@/env";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { sendWeeklyReminders } from "@/lib/reminders";

export const maxDuration = 300;
/** Stop starting sends with time to spare before `maxDuration`; the next hourly run picks up the rest. */
const BUDGET_MS = 270_000;

/**
 * Monday reminders: each student (or a younger student's parent) gets a look back and ahead.
 * Runs hourly 13:00–18:00 UTC on Mondays (vercel.json). The first run sends what it can within its
 * budget; later runs finish the week and retry failed sends. Claims make every re-run safe.
 */
export async function GET(req: Request) {
  const deadline = Date.now() + BUDGET_MS;
  if (!isAuthorizedCron(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const result = await sendWeeklyReminders(db, { appUrl: env().APP_URL, send: sendEmail, deadline });
  if (result.more) console.info("[reminders] time budget reached; the next scheduled run continues this week");
  return Response.json(result);
}
