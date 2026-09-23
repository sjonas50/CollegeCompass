import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent } from "@/lib/accounts";
import { assessMessage } from "@/lib/ai/safety";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "@/lib/ai/usage";

let db: Db;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  const res = await registerParent(db, { displayName: "Test", email: "t@example.com", password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
});

/** A stand-in for the Anthropic client that returns a fixed verdict and records what it was sent. */
function fakeClient(verdict: { category: string; severity: string } | null, sent: string[] = []) {
  return {
    beta: {
      messages: {
        parse: async (params: { messages: { content: string }[] }) => {
          sent.push(params.messages[0].content);
          return {
            stop_reason: verdict ? "end_turn" : "refusal",
            parsed_output: verdict ? { ...verdict, rationale: "test" } : null,
            usage: { input_tokens: 500, output_tokens: 50 },
          };
        },
      },
    },
  } as never;
}

describe("assessMessage", () => {
  it("escalates on the model tier even when rules miss indirect language", async () => {
    const result = await assessMessage(db, userId, "I won't be around by then anyway", {
      client: fakeClient({ category: "self_harm", severity: "high" }),
    });
    expect(result).toMatchObject({ severity: "high", category: "self_harm", sources: ["model"], degraded: false });
    expect(result.supportMessage).toContain("988");
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event).toMatchObject({ category: "self_harm", severity: "high", sources: ["model"] });
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
  });

  it("keeps the rules verdict when the model under-rates", async () => {
    const result = await assessMessage(db, userId, "I'm going to kill myself", {
      client: fakeClient({ category: "none", severity: "none" }),
    });
    expect(result.severity).toBe("imminent");
    expect(result.sources).toEqual(["rules"]);
  });

  it("falls back to rules and flags the gap when the model is unavailable", async () => {
    const result = await assessMessage(db, userId, "my dad hits me", { client: fakeClient(null) });
    expect(result).toMatchObject({ severity: "high", category: "abuse", degraded: true });
    expect(result.supportMessage).toContain("1-800-422-4453");
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toEqual(["rules", "model_unavailable"]);
  });

  it("lets the model overrule noisy keyword matches below high severity", async () => {
    const text = "I'm interested in working in suicide prevention. What should I major in?";
    const result = await assessMessage(db, userId, text, { client: fakeClient({ category: "none", severity: "none" }) });
    expect(result).toMatchObject({ severity: "none", sources: [] });
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(0);

    // Without the model, the keyword rule still flags it for human review.
    const degraded = await assessMessage(db, userId, text, { client: fakeClient(null) });
    expect(degraded).toMatchObject({ severity: "medium", sources: ["rules"], degraded: true });
  });

  it("doesn't queue ordinary messages", async () => {
    const result = await assessMessage(db, userId, "what classes help with engineering?", {
      client: fakeClient({ category: "none", severity: "none" }),
    });
    expect(result).toMatchObject({ severity: "none", supportMessage: null });
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(0);
  });

  it("removes the student's name and contact details before calling the model", async () => {
    const sent: string[] = [];
    await assessMessage(db, userId, "I'm Maya, text me at 555-123-4567", {
      client: fakeClient({ category: "none", severity: "none" }, sent),
      knownNames: ["Maya"],
    });
    expect(sent[0]).toContain("I'm [name], text me at [phone]");
    expect(sent[0]).not.toContain("Maya");
  });
});

describe("AI budget", () => {
  it("blocks further AI use once the monthly budget is spent", async () => {
    await assertWithinBudget(db, userId);
    // $1 default budget: 40k output tokens on Opus 5 = $1.00
    await recordUsage(db, userId, "counselor", "claude-opus-5", { input_tokens: 0, output_tokens: 40_000 });
    await expect(assertWithinBudget(db, userId)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
