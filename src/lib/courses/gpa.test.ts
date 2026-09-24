import { describe, expect, it } from "vitest";
import { type GpaCourse, GRADE_POINTS, computeGpa, countsTowardGpa, earnsCredit, formatGpa, gradePoints } from "./gpa";

const course = (over: Partial<GpaCourse> = {}): GpaCourse => ({
  gradeLevel: 9,
  level: "regular",
  credits: 1,
  status: "completed",
  finalGrade: "A",
  highSchoolCredit: true,
  ...over,
});

describe("grade points", () => {
  it("uses the unweighted 4.0 scale", () => {
    expect(GRADE_POINTS).toMatchObject({
      "A+": 4, A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7, F: 0,
    });
    expect(GRADE_POINTS.P).toBeNull();
  });

  it("adds +0.5 for honors and +1.0 for AP, IB and dual enrollment on passing grades only", () => {
    expect(gradePoints(course({ level: "honors", finalGrade: "B" }), true)).toBe(3.5);
    expect(gradePoints(course({ level: "ap", finalGrade: "A" }), true)).toBe(5);
    expect(gradePoints(course({ level: "ib", finalGrade: "C" }), true)).toBe(3);
    expect(gradePoints(course({ level: "dual_enrollment", finalGrade: "D-" }), true)).toBe(1.7);
    expect(gradePoints(course({ level: "ap", finalGrade: "F" }), true)).toBe(0);
    expect(gradePoints(course({ level: "ap", finalGrade: "A" }), false)).toBe(4);
  });

  it("only counts finished high school courses with a letter grade", () => {
    expect(countsTowardGpa(course())).toBe(true);
    for (const finalGrade of ["P", "W", "I", null, "Z"]) expect(countsTowardGpa(course({ finalGrade }))).toBe(false);
    expect(countsTowardGpa(course({ status: "in_progress", finalGrade: null }))).toBe(false);
    expect(countsTowardGpa(course({ highSchoolCredit: false }))).toBe(false);
  });

  it("earns credit for finished courses unless failed, withdrawn or incomplete", () => {
    expect(earnsCredit(course())).toBe(true);
    expect(earnsCredit(course({ finalGrade: "P" }))).toBe(true);
    expect(earnsCredit(course({ finalGrade: null }))).toBe(true);
    for (const finalGrade of ["F", "W", "I"]) expect(earnsCredit(course({ finalGrade }))).toBe(false);
    expect(earnsCredit(course({ status: "planned", finalGrade: null }))).toBe(false);
    expect(earnsCredit(course({ highSchoolCredit: false }))).toBe(false);
  });
});

describe("computeGpa", () => {
  it("returns nulls when nothing counts yet", () => {
    expect(computeGpa([])).toEqual({ unweighted: null, weighted: null, gpaCredits: 0, creditsEarned: 0, byGrade: [] });
    const planned = computeGpa([course({ status: "planned", finalGrade: null })]);
    expect(planned.unweighted).toBeNull();
    expect(planned.byGrade).toEqual([]);
  });

  it("weights by credits", () => {
    // (4.0 * 1 + 3.0 * 0.5) / 1.5 = 3.666…
    const gpa = computeGpa([course({ finalGrade: "A" }), course({ finalGrade: "B", credits: 0.5 })]);
    expect(gpa.unweighted).toBe(3.67);
    expect(gpa.weighted).toBe(3.67);
    expect(gpa.gpaCredits).toBe(1.5);
    expect(gpa.creditsEarned).toBe(1.5);
  });

  it("computes weighted and unweighted GPAs", () => {
    const gpa = computeGpa([
      course({ level: "ap", finalGrade: "A-" }), // 3.7 / 4.7
      course({ level: "honors", finalGrade: "B+" }), // 3.3 / 3.8
      course({ level: "ap", finalGrade: "F" }), // 0 / 0
      course({ finalGrade: "C" }), // 2.0 / 2.0
    ]);
    expect(gpa.unweighted).toBe(2.25);
    expect(gpa.weighted).toBe(2.63); // 10.5 / 4 = 2.625, rounded half up
    expect(gpa.gpaCredits).toBe(4);
    expect(gpa.creditsEarned).toBe(3);
  });

  it("rounds exactly to two decimals", () => {
    // (3.3 + 3.7 + 3.0) / 3 = 3.333…; (4 + 4 + 3.7 * 2) / 4 = 3.85
    expect(computeGpa([course({ finalGrade: "B+" }), course({ finalGrade: "A-" }), course({ finalGrade: "B" })]).unweighted).toBe(3.33);
    expect(computeGpa([course(), course(), course({ finalGrade: "A-", credits: 2 })]).unweighted).toBe(3.85);
    // 2.7 * 0.25 + 3.3 * 0.75 = 3.15 exactly
    expect(computeGpa([course({ finalGrade: "B-", credits: 0.25 }), course({ finalGrade: "B+", credits: 0.75 })]).unweighted).toBe(3.15);
  });

  it("leaves out P, W, I, unfinished and middle school courses, but counts pass credits as earned", () => {
    const gpa = computeGpa([
      course({ finalGrade: "B" }),
      course({ finalGrade: "P" }),
      course({ finalGrade: "W" }),
      course({ finalGrade: "I" }),
      course({ status: "in_progress", finalGrade: null }),
      course({ gradeLevel: 8, finalGrade: "F", highSchoolCredit: false }),
    ]);
    expect(gpa.unweighted).toBe(3);
    expect(gpa.gpaCredits).toBe(1);
    expect(gpa.creditsEarned).toBe(2);
  });

  it("includes middle school courses taken for high school credit", () => {
    const gpa = computeGpa([course({ gradeLevel: 8, finalGrade: "A", highSchoolCredit: true }), course({ gradeLevel: 9, finalGrade: "B" })]);
    expect(gpa.unweighted).toBe(3.5);
    expect(gpa.byGrade.map((g) => g.gradeLevel)).toEqual([8, 9]);
  });

  it("breaks the GPA down by grade level", () => {
    const gpa = computeGpa([
      course({ gradeLevel: 10, level: "honors", finalGrade: "A" }),
      course({ gradeLevel: 9, finalGrade: "B" }),
      course({ gradeLevel: 9, finalGrade: "A" }),
      course({ gradeLevel: 11, finalGrade: "P" }),
    ]);
    expect(gpa.byGrade).toEqual([
      { gradeLevel: 9, unweighted: 3.5, weighted: 3.5, gpaCredits: 2, creditsEarned: 2 },
      { gradeLevel: 10, unweighted: 4, weighted: 4.5, gpaCredits: 1, creditsEarned: 1 },
      { gradeLevel: 11, unweighted: null, weighted: null, gpaCredits: 0, creditsEarned: 1 },
    ]);
    expect(gpa.creditsEarned).toBe(4);
  });

  it("formats with two decimals", () => {
    expect(formatGpa(3.5)).toBe("3.50");
    expect(formatGpa(4)).toBe("4.00");
    expect(formatGpa(null)).toBeNull();
  });
});
