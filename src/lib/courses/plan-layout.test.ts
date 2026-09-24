import { describe, expect, it } from "vitest";
import { emptyText, focusGrade, gradeOrder, isGraduated, removedNotice, savedNotice, whenLabel } from "./plan-layout";

describe("gradeOrder", () => {
  it("puts the current grade first, then later grades, then earlier grades newest first", () => {
    expect(gradeOrder(7)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(gradeOrder(9)).toEqual([9, 10, 11, 12, 8, 7]);
    expect(gradeOrder(12)).toEqual([12, 11, 10, 9, 8, 7]);
  });

  it("shows a graduate's senior year first", () => {
    expect(focusGrade(13)).toBe(12);
    expect(focusGrade(15)).toBe(12);
    expect(gradeOrder(13)).toEqual([12, 11, 10, 9, 8, 7]);
  });

  it("lists every grade exactly once", () => {
    for (const current of [6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect([...gradeOrder(current)].sort((a, b) => a - b), String(current)).toEqual([7, 8, 9, 10, 11, 12]);
    }
  });
});

describe("whenLabel", () => {
  it("describes each grade relative to the student's current grade", () => {
    expect([7, 8, 9, 10, 11, 12].map((g) => whenLabel(g, 9))).toEqual([
      "2 years ago", "Last year", "This year", "Next year", "In 2 years", "In 3 years",
    ]);
    expect(whenLabel(12, 7)).toBe("In 5 years");
    expect(whenLabel(12, 12)).toBe("This year");
  });

  it("treats senior year as last year once a student graduates", () => {
    expect(isGraduated(12)).toBe(false);
    expect(isGraduated(13)).toBe(true);
    expect(whenLabel(12, 13)).toBe("Last year");
    expect(whenLabel(11, 13)).toBe("2 years ago");
  });
});

describe("emptyText", () => {
  it("asks about this year, invites planning ahead and mentions finished classes", () => {
    expect(emptyText(9, 9)).toMatch(/^What are you taking this year\?/);
    expect(emptyText(10, 9)).toMatch(/^Thinking ahead\?/);
    expect(emptyText(8, 9)).toMatch(/high school credit, like Algebra I/);
    expect(emptyText(9, 10)).toMatch(/GPA estimate/);
  });

  it("never asks a graduate what they're taking this year", () => {
    for (const grade of [7, 8, 9, 10, 11, 12]) expect(emptyText(grade, 13)).not.toMatch(/this year|Thinking ahead/);
    expect(emptyText(12, 13)).toMatch(/GPA estimate/);
  });
});

describe("notices", () => {
  const biology = { name: "Biology", gradeLevel: 8 };

  it("says a course was saved when it stays in its grade, keeping focus on the row", () => {
    expect(savedNotice(biology, { name: "Honors  Biology ", gradeLevel: 8 })).toEqual({ text: "Saved Honors Biology.", moveFocus: false });
    expect(savedNotice(biology, { name: "   ", gradeLevel: 8 })).toEqual({ text: "Saved Biology.", moveFocus: false });
  });

  it("says where a course moved, and moves focus because its row leaves the section", () => {
    expect(savedNotice(biology, { name: "Biology", gradeLevel: 9 })).toEqual({ text: "Moved Biology to 9th grade.", moveFocus: true });
    expect(savedNotice(biology, { name: "Biology", gradeLevel: Number.NaN })).toEqual({ text: "Saved Biology.", moveFocus: false });
  });

  it("confirms a removal", () => {
    expect(removedNotice("Biology")).toBe("Removed Biology.");
  });
});
