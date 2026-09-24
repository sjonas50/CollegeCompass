import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { UNLOCK_PATH } from "./describe";
import type { HouseholdAccess } from "./entitlement";
import { getUserAccess } from "./service";

/**
 * The signed-in user's household access, for pages that show a locked state themselves (like the
 * counselor) or locked cards (like the dashboard). Pass the user from requireUser().
 */
export async function accessFor(user: { id: string }, now = new Date()): Promise<HouseholdAccess> {
  return getUserAccess(await getDb(), user.id, now);
}

/**
 * The gate for pages and server actions that need full access. Call it right after requireUser():
 *
 *   const student = await requireUser(["student"]);
 *   await requireFullAccess(student);
 *
 * Without full access it redirects to /account/access (what's still free, and how to unlock the
 * rest). Route handlers should use accessFor() and answer with a status code instead.
 */
export async function requireFullAccess(user: { id: string }, now = new Date()): Promise<HouseholdAccess> {
  const access = await accessFor(user, now);
  if (!access.full) redirect(UNLOCK_PATH);
  return access;
}
