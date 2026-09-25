import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { toAiContext } from "@/lib/ai/privacy";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import { planSummary } from "@/lib/courses/service";
import { counselorExtraTools } from "@/lib/counselor/extra-tools";
import { buildStudentContext } from "@/lib/counselor/prompt";
import { type CounselorEvent, respond } from "@/lib/counselor/respond";
import { counselorTools } from "@/lib/counselor/tools";
import { addNorthStar } from "@/lib/goals";
import { explainLatestMatches } from "@/lib/matching/explain";
import { computeMatches, loadOccupationProfiles } from "@/lib/matching/service";
import { exportStudentData } from "@/lib/privacy";
import { saveSchoolSettings } from "@/lib/schools/student";
import { insertSchools, school } from "@/lib/schools/test-fixtures";

// The school a student goes to identifies them (a first name, a grade and a small school are
// enough), so it never goes to the AI provider. This builds a student with a named school, a
// district, a next school they typed themselves and a state, then checks every payload an AI
// feature builds for them: the counselor's context, its tools' answers, the whole request the
// counselor sends, and the career explanation's facts. The state may appear; the school may not.

const NOW = new Date("2026-09-25T15:00:00Z");
const SCHOOL = school({
  schoolRef: "nces:489999912345",
  name: "ZEPHYRHILL UNIQUE H S",
  state: "TX",
  city: "Quillfeather",
  leaName: "Quillfeather Wren ISD",
  leaId: "4899999",
});
// Everything that could point to the school: its names, id, district and town, and the next
// school the family typed for themselves.
const FORBIDDEN = [/zephyrhill/i, /489999912345/, /nces:\d/i, /quillfeather/i, /wren isd/i, /4899999/, /brambleton/i];

let db: Db;
let userId: string;

function expectNoSchool(label: string, payload: unknown) {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const pattern of FORBIDDEN) expect(json, `${label} mentions ${pattern}`).not.toMatch(pattern);
}

async function takeInterests(answers: Partial<Record<Riasec, number>>) {
  const start = await startOrResumeAttempt(db, userId, "interests", NOW);
  if (!start.ok) throw new Error();
  await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answers[i.area] ?? 1])));
  await completeAttempt(db, userId, start.attempt.id, NOW);
  await computeMatches(db, userId);
}

beforeEach(async () => {
  db = await createTestDb();
  await insertSchools(db, [SCHOOL]);
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "Does the work." })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) => (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 }))),
  );
  await loadOccupationProfiles(db, { fresh: true });

  const res = await registerStudent(
    db,
    { displayName: "Maya", email: "maya@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    NOW,
  );
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
  const saved = await saveSchoolSettings(
    db,
    userId,
    { state: "TX", current: { choice: "listed", schoolRef: SCHOOL.schoolRef }, next: { choice: "not_listed", name: "Brambleton Academy" } },
    { by: "student", now: NOW },
  );
  expect(saved).toEqual({ ok: true });

  await db.insert(schema.studentCourses).values([
    { userId, name: "Chemistry", subject: "science", gradeLevel: 10, courseTypeId: "sci.chem", courseTypeSource: "student" },
    { userId, name: "Algebra II", subject: "math", level: "honors", gradeLevel: 10 },
  ]);
  await addNorthStar(db, userId, "19-2031.00");
  await db.insert(schema.weeklySteps).values({ userId, weekStart: "2026-09-21", text: "Ask about AP Chemistry" });
  await takeInterests({ I: 5, R: 4, A: 3 });
});

describe("no AI payload carries the student's school", () => {
  it("the stored settings really do name the school (so the checks below mean something)", async () => {
    const data = await exportStudentData(db, userId, userId);
    expect(JSON.stringify(data)).toMatch(/Zephyrhill Unique High School/);
    expect(JSON.stringify(data)).toMatch(/Brambleton Academy/);
    expect(data?.profile.homeState).toBe("TX");
  });

  it("StudentAiContext: the state, never the school", async () => {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const ctx = toAiContext({ ...row, grade: 10 });
    expect(ctx).toEqual({ grade: 10, gradeBand: "build", homeState: "TX" });
    expectNoSchool("StudentAiContext", ctx);
  });

  it("the counselor's student context", async () => {
    const context = await buildStudentContext(db, { id: userId, grade: 10 }, { now: NOW, knownNames: ["Maya"] });
    expect(context).toContain("Grade 10");
    expectNoSchool("counselor context", context);
  });

  it("the counselor's tools: plan, roadmap, college list and aid guide", async () => {
    const extra = await counselorExtraTools(db, { id: userId, grade: 10 }, { now: NOW });
    const tools = counselorTools({ db, userId, grade: 10, extra });
    const run = async (name: string, input: object) => {
      const tool = tools.find((t) => t.name === name) as unknown as { run: (input: object) => Promise<unknown> };
      return tool.run(input);
    };
    const plan = await run("get_my_plan", {});
    expect(String(plan)).toContain("Chemistry");
    expectNoSchool("get_my_plan", plan);
    expectNoSchool("get_my_roadmap", await run("get_my_roadmap", {}));
    expectNoSchool("get_my_college_list", await run("get_my_college_list", {}));
    expectNoSchool("get_aid_guide", await run("get_aid_guide", { sectionId: "state-aid-and-promise-programs" }));
    expectNoSchool("planSummary", await planSummary(db, userId));
  });

  it("the whole request the counselor sends, tools and context included", async () => {
    const requests: unknown[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: { model: string; system: string }) => {
            requests.push(params);
            const output = params.system.includes("private notes") ? { notes: [] } : { category: "none", severity: "none", rationale: "t" };
            return { stop_reason: "end_turn", model: params.model, content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 10, output_tokens: 5 } };
          },
          toolRunner: (params: object) => {
            requests.push(params);
            return {
              async *[Symbol.asyncIterator]() {
                yield {
                  async *[Symbol.asyncIterator]() {
                    yield { type: "content_block_delta", delta: { type: "text_delta", text: "Chemistry is a good next step." } };
                  },
                  finalMessage: async () => ({
                    stop_reason: "end_turn",
                    model: "claude-opus-5",
                    content: [{ type: "text", text: "Chemistry is a good next step." }],
                    usage: { input_tokens: 1000, output_tokens: 100 },
                  }),
                };
              },
            };
          },
        },
      },
    } as never;
    const extraTools = await counselorExtraTools(db, { id: userId, grade: 10 }, { now: NOW });
    const events: CounselorEvent[] = [];
    for await (const e of respond(db, { id: userId, grade: 10, displayName: "Maya" }, { text: "Which science should I take next year?" }, { client, extraTools, now: NOW })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "delta")).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expectNoSchool("counselor requests", requests);
  });

  it("the career explanation's facts", async () => {
    const requests: unknown[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: { model: string }) => {
            requests.push(params);
            return {
              model: params.model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify({ overview: "You like figuring things out.", careers: [] }) }],
              usage: { input_tokens: 800, output_tokens: 300 },
            };
          },
        },
      },
    } as never;
    const explanation = await explainLatestMatches(db, userId, { now: NOW, client });
    expect(explanation?.source).toBe("ai");
    expect(requests).toHaveLength(1);
    expectNoSchool("explain request", requests);
  });
});
