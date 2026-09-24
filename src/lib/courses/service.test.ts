import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "../accounts";
import { addNorthStar } from "../goals";
import { deleteStudent } from "../privacy";
import { MAX_COURSES, addCourse, deleteCourse, getCourse, listCourses, planSummary, updateCourse } from "./service";
import { type CourseInputRaw, CourseInputSchema } from "./validation";

const now = new Date("2026-09-23T12:00:00Z");
let db: Db;
let ana: string;
let ben: string;

async function student(displayName: string, email: string, grade = 10) {
  const res = await registerStudent(db, { displayName, email, password: "correct horse battery", birthDate: "2011-01-15", grade }, now);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

const input = (over: Partial<CourseInputRaw> = {}) =>
  CourseInputSchema.parse({ name: "Biology", subject: "science", gradeLevel: 10, status: "in_progress", ...over });

async function add(userId: string, over: Partial<CourseInputRaw> = {}) {
  const res = await addCourse(db, userId, input(over));
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

beforeEach(async () => {
  db = await createTestDb();
  ana = await student("Ana", "ana@example.com");
  ben = await student("Ben", "ben@example.com");
});

describe("course CRUD", () => {
  it("adds and lists a student's own courses in grade order", async () => {
    await add(ana, { name: "Chemistry", gradeLevel: 11, status: "planned" });
    const bio = await add(ana, { name: "Biology" });
    await add(ana, { name: "Algebra I", subject: "math", gradeLevel: 8, status: "completed", finalGrade: "A" });
    await add(ben, { name: "Ben's class" });

    expect(bio).toMatchObject({ name: "Biology", subject: "science", level: "regular", term: "full_year", credits: 1, highSchoolCredit: true });
    expect(bio).not.toHaveProperty("userId");
    const courses = await listCourses(db, ana);
    expect(courses.map((c) => [c.gradeLevel, c.name])).toEqual([[8, "Algebra I"], [10, "Biology"], [11, "Chemistry"]]);
    expect(courses[0].highSchoolCredit).toBe(false);
    expect(await getCourse(db, ana, bio.id)).toMatchObject({ name: "Biology" });
  });

  it("updates a course and its updatedAt", async () => {
    const bio = await add(ana);
    const later = new Date("2027-06-01T12:00:00Z");
    const res = await updateCourse(db, ana, bio.id, input({ name: "Honors Biology", level: "honors", status: "completed", finalGrade: "B+" }), later);
    expect(res.ok && res.value).toMatchObject({ name: "Honors Biology", level: "honors", status: "completed", finalGrade: "B+" });
    expect(res.ok && res.value.updatedAt.toISOString()).toBe(later.toISOString());
    expect(res.ok && res.value.createdAt.getTime()).toBe(bio.createdAt.getTime());
  });

  it("clears the final grade when a course is no longer finished", async () => {
    const bio = await add(ana, { status: "completed", finalGrade: "A" });
    // Bypasses the schema, as a defense against callers that skip validation.
    const res = await updateCourse(db, ana, bio.id, { ...input(), status: "planned", finalGrade: "A" });
    expect(res.ok && res.value.finalGrade).toBeNull();
  });

  it("deletes a course", async () => {
    const bio = await add(ana);
    expect(await deleteCourse(db, ana, bio.id)).toEqual({ ok: true, value: undefined });
    expect(await listCourses(db, ana)).toEqual([]);
    expect(await deleteCourse(db, ana, bio.id)).toEqual({ ok: false, error: "not_found" });
  });

  it("never reads, changes or deletes another student's course", async () => {
    const bio = await add(ana);
    expect(await getCourse(db, ben, bio.id)).toBeNull();
    expect(await updateCourse(db, ben, bio.id, input({ name: "Hacked" }))).toEqual({ ok: false, error: "not_found" });
    expect(await deleteCourse(db, ben, bio.id)).toEqual({ ok: false, error: "not_found" });
    expect((await getCourse(db, ana, bio.id))?.name).toBe("Biology");
    expect(await listCourses(db, ben)).toEqual([]);
  });

  it("treats malformed course ids as not found", async () => {
    for (const id of ["", "not-a-uuid", "1; drop table student_courses"]) {
      expect(await getCourse(db, ana, id)).toBeNull();
      expect(await updateCourse(db, ana, id, input())).toEqual({ ok: false, error: "not_found" });
      expect(await deleteCourse(db, ana, id)).toEqual({ ok: false, error: "not_found" });
    }
  });

  it("caps how many courses a student can add", async () => {
    await db.insert(schema.studentCourses).values(
      Array.from({ length: MAX_COURSES }, (_, i) => ({ userId: ana, name: `Course ${i}`, subject: "other" as const, gradeLevel: 9 })),
    );
    expect(await addCourse(db, ana, input())).toEqual({ ok: false, error: "limit" });
    expect((await addCourse(db, ben, input())).ok).toBe(true);
  });

  it("deletes courses with the student", async () => {
    await add(ana);
    await add(ben);
    expect(await deleteStudent(db, ana, ana)).toBe(true);
    expect(await db.select().from(schema.studentCourses)).toHaveLength(1);
  });
});

describe("planSummary", () => {
  beforeEach(async () => {
    await db.insert(schema.occupations).values([{ code: "29-1141.00", title: "Registered Nurses", description: "Care for patients.", jobZone: 4 }]);
    await db.insert(schema.occupationInterests).values([{ occupationCode: "29-1141.00", interest: "S", score: 7 }]);
    await db.insert(schema.majors).values([{ cipCode: "51.3801", title: "Registered Nursing/Registered Nurse" }]);
    await db.insert(schema.cipSocLinks).values([{ cipCode: "51.3801", socCode: "29-1141" }]);
  });

  it("summarizes an empty plan", async () => {
    const summary = await planSummary(db, ana);
    expect(summary.gpa).toMatchObject({ unweighted: null, weighted: null, gpaCredits: 0, creditsEarned: 0, byGrade: [] });
    expect(summary.gpa.note).toMatch(/transcript/);
    expect(summary.coursesByGrade).toEqual([]);
    expect(summary.checklist.areas.every((a) => a.status === "room_to_add")).toBe(true);
    expect(summary.suggestions).toEqual([]);
  });

  it("gives the counselor GPA, courses by grade, checklist progress and suggestions without ids", async () => {
    await add(ana, { name: "English 9", subject: "english", gradeLevel: 9, status: "completed", finalGrade: "A" });
    await add(ana, { name: "Honors Biology", level: "honors", gradeLevel: 9, status: "completed", finalGrade: "B" });
    await add(ana, { name: "Spanish I", subject: "world_language", gradeLevel: 8, status: "completed", finalGrade: "A-", highSchoolCredit: true });
    await add(ana, { name: "Chemistry", gradeLevel: 10, status: "in_progress" });
    await add(ana, { name: "Anatomy & Physiology", gradeLevel: 11, status: "planned" });
    await add(ana, { name: "Ana's study hall, call 555-123-4567", subject: "other", gradeLevel: 10 });
    await add(ben, { name: "Ben only", gradeLevel: 9, status: "completed", finalGrade: "F" });
    await addNorthStar(db, ana, "29-1141.00");

    const summary = await planSummary(db, ana);
    expect(summary.gpa).toMatchObject({ unweighted: 3.57, weighted: 3.73, gpaCredits: 3, creditsEarned: 3 });
    expect(summary.gpa.byGrade.map((g) => g.gradeLevel)).toEqual([8, 9]);

    expect(summary.coursesByGrade.map((g) => [g.gradeLevel, g.courses.length])).toEqual([[8, 1], [9, 2], [10, 2], [11, 1]]);
    expect(summary.coursesByGrade[1].courses.find((c) => c.name === "Honors Biology")).toEqual({
      name: "Honors Biology",
      subject: "science",
      level: "honors",
      term: "full_year",
      status: "completed",
      finalGrade: "B",
      highSchoolCredit: true,
    });
    expect(summary.coursesByGrade[2].courses.map((c) => c.name).sort()).toEqual(["Chemistry", "[name]'s study hall, call [phone]"]);

    const science = summary.checklist.areas.find((a) => a.subject === "science");
    expect(science).toMatchObject({ years: 3, doneOrInProgress: 2, planned: 1, status: "on_track" });
    expect(summary.checklist.areas.find((a) => a.subject === "math")).toMatchObject({ years: 3, recommendedYears: 4 });
    expect(summary.checklist.framing).toMatch(/^Many four-year colleges look for about/);
    expect(summary.checklist.notes.join(" ")).toMatch(/counselor/);

    expect(summary.suggestions).toHaveLength(1);
    expect(summary.suggestions[0]).toMatchObject({ career: "Registered Nurses", occupationCode: "29-1141.00", basis: "majors" });
    const ideas = Object.fromEntries(summary.suggestions[0].ideas.map((i) => [i.title, i.inPlan]));
    expect(ideas).toMatchObject({ Biology: true, Chemistry: true, "Anatomy and physiology": true, "Health science (CTE)": false });

    const json = JSON.stringify(summary);
    expect(json).not.toContain(ana);
    expect(json).not.toContain(ben);
    expect(json).not.toContain("Ben only");
    expect(json).not.toMatch(/"(id|userId)"/);
    const [course] = await listCourses(db, ana);
    expect(json).not.toContain(course.id);
    expect(JSON.parse(json)).toEqual(summary);
  });
});
