import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { northStarGoals, occupations } from "@/db/schema";

/** Students keep one or two "north star" careers at a time, framed as "for now". */
export const MAX_NORTH_STARS = 2;

export async function listNorthStars(db: Db, userId: string) {
  return db
    .select({ occupationCode: northStarGoals.occupationCode, title: northStarGoals.title, createdAt: northStarGoals.createdAt })
    .from(northStarGoals)
    .where(eq(northStarGoals.userId, userId))
    .orderBy(asc(northStarGoals.createdAt));
}

export async function addNorthStar(db: Db, userId: string, occupationCode: string) {
  const [occ] = await db.select({ title: occupations.title }).from(occupations).where(eq(occupations.code, occupationCode));
  if (!occ) return { ok: false as const, error: "not_found" as const };
  const [{ n }] = await db.select({ n: count() }).from(northStarGoals).where(eq(northStarGoals.userId, userId));
  if (n >= MAX_NORTH_STARS) return { ok: false as const, error: "limit" as const };
  await db.insert(northStarGoals).values({ userId, occupationCode, title: occ.title }).onConflictDoNothing();
  return { ok: true as const };
}

export async function removeNorthStar(db: Db, userId: string, occupationCode: string) {
  await db
    .delete(northStarGoals)
    .where(and(eq(northStarGoals.userId, userId), eq(northStarGoals.occupationCode, occupationCode)));
}
