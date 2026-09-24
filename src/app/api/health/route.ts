import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** How long the database gets to answer before the app counts as down. */
const DATABASE_TIMEOUT_MS = 5_000;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Uptime check for monitors: `{ok:true}` once the database answers a trivial query. A failure
 * returns only `{ok:false}` with 503; the reason (error name only) goes to the server log.
 * Public on purpose: it reveals nothing and does no work beyond `select 1`.
 */
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      const error = new Error("database check timed out");
      error.name = "TimeoutError";
      timer = setTimeout(() => reject(error), DATABASE_TIMEOUT_MS);
    });
    const ping = async () => {
      const db = await getDb();
      await db.execute(sql`select 1`);
    };
    await Promise.race([ping(), timeout]);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("[health] database check failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
