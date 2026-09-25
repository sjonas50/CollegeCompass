import { describe, expect, it } from "vitest";
import { ageOn, currentGrade, gradeBand, gradeQuestion, isAllowedGrade, isPlausibleStudentBirthDate, isUnder13, schoolYearOf } from "./age";

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

  it("counts a child as 13 only once their birthday has started everywhere in the US", () => {
    const born = "2013-09-25";
    // 6:30 pm in Denver, 5:30 pm in Los Angeles on the 24th: the UTC date is already the 25th.
    expect(ageOn(born, new Date("2026-09-25T00:30:00Z"))).toBe(13);
    expect(isUnder13(born, new Date("2026-09-25T00:30:00Z"))).toBe(true);
    // Midnight in New York, Hawaii still on the 24th.
    expect(isUnder13(born, new Date("2026-09-25T04:00:00Z"))).toBe(true);
    // 11:59 pm on the 24th in American Samoa (UTC−11), the last US time zone to reach the 25th.
    expect(isUnder13(born, new Date("2026-09-25T10:59:59Z"))).toBe(true);
    expect(isUnder13(born, new Date("2026-09-25T11:00:00Z"))).toBe(false);
    // A leap-day birthday turns 13 on March 1 in other years.
    expect(isUnder13("2012-02-29", new Date("2025-03-01T10:59:59Z"))).toBe(true);
    expect(isUnder13("2012-02-29", new Date("2025-03-01T11:00:00Z"))).toBe(false);
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

  it("asks for the grade just finished in June and July", () => {
    const july = new Date("2027-07-10T12:00:00Z");
    expect(gradeQuestion(july)).toEqual({ label: "Grade you just finished", min: 6, max: 11 });
    expect(isAllowedGrade(6, july)).toBe(true);
    expect(isAllowedGrade(6, new Date("2027-09-10T12:00:00Z"))).toBe(false);
    // A rising senior who finished 11th in July shows as 12th in August, not graduated.
    const stored = { grade: 11, gradeSchoolYear: schoolYearOf(july) };
    expect(currentGrade(stored, new Date("2027-08-20T12:00:00Z"))).toBe(12);
  });

  it("maps grades to bands", () => {
    expect([7, 8, 9, 10, 11, 12].map(gradeBand)).toEqual([
      "explore", "explore", "build", "build", "launch", "launch",
    ]);
  });
});
