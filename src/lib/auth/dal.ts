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

export async function requireUser(roles?: SessionUser["role"][]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homePathFor(user));
  return user;
}

export function homePathFor(user: Pick<SessionUser, "role">) {
  return user.role === "parent" ? "/parent" : "/dashboard";
}
