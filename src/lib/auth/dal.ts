import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { readSessionToken } from "./cookies";
import { type SessionUser, validateSession } from "./sessions";

/**
 * The signed-in user for this request, checked against the database (not just the cookie).
 * Every page, action and route handler that touches user data goes through here.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  const session = await validateSession(await getDb(), token);
  return session?.user ?? null;
});

/**
 * The signed-in user, or a redirect to sign in. With `roles`, other roles are sent to their own home
 * page. Without `roles`, any family account passes but staff admins don't: they have their own pages
 * under /admin and should never end up in a student's or parent's pages by accident.
 */
export async function requireUser(roles?: SessionUser["role"][]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowed = roles ? roles.includes(user.role) : user.role !== "admin";
  if (!allowed) redirect(homePathFor(user));
  return user;
}

export function homePathFor(user: Pick<SessionUser, "role">) {
  if (user.role === "parent") return "/parent";
  if (user.role === "admin") return "/admin";
  return "/dashboard";
}
