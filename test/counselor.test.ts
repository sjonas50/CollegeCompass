import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent, setStudentGrade } from "@/lib/accounts";
import { env } from "@/env";
import { recordUsage } from "@/lib/ai/usage";
import { listMessages } from "@/lib/counselor/conversations";
import { deleteConversation, listConversations } from "@/lib/counselor/conversations";
import { MAX_MEMORY_NOTES, MEMORY_BATCH, clearMemory, getMemory, updateMemory } from "@/lib/counselor/memory";
import { historyStart } from "@/lib/counselor/respond";
import { NOTICES, type CounselorEvent, cleanMessage, respond } from "@/lib/counselor/respond";

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
 * Fake Anthropic client: `create` answers the safety classifier (and memory), `toolRunner` streams
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
    structuredParams: [] as { system: string; messages: { content: string }[] }[],
    aborted: false,
  };
  const iterations: Iteration[] = opts.iterations ?? [{ text: opts.reply ?? "Great question! Let's look at biology classes.", stop: opts.stop }];
  const client = {
    beta: {
      messages: {
        // Structured-output calls: the safety classifier and memory updates.
        create: async (params: { model: string; system: string; messages: { content: string }[] }) => {
          calls.structuredParams.push(params);
          const reply = (output: unknown, usage: object) => ({
            stop_reason: output ? "end_turn" : "refusal",
            model: params.model,
            content: output ? [{ type: "text", text: JSON.stringify(output) }] : [],
            usage,
          });
          if (params.system.includes("private notes")) return reply({ notes: opts.memory ?? [] }, { input_tokens: 10, output_tokens: 10 });
          await new Promise((r) => setTimeout(r, opts.safetyDelayMs ?? 0));
          const v = opts.verdict === undefined ? { category: "none", severity: "none" } : opts.verdict;
          return reply(v && { ...v, rationale: "t" }, { input_tokens: 10, output_tokens: 5 });
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

describe("cleanMessage", () => {
  it("turns page breaks into newlines and drops other control characters", () => {
    expect(cleanMessage(" a\u000Bb\u000Cc\u0000d\u0007e\u007F\r\nf\rg\th ")).toBe("a\nb\ncde\nf\ng\th");
    expect(cleanMessage("\u0000\u0001 ")).toBe("");
  });
});

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
    expect(second.calls.runnerParams[0].system[2].text).toContain("shared something concerning");
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

  it("rate-limits bursts but still screens every message in full", async () => {
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
    expect(counted.calls.structuredParams).toHaveLength(1); // screened
    expect(counted.calls.runnerParams).toHaveLength(0); // no counselor reply
    expect(await db.select().from(schema.counselorConversations)).toHaveLength(convsBefore);
    expect(await db.select().from(schema.counselorMessages)).toHaveLength(msgsBefore);

    // Indirect language only the model catches still gets help, and the exchange is kept.
    const crisis = fakeClient({ verdict: { category: "self_harm", severity: "high" } });
    const urgent = await collect(respond(db, student, { conversationId: id, text: "i dont want to be here anymore" }, { client: crisis.client, now }));
    expect(urgent[0].type).toBe("support");
    expect(urgent.at(-1)).toMatchObject({ type: "done", messageId: expect.any(String) });
    expect(crisis.calls.runnerParams).toHaveLength(0);
    const msgs = await listMessages(db, id!);
    expect(msgs.slice(-2).map((m) => [m.role, m.kind])).toEqual([["user", "chat"], ["assistant", "support"]]);
    const [conv] = await db.select().from(schema.counselorConversations).where(sql`id = ${id}`);
    expect(conv.concernFlagged).toBe(true);
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toEqual(["model"]);
  });

  it("falls back to keyword rules past the screening cap, and still records the crisis", async () => {
    const { client } = fakeClient({});
    for (let i = 0; i < 20 + 60; i++) await collect(respond(db, student, { text: `question ${i}` }, { client, now }));
    const crisis = fakeClient({ verdict: { category: "self_harm", severity: "imminent" } });
    const urgent = await collect(respond(db, student, { text: "going to end it tonight" }, { client: crisis.client, now }));
    expect(urgent[0].type).toBe("support");
    expect(crisis.calls.structuredParams).toHaveLength(0); // keyword rules only
    const conversation = urgent.find((e) => e.type === "conversation") as { id: string };
    const msgs = await listMessages(db, conversation.id);
    expect(msgs.map((m) => [m.role, m.kind])).toEqual([["user", "chat"], ["assistant", "support"]]);
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toEqual(["rules", "rate_limited"]);
  });

  it("rebuilds a saved context when what it summarizes changes, or once it's an hour old", async () => {
    const first = fakeClient({});
    const id = ((await collect(respond(db, student, { text: "hi" }, { client: first.client, now })))[0] as { id: string }).id;
    expect(first.calls.runnerParams[0].system[1].text).toContain("Grade 10");

    await setStudentGrade(db, student.id, 11, now);
    const second = fakeClient({});
    // The route passes the session's (now updated) grade.
    await collect(respond(db, { ...student, grade: 11 }, { conversationId: id, text: "I skipped a grade actually" }, { client: second.client, now }));
    expect(second.calls.runnerParams[0].system[1].text).toContain("Grade 11");

    // Still chatting, but the saved context is over an hour old.
    await db.insert(schema.counselorMemory).values({ userId: student.id, notes: ["Wants to study marine biology"] });
    await db.execute(sql`update counselor_conversations set context_built_at = now() - interval '61 minutes' where id = ${id}`);
    const third = fakeClient({});
    await collect(respond(db, student, { conversationId: id, text: "and?" }, { client: third.client, now }));
    expect(third.calls.runnerParams[0].system[1].text).toContain("marine biology");
  });

  it("stops sending memory notes as soon as the student clears them", async () => {
    await db.insert(schema.counselorMemory).values({ userId: student.id, notes: ["Worried about money for college"] });
    const first = fakeClient({});
    const id = ((await collect(respond(db, student, { text: "hi" }, { client: first.client, now })))[0] as { id: string }).id;
    expect(first.calls.runnerParams[0].system[1].text).toContain("Worried about money");
    await clearMemory(db, student.id);
    const [conv] = await db.select().from(schema.counselorConversations);
    expect(conv.context).toBeNull();
    const second = fakeClient({});
    await collect(respond(db, student, { conversationId: id, text: "hi again" }, { client: second.client, now }));
    expect(JSON.stringify(second.calls.runnerParams)).not.toContain("Worried about money");
  });

  it("keeps support mode and memory exclusion even if flagging the conversation failed", async () => {
    const first = fakeClient({});
    const id = ((await collect(respond(db, student, { text: "hi" }, { client: first.client, now })))[0] as { id: string }).id;
    // As if a crisis turn stored its resources but the flag write failed.
    await db.insert(schema.counselorMessages).values([
      { conversationId: id, role: "user", kind: "chat", content: "i dont want to be here anymore" },
      { conversationId: id, role: "assistant", kind: "support", content: "Call or text 988" },
    ]);
    const next = fakeClient({ memory: ["SHOULD NOT BE SAVED"] });
    await collect(respond(db, student, { conversationId: id, text: "ok" }, { client: next.client, now }));
    expect(next.calls.runnerParams[0].system.map((b) => b.text).join("\n")).toContain("shared something concerning");
    const [conv] = await db.select().from(schema.counselorConversations);
    expect(conv.concernFlagged).toBe(true);
    await db.update(schema.counselorConversations).set({ concernFlagged: false });
    expect(await updateMemory(db, student.id, id, { client: next.client, force: true })).toBeNull();
  });

  it("still sends crisis resources when storing the message fails", async () => {
    await db.execute(sql`drop table counselor_messages cascade`);
    const { client } = fakeClient({ verdict: { category: "self_harm", severity: "high" } });
    const events = await collect(respond(db, student, { text: "i dont want to be here anymore" }, { client, now }));
    expect(events.map((e) => e.type)).toEqual(["support", "done"]);
  });

  it("reuses the conversation's student context within a session and rebuilds it after a break", async () => {
    const first = fakeClient({});
    const events = await collect(respond(db, student, { text: "hi" }, { client: first.client, now }));
    const id = (events[0] as { id: string }).id;
    const saved = first.calls.runnerParams[0].system[1].text;
    await db.insert(schema.counselorMemory).values({ userId: student.id, notes: ["Wants to study marine biology"] });

    const second = fakeClient({});
    await collect(respond(db, student, { conversationId: id, text: "and then?" }, { client: second.client, now }));
    expect(second.calls.runnerParams[0].system[1].text).toBe(saved);

    await db.execute(sql`update counselor_conversations set updated_at = now() - interval '2 hours' where id = ${id}`);
    const third = fakeClient({});
    await collect(respond(db, student, { conversationId: id, text: "back again" }, { client: third.client, now }));
    expect(third.calls.runnerParams[0].system[1].text).toContain("marine biology");
  });

  it("turns a failed context lookup into an error notice, with no unhandled rejection or logged ids", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await db.execute(sql`drop table weekly_steps cascade`);
      const { client } = fakeClient({ safetyDelayMs: 30 });
      const events = await collect(respond(db, student, { text: "hello" }, { client, now }));
      await new Promise((r) => setTimeout(r, 20));
      expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.error });
      expect(unhandled).toEqual([]);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(student.id);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      logged.mockRestore();
    }
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

  it("takes back a refused draft on screen, keeping text from earlier tool rounds", async () => {
    const { client } = fakeClient({ iterations: [{ text: "Let me check your plan.", stop: "tool_use" }, { text: "REFUSED-DRAFT", stop: "refusal" }] });
    const events = await collect(respond(db, student, { text: "something odd" }, { client, now }));
    const tail = events.slice(events.findIndex((e) => e.type === "replace"));
    expect(tail.map((e) => e.type)).toEqual(["replace", "notice", "done"]);
    expect(tail[0]).toEqual({ type: "replace", text: "Let me check your plan.\n\n" });
  });

  it("marks a reply cut off when the runner fails after a tool round", async () => {
    const { client } = fakeClient({ iterations: [{ text: "Let me look at your course plan.", stop: "tool_use" }, { text: "", throwAfterText: true }] });
    const events = await collect(respond(db, student, { text: "what should I take?" }, { client, now }));
    expect(events.some((e) => e.type === "replace")).toBe(false);
    expect(events.find((e) => e.type === "notice")).toEqual({ type: "notice", text: NOTICES.error });
    const conv = events[0] as { id: string };
    expect((await listMessages(db, conv.id)).map((m) => [m.kind, m.content])).toEqual([
      ["chat", "what should I take?"],
      ["chat", "Let me look at your course plan.\n\n"],
      ["notice", NOTICES.error],
    ]);
  });

  it("scrubs names from the safety screen, earlier turns, and step text in the context", async () => {
    const withName = { ...student, username: "mayalopez" };
    // Added before the first turn, so the step is in the context that turn builds.
    await db.insert(schema.weeklySteps).values({ userId: student.id, weekStart: "2026-09-21", text: "Ask Maya's teacher" });
    const first = fakeClient({});
    const events = await collect(respond(db, withName, { text: "I'm Maya (mayalopez on here)" }, { client: first.client, now }));
    expect(first.calls.runnerParams[0].system[1].text).toContain("Ask [name]'s teacher");
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

describe("counselor memory privacy", () => {
  it("never sends the student's name, username or contact details to the memory model", async () => {
    const withName = { ...student, username: "mayalopez" };
    const { client, calls } = fakeClient({ memory: ["Wants to study biology"] });
    let id: string | undefined;
    for (let i = 0; i < MEMORY_BATCH / 2; i++) {
      const text = i === 0 ? "I'm Maya (mayalopez), email me at maya.l@example.com or call 555-123-4567" : `I love biology ${i}`;
      const events = await collect(respond(db, withName, { conversationId: id, text }, { client, now }));
      id = (events[0] as { id: string }).id;
    }
    await updateMemory(db, student.id, id!, { client, knownNames: ["Maya", "mayalopez"] });
    const memoryCall = calls.structuredParams.find((p) => p.system.includes("private notes"));
    expect(memoryCall).toBeTruthy();
    expect(JSON.stringify(memoryCall)).not.toMatch(/maya|example\.com|555-123-4567/i);
    expect(JSON.stringify(memoryCall)).toContain("I love biology 1");
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
    const before = calls.structuredParams.length;
    expect(await updateMemory(db, student.id, id, { client, now })).toBeNull();
    expect(calls.structuredParams.length).toBe(before);
  });

  it("enforces the note limits itself and scrubs the transcript", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `Note ${i} ${"x".repeat(300)}`);
    const { client, calls } = fakeClient({ memory: long });
    const id = await chat(client, MEMORY_BATCH / 2);
    const notes = await updateMemory(db, student.id, id, { client, knownNames: ["Maya"], now });
    expect(notes).toHaveLength(MAX_MEMORY_NOTES);
    expect(notes!.every((n) => n.length <= 140)).toBe(true);
    const memoryCall = calls.structuredParams.find((p) => p.system.includes("private notes"));
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
    expect(tools.map((t) => t.name)).toEqual(["get_my_plan", "get_my_roadmap", "get_my_college_list"]);
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
