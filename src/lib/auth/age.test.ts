import { describe, expect, it } from "vitest";
import { ageOn, currentGrade, gradeBand, isPlausibleStudentBirthDate, isUnder13, schoolYearOf } from "./age";

const today = new Date("2026-09-23T12:00:00Z");

describe("age", () => {
  it("counts whole years, turning over on the birthday", () => {
    expect(ageOn("2013-09-23", today)).toBe(13);
    expect(ageOn("2013-09-24", today)).toBe(12);
    expect(ageOn("2013-02-28", today)).toBe(13);
  });

  it("flags under-13 students", () => {
    expect(isUnder13("2013-09-24", today)).toBe(true);
    expect(isUnder13("2013-09-23", today)).toBe(false);
  });

  it("rejects malformed or implausible birth dates", () => {
    expect(isPlausibleStudentBirthDate("2013-02-30", today)).toBe(false);
    expect(isPlausibleStudentBirthDate("2013-2-3", today)).toBe(false);
    expect(isPlausibleStudentBirthDate("1990-01-01", today)).toBe(false);
    expect(isPlausibleStudentBirthDate("2020-01-01", today)).toBe(false);
    expect(isPlausibleStudentBirthDate("2012-06-15", today)).toBe(true);
  });

  it("names school years by the August they start in", () => {
    expect(schoolYearOf(new Date("2026-07-31T12:00:00Z"))).toBe(2025);
    expect(schoolYearOf(new Date("2026-08-01T12:00:00Z"))).toBe(2026);
  });

  it("advances grades each August", () => {
    const stored = { grade: 7, gradeSchoolYear: 2026 };
    expect(currentGrade(stored, new Date("2027-06-15T12:00:00Z"))).toBe(7); // summer after 7th
    expect(currentGrade(stored, new Date("2027-08-20T12:00:00Z"))).toBe(8);
    expect(currentGrade(stored, new Date("2032-09-01T12:00:00Z"))).toBe(13); // graduated
    expect(currentGrade({ grade: null, gradeSchoolYear: null })).toBeNull();
  });

  it("maps grades to bands", () => {
    expect([7, 8, 9, 10, 11, 12].map(gradeBand)).toEqual([
      "explore", "explore", "build", "build", "launch", "launch",
    ]);
  });
});
