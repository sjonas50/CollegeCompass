import { and, eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";
import { audit } from "../audit";
import { consumeRateLimit } from "../rate-limit";
import { hashPassword, verifyPassword } from "./password";

// A teen who owns their account changes its password. It matters most for a teen whose parent set
// the account up at 13 or older: that parent chose the password, and nothing else changes it. The
// new password signs out every other device.

/** The same rules as a new account's password (see the signup schemas in src/lib/accounts.ts). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** The change-password fields: the current password, and the new one typed twice. */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your password."),
    newPassword: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The two new passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Choose a password that's different from the one you have now.",
    path: ["newPassword"],
  });

/** Password tries (right or wrong) for changing a password, per account. */
export const CHANGE_PASSWORD_LIMIT = { count: 5, windowMs: 15 * 60_000 };

export type PasswordChangeError =
  | "not_found"
  /** A child a parent set up under 13: that parent manages the account. */
  | "parent_managed"
  | "rate_limited"
  | "wrong_password"
  | "same_password"
  | "invalid_password";

/** A checked change, ready to save with savePasswordChange. */
export type PreparedPasswordChange = { userId: string; checkedHash: string; newHash: string };

/**
 * Checks a student's current password and hashes the new one. Only students who own their account
 * can (not parentManaged), and tries are limited like deleting an account. Nothing is saved yet.
 */
export async function preparePasswordChange(
  db: Db,
  studentId: string,
  input: { current: string; next: string },
  now = new Date(),
): Promise<{ ok: true; change: PreparedPasswordChange } | { ok: false; error: PasswordChangeError }> {
  if (input.next.length < PASSWORD_MIN || input.next.length > PASSWORD_MAX) return { ok: false, error: "invalid_password" };
  if (input.next === input.current) return { ok: false, error: "same_password" };
  if (!z.uuid().safeParse(studentId).success) return { ok: false, error: "not_found" };
  const [student] = await db
    .select({ passwordHash: users.passwordHash, parentManaged: users.parentManaged })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student) return { ok: false, error: "not_found" };
  if (student.parentManaged) return { ok: false, error: "parent_managed" };
  const { count, windowMs } = CHANGE_PASSWORD_LIMIT;
  if (!(await consumeRateLimit(db, `password-change:${studentId}`, count, windowMs, now))) return { ok: false, error: "rate_limited" };
  if (!(await verifyPassword(student.passwordHash, input.current))) return { ok: false, error: "wrong_password" };
  return { ok: true, change: { userId: studentId, checkedHash: student.passwordHash, newHash: await hashPassword(input.next) } };
}

/**
 * Saves a prepared change (in the caller's transaction, if any) and signs the student out
 * everywhere: the caller starts a new session for the device they're on. Returns false, saving
 * nothing, if the password changed since it was checked.
 */
export async function savePasswordChange(db: Db, change: PreparedPasswordChange): Promise<boolean> {
  const saved = await db
    .update(users)
    .set({ passwordHash: change.newHash })
    .where(and(eq(users.id, change.userId), eq(users.passwordHash, change.checkedHash)))
    .returning({ id: users.id });
  if (!saved.length) return false;
  await db.delete(sessions).where(eq(sessions.userId, change.userId));
  await audit(db, "account.password_changed", { actorUserId: change.userId });
  return true;
}

/**
 * A student who owns their account changes its password (see preparePasswordChange). Every session
 * ends, this device's too: the caller starts a new one.
 */
export async function changeOwnPassword(
  db: Db,
  studentId: string,
  input: { current: string; next: string },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: PasswordChangeError }> {
  const prepared = await preparePasswordChange(db, studentId, input, now);
  if (!prepared.ok) return prepared;
  const saved = await db.transaction((tx) => savePasswordChange(tx, prepared.change));
  return saved ? { ok: true } : { ok: false, error: "wrong_password" };
}
