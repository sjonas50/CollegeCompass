import { describe, expect, it } from "vitest";
import { defaultHighSchoolCredit, defaultStatusFor, highSchoolCreditChecked, highSchoolCreditHint } from "./catalog";

describe("defaultStatusFor", () => {
  it("defaults past grades to finished, this year to taking now, and later grades to planned", () => {
    expect([7, 8, 9, 10, 11, 12].map((g) => defaultStatusFor(g, 9))).toEqual([
      "completed", "completed", "in_progress", "planned", "planned", "planned",
    ]);
    expect(defaultStatusFor(7, 7)).toBe("in_progress");
    expect(defaultStatusFor(12, 12)).toBe("in_progress");
  });

  it("defaults a graduate's senior-year classes to finished", () => {
    expect(defaultStatusFor(12, 13)).toBe("completed");
  });
});

describe("high school credit", () => {
  it("defaults on for grades 9–12 and off for 7–8", () => {
    expect([7, 8, 9, 10, 11, 12].map(defaultHighSchoolCredit)).toEqual([false, false, true, true, true, true]);
  });

  it("explains the box for the grade picked in the form", () => {
    expect(highSchoolCreditHint(8)).toMatch(/^Most middle school classes don't/);
    expect(highSchoolCreditHint(9)).toMatch(/^Almost every high school class does/);
  });

  it("keeps the saved choice while a course stays in middle school or in high school", () => {
    expect(highSchoolCreditChecked({ gradeLevel: 8, checked: true }, 8)).toBe(true);
    expect(highSchoolCreditChecked({ gradeLevel: 8, checked: true }, 7)).toBe(true);
    expect(highSchoolCreditChecked({ gradeLevel: 7, checked: false }, 8)).toBe(false);
    expect(highSchoolCreditChecked({ gradeLevel: 10, checked: false }, 11)).toBe(false);
    expect(highSchoolCreditChecked({ gradeLevel: 10, checked: true }, 9)).toBe(true);
  });

  it("switches to the new grade's default when a course moves between middle and high school", () => {
    // A class added to 8th by mistake and moved to 9th counts for credit again.
    expect(highSchoolCreditChecked({ gradeLevel: 8, checked: false }, 9)).toBe(true);
    expect(highSchoolCreditChecked({ gradeLevel: 8, checked: true }, 12)).toBe(true);
    expect(highSchoolCreditChecked({ gradeLevel: 9, checked: true }, 8)).toBe(false);
    expect(highSchoolCreditChecked({ gradeLevel: 11, checked: false }, 7)).toBe(false);
  });
});
