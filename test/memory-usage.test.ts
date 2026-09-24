import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { costMicros } from "@/lib/ai/models";
import { MAX_MEMORY_NOTES, MAX_NOTE_CHARS, MEMORY_BATCH, getMemory, updateMemory } from "@/lib/counselor/memory";
import { fallbackUsage, stubAnthropic } from "./anthropic-stub";

const now = new Date("2026-09-23T12:00:00Z");
let db: Db;
let userId: string;
let conversationId: string;

beforeEach(async () => {
  db = await createTestDb();
  const res = await registerStudent(
    db,
    { displayName: "Maya", email: "maya@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
  const [conv] = await db.insert(schema.counselorConversations).values({ userId }).returning();
  conversationId = conv.id;
  await db.insert(schema.counselorMessages).values(
    Array.from({ length: MEMORY_BATCH }, (_, i) => ({
      conversationId,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: i % 2 === 0 ? `I love biology ${i}` : `Biology is a great fit ${i}`,
    })),
  );
  await db.insert(schema.counselorMemory).values({ userId, notes: ["Plays soccer"] });
});

async function processedCount() {
  const [conv] = await db
    .select({ n: schema.counselorConversations.memoryProcessedCount })
    .from(schema.counselorConversations)
    .where(eq(schema.counselorConversations.id, conversationId));
  return conv.n;
}

describe("memory usage accounting", () => {
  it("records a response cut off at max_tokens, keeps the old notes, and doesn't retry the batch", async () => {
    const { client, requests } = stubAnthropic(() => ({
      stop_reason: "max_tokens",
      text: '{"notes":["Wants to study biology","Works aft',
      usage: { input_tokens: 900, output_tokens: 2000 },
    }));
    await expect(updateMemory(db, userId, conversationId, { client, now })).resolves.toBeNull();
    const rows = await db.select().from(schema.aiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "counselor", inputTokens: 900, outputTokens: 2000 });
    expect(await getMemory(db, userId)).toEqual(["Plays soccer"]);

    // The batch was billed once; the next turn doesn't send the same messages again.
    expect(await processedCount()).toBe(MEMORY_BATCH);
    expect(await updateMemory(db, userId, conversationId, { client, now })).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("records a refusal whose text isn't JSON", async () => {
    const { client } = stubAnthropic(() => ({ stop_reason: "refusal", text: "I can't help with that." }));
    await expect(updateMemory(db, userId, conversationId, { client, now })).resolves.toBeNull();
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
    expect(await getMemory(db, userId)).toEqual(["Plays soccer"]);
    expect(await processedCount()).toBe(MEMORY_BATCH);
  });

  it("records output that doesn't match the schema", async () => {
    const { client } = stubAnthropic(() => ({ text: '{"notes":"Wants to study biology"}' }));
    await expect(updateMemory(db, userId, conversationId, { client, now })).resolves.toBeNull();
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
    expect(await getMemory(db, userId)).toEqual(["Plays soccer"]);
  });

  it("clamps note limits the API doesn't enforce, and charges each fallback attempt at its own model", async () => {
    const notes = [...Array.from({ length: MAX_MEMORY_NOTES }, (_, i) => `Note ${i}`), "x".repeat(MAX_NOTE_CHARS + 60)].reverse();
    const { client, requests } = stubAnthropic((body) => ({
      text: JSON.stringify({ notes }),
      model: "claude-opus-4-8",
      usage: fallbackUsage(body.model, "claude-opus-4-8"),
    }));
    const saved = await updateMemory(db, userId, conversationId, { client, now });
    expect(saved).toHaveLength(MAX_MEMORY_NOTES);
    expect(saved!.every((n) => n.length <= MAX_NOTE_CHARS)).toBe(true);
    expect(await getMemory(db, userId)).toEqual(saved);
    expect(requests[0].output_config).toMatchObject({ format: { type: "json_schema" } });

    const requested = requests[0].model;
    const rows = await db.select().from(schema.aiUsage);
    expect(rows.map((r) => r.model).sort()).toEqual([requested, "claude-opus-4-8"].sort());
    expect(rows.reduce((s, r) => s + r.costMicros, 0)).toBe(
      costMicros(requested, { input_tokens: 1000, output_tokens: 400 }) +
        costMicros("claude-opus-4-8", { input_tokens: 1000, output_tokens: 200 }),
    );
  });
});
