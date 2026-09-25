import { eq, sql } from "drizzle-orm";
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

/**
 * Gives back one hit that consumeRateLimit counted, for an attempt that turned out not to count
 * (a correct password, an email that definitely wasn't sent). Never goes below zero, and leaves the
 * window where it is.
 */
export async function refundRateLimit(db: Db, key: string): Promise<void> {
  await db
    .update(rateLimits)
    .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
    .where(eq(rateLimits.key, key));
}
