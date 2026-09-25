import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import { costMicros } from "@/lib/ai/models";
import { getCareer, searchCareers } from "@/lib/careers";
import { MAX_NORTH_STARS, addNorthStar, listNorthStars } from "@/lib/goals";
import { explainLatestMatches } from "@/lib/matching/explain";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { fallbackUsage, stubAnthropic } from "./anthropic-stub";

const now = new Date("2026-09-23T12:00:00Z");
let db: Db;
let userId: string;

async function seedReference() {
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
    ["17-2051.00", "Civil Engineers", 4, { R: 6, I: 6 }],
    ["29-2012.00", "Medical and Clinical Laboratory Technicians", 3, { I: 6, R: 5, C: 4 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ["27-1024.00", "Graphic Designers", 4, { A: 7 }],
    ["43-4071.00", "File Clerks", 2, { C: 7 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: `${title} do things.` })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await db.insert(schema.majors).values([{ cipCode: "40.0501", title: "Chemistry, General" }]);
  await db.insert(schema.cipSocLinks).values([{ cipCode: "40.0501", socCode: "19-2031" }]);
  await loadOccupationProfiles(db, { fresh: true });
}

beforeEach(async () => {
  db = await createTestDb();
  await seedReference();
  const res = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
});

async function completeInterests() {
  const start = await startOrResumeAttempt(db, userId, "interests", now);
  if (!start.ok) throw new Error();
  const scientist = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : i.area === "R" ? 4 : 2]));
  await saveResponses(db, userId, start.attempt.id, scientist);
  await completeAttempt(db, userId, start.attempt.id, now);
  return computeMatches(db, userId);
}

/** A stand-in for the Anthropic client that returns fixed output (null: refuses). */
function fakeClient(output: unknown) {
  return {
    beta: {
      messages: {
        create: async (params: { model: string }) => ({
          model: params.model,
          stop_reason: output ? "end_turn" : "refusal",
          content: output ? [{ type: "text", text: JSON.stringify(output) }] : [],
          usage: { input_tokens: 800, output_tokens: 300 },
        }),
      },
    },
  } as never;
}

describe("discover flow", () => {
  it("computes matches from completed interests, grouped by pathway", async () => {
    expect(await computeMatches(db, userId)).toBeNull();
    await completeInterests();
    const run = await latestMatchRun(db, userId);
    expect(run?.matches[0].title).toBe("Chemists");
    expect(run?.matches.map((m) => m.title)).toContain("Medical and Clinical Laboratory Technicians");
  });

  it("stores the AI explanation, keeping only careers it was asked about", async () => {
    await completeInterests();
    const explanation = await explainLatestMatches(db, userId, {
      now,
      client: fakeClient({
        overview: "You love figuring out how things work.",
        careers: [
          { code: "19-2031.00", why: "Chemists run experiments all day." },
          { code: "99-9999.99", why: "Invented career." },
        ],
      }),
    });
    expect(explanation?.source).toBe("ai");
    expect(explanation?.careers.find((c) => c.code === "19-2031.00")?.why).toBe("Chemists run experiments all day.");
    expect(explanation?.careers.some((c) => c.code === "99-9999.99")).toBe(false);
    expect((await latestMatchRun(db, userId))?.explanation?.source).toBe("ai");
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
  });

  it("falls back to a template without storing it when the model declines", async () => {
    await completeInterests();
    const explanation = await explainLatestMatches(db, userId, { now, client: fakeClient(null) });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toContain("Investigative");
    // The template's reason: the career's preparation, what the work is, and the interests it shares.
    expect(explanation?.careers.find((c) => c.code === "19-2031.00")?.why).toMatch(
      /^With a bachelor's degree, you could .+, using your interest in figuring things out and hands-on work\.$/,
    );
    expect((await latestMatchRun(db, userId))?.explanation).toBeNull();
  });

  it("records usage when the explanation is cut off at max_tokens, and falls back to the template", async () => {
    await completeInterests();
    const { client } = stubAnthropic(() => ({
      stop_reason: "max_tokens",
      text: '{"overview":"You love figuring things out.","careers":[{"code":"19-2031.00","why":"Chem',
      usage: { input_tokens: 800, output_tokens: 4000 },
    }));
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(explanation?.source).toBe("template");
    expect(await db.select().from(schema.aiUsage)).toMatchObject([{ feature: "explain", inputTokens: 800, outputTokens: 4000 }]);
    expect((await latestMatchRun(db, userId))?.explanation).toBeNull();
  });

  it("records usage when the model refuses with non-JSON text", async () => {
    await completeInterests();
    const { client } = stubAnthropic(() => ({ stop_reason: "refusal", text: "I can't help with that." }));
    expect((await explainLatestMatches(db, userId, { now, client }))?.source).toBe("template");
    expect(await db.select().from(schema.aiUsage)).toHaveLength(1);
  });

  it("charges each fallback attempt at the model that ran it", async () => {
    await completeInterests();
    const { client, requests } = stubAnthropic((body) => ({
      text: JSON.stringify({ overview: "You love figuring things out.", careers: [{ code: "19-2031.00", why: "Chemists experiment." }] }),
      model: "claude-opus-4-8",
      usage: fallbackUsage(body.model, "claude-opus-4-8"),
    }));
    expect((await explainLatestMatches(db, userId, { now, client }))?.source).toBe("ai");
    const requested = requests[0].model;
    const rows = await db.select().from(schema.aiUsage);
    expect(rows.map((r) => r.model).sort()).toEqual([requested, "claude-opus-4-8"].sort());
    expect(rows.reduce((s, r) => s + r.costMicros, 0)).toBe(
      costMicros(requested, { input_tokens: 1000, output_tokens: 400 }) +
        costMicros("claude-opus-4-8", { input_tokens: 1000, output_tokens: 200 }),
    );
  });

  it("limits students to two north stars", async () => {
    expect(await addNorthStar(db, userId, "19-2031.00")).toEqual({ ok: true });
    expect(await addNorthStar(db, userId, "27-1024.00")).toEqual({ ok: true });
    expect(await addNorthStar(db, userId, "25-2031.00")).toEqual({ ok: false, error: "limit" });
    expect(await addNorthStar(db, userId, "00-0000.00")).toEqual({ ok: false, error: "not_found" });
    expect(await listNorthStars(db, userId)).toHaveLength(MAX_NORTH_STARS);
  });

  it("shows career details with related majors, and searches titles", async () => {
    const chemist = await getCareer(db, "19-2031.00");
    expect(chemist).toMatchObject({ title: "Chemists", pathway: "degree", majors: [{ cipCode: "40.0501", title: "Chemistry, General" }] });
    expect(chemist?.interests[0].area).toBe("I");
    expect((await searchCareers(db, "engin")).map((c) => c.title)).toEqual(["Civil Engineers"]);
    expect(await searchCareers(db, "%")).toEqual([]);
  });

  it("exports and deletes all discover data with the student", async () => {
    await completeInterests();
    await addNorthStar(db, userId, "19-2031.00");
    const data = await exportStudentData(db, userId, userId);
    expect(data?.assessments[0].responses).toMatchObject({ I1: 5 });
    expect(data?.assessments[0].scores).toMatchObject({ code: "IRA" });
    expect(data?.careerMatches[0].matches.length).toBeGreaterThan(0);
    expect(data?.northStars).toHaveLength(1);

    expect(await deleteStudent(db, userId, userId)).toBe(true);
    for (const table of [schema.assessmentAttempts, schema.assessmentResponses, schema.assessmentResults, schema.matchRuns, schema.careerMatches, schema.northStarGoals]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    expect(await db.select().from(schema.occupations)).toHaveLength(6);
  });
});
