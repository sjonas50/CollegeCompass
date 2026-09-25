import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { insertColleges } from "@/lib/colleges/test-fixtures";
import { pageNames } from "./page-names";
import { type CounselorEvent, respond } from "./respond";

// The real names of the colleges and careers a counselor reply links to, so the chat can name each
// link after its page (see chatLinks): for saved conversations (the page looks them up) and for a
// reply that just streamed in (the stream's last event carries them).

const now = new Date("2026-09-24T12:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await insertColleges(db, [
    { unitId: 204796, name: "Ohio State University-Main Campus", city: "Columbus", state: "OH" },
    { unitId: 204024, name: "Miami University-Oxford", city: "Oxford", state: "OH" },
  ]);
  await db.insert(schema.occupations).values([
    { code: "29-1141.00", title: "Registered Nurses", jobZone: 3, description: "Assess patient health problems and needs." },
    { code: "47-2111.00", title: "Electricians", jobZone: 3, description: "Install, maintain, and repair electrical wiring." },
  ]);
});

describe("page names", () => {
  it("looks up every college and career page the replies link to", async () => {
    const replies = [
      "- Ohio State University, Columbus — about $17,300 a year, and 88% of students finish. /colleges/204796\n- Miami: /colleges/204024.",
      "Registered nurses (/careers/29-1141.00) and electricians: /careers/47-2111.00/. Ohio State again: /colleges/204796",
    ];
    expect(await pageNames(db, replies)).toEqual({
      "/colleges/204796": "Ohio State University-Main Campus",
      "/colleges/204024": "Miami University-Oxford",
      "/careers/29-1141.00": "Registered Nurses",
      "/careers/47-2111.00": "Electricians",
    });
  });

  it("gives no name to a page that doesn't exist, and asks nothing when nothing is linked", async () => {
    expect(await pageNames(db, ["See /colleges/1, /colleges/99999999999 and /careers/11-1011.00."])).toEqual({});
    expect(await pageNames(db, ["No links here.", ""])).toEqual({});
    expect(await pageNames(db, [])).toEqual({});
  });
});

describe("a reply's page names", () => {
  let student: { id: string; grade: number; displayName: string };

  beforeEach(async () => {
    const res = await registerStudent(
      db,
      { displayName: "Maya", email: "maya@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    student = { id: res.value.userId, grade: 10, displayName: "Maya" };
  });

  /** A model that screens every message as safe and answers with `reply`. */
  function fakeClient(reply: string) {
    const message = (model: string, text: string) => ({
      stop_reason: "end_turn",
      model,
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    return {
      beta: {
        messages: {
          create: async (params: { model: string }) =>
            message(params.model, JSON.stringify({ category: "none", severity: "none", rationale: "t" })),
          toolRunner: () => ({
            async *[Symbol.asyncIterator]() {
              yield {
                async *[Symbol.asyncIterator]() {
                  yield { type: "content_block_delta", delta: { type: "text_delta", text: reply } };
                },
                finalMessage: async () => message("claude-opus-5", reply),
              };
            },
          }),
        },
      },
    } as never;
  }

  async function lastEvent(reply: string) {
    const events: CounselorEvent[] = [];
    for await (const e of respond(db, student, { text: "Tell me about Ohio State" }, { client: fakeClient(reply), now })) events.push(e);
    return events.at(-1);
  }

  it("come with the end of the stream", async () => {
    const reply = "Ohio State is big. Its page is /colleges/204796, and nursing is at /careers/29-1141.00. Also see /colleges/1.";
    expect(await lastEvent(reply)).toEqual({
      type: "done",
      messageId: expect.any(String),
      names: { "/colleges/204796": "Ohio State University-Main Campus", "/careers/29-1141.00": "Registered Nurses" },
    });
  });

  it("are left out when the reply links to no college or career", async () => {
    expect(await lastEvent("Ohio State is a big public university in Columbus.")).toEqual({ type: "done", messageId: expect.any(String) });
  });
});
