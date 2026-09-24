import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { counselorConversations, counselorMemory } from "@/db/schema";
import { getAnthropic } from "../ai/client";
import { modelFor, supportsEffort } from "../ai/models";
import { scrubPii } from "../ai/privacy";
import { recordUsage } from "../ai/usage";
import { listMessages } from "./conversations";

export const MAX_MEMORY_NOTES = 12;
/** Fold new messages into memory once this many have accumulated in a conversation. */
export const MEMORY_BATCH = 6;

const MemoryUpdate = z.object({
  notes: z.array(z.string().max(140)).max(MAX_MEMORY_NOTES),
});

const SYSTEM = `You maintain short private notes that help an AI guidance counselor remember a student (grades 7–12) across conversations. Given the current notes and a new conversation, return the updated list of notes.

Keep notes that help future guidance: goals and careers they're considering, subjects they like or struggle with, activities, plans (college, training, military, work), constraints (works after school, cares for siblings, cost worries), questions they're exploring, and commitments they made.
Never record: names or identifying details (people, schools, towns, social media), health or mental-health details, family conflict, abuse, relationships or sexuality, religion, immigration status, or anything said in a crisis. If an existing note contains any of these, remove it.
Merge duplicates, update anything that changed, drop what's stale. Each note is one short sentence in the third person ("Wants to study marine biology"). At most ${MAX_MEMORY_NOTES} notes.`;

export async function getMemory(db: Db, userId: string) {
  const [row] = await db.select({ notes: counselorMemory.notes }).from(counselorMemory).where(eq(counselorMemory.userId, userId));
  return row?.notes ?? [];
}

/**
 * Folds unprocessed messages of a conversation into the student's notes. Skips flagged
 * conversations entirely: nothing said around a crisis goes into memory.
 */
export async function updateMemory(
  db: Db,
  userId: string,
  conversationId: string,
  opts: { client?: Pick<Anthropic, "beta">; knownNames?: string[]; force?: boolean } = {},
) {
  const [conv] = await db.select().from(counselorConversations).where(eq(counselorConversations.id, conversationId));
  if (!conv || conv.userId !== userId || conv.concernFlagged) return null;

  const messages = (await listMessages(db, conversationId)).filter((m) => m.kind === "chat");
  const fresh = messages.slice(conv.memoryProcessedCount);
  if (fresh.length === 0 || (!opts.force && fresh.length < MEMORY_BATCH)) return null;

  const current = await getMemory(db, userId);
  const transcript = fresh
    .map((m) => `${m.role === "user" ? "Student" : "Counselor"}: ${m.role === "user" ? scrubPii(m.content, opts.knownNames) : m.content}`)
    .join("\n");
  const client = opts.client ?? getAnthropic();
  const model = modelFor("counselor");
  const message = await client.beta.messages.parse({
    model,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { ...(supportsEffort(model) && { effort: "low" as const }), format: betaZodOutputFormat(MemoryUpdate) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Current notes:\n${current.length ? current.map((n) => `- ${n}`).join("\n") : "(none)"}\n\nNew conversation:\n${transcript}`,
      },
    ],
  });
  await recordUsage(db, userId, "counselor", model, message.usage);
  const notes = message.stop_reason === "refusal" ? null : message.parsed_output?.notes;
  if (!notes) return null;

  await db
    .insert(counselorMemory)
    .values({ userId, notes })
    .onConflictDoUpdate({ target: counselorMemory.userId, set: { notes, updatedAt: new Date() } });
  await db
    .update(counselorConversations)
    .set({ memoryProcessedCount: messages.length })
    .where(eq(counselorConversations.id, conversationId));
  return notes;
}

export async function clearMemory(db: Db, userId: string) {
  await db.delete(counselorMemory).where(eq(counselorMemory.userId, userId));
}
