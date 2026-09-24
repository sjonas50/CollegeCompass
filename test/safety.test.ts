import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent } from "@/lib/accounts";
import { assessMessage } from "@/lib/ai/safety";
import { env } from "@/env";
import { costMicros } from "@/lib/ai/models";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "@/lib/ai/usage";
import { fallbackUsage, stubAnthropic } from "./anthropic-stub";

let db: Db;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  const res = await registerParent(db, { displayName: "Test", email: "t@example.com", password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
});

/** A stand-in for the Anthropic client that returns a fixed verdict (null: refuses) and records what it was sent. */
function fakeClient(verdict: { category: string; severity: string } | null, sent: string[] = []) {
  return {
    beta: {
      messages: {
        create: async (params: { model: string; messages: { content: string }[] }) => {
          sent.push(params.messages[0].content);
          return {
            model: params.model,
            stop_reason: verdict ? "end_turn" : "refusal",
            content: verdict ? [{ type: "text", text: JSON.stringify({ ...verdict, rationale: "test" }) }] : [],
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
    const result = await assessMessage(db, userId, "i'm scared to go home", { client: fakeClient(null) });
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

describe("safety model backup", () => {
  it("retries on the backup model when the primary errors, before degrading to rules", async () => {
    const models: string[] = [];
    const flaky = {
      beta: {
        messages: {
          create: async (params: { model: string }) => {
            models.push(params.model);
            if (models.length === 1) throw new Error("overloaded");
            const text = JSON.stringify({ category: "self_harm", severity: "high", rationale: "t" });
            return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } };
          },
        },
      },
    } as never;
    const result = await assessMessage(db, userId, "i dont think ill be around by then", { client: flaky });
    expect(models).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(result).toMatchObject({ severity: "high", degraded: false, sources: ["model"] });
  });

  it("degrades to rules only when both models fail", async () => {
    const down = { beta: { messages: { create: async () => { throw new Error("outage"); } } } } as never;
    const result = await assessMessage(db, userId, "i took the whole bottle", { client: down });
    expect(result).toMatchObject({ severity: "imminent", degraded: true, sources: ["rules"] });
  });

  it("gives resources for a plain statement without waiting on the model", async () => {
    let calls = 0;
    const hanging = { beta: { messages: { create: () => { calls++; return new Promise(() => {}); } } } } as never;
    const result = await assessMessage(db, userId, "I'm going to kill myself tonight", { client: hanging });
    expect(result).toMatchObject({ severity: "imminent", category: "self_harm", degraded: false, sources: ["rules"] });
    expect(result.supportMessage).toContain("988");
    expect(calls).toBe(0);
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toEqual(["rules"]);
  });

  it("lets the model clear a broad keyword match that only applies in an outage", async () => {
    const text = "I'm about to jump off a building, this group project is killing me";
    const up = await assessMessage(db, userId, text, { client: fakeClient({ category: "none", severity: "none" }) });
    expect(up).toMatchObject({ severity: "none", supportMessage: null });
    const down = await assessMessage(db, userId, text, { client: fakeClient(null) });
    expect(down).toMatchObject({ severity: "imminent", degraded: true });
  });
});

describe("safety usage accounting", () => {
  it("records a verdict cut off at max_tokens, then tries the backup model", async () => {
    const { client, requests } = stubAnthropic(() => ({ stop_reason: "max_tokens", text: '{"category":"self_harm","sev' }));
    const result = await assessMessage(db, userId, "i took the whole bottle", { client });
    expect(result).toMatchObject({ severity: "imminent", degraded: true, sources: ["rules"] });
    expect(requests.map((r) => r.model)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    const rows = await db.select().from(schema.aiUsage);
    expect(rows.map((r) => [r.feature, r.model])).toEqual([["safety", "claude-opus-5"], ["safety", "claude-sonnet-5"]]);
  });

  it("records a refusal whose text isn't JSON, without retrying", async () => {
    const { client, requests } = stubAnthropic(() => ({ stop_reason: "refusal", text: "I can't help with that." }));
    const result = await assessMessage(db, userId, "i'm scared to go home", { client });
    expect(result).toMatchObject({ severity: "high", category: "abuse", degraded: true });
    expect(requests).toHaveLength(1);
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
  });

  it("charges each fallback attempt at the model that ran it", async () => {
    const { client } = stubAnthropic((body) => ({
      text: JSON.stringify({ category: "self_harm", severity: "high", rationale: "t" }),
      model: "claude-opus-4-8",
      usage: fallbackUsage(body.model, "claude-opus-4-8"),
    }));
    const result = await assessMessage(db, userId, "I won't be around by then anyway", { client });
    expect(result).toMatchObject({ severity: "high", degraded: false, sources: ["model"] });
    const rows = await db.select().from(schema.aiUsage);
    expect(rows.map((r) => r.model).sort()).toEqual(["claude-opus-4-8", "claude-opus-5"]);
    expect(rows.reduce((s, r) => s + r.costMicros, 0)).toBe(
      costMicros("claude-opus-5", { input_tokens: 1000, output_tokens: 400 }) +
        costMicros("claude-opus-4-8", { input_tokens: 1000, output_tokens: 200 }),
    );
  });
});

describe("AI budget", () => {
  it("blocks further AI use once the monthly budget is spent", async () => {
    await assertWithinBudget(db, userId);
    // Opus 5 output costs $25 per million tokens, so this spends exactly the monthly budget.
    const tokens = (env().AI_MONTHLY_BUDGET_USD / 25) * 1_000_000;
    await recordUsage(db, userId, "counselor", "claude-opus-5", { input_tokens: 0, output_tokens: tokens - 1 });
    await assertWithinBudget(db, userId);
    await recordUsage(db, userId, "counselor", "claude-opus-5", { input_tokens: 0, output_tokens: 1 });
    await expect(assertWithinBudget(db, userId)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
