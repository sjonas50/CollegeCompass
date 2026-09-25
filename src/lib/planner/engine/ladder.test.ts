import { describe, expect, it } from "vitest";
import type { SchoolGrade } from "../common";
import { type LadderConstraint, type LadderProblem, rungTypes, solveLadder } from "./ladder";

// The math ladder solver (design §5.6): exact, deterministic, one rung a year by default.

const calcBy12: LadderConstraint = { id: "calc", rank: 5, byGrade: 12, hard: false, priority: 3, label: "calculus" };

function problem(p: Partial<LadderProblem>): LadderProblem {
  return {
    grades: [9, 10, 11, 12],
    start: 0,
    locked: new Map(),
    available: () => true,
    constraints: [calcBy12],
    moves: { double: false, summer: false },
    ...p,
  };
}

describe("math ladder", () => {
  it("Algebra I in 8th keeps calculus in 12th open, with no slack anywhere", () => {
    const sol = solveLadder(problem({ grades: [8, 9, 10, 11, 12] as SchoolGrade[] }));
    expect(sol.steps.map((s) => [s.grade, s.rank])).toEqual([
      [8, 1],
      [9, 2],
      [10, 3],
      [11, 4],
      [12, 5],
    ]);
    expect(sol.unmet).toEqual([]);
    expect(sol.slack.every((s) => s.latest === s.step.grade)).toBe(true);
  });

  it("with Algebra I in 9th, calculus by 12th doesn't fit at one class a year", () => {
    const sol = solveLadder(problem({ start: 1, grades: [10, 11, 12] as SchoolGrade[] }));
    expect(sol.unmet.map((u) => u.id)).toEqual(["calc"]);
    expect(sol.steps.map((s) => s.rank)).toEqual([2, 3, 4]);
  });

  it("reaches it by doubling up or in summer only when those moves are allowed", () => {
    const base = problem({ start: 1, grades: [10, 11, 12] as SchoolGrade[] });
    const doubled = solveLadder({ ...base, moves: { double: true, summer: false } });
    expect(doubled.unmet).toEqual([]);
    expect(doubled.steps.filter((s) => s.grade === doubled.steps.find((t, i) => doubled.steps.some((u, j) => j !== i && u.grade === t.grade))?.grade)).toHaveLength(2);
    const summer = solveLadder({ ...base, moves: { double: false, summer: true } });
    expect(summer.unmet).toEqual([]);
    expect(summer.steps.some((s) => s.summer)).toBe(true);
  });

  it("never counts a summer class after 12th grade", () => {
    const sol = solveLadder(problem({ start: 1, grades: [11, 12] as SchoolGrade[], moves: { double: false, summer: true }, constraints: [{ ...calcBy12, rank: 4 }] }));
    expect(sol.steps.every((s) => !(s.summer && s.grade === 12))).toBe(true);
  });

  it("keeps the student's own math rows (locked) and plans around them", () => {
    const sol = solveLadder(problem({ start: 1, locked: new Map([[10 as SchoolGrade, 2]]), constraints: [{ ...calcBy12, rank: 4 }] }));
    expect(sol.steps.map((s) => [s.grade, s.rank])).toEqual([
      [11, 3],
      [12, 4],
    ]);
    expect(sol.steps.some((s) => s.grade === 10)).toBe(false);
  });

  it("skips grades where no class at the next rung is offered", () => {
    const sol = solveLadder(problem({ start: 3, grades: [11, 12] as SchoolGrade[], available: (g, r) => !(g === 11 && r === 4), constraints: [{ ...calcBy12, rank: 4 }] }));
    expect(sol.steps.map((s) => [s.grade, s.rank])).toEqual([[12, 4]]);
  });

  it("prefers meeting a required rung over a softer target", () => {
    const hard: LadderConstraint = { id: "alg2", rank: 3, byGrade: 11, hard: true, priority: 1, label: "Algebra II" };
    const sol = solveLadder(problem({ start: 1, grades: [10, 11] as SchoolGrade[], constraints: [hard, calcBy12] }));
    expect(sol.unmet.map((u) => u.id)).toEqual(["calc"]);
    expect(sol.steps.map((s) => s.rank)).toEqual([2, 3]);
  });

  it("doesn't climb past its highest target", () => {
    const sol = solveLadder(problem({ start: 1, constraints: [{ ...calcBy12, rank: 3 }] }));
    expect(Math.max(...sol.steps.map((s) => s.rank))).toBe(3);
  });

  it("reports slack: a step with room to spare isn't a deadline", () => {
    const sol = solveLadder(problem({ start: 1, constraints: [{ ...calcBy12, rank: 3 }] }));
    const geometry = sol.slack.find((s) => s.step.rank === 2)!;
    expect(geometry.step.grade).toBe(9);
    expect(geometry.latest).toBe(11);
  });

  it("follows the student's family of courses", () => {
    expect(rungTypes("ut", 3)[0]).toBe("math.ut_sec3");
    expect(rungTypes("integrated", 2)[0]).toBe("math.int2");
    expect(rungTypes("traditional", 1)[0]).toBe("math.alg1");
    expect(rungTypes("traditional", 4)).toContain("math.precalc");
  });

  it("is deterministic", () => {
    const p = problem({ start: 1, moves: { double: true, summer: true } });
    expect(JSON.stringify(solveLadder(p))).toBe(JSON.stringify(solveLadder(p)));
  });
});
