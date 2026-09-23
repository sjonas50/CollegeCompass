import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window limiter stored in Postgres, so it holds across serverless instances.
 * Returns false when `key` has exceeded `limit` hits within `windowMs`.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        // Start a new window if the old one has lapsed; otherwise count this hit.
        count: sql`case when ${rateLimits.windowStart} <= ${windowStart.toISOString()}::timestamptz then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${windowStart.toISOString()}::timestamptz then ${now.toISOString()}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= limit;
}
