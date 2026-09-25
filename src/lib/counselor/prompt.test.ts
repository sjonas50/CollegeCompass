import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, type Riasec } from "../assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { buildStudentContext, formatStudentContext } from "./prompt";

// The counselor's private context tells it only the interests the scores support: never areas the
// interest code picked from a tie in RIASEC order, and no strongest interests when none stands out.

const now = new Date("2026-09-23T12:00:00Z");
const interestsLine = (context: string) => context.split("\n").find((l) => /interest/i.test(l));

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

  /** Finishes interests with one answer for every activity in an area (1, "Strongly dislike", if not given). */
  async function interestsFrom(answers: Partial<Record<Riasec, number>>) {
    const start = await startOrResumeAttempt(db, student.id, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, student.id, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answers[i.area] ?? 1])));
    await completeAttempt(db, student.id, start.attempt.id, now);
    return interestsLine(await buildStudentContext(db, student, { now }));
  }

  it("gives a clear top three", async () => {
    expect(await interestsFrom({ A: 5, S: 4, E: 3 })).toBe(
      "- Strongest interests: making things that express ideas; working with people; leading and influencing.",
    );
  });

  it("gives only the areas above a tie", async () => {
    // The code is "ARI", but Realistic and Investigative scored 0 of 40, like the other three.
    expect(await interestsFrom({ A: 5 })).toBe("- Strongest interests: making things that express ideas.");
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
