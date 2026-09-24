import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { env } from "@/env";
import { recordUsage } from "@/lib/ai/usage";
import { listMessages } from "@/lib/counselor/conversations";
import { deleteConversation, listConversations } from "@/lib/counselor/conversations";
import { MAX_MEMORY_NOTES, MEMORY_BATCH, clearMemory, getMemory, updateMemory } from "@/lib/counselor/memory";
import { historyStart } from "@/lib/counselor/respond";
import { NOTICES, type CounselorEvent, respond } from "@/lib/counselor/respond";

const now = new Date("2026-09-23T12:00:00Z");
let db: Db;
let student: { id: string; grade: number; displayName: string };

beforeEach(async () => {
  db = await createTestDb();
  const res = await registerStudent(
    db,
    { displayName: "Maya", email: "maya@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  student = { id: res.value.userId, grade: 10, displayName: "Maya" };
});

type Verdict = { category: string; severity: string };
type Iteration = { text: string; stop?: string; throwAfterText?: boolean };

/**
 * Fake Anthropic client: `parse` answers the safety classifier (and memory), `toolRunner` streams
 * scripted iterations. Records every request it receives and whether generation was aborted.
 */
function fakeClient(opts: {
  verdict?: Verdict | null;
  reply?: string;
  stop?: string;
  iterations?: Iteration[];
  safetyDelayMs?: number;
  memory?: string[];
}) {
  const calls = {
    runnerParams: [] as { messages: { content: unknown }[]; system: { text: string }[] }[],
    parseParams: [] as { system: string; messages: { content: string }[] }[],
    aborted: false,
  };
  const iterations: Iteration[] = opts.iterations ?? [{ text: opts.reply ?? "Great question! Let's look at biology classes.", stop: opts.stop }];
  const client = {
    beta: {
      messages: {
        parse: async (params: { system: string; messages: { content: string }[] }) => {
          calls.parseParams.push(params);
          if (params.system.includes("private notes")) {
            return { stop_reason: "end_turn", parsed_output: { notes: opts.memory ?? [] }, usage: { input_tokens: 10, output_tokens: 10 } };
          }
          await new Promise((r) => setTimeout(r, opts.safetyDelayMs ?? 0));
          const v = opts.verdict === undefined ? { category: "none", severity: "none" } : opts.verdict;
          return { stop_reason: v ? "end_turn" : "refusal", parsed_output: v ? { ...v, rationale: "t" } : null, usage: { input_tokens: 10, output_tokens: 5 } };
        },
        toolRunner: (params: never, options: { signal: AbortSignal }) => {
          calls.runnerParams.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              for (const it of iterations) {
                const chunks = it.text.match(/[\s\S]{1,8}/g) ?? [];
                yield {
                  async *[Symbol.asyncIterator]() {
                    for (const c of chunks) {
                      if (options.signal.aborted) {
                        calls.aborted = true;
                        throw new Error("aborted");
                      }
                      yield { type: "content_block_delta", delta: { type: "text_delta", text: c } };
                      await new Promise((r) => setTimeout(r, 1));
                    }
                    if (it.throwAfterText) throw new Error("connection reset");
                  },
                  finalMessage: async () => ({
                    stop_reason: it.stop ?? "end_turn",
                    model: "claude-opus-5",
                    content: [{ type: "text", text: it.text }],
                    usage: { input_tokens: 1000, output_tokens: 100 },
                  }),
                };
              }
            },
          };
        },
      },
    },
  };
  return { client: client as never, calls };
}

async function collect(gen: AsyncGenerator<CounselorEvent>) {
  const events: CounselorEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const text = (events: CounselorEvent[]) => events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");

describe("counselor respond", () => {
  it("streams a reply after screening and stores both messages", async () => {
    const { client } = fakeClient({});
    const events = await collect(respond(db, student, { text: "What classes help with biology?" }, { client, now }));
    expect(events[0].type).toBe("conversation");
    expect(text(events)).toBe("Great question! Let's look at biology classes.");
    const conv = events[0] as { id: string };
    const msgs = await listMessages(db, conv.id);
    expect(msgs.map((m) => [m.role, m.kind])).toEqual([["user", "chat"], ["assistant", "chat"]]);
    expect((await db.select().from(schema.aiUsage)).map((u) => u.feature).sort()).toEqual(["counselor", "safety"]);
  });

  it("never releases the draft when screening finds a crisis, and flags the conversation", async () => {
    // A long draft, so generation is still running when screening returns.
    const { client, calls } = fakeClient({ verdict: { category: "self_harm", severity: "high" }, safetyDelayMs: 30, reply: "x".repeat(4000) });
    const events = await collect(respond(db, student, { text: "i dont want to be here anymore" }, { client, now }));
    expect(events.some((e) => e.type === "delta")).toBe(false);
    const support = events.find((e) => e.type === "support") as { text: string };
    expect(support.text).toContain("988");
    expect(calls.aborted).toBe(true);
    const [conv] = await db.select().from(schema.counselorConversations);
    expect(conv.concernFlagged).toBe(true);
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(1);
  });

  it("keeps a flagged conversation in support mode on the next turn", async () => {
    const first = fakeClient({ verdict: { category: "self_harm", severity: "high" } });
    const events = await collect(respond(db, student, { text: "i want to die" }, { client: first.client, now }));
    const id = (events[0] as { id: string }).id;
    const second = fakeClient({});
    await collect(respond(db, student, { conversationId: id, text: "ok. can we talk about classes" }, { client: second.client, now }));
    expect(second.calls.runnerParams[0].system[1].text).toContain("shared something concerning");
    // The support message is part of the history the counselor sees.
    expect(JSON.stringify(second.calls.runnerParams[0].messages)).toContain("988");
  });

  it("removes the student's name and contact details before the model sees them", async () => {
    const { client, calls } = fakeClient({});
    await collect(respond(db, student, { text: "Hi I'm Maya, my email is maya@example.com" }, { client, now }));
    const sent = JSON.stringify(calls.runnerParams[0]);
    expect(sent).not.toContain("Maya");
    expect(sent).not.toContain("maya@example.com");
    expect(sent).toContain("[name]");
  });

  it("gives a notice when the monthly budget is used up, but still screens for safety", async () => {
    // Spend the whole monthly budget (Opus 5 output: $25 per million tokens).
    const tokens = (env().AI_MONTHLY_BUDGET_USD / 25) * 1_000_000;
    await recordUsage(db, student.id, "counselor", "claude-opus-5", { input_tokens: 0, output_tokens: tokens });
    const calm = fakeClient({});
    const events = await collect(respond(db, student, { text: "what is a gpa" }, { client: calm.client, now }));
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.budget });
    expect(calm.calls.runnerParams).toHaveLength(0);

    const crisis = fakeClient({ verdict: { category: "abuse", severity: "high" } });
    const events2 = await collect(respond(db, student, { text: "my stepdad hits me" }, { client: crisis.client, now }));
    expect(events2.some((e) => e.type === "support")).toBe(true);
  });

  it("won't continue another student's conversation", async () => {
    const { client } = fakeClient({});
    const events = await collect(respond(db, student, { text: "hello" }, { client, now }));
    const id = (events[0] as { id: string }).id;
    const other = await registerStudent(
      db,
      { displayName: "Bo", email: "bo@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!other.ok) throw new Error();
    await expect(collect(respond(db, { id: other.value.userId, grade: 10, displayName: "Bo" }, { conversationId: id, text: "hi" }, { client, now }))).rejects.toThrow("not found");
  });

  it("shows a friendly notice when the model declines", async () => {
    const { client } = fakeClient({ reply: "", stop: "refusal" });
    const events = await collect(respond(db, student, { text: "something odd" }, { client, now }));
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.refusal });
  });

  it("rate-limits bursts before any model call or write, but still gives crisis help", async () => {
    const { client } = fakeClient({});
    let id: string | undefined;
    for (let i = 0; i < 20; i++) {
      const events = await collect(respond(db, student, { conversationId: id, text: `question ${i}` }, { client, now }));
      id = (events[0] as { id: string }).id;
    }
    const counted = fakeClient({});
    const convsBefore = (await db.select().from(schema.counselorConversations)).length;
    const msgsBefore = (await db.select().from(schema.counselorMessages)).length;
    const limited = await collect(respond(db, student, { text: "one more" }, { client: counted.client, now }));
    expect(limited).toEqual([{ type: "notice", text: NOTICES.rateLimited }, { type: "done", messageId: null }]);
    expect(counted.calls.parseParams).toHaveLength(0);
    expect(counted.calls.runnerParams).toHaveLength(0);
    expect(await db.select().from(schema.counselorConversations)).toHaveLength(convsBefore);
    expect(await db.select().from(schema.counselorMessages)).toHaveLength(msgsBefore);
    const crisis = fakeClient({ verdict: { category: "self_harm", severity: "imminent" } });
    const urgent = await collect(respond(db, student, { conversationId: id, text: "going to end it tonight" }, { client: crisis.client, now }));
    expect(urgent[0].type).toBe("support");
    expect(crisis.calls.parseParams).toHaveLength(0); // keyword rules only
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toEqual(["rules", "rate_limited"]);
  });

  it("sends crisis resources even when recording the safety event fails", async () => {
    await db.execute(sql`drop table safety_events`);
    const { client } = fakeClient({ verdict: { category: "self_harm", severity: "high" } });
    const events = await collect(respond(db, student, { text: "i want to die" }, { client, now }));
    expect(events.find((e) => e.type === "support")).toBeTruthy();
  });

  it("aborts generation when the client disconnects and keeps what was written", async () => {
    const controller = new AbortController();
    const { client, calls } = fakeClient({ reply: "a".repeat(400) });
    const events: CounselorEvent[] = [];
    for await (const e of respond(db, student, { text: "tell me about nursing" }, { client, now, signal: controller.signal })) {
      events.push(e);
      if (e.type === "delta" && events.filter((x) => x.type === "delta").length === 3) controller.abort();
    }
    expect(calls.aborted).toBe(true);
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.interrupted });
    const conv = events[0] as { id: string };
    const kinds = (await listMessages(db, conv.id)).map((m) => m.kind);
    expect(kinds).toEqual(["chat", "chat", "notice"]);
  });

  it("reports running out of tool iterations as incomplete, not as a finished answer", async () => {
    const { client } = fakeClient({ iterations: [{ text: "Let me look that up.", stop: "tool_use" }] });
    const events = await collect(respond(db, student, { text: "what majors lead to nursing?" }, { client, now }));
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.incomplete });
  });

  it("marks a reply that failed partway with an error notice", async () => {
    const { client } = fakeClient({ iterations: [{ text: "Here are three ideas: first", throwAfterText: true }] });
    const events = await collect(respond(db, student, { text: "ideas for summer?" }, { client, now }));
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.error });
    const conv = events[0] as { id: string };
    expect((await listMessages(db, conv.id)).map((m) => m.kind)).toEqual(["chat", "chat", "notice"]);
  });

  it("never stores text from a refused attempt as a chat reply", async () => {
    const { client } = fakeClient({ iterations: [{ text: "REFUSED-DRAFT", stop: "refusal" }] });
    const events = await collect(respond(db, student, { text: "something odd" }, { client, now }));
    const conv = events[0] as { id: string };
    const stored = await listMessages(db, conv.id);
    expect(stored.some((m) => m.content.includes("REFUSED-DRAFT"))).toBe(false);
    expect(stored.at(-1)).toMatchObject({ kind: "notice", content: NOTICES.refusal });
  });

  it("scrubs names from the safety screen, earlier turns, and step text in the context", async () => {
    const withName = { ...student, username: "mayalopez" };
    const first = fakeClient({});
    const events = await collect(respond(db, withName, { text: "I'm Maya (mayalopez on here)" }, { client: first.client, now }));
    await db.insert(schema.weeklySteps).values({ userId: student.id, weekStart: "2026-09-21", text: "Ask Maya's teacher" });
    const second = fakeClient({});
    await collect(respond(db, withName, { conversationId: (events[0] as { id: string }).id, text: "hi again" }, { client: second.client, now }));
    const everything = JSON.stringify([first.calls, second.calls]);
    expect(everything).not.toMatch(/maya/i);
  });
});

describe("counselor memory", () => {
  it("folds a batch of messages into notes, and never from flagged conversations", async () => {
    const { client } = fakeClient({ memory: ["Wants to study biology", "Works after school"] });
    let id: string | undefined;
    for (let i = 0; i < MEMORY_BATCH / 2; i++) {
      const events = await collect(respond(db, student, { conversationId: id, text: `I love biology ${i}` }, { client, now }));
      id = (events[0] as { id: string }).id;
    }
    expect(await updateMemory(db, student.id, id!, { client, knownNames: ["Maya"] })).toEqual(["Wants to study biology", "Works after school"]);
    expect(await getMemory(db, student.id)).toHaveLength(2);
    // Nothing new since the last update.
    expect(await updateMemory(db, student.id, id!, { client })).toBeNull();

    const crisis = fakeClient({ verdict: { category: "self_harm", severity: "high" }, memory: ["SHOULD NOT BE SAVED"] });
    const events = await collect(respond(db, student, { text: "i want to die" }, { client: crisis.client, now }));
    expect(await updateMemory(db, student.id, (events[0] as { id: string }).id, { client: crisis.client, force: true })).toBeNull();
    expect(await getMemory(db, student.id)).toEqual(["Wants to study biology", "Works after school"]);
  });
});

describe("counselor memory safeguards", () => {
  async function chat(client: never, n: number) {
    let id: string | undefined;
    for (let i = 0; i < n; i++) {
      const events = await collect(respond(db, student, { conversationId: id, text: `I love biology ${i}` }, { client, now }));
      id = (events[0] as { id: string }).id;
    }
    return id!;
  }

  it("skips memory updates once the monthly budget is used up", async () => {
    const { client, calls } = fakeClient({ memory: ["x"] });
    const id = await chat(client, MEMORY_BATCH / 2);
    const tokens = (env().AI_MONTHLY_BUDGET_USD / 25) * 1_000_000;
    await recordUsage(db, student.id, "counselor", "claude-opus-5", { input_tokens: 0, output_tokens: tokens });
    const before = calls.parseParams.length;
    expect(await updateMemory(db, student.id, id, { client, now })).toBeNull();
    expect(calls.parseParams.length).toBe(before);
  });

  it("enforces the note limits itself and scrubs the transcript", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `Note ${i} ${"x".repeat(300)}`);
    const { client, calls } = fakeClient({ memory: long });
    const id = await chat(client, MEMORY_BATCH / 2);
    const notes = await updateMemory(db, student.id, id, { client, knownNames: ["Maya"], now });
    expect(notes).toHaveLength(MAX_MEMORY_NOTES);
    expect(notes!.every((n) => n.length <= 140)).toBe(true);
    const memoryCall = calls.parseParams.find((p) => p.system.includes("private notes"));
    expect(JSON.stringify(memoryCall)).not.toContain("Maya");
  });

  it("keeps conversations and memory to their owner", async () => {
    const { client } = fakeClient({ memory: ["LEAKED"] });
    const id = await chat(client, MEMORY_BATCH / 2);
    const other = await registerStudent(
      db,
      { displayName: "Bo", email: "bo@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!other.ok) throw new Error();
    expect(await updateMemory(db, other.value.userId, id, { client, force: true, now })).toBeNull();
    expect(await getMemory(db, other.value.userId)).toEqual([]);
    expect(await listConversations(db, other.value.userId)).toEqual([]);
    expect(await deleteConversation(db, other.value.userId, id)).toBe(false);
    expect(await listConversations(db, student.id)).toHaveLength(1);
    await updateMemory(db, student.id, id, { client, force: true, now });
    await clearMemory(db, other.value.userId);
    expect(await getMemory(db, student.id)).toEqual(["LEAKED"]);
  });
});

describe("counselor tools", () => {
  it("exposes only the student's own plan and roadmap, with no ids or names", async () => {
    const { counselorExtraTools } = await import("@/lib/counselor/extra-tools");
    await db.insert(schema.studentCourses).values({ userId: student.id, name: "Maya's Biology", subject: "science", gradeLevel: 10, status: "completed", finalGrade: "A" });
    await db.insert(schema.weeklySteps).values({ userId: student.id, weekStart: "2026-09-21", text: "Ask Maya's counselor about AP Bio" });
    const tools = await counselorExtraTools(db, student, { now });
    expect(tools.map((t) => t.name)).toEqual(["get_my_plan", "get_my_roadmap"]);
    const plan = String(await tools[0].run({}));
    expect(plan).toContain("Biology");
    expect(plan).not.toContain("Maya");
    expect(plan).not.toContain(student.id);
    const roadmap = String(await tools[1].run({}));
    expect(roadmap).not.toContain(student.id);
    expect(roadmap).toContain("AP Bio");
    expect(roadmap).not.toContain("Maya");
  });
});

describe("history window", () => {
  it("moves in blocks of ten so the cached prefix survives several turns", () => {
    expect(historyStart(30, 30)).toBe(0);
    expect(historyStart(31, 30)).toBe(10);
    expect(historyStart(40, 30)).toBe(10);
    expect(historyStart(41, 30)).toBe(20);
  });
});
