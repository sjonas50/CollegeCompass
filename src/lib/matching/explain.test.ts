import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { MatchExplanation } from "@/db/schema";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, type Riasec } from "../assessments/instruments";
import { interestPattern } from "../assessments/interest-pattern";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { explainLatestMatches, interestFacts, templateExplanation } from "./explain";
import { fitLabel, scoreOccupation } from "./match";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "./service";

// The written explanation of a student's matches never claims interest areas their scores don't
// show: not for a tie, and not when every area scored about the same.

const areas = (scores: Partial<Record<Riasec, number>>) => ({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, ...scores });
const profile = (scores: Partial<Record<Riasec, number>>) => ({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1, ...scores });
const chemist = { occupationCode: "19-2031.00", interests: profile({ I: 7, R: 4 }) };
const teacher = { occupationCode: "25-2031.00", interests: profile({ S: 7, A: 3 }) };

describe("template explanation", () => {
  it("names the strongest areas when they're clear", () => {
    const e = templateExplanation(areas({ I: 40, R: 30, A: 20 }), [chemist, teacher]);
    expect(e.overview).toMatch(/^Your strongest interest areas are Investigative and Realistic, followed by Artistic\./);
    expect(e.careers[0].why).toBe(
      "Combines figuring things out and hands-on work, which lines up with your investigative and realistic interests.",
    );
  });

  it("says no area stands out when every area scored about the same", () => {
    for (const level of [0, 20, 40]) {
      const e = templateExplanation(areas({ R: level, I: level, A: level, S: level, E: level, C: level }), [chemist, teacher]);
      expect(e.overview).toMatch(/^You rated all six interest areas about the same, so no area stands out yet\./);
      expect(e.overview).not.toMatch(/strongest|Realistic|Investigative/);
      expect(e.careers.map((c) => c.why)).toEqual(["Combines figuring things out and hands-on work.", "Combines helping people and creating things."]);
      expect(e.careers.every((c) => !/your .* interests/.test(c.why))).toBe(true);
    }
  });

  it("says no area stands out when no area reached 'Not sure' on average", () => {
    // "Dislike" on the Conventional activities and "Strongly dislike" on the rest.
    const e = templateExplanation(areas({ C: 10 }), [chemist, teacher]);
    expect(e.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(e.overview).not.toMatch(/strongest|Conventional/);
    expect(e.careers.map((c) => c.why)).toEqual(["Combines figuring things out and hands-on work.", "Combines helping people and creating things."]);
  });

  it("calls a tie a tie", () => {
    expect(templateExplanation(areas({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. Enterprising and Conventional are tied after them\./,
    );
    expect(templateExplanation(areas({ R: 30, I: 30, A: 20, S: 10, E: 5 }), [chemist]).overview).toMatch(
      /^Your strongest interest areas are Realistic, Investigative and Artistic\. Realistic and Investigative are tied\./,
    );
    expect(templateExplanation(areas({ A: 40, S: 30 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. The other four areas are tied\./,
    );
  });
});

describe("fit labels", () => {
  it("never calls a career a great or good fit for a flat profile", () => {
    // Every answer "Not sure": closeness scores run high for careers with middling profiles.
    const notSure = areas({ R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 });
    const middling = { code: "11-9151.00", title: "Managers", jobZone: 4, interests: profile({ R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }), values: {} };
    const { score } = scoreOccupation({ interests: notSure }, middling);
    expect(fitLabel(score)).toBe("Great fit");
    expect(fitLabel(score, { noLead: true })).toBe("Worth exploring");
    expect(fitLabel(90, { noLead: false })).toBe("Great fit");
    expect(fitLabel(75)).toBe("Good fit");
  });

  it("never calls a career a great fit when no area was liked, though its shape matches", () => {
    const clerk = { code: "43-4071.00", title: "File Clerks", jobZone: 2, interests: profile({ C: 7 }), values: {} };
    const { score } = scoreOccupation({ interests: areas({ C: 10 }) }, clerk);
    expect(score).toBe(100);
    expect(fitLabel(score, { noLead: true })).toBe("Worth exploring");
  });
});

describe("what the model is told about interests", () => {
  const facts = (scores: Partial<Record<Riasec, number>>) => {
    const pattern = interestPattern(areas(scores));
    if (pattern.kind !== "code" && pattern.kind !== "tied") throw new Error(pattern.kind);
    return interestFacts(pattern);
  };
  const names = (f: ReturnType<typeof facts>) => f.topInterests.map((t) => t.area);

  it("gives a clear code and its areas", () => {
    const f = facts({ A: 40, S: 30, E: 20 });
    expect(f).toMatchObject({ interestCode: "ASE" });
    expect(names(f)).toEqual(["Artistic", "Social", "Enterprising"]);
    expect(f.topInterests[0].meaning).toMatch(/^Making things that express ideas/);
    expect(f).not.toHaveProperty("tiedAreas");
  });

  it("says when areas in the code are tied", () => {
    const f = facts({ R: 30, I: 30, A: 20, S: 10, E: 5 });
    expect(f).toMatchObject({ interestCode: "RIA", tiedAreas: "Realistic and Investigative are tied, so their order doesn't matter." });
    expect(names(f)).toEqual(["Realistic", "Investigative", "Artistic"]);
  });

  it("gives only the areas above a tie as top interests, with no code", () => {
    // The scoring's code is "ARI": Realistic and Investigative fill it in RIASEC order at 0 of 40.
    const f = facts({ A: 40 });
    expect(f).not.toHaveProperty("interestCode");
    expect(names(f)).toEqual(["Artistic"]);
    expect(f).toMatchObject({ tiedAreas: "Realistic, Investigative, Social, Enterprising and Conventional are tied below the top interests." });

    const third = facts({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 });
    expect(names(third)).toEqual(["Artistic", "Social"]);
    expect(third).toMatchObject({ tiedAreas: "Enterprising and Conventional are tied below the top interests." });
  });

  it("gives every area tied for first as a top interest, and says they're tied", () => {
    const f = facts({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 });
    expect(f).not.toHaveProperty("interestCode");
    expect(names(f)).toEqual(["Realistic", "Investigative", "Artistic", "Social"]);
    expect(f).toMatchObject({ tiedAreas: "Realistic, Investigative, Artistic and Social are tied for the top interest." });
  });
});

describe("explaining matches when areas are tied or none stands out", () => {
  let db: Db;
  let userId: string;
  const now = new Date("2026-09-23T12:00:00Z");

  beforeEach(async () => {
    db = await createTestDb();
    const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
      ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
      ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ];
    await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
    await db.insert(schema.occupationInterests).values(
      occs.flatMap(([code, , , i]) =>
        (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
      ),
    );
    await loadOccupationProfiles(db, { fresh: true });
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    userId = res.value.userId;
  });

  /** Finishes interests with one answer for every activity in an area (1, "Strongly dislike", if not given). */
  async function takeInterests(answers: Partial<Record<Riasec, number>>) {
    const start = await startOrResumeAttempt(db, userId, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answers[i.area] ?? 1])));
    await completeAttempt(db, userId, start.attempt.id, now);
    await computeMatches(db, userId);
  }

  /** A fake model that records what it was asked and answers with `output`. */
  function recordingClient(output: unknown) {
    const requests: { messages: { content: string }[] }[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: { model: string; messages: { content: string }[] }) => {
            requests.push(params);
            return {
              model: params.model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(output) }],
              usage: { input_tokens: 800, output_tokens: 300 },
            };
          },
        },
      },
    } as never;
    return { client, requests };
  }

  const refusingClient = () =>
    ({
      beta: {
        messages: {
          create: async () => {
            throw new Error("the model should not be asked");
          },
        },
      },
    }) as never;

  it("uses the template without asking the model, which would be told the RIASEC-order code as top interests", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toContain("no area stands out");
    expect(await db.select().from(schema.aiUsage)).toHaveLength(0);
    // Not stored, like any template.
    expect((await latestMatchRun(db, userId))?.explanation).toBeNull();
  });

  it("uses the template when no area reached 'Not sure' on average", async () => {
    await takeInterests({ C: 2 });
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(await db.select().from(schema.aiUsage)).toHaveLength(0);
  });

  it("shows the template, not an explanation stored before this rule, when no area stands out", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "Your strongest interest areas are hands-on work and figuring things out.",
      careers: [{ code: "19-2031.00", why: "You love hands-on work." }],
    };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^You rated all six interest areas about the same/);
    expect(JSON.stringify(explanation)).not.toContain("hands-on work and figuring");
  });

  it("still returns a stored explanation when areas stand out, without asking again", async () => {
    await takeInterests({ I: 5, R: 4 });
    const run = await latestMatchRun(db, userId);
    const stored: MatchExplanation = { source: "ai", overview: "You like figuring things out.", careers: [] };
    await db.update(schema.matchRuns).set({ explanation: stored }).where(eq(schema.matchRuns.id, run!.id));
    expect(await explainLatestMatches(db, userId, { now, client: refusingClient() })).toEqual(stored);
  });

  it("tells the model only the areas above a tie, not the code's RIASEC-order picks", async () => {
    // "Strongly like" on every artistic activity, "Strongly dislike" on the rest: the code is "ARI".
    await takeInterests({ A: 5 });
    const { client, requests } = recordingClient({
      overview: "You love making things.",
      careers: [{ code: "25-2031.00", why: "Teachers make lessons come alive." }],
    });
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(explanation?.source).toBe("ai");
    expect(requests).toHaveLength(1);
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Artistic"]);
    expect(facts.tiedAreas).toBe("Realistic, Investigative, Social, Enterprising and Conventional are tied below the top interests.");
    expect(facts.grade).toBe(10);
    expect(facts.careers.map((c: { code: string }) => c.code).sort()).toEqual(["19-2031.00", "25-2031.00"]);
  });

  it("still gives the model a clear code", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts.interestCode).toBe("IRA");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Investigative", "Realistic", "Artistic"]);
    expect(facts).not.toHaveProperty("tiedAreas");
  });
});
