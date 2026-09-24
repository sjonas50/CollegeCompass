import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";
import { currentGrade } from "./age";
import { generateToken, hashToken } from "./tokens";

const DAY_MS = 24 * 60 * 60 * 1000;
// Short-ish because many students share school Chromebooks; active users are renewed.
export const SESSION_TTL_MS = 14 * DAY_MS;
const RENEW_WHEN_REMAINING_MS = 7 * DAY_MS;
// Staff can read minors' flagged messages, so their sessions end after a working day and are
// never extended.
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionUser = Pick<
  typeof users.$inferSelect,
  "id" | "role" | "displayName" | "username" | "householdId" | "parentManaged"
> & {
  /** Current grade (advanced each August); above 12 means graduated. Null for adults. */
  grade: number | null;
};

export async function createSession(db: Db, userId: string, now = new Date()) {
  const token = generateToken();
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  const expiresAt = new Date(now.getTime() + (user?.role === "admin" ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS));
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the session's user, extending the session if it's close to expiring. */
export async function validateSession(db: Db, token: string, now = new Date()) {
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        role: users.role,
        displayName: users.displayName,
        username: users.username,
        grade: users.grade,
        gradeSchoolYear: users.gradeSchoolYear,
        householdId: users.householdId,
        parentManaged: users.parentManaged,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id));

  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  let expiresAt = row.expiresAt;
  if (row.user.role !== "admin" && expiresAt.getTime() - now.getTime() < RENEW_WHEN_REMAINING_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }
  const { gradeSchoolYear, ...user } = row.user;
  return { user: { ...user, grade: currentGrade({ grade: user.grade, gradeSchoolYear }, now) } as SessionUser, expiresAt };
}

export async function invalidateSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateAllSessions(db: Db, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
