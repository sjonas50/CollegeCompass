import "server-only";
import { getDb } from "@/db";
import type { AidLanguage } from "@/lib/aid-guide";
import { getCurrentUser } from "@/lib/auth/dal";
import { viewerStates } from "@/lib/schools/student";

/**
 * The states whose programs the guide shows first for whoever is reading: a signed-in student's
 * own state, or a parent's children's states. Only the English guide has state tags, and visitors
 * who aren't signed in see the guide as written.
 */
export async function guideStatesForViewer(lang: AidLanguage): Promise<string[]> {
  if (lang !== "en") return [];
  const user = await getCurrentUser();
  if (!user) return [];
  if (user.role === "student") return user.homeState ? [user.homeState] : [];
  if (user.role !== "parent") return [];
  return viewerStates(await getDb(), user);
}
