import { describe, expect, it } from "vitest";
import { cohortValue, deriveCohort, schoolYearForGrade } from "./cohort";

describe("deriveCohort", () => {
  it("derives the entry and graduation years from the grade now", () => {
    // A 10th grader in 2026-27 started 9th grade in fall 2025: the class of 2029.
    expect(deriveCohort(10, 2026)).toEqual({ grade9EntryYear: 2025, classYear: 2029, grade7EntryYear: 2023, overrides: {} });
    // A 7th grader in 2026-27 starts 9th grade in fall 2028: the class of 2032.
    expect(deriveCohort(7, 2026)).toMatchObject({ grade9EntryYear: 2028, classYear: 2032, grade7EntryYear: 2026 });
    expect(deriveCohort(12, 2026)).toMatchObject({ grade9EntryYear: 2023, classYear: 2027 });
  });

  it("keeps the two overrides independent", () => {
    const early = deriveCohort(11, 2026, { classYear: { year: 2027, reason: "graduating_early" } });
    expect(early).toMatchObject({ grade9EntryYear: 2024, classYear: 2027, overrides: { classYear: "graduating_early" } });

    const repeated = deriveCohort(10, 2026, { grade9Entry: { year: 2024, reason: "repeated" } });
    expect(repeated).toMatchObject({ grade9EntryYear: 2024, classYear: 2029, grade7EntryYear: 2022, overrides: { grade9Entry: "repeated" } });
  });

  it("picks the number each rule set is keyed by", () => {
    const cohort = deriveCohort(9, 2026);
    expect(cohortValue(cohort, "grade9_entry_year")).toBe(2026);
    expect(cohortValue(cohort, "class_year")).toBe(2030);
    expect(cohortValue(cohort, "grade7_entry_year")).toBe(2024);
    expect(schoolYearForGrade(cohort, 12)).toBe(2029);
    expect(schoolYearForGrade(cohort, 8)).toBe(2025);
  });
});
