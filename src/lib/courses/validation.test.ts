import { describe, expect, it } from "vitest";
import * as z from "zod";
import { CourseInputSchema, courseFormInput } from "./validation";

const valid = { name: "Biology", subject: "science", level: "honors", gradeLevel: 10, term: "full_year", credits: 1, status: "planned" };

function errorsFor(input: Record<string, unknown>) {
  const res = CourseInputSchema.safeParse(input);
  if (res.success) return {};
  return z.flattenError(res.error).fieldErrors as Record<string, string[] | undefined>;
}

describe("CourseInputSchema", () => {
  it("accepts a valid course and tidies the name", () => {
    const res = CourseInputSchema.parse({ ...valid, name: "  AP   Biology " });
    expect(res).toEqual({ ...valid, name: "AP Biology", finalGrade: null, highSchoolCredit: true });
  });

  it("requires a name of 1–80 characters", () => {
    expect(errorsFor({ ...valid, name: "   " }).name).toEqual(["Give the course a name."]);
    expect(errorsFor({ ...valid, name: "x".repeat(81) }).name).toEqual(["Use 80 characters or fewer."]);
    expect(errorsFor({ ...valid, name: "x".repeat(80) }).name).toBeUndefined();
  });

  it("only allows known subjects, levels, terms and statuses", () => {
    const errors = errorsFor({ ...valid, subject: "cooking", level: "super", term: "winter", status: "dropped" });
    expect(errors.subject).toEqual(["Choose a subject."]);
    expect(errors.level).toBeDefined();
    expect(errors.term).toBeDefined();
    expect(errors.status).toBeDefined();
  });

  it("only allows grades 7–12", () => {
    for (const gradeLevel of [6, 13, 9.5, "abc", undefined]) {
      expect(errorsFor({ ...valid, gradeLevel }).gradeLevel, String(gradeLevel)).toBeDefined();
    }
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: "7" }).gradeLevel).toBe(7);
  });

  it("allows 0.25–2 credits in quarter steps", () => {
    for (const credits of [0, 0.2, 2.25, 1.1, -1, "abc"]) {
      expect(errorsFor({ ...valid, credits }).credits, String(credits)).toBeDefined();
    }
    for (const credits of [0.25, 0.5, 0.75, 1.5, 2, "1.25"]) {
      expect(errorsFor({ ...valid, credits }).credits, String(credits)).toBeUndefined();
    }
  });

  it("allows a final grade only on finished courses", () => {
    expect(errorsFor({ ...valid, finalGrade: "A" }).finalGrade).toEqual(["Only finished courses get a final grade."]);
    expect(errorsFor({ ...valid, status: "in_progress", finalGrade: "B" }).finalGrade).toBeDefined();
    expect(CourseInputSchema.parse({ ...valid, status: "completed", finalGrade: "A-" }).finalGrade).toBe("A-");
    for (const finalGrade of ["P", "W", "I", "F", "D+"]) {
      expect(CourseInputSchema.parse({ ...valid, status: "completed", finalGrade }).finalGrade).toBe(finalGrade);
    }
    expect(errorsFor({ ...valid, status: "completed", finalGrade: "E" }).finalGrade).toEqual(["Choose a grade from the list."]);
    expect(CourseInputSchema.parse({ ...valid, status: "completed", finalGrade: "" }).finalGrade).toBeNull();
  });

  it("defaults high school credit on for grades 9–12 and off for 7–8, but respects an explicit choice", () => {
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: 9 }).highSchoolCredit).toBe(true);
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: 8 }).highSchoolCredit).toBe(false);
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: 7 }).highSchoolCredit).toBe(false);
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: 8, highSchoolCredit: true }).highSchoolCredit).toBe(true);
    expect(CourseInputSchema.parse({ ...valid, gradeLevel: 11, highSchoolCredit: false }).highSchoolCredit).toBe(false);
  });

  it("fills in level, term, credits and status defaults", () => {
    expect(CourseInputSchema.parse({ name: "Art", subject: "arts", gradeLevel: 9 })).toEqual({
      name: "Art",
      subject: "arts",
      level: "regular",
      gradeLevel: 9,
      term: "full_year",
      credits: 1,
      status: "planned",
      finalGrade: null,
      highSchoolCredit: true,
    });
  });
});

describe("courseFormInput", () => {
  function form(entries: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  }

  it("reads the planner form, treating the checkbox as on/off", () => {
    const fields = { name: "Algebra I", subject: "math", level: "regular", gradeLevel: "8", term: "full_year", credits: "1", status: "completed", finalGrade: "A" };
    expect(CourseInputSchema.parse(courseFormInput(form({ ...fields, highSchoolCredit: "on" })))).toMatchObject({
      gradeLevel: 8,
      credits: 1,
      finalGrade: "A",
      highSchoolCredit: true,
    });
    expect(CourseInputSchema.parse(courseFormInput(form({ ...fields, gradeLevel: "10" }))).highSchoolCredit).toBe(false);
  });

  it("reports a missing name instead of throwing", () => {
    expect(errorsFor(courseFormInput(form({ subject: "math", gradeLevel: "9" }))).name).toBeDefined();
  });
});
