import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { counselorConversations, counselorMessages } from "@/db/schema";

export const HISTORY_LIMIT = 30;

export async function createConversation(db: Db, userId: string, title: string) {
  const [conv] = await db
    .insert(counselorConversations)
    .values({ userId, title: title.slice(0, 80) })
    .returning();
  return conv;
}

export async function getOwnedConversation(db: Db, userId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(counselorConversations)
    .where(and(eq(counselorConversations.id, conversationId), eq(counselorConversations.userId, userId)));
  return conv ?? null;
}

export async function listConversations(db: Db, userId: string, limit = 20) {
  return db
    .select({ id: counselorConversations.id, title: counselorConversations.title, updatedAt: counselorConversations.updatedAt })
    .from(counselorConversations)
    .where(eq(counselorConversations.userId, userId))
    .orderBy(desc(counselorConversations.updatedAt))
    .limit(limit);
}

export async function listMessages(db: Db, conversationId: string) {
  return db
    .select({
      id: counselorMessages.id,
      role: counselorMessages.role,
      kind: counselorMessages.kind,
      content: counselorMessages.content,
      createdAt: counselorMessages.createdAt,
    })
    .from(counselorMessages)
    .where(eq(counselorMessages.conversationId, conversationId))
    .orderBy(asc(counselorMessages.seq));
}

export async function appendMessage(
  db: Db,
  conversationId: string,
  message: { role: "user" | "assistant"; kind?: "chat" | "support" | "notice"; content: string },
) {
  const [row] = await db
    .insert(counselorMessages)
    .values({ conversationId, role: message.role, kind: message.kind ?? "chat", content: message.content })
    .returning({ id: counselorMessages.id });
  await db
    .update(counselorConversations)
    .set({ updatedAt: sql`now()` })
    .where(eq(counselorConversations.id, conversationId));
  return row.id;
}

export async function flagConversation(db: Db, conversationId: string) {
  await db.update(counselorConversations).set({ concernFlagged: true }).where(eq(counselorConversations.id, conversationId));
}

export async function deleteConversation(db: Db, userId: string, conversationId: string) {
  const deleted = await db
    .delete(counselorConversations)
    .where(and(eq(counselorConversations.id, conversationId), eq(counselorConversations.userId, userId)))
    .returning({ id: counselorConversations.id });
  return deleted.length > 0;
}
