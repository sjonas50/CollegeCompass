import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { MatchExplanation } from "@/db/schema";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "../assessments/instruments";
import { interestPattern } from "../assessments/interest-pattern";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import {
  AREA_PHRASE,
  EXPLANATION_FACTS_VERSION,
  MAX_REASON_WORDS,
  type TemplateCareer,
  careerClause,
  explainLatestMatches,
  interestFacts,
  storedExplanation,
  strengthFacts,
  templateExplanation,
} from "./explain";
import { fitLabel, scoreOccupation } from "./match";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "./service";

// The written explanation of a student's matches never claims interest areas their scores don't
// show: not for a tie, and not when every area scored about the same.

const areas = (scores: Partial<Record<Riasec, number>>) => ({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, ...scores });
const profile = (scores: Partial<Record<Riasec, number>>) => ({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1, ...scores });
// Real O*NET descriptions and job zones.
const chemist = {
  occupationCode: "19-2031.00",
  title: "Chemists",
  jobZone: 4,
  description:
    "Conduct qualitative and quantitative chemical analyses or experiments in laboratories for quality or process control or to develop new products or knowledge.",
  interests: profile({ I: 7, R: 4 }),
};
const teacher = {
  occupationCode: "25-2031.00",
  title: "Secondary School Teachers",
  jobZone: 4,
  description: "Teach one or more subjects to students at the secondary school level.",
  interests: profile({ S: 7, A: 4 }),
};
const electrician = {
  occupationCode: "47-2111.00",
  title: "Electricians",
  jobZone: 3,
  description: "Install, maintain, and repair electrical wiring, equipment, and fixtures. Ensure that work is in accordance with relevant codes.",
  interests: profile({ R: 7, C: 4, I: 3 }),
};
const counselor = {
  occupationCode: "21-1014.00",
  title: "Mental Health Counselors",
  jobZone: 5,
  description: "Counsel and advise individuals and groups to promote optimum mental and emotional health, with an emphasis on prevention.",
  interests: profile({ S: 7, I: 4, A: 3 }),
};
const page = [chemist, teacher, electrician, counselor];
const reasons = (scores: Partial<Record<Riasec, number>>, careers: TemplateCareer[] = page) =>
  templateExplanation(areas(scores), careers).careers.map((c) => c.why);
const wordCount = (s: string) => s.split(/\s+/).length;

describe("template explanation", () => {
  it("says what the work is, the preparation it needs, and the interests it shares with the student", () => {
    const e = templateExplanation(areas({ I: 40, R: 30, A: 20 }), [chemist, electrician, counselor]);
    expect(e.overview).toMatch(/^Your strongest interest areas are Investigative and Realistic, followed by Artistic\./);
    expect(e.careers.map((c) => c.why)).toEqual([
      "With a bachelor's degree, you could conduct qualitative and quantitative chemical analyses or experiments, using your interest in figuring things out and hands-on work.",
      "With career training or a two-year degree, you'd install, maintain, and repair electrical wiring, equipment, and fixtures, which fits your interest in hands-on work.",
      "With a graduate degree, you could counsel and advise individuals and groups, using your interest in figuring things out.",
    ]);
  });

  it("names only areas the student leans toward, never one they disliked", () => {
    // Artistic reached "Not sure" (20 of 40); teaching is strongly social, which this student disliked.
    expect(reasons({ I: 40, R: 30, A: 20 }, [teacher])).toEqual([
      "With a bachelor's degree, you could teach one or more subjects to students at the secondary school level, using your interest in creating things.",
    ]);
    // One "Dislike" among the social activities: Social scored 1 of 40.
    const [chemistWhy, teacherWhy, electricianWhy, counselorWhy] = reasons({ A: 40, S: 1 });
    expect(teacherWhy).toMatch(/your interest in creating things\.$/);
    for (const why of [chemistWhy, electricianWhy, counselorWhy]) expect(why).not.toMatch(/interest/);
    expect([chemistWhy, teacherWhy, electricianWhy, counselorWhy].join(" ")).not.toMatch(/helping people|figuring things out|hands-on/);

    // Areas the student liked count even when a tie keeps them out of the top interests.
    expect(reasons({ I: 40, A: 30, S: 30, E: 30 })[3]).toBe(
      "With a graduate degree, you'd counsel and advise individuals and groups, which fits your interest in figuring things out and helping people.",
    );
  });

  it("never names an area the student leaned toward disliking, for any scores", () => {
    // A fixed pseudo-random walk over scores and career profiles.
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const areasList = ["R", "I", "A", "S", "E", "C"] as const;
    for (let round = 0; round < 300; round++) {
      const student = Object.fromEntries(areasList.map((a) => [a, next(41)])) as Record<Riasec, number>;
      const careers = Array.from({ length: 8 }, (_, i) => ({
        ...chemist,
        occupationCode: `code-${i}`,
        title: `Career ${i}`,
        interests: Object.fromEntries(areasList.map((a) => [a, 1 + next(7)])) as Record<Riasec, number>,
      }));
      const e = templateExplanation(student, careers);
      const disliked = areasList.filter((a) => student[a] < 20).map((a) => AREA_PHRASE[a]);
      for (const { why } of e.careers) {
        for (const phrase of disliked) expect(why, JSON.stringify(student)).not.toContain(phrase);
      }
      expect(new Set(e.careers.map((c) => c.why)).size).toBe(careers.length);
    }
  });

  it("says no area stands out when every area scored about the same, and names none in the reasons", () => {
    for (const level of [0, 20, 40]) {
      const e = templateExplanation(areas({ R: level, I: level, A: level, S: level, E: level, C: level }), page);
      expect(e.overview).toMatch(/^You rated all six interest areas about the same, so no area stands out yet\./);
      expect(e.overview).not.toMatch(/strongest|Realistic|Investigative/);
      expect(e.careers.map((c) => c.why)).toEqual([
        "With a bachelor's degree, you could conduct qualitative and quantitative chemical analyses or experiments.",
        "With a bachelor's degree, you'd teach one or more subjects to students at the secondary school level.",
        "With career training or a two-year degree, you could install, maintain, and repair electrical wiring, equipment, and fixtures.",
        "With a graduate degree, you'd counsel and advise individuals and groups.",
      ]);
      expect(e.careers.every((c) => !/interest/.test(c.why))).toBe(true);
    }
  });

  it("says no area stands out when no area reached 'Not sure' on average", () => {
    // "Dislike" on the Conventional activities and "Strongly dislike" on the rest.
    const e = templateExplanation(areas({ C: 10 }), page);
    expect(e.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(e.overview).not.toMatch(/strongest|Conventional/);
    expect(e.careers.every((c) => !/interest|organized/.test(c.why))).toBe(true);
  });

  it("never gives two careers on a page the same reason", () => {
    // No descriptions, the same preparation and the same interests: only the career's name differs.
    const alike = Array.from({ length: 6 }, (_, i) => ({ occupationCode: `27-10${i}`, title: `Designers ${i}`, jobZone: 4, interests: profile({ A: 7 }) }));
    const whys = reasons({ A: 40 }, alike);
    expect(new Set(whys).size).toBe(6);
    expect(whys.slice(0, 2)).toEqual([
      "With a bachelor's degree, this career uses your interest in creating things.",
      "With a bachelor's degree, this path fits your interest in creating things.",
    ]);
    // Neighbors start from different wordings. (Two areas would make these too long, so one is named.)
    expect(reasons({ A: 40, S: 30 }, [teacher, { ...teacher, occupationCode: "25-2022.00", title: "Middle School Teachers" }])).toEqual([
      "With a bachelor's degree, you could teach one or more subjects to students at the secondary school level, using your interest in creating things.",
      "With a bachelor's degree, you'd teach one or more subjects to students at the secondary school level, which fits your interest in creating things.",
    ]);
  });

  it("keeps each reason to one short sentence", () => {
    for (const scores of [{ I: 40, R: 30, A: 20 }, { A: 40, S: 30 }, { S: 40, I: 30, A: 25 }, { R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 }]) {
      for (const why of reasons(scores)) {
        expect(wordCount(why), why).toBeLessThanOrEqual(MAX_REASON_WORDS);
        expect(why.match(/[.!?](\s|$)/g), why).toHaveLength(1);
      }
    }
  });
});

describe("what a career involves, from its O*NET description", () => {
  it.each([
    [
      "Design or create graphics to meet specific commercial or promotional needs, such as packaging, displays, or logos. May use a variety of mediums.",
      "design or create graphics to meet specific commercial or promotional needs",
    ],
    [
      "Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records. Administer nursing care.",
      "assess patient health problems and needs",
    ],
    [
      "Install, configure, and maintain an organization's local area network (LAN), wide area network (WAN), data communications network, operating systems, and physical and virtual servers.",
      "install, configure, and maintain an organization's local area network",
    ],
    ["Create original artwork using any of a wide variety of media and techniques.", "create original artwork using any of a wide variety of media and techniques"],
    [
      "Teach courses pertaining to the culture and development of an area, an ethnic group, or any other group, such as Latin American studies.",
      "teach courses in the culture and development",
    ],
    ["Under the direction of a dentist, perform limited clinical duties, such as equipment preparation and sterilization.", "perform limited clinical duties"],
    ["Lead U.S. Army units in combat. Plan missions.", "lead U.S. Army units in combat"],
  ])("%s", (description, clause) => {
    expect(careerClause(description)).toBe(clause);
  });

  it("cuts a long one before a linking word, never mid-list or after 'any'", () => {
    const artists = "Create original artwork using any of a wide variety of media and techniques.";
    expect(careerClause(artists, 12)).toBe("create original artwork");
    expect(careerClause("Evaluate, authorize, or recommend approval of commercial, real estate, or credit loans.", 10)).toBe(
      "evaluate, authorize, or recommend approval",
    );
  });

  it("has nothing to say without a description", () => {
    expect(careerClause("")).toBeNull();
    expect(careerClause(null)).toBeNull();
    expect(careerClause("Operate.")).toBeNull();
  });
});

describe("template overview", () => {
  it("calls a tie a tie", () => {
    expect(templateExplanation(areas({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. Enterprising and Conventional are tied after them\./,
    );
    expect(templateExplanation(areas({ R: 30, I: 30, A: 20, S: 10, E: 5 }), [chemist]).overview).toMatch(
      /^Your strongest interest areas are Realistic, Investigative and Artistic\. Realistic and Investigative are tied\./,
    );
    expect(templateExplanation(areas({ A: 40, S: 30, R: 20, I: 20, E: 20, C: 20 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. The other four areas are tied\./,
    );
  });

  it("never names an area below 'Not sure' as one of the student's interests", () => {
    // One "Dislike" among the social activities: Social scored 1 of 40, so it isn't second.
    const e = templateExplanation(areas({ A: 40, S: 1 }), [teacher]);
    expect(e.overview).toMatch(/^Artistic stands out\. You leaned toward disliking the other five areas\./);
    expect(e.careers[0].why).toBe(
      "With a bachelor's degree, you could teach one or more subjects to students at the secondary school level, using your interest in creating things.",
    );
    expect(templateExplanation(areas({ A: 40, S: 30 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. You leaned toward disliking the other four areas\./,
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
    if (pattern.kind === "flat" || pattern.kind === "low") throw new Error(pattern.kind);
    return interestFacts(pattern, areas(scores));
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

  it("gives only the areas that reached 'Not sure' as top interests, with no code, and says the rest were disliked", () => {
    // The scoring's code is "ARI": Realistic and Investigative fill it in RIASEC order at 0 of 40.
    const f = facts({ A: 40 });
    expect(f).not.toHaveProperty("interestCode");
    expect(f).not.toHaveProperty("tiedAreas");
    expect(names(f)).toEqual(["Artistic"]);
    expect(f).toMatchObject({
      otherAreas: "Realistic, Investigative, Social, Enterprising and Conventional are below the top interests, and the student leaned toward disliking them.",
    });

    // One "Dislike" among the social activities (1 of 40) doesn't make Social an interest, or the code "ASR".
    const barely = facts({ A: 40, S: 1 });
    expect(barely).not.toHaveProperty("interestCode");
    expect(names(barely)).toEqual(["Artistic"]);
    expect(barely).toEqual(f);
    expect(names(facts({ A: 40, S: 30, E: 19 }))).toEqual(["Artistic", "Social"]);
  });

  it("gives only the areas above a tie as top interests, and how the tied areas were rated", () => {
    const third = facts({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 });
    expect(third).not.toHaveProperty("interestCode");
    expect(names(third)).toEqual(["Artistic", "Social"]);
    expect(third).toMatchObject({
      tiedAreas: "Enterprising and Conventional are tied below the top interests, and on average the student was not sure about them.",
    });

    // Liked areas kept out of the top by a tie are still liked.
    const liked = facts({ I: 40, A: 30, S: 30, E: 30 });
    expect(names(liked)).toEqual(["Investigative"]);
    expect(liked).toMatchObject({
      tiedAreas: "Artistic, Social and Enterprising are tied below the top interests, and the student leaned toward liking them.",
    });
  });

  it("gives every area tied for first as a top interest, and says they're tied", () => {
    const f = facts({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 });
    expect(f).not.toHaveProperty("interestCode");
    expect(names(f)).toEqual(["Realistic", "Investigative", "Artistic", "Social"]);
    expect(f).toMatchObject({ tiedAreas: "Realistic, Investigative, Artistic and Social are tied for the top interest." });
  });
});

describe("what the model is told about strengths", () => {
  it("gives the strengths wording students see, leaving out emotional stability", () => {
    const facts = strengthFacts({ extraversion: 80, agreeableness: 50, conscientiousness: 20, neuroticism: 90, intellect: 70 });
    expect(facts).toEqual([
      "Social energy: You get energy from being around people and feel comfortable speaking up.",
      "Warmth: You care about others and can also stand your ground when it matters.",
      "Organization: You're flexible and spontaneous. Simple habits, like a planner, can help you reach big goals.",
      "Curiosity: You love ideas, imagination, and big questions.",
    ]);
  });
});

describe("stored explanations", () => {
  const old: MatchExplanation = { source: "ai", overview: "Written from the code's three letters.", careers: [] };
  const current: MatchExplanation = { ...old, factsVersion: EXPLANATION_FACTS_VERSION };
  const stored = (explanation: MatchExplanation | null, scores: Partial<Record<Riasec, number>>) =>
    storedExplanation(explanation, interestPattern(areas(scores)));

  it("keeps one written from older facts only for a clear code with no ties", () => {
    expect(stored(old, { A: 40, S: 30, E: 20 })).toBe(old);
    // A tie inside the code, a tie below the top, only one or two areas at "Not sure".
    for (const scores of [{ R: 30, I: 30, A: 20 }, { A: 40, S: 30, E: 20, C: 20 }, { A: 40, S: 1 }, { A: 40, S: 30 }]) {
      expect(stored(old, scores), JSON.stringify(scores)).toBeNull();
      expect(stored(current, scores), JSON.stringify(scores)).toBe(current);
    }
  });

  it("never keeps one when no area stands out", () => {
    expect(stored(current, { R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 })).toBeNull();
    expect(stored(current, { C: 10 })).toBeNull();
    expect(stored(null, { A: 40, S: 30, E: 20 })).toBeNull();
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

  it("still returns a stored explanation for a clear code, without asking again", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    const run = await latestMatchRun(db, userId);
    // Stored before facts had a version: for a clear code with no ties, the facts are the same.
    const stored: MatchExplanation = { source: "ai", overview: "You like figuring things out.", careers: [] };
    await db.update(schema.matchRuns).set({ explanation: stored }).where(eq(schema.matchRuns.id, run!.id));
    expect(await explainLatestMatches(db, userId, { now, client: refusingClient() })).toEqual(stored);
  });

  it.each([
    ["areas tied below the top", { A: 5, S: 4, E: 4, C: 4 }],
    ["only two areas reaching 'Not sure'", { A: 5, S: 2 }],
    ["areas tied inside the code", { R: 5, I: 5, A: 4 }],
  ])("writes an explanation stored from older facts again for %s", async (_, answers: Partial<Record<Riasec, number>>) => {
    await takeInterests(answers);
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "You love creating things, working with your hands and figuring things out.",
      careers: [{ code: "19-2031.00", why: "Chemists use the hands-on skills you enjoy." }],
    };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const { client, requests } = recordingClient({ overview: "You love making things.", careers: [] });
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(requests).toHaveLength(1);
    expect(explanation).toMatchObject({ source: "ai", overview: "You love making things.", factsVersion: EXPLANATION_FACTS_VERSION });
    expect(JSON.stringify(explanation)).not.toContain("hands-on skills");

    // Stored with the new version, so it isn't written a third time.
    expect((await latestMatchRun(db, userId))?.explanation).toMatchObject({ factsVersion: EXPLANATION_FACTS_VERSION });
    expect(await explainLatestMatches(db, userId, { now, client: refusingClient() })).toEqual(explanation);
  });

  it("uses the template for a stale explanation when the model can't write a new one", async () => {
    await takeInterests({ A: 5 });
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = { source: "ai", overview: "You love hands-on work and figuring things out.", careers: [] };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^Artistic stands out\. You leaned toward disliking the other five areas\./);
  });

  it("tells the model only the areas that reached 'Not sure', not the code's RIASEC-order picks", async () => {
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
    expect(facts).not.toHaveProperty("tiedAreas");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Artistic"]);
    expect(facts.otherAreas).toBe(
      "Realistic, Investigative, Social, Enterprising and Conventional are below the top interests, and the student leaned toward disliking them.",
    );
    expect(facts.grade).toBe(10);
    expect(facts.careers.map((c: { code: string }) => c.code).sort()).toEqual(["19-2031.00", "25-2031.00"]);
  });

  it("never tells the model a disliked area is a top interest", async () => {
    // "Dislike" on every social activity (10 of 40): the code is "ASR", but Social isn't an interest.
    await takeInterests({ A: 5, S: 2 });
    const { client, requests } = recordingClient({ overview: "You love making things.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Artistic"]);
  });

  it("tells the model how areas tied below the top were rated", async () => {
    // "Strongly like" investigative activities and "Like" artistic, social and enterprising ones.
    await takeInterests({ I: 5, A: 4, S: 4, E: 4 });
    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Investigative"]);
    expect(facts.tiedAreas).toBe("Artistic, Social and Enterprising are tied below the top interests, and the student leaned toward liking them.");
  });

  it("never tells the model how the student handles stress", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    // "Very accurate" for every statement, "I get upset easily" and "I have frequent mood swings" too.
    const start = await startOrResumeAttempt(db, userId, "personality", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 5])));
    await completeAttempt(db, userId, start.attempt.id, now);

    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const content = requests[0].messages[0].content;
    const facts = JSON.parse(content.replace(/^[^\n]*\n/, ""));
    expect(facts.strengths.map((s: string) => s.split(":")[0])).toEqual(["Social energy", "Warmth", "Organization", "Curiosity"]);
    expect(content).not.toMatch(/Staying calm|stress|feel things deeply|bounce back/i);
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
