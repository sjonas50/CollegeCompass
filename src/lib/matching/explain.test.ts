import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, type Riasec } from "../assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { explainLatestMatches, templateExplanation } from "./explain";
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
    expect(fitLabel(score, { flat: true })).toBe("Worth exploring");
    expect(fitLabel(90, { flat: false })).toBe("Great fit");
    expect(fitLabel(75)).toBe("Good fit");
  });
});

describe("explaining a flat profile's matches", () => {
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

  it("uses the template without asking the model, which would be told the RIASEC-order code as top interests", async () => {
    const start = await startOrResumeAttempt(db, userId, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, 3])));
    await completeAttempt(db, userId, start.attempt.id, now);
    await computeMatches(db, userId);

    let asked = 0;
    const client = {
      beta: {
        messages: {
          create: async () => {
            asked++;
            throw new Error("the model should not be asked");
          },
        },
      },
    } as never;
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(asked).toBe(0);
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toContain("no area stands out");
    expect(await db.select().from(schema.aiUsage)).toHaveLength(0);
    // Not stored, like any template.
    expect((await latestMatchRun(db, userId))?.explanation).toBeNull();
  });
});
