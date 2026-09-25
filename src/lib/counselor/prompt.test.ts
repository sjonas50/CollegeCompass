import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "../assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { buildStudentContext, formatStudentContext } from "./prompt";

// The counselor's private context tells it only the interests the scores support: never areas the
// interest code picked from a tie in RIASEC order, and no strongest interests when none stands out.

const now = new Date("2026-09-23T12:00:00Z");
const interestsLine = (context: string) => context.split("\n").find((l) => /interest/i.test(l));
const tiedBelowLine = (context: string) => context.split("\n").find((l) => l.includes("tied below the strongest"));

describe("formatting the interests line", () => {
  const base = { grade: 9, month: 8 };

  it("lists the strongest interests", () => {
    expect(interestsLine(formatStudentContext({ ...base, interests: ["helping people", "creating things"] }))).toBe(
      "- Strongest interests: helping people; creating things.",
    );
  });

  it("says when no area stands out, instead of listing strongest interests", () => {
    const context = formatStudentContext({ ...base, interests: [], interestsNoLead: "rated all six interest areas about the same" });
    expect(interestsLine(context)).toBe("- Rated all six interest areas about the same (no clear lead yet).");
    expect(context).not.toContain("Strongest interests");
    expect(context).not.toContain("Hasn't taken the interests assessment");
  });

  it("says how areas tied below the strongest were rated", () => {
    const areas = ["making things that express ideas", "working with people"];
    const context = (level: "liked" | "not sure" | "disliked") =>
      formatStudentContext({ ...base, interests: ["figuring things out"], interestsTiedBelow: { level, areas } });
    expect(tiedBelowLine(context("liked"))).toBe(
      "- Also leaned toward liking, tied below the strongest: making things that express ideas; working with people.",
    );
    expect(tiedBelowLine(context("not sure"))).toBe(
      '- Rated "Not sure" on average, tied below the strongest: making things that express ideas; working with people.',
    );
    expect(tiedBelowLine(context("disliked"))).toBe(
      "- Leaned toward disliking, tied below the strongest: making things that express ideas; working with people.",
    );
    // It follows the strongest interests.
    const lines = context("liked").split("\n");
    expect(lines.indexOf(tiedBelowLine(context("liked"))!)).toBe(lines.indexOf(interestsLine(context("liked"))!) + 1);
    expect(tiedBelowLine(formatStudentContext({ ...base, interests: ["figuring things out"] }))).toBeUndefined();
  });

  it("says when the assessment isn't done", () => {
    expect(interestsLine(formatStudentContext(base))).toBe(
      "- Hasn't taken the interests assessment yet (it's on their dashboard and unlocks career matches).",
    );
  });
});

describe("building the context from results", () => {
  let db: Db;
  let student: { id: string; grade: number };

  beforeEach(async () => {
    db = await createTestDb();
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    student = { id: res.value.userId, grade: 10 };
  });

  /**
   * Finishes interests with one answer for every activity in an area (1, "Strongly dislike", if not
   * given), or per activity in `items`, and returns the context.
   */
  async function contextFrom(answers: Partial<Record<Riasec, number>>, items: Record<string, number> = {}) {
    const start = await startOrResumeAttempt(db, student.id, "interests", now);
    if (!start.ok) throw new Error();
    const responses = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, items[i.id] ?? answers[i.area] ?? 1]));
    await saveResponses(db, student.id, start.attempt.id, responses);
    await completeAttempt(db, student.id, start.attempt.id, now);
    return buildStudentContext(db, student, { now });
  }
  const interestsFrom = async (answers: Partial<Record<Riasec, number>>) => interestsLine(await contextFrom(answers));

  it("gives a clear top three", async () => {
    expect(await interestsFrom({ A: 5, S: 4, E: 3 })).toBe(
      "- Strongest interests: making things that express ideas; working with people; leading and influencing.",
    );
  });

  it("gives only the areas that reached 'Not sure'", async () => {
    // The code is "ARI", but Realistic and Investigative scored 0 of 40, like the other three.
    const context = await contextFrom({ A: 5 });
    expect(interestsLine(context)).toBe("- Strongest interests: making things that express ideas.");
    expect(tiedBelowLine(context)).toBeUndefined();
  });

  it("never gives an area below 'Not sure' as a strongest interest", async () => {
    // One "Dislike" among the social activities: Social scores 1 of 40, and the code is "ASR".
    const social = INTEREST_ITEMS.find((i) => i.area === "S")!.id;
    const context = await contextFrom({ A: 5 }, { [social]: 2 });
    expect(interestsLine(context)).toBe("- Strongest interests: making things that express ideas.");
    expect(context).not.toContain("working with people");
  });

  it("keeps liked areas that a tie keeps out of the strongest", async () => {
    // "Strongly like" the investigative activities and "Like" the artistic, social and enterprising ones.
    const context = await contextFrom({ I: 5, A: 4, S: 4, E: 4 });
    expect(interestsLine(context)).toBe("- Strongest interests: figuring things out.");
    expect(tiedBelowLine(context)).toBe(
      "- Also leaned toward liking, tied below the strongest: making things that express ideas; working with people; leading and influencing.",
    );
  });

  it("says every area was rated about the same, with no strongest interests", async () => {
    expect(await interestsFrom({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 })).toBe(
      "- Rated all six interest areas about the same (no clear lead yet).",
    );
  });

  it("says when every area leaned toward 'Dislike'", async () => {
    expect(await interestsFrom({ C: 2 })).toBe("- Leaned toward disliking all six interest areas (no clear lead yet).");
  });
});

describe("strengths in the context", () => {
  let db: Db;
  let student: { id: string; grade: number };

  beforeEach(async () => {
    db = await createTestDb();
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    student = { id: res.value.userId, grade: 10 };
  });

  async function contextWithPersonality(answer: (item: (typeof PERSONALITY_ITEMS)[number]) => number) {
    const start = await startOrResumeAttempt(db, student.id, "personality", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, student.id, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, answer(i)])));
    await completeAttempt(db, student.id, start.attempt.id, now);
    return buildStudentContext(db, student, { now });
  }
  const strengthsLine = (context: string) => context.split("\n").find((l) => l.startsWith("- Strengths:"));

  it("sends four traits and never emotional stability (mood data about a minor)", async () => {
    // "Very accurate" on every statement that says the trait describes them, including mood swings
    // and getting upset easily; "Very inaccurate" on the rest.
    const stressed = await contextWithPersonality((i) => (i.keyed === 1 ? 5 : 1));
    const line = strengthsLine(stressed)!;
    expect(line).toContain("Social energy: You get energy from being around people");
    expect(line).toContain("Warmth: You're caring");
    expect(line).toContain("Organization: You like to plan ahead");
    expect(line).toContain("Curiosity: You love ideas");
    expect(line).not.toMatch(/Staying calm|feel things deeply|stress/i);
    expect(stressed).not.toMatch(/Staying calm|feel things deeply|mood|stress/i);
  });

  it("leaves emotional stability out at every level", async () => {
    for (const value of [1, 3, 5]) {
      db = await createTestDb();
      const res = await registerStudent(
        db,
        { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
        now,
      );
      if (!res.ok) throw new Error(res.error);
      student = { id: res.value.userId, grade: 10 };
      const context = await contextWithPersonality((i) => (i.factor === "neuroticism" ? value : 3));
      expect(strengthsLine(context)!.match(/(Social energy|Warmth|Organization|Curiosity|Staying calm):/g)).toEqual([
        "Social energy:",
        "Warmth:",
        "Organization:",
        "Curiosity:",
      ]);
    }
  });

  it("formats the four strengths on one line", () => {
    const context = formatStudentContext({ grade: 9, month: 8, strengths: ["Warmth: You're caring and tuned in to how other people feel."] });
    expect(strengthsLine(context)).toBe("- Strengths: Warmth: You're caring and tuned in to how other people feel.");
  });
});
