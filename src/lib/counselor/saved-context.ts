import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { counselorConversations } from "@/db/schema";

/**
 * Drops the student context saved on each of a student's conversations, so the next message
 * rebuilds it. Call it whenever something the context summarizes changes (assessment results,
 * grade, north stars, memory notes), and always when the student asks to erase something.
 */
export async function forgetSavedContexts(db: Db, userId: string) {
  await db
    .update(counselorConversations)
    .set({ context: null, contextBuiltAt: null })
    .where(eq(counselorConversations.userId, userId));
}
