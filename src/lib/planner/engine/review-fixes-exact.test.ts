import { describe, expect, it } from "vitest";
import type { CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolGrade } from "../common";
import { plannerContentFor } from "../content";
import { guessCourseType, guessCourseTypeId, resolveRowCourseType } from "../course-type-guess";
import type { CourseTypeId } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlannerInput } from "../engine-io";
import type { FamilyId } from "../families";
import { plan } from "./index";
import { claims } from "./testing/claims";
import { misreadClaims, withExactTitles } from "./testing/exact";
import { planned, requirement, suggestions } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the review of exact titles (exact-titles.ts): names a state's schools also
// use for another kind of class than the name says. Such a name is never exact there, and the
// guesser lists the other kind too, so "Confirm your classes" asks about the row and confirm first
// holds whatever the other kind would decide. They run the engine on the real Utah, Tennessee and
// Texas content with class names typed through the real guesser, as the app reads them (exact
// titles confirmed, the rest guessed), against the truth: the student's real kinds, confirmed.

const USU: CollegeTarget = { unitId: 230728, name: "Utah State University", state: "UT", public: true, admissionRate: 0.93, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };

function input(s: Scenario, goals: FamilyId[] = []): PlannerInput {
  const i = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) i.targets.families = goals.map((familyId) => ({ familyId, source: "north_star" as FamilyTarget["source"], cip6: null, because: null }));
  return i;
}
const pathOf = (i: PlannerInput): PlannedPath => planned(plan(i));

/** A typed class: its name, subject and grade, and (`as`, `asLevel`) what it really is when that isn't the guess. */
type Row = [name: string, subject: CourseSubject, grade: SchoolGrade, extra?: Partial<CourseSpec> & { as?: CourseTypeId; asLevel?: CourseSpec["level"] }];

/** typed: kinds guessed from the names; truth: the real kinds, confirmed. */
function rows(state: PlannerState, list: Row[], mode: "typed" | "truth"): CourseSpec[] {
  return list.map(([name, subject, grade, extra]) => {
    const { as, asLevel, ...rest } = extra ?? {};
    const guess = guessCourseTypeId(name, subject, state);
    if (mode === "typed") return { type: guess, grade, name, assumed: true, ...rest };
    return { type: as ?? guess, grade, name, assumed: false, ...rest, ...(asLevel ? { level: asLevel } : {}) };
  });
}

/** The student as the app reads their typed names, and the truth. */
function student(s: Omit<Scenario, "courses">, list: Row[], goals: FamilyId[] = []) {
  const typed = input({ ...s, courses: rows(s.state!, list, "typed") }, goals);
  const app = withExactTitles(typed);
  return { typed, app, appPath: pathOf(app), truth: pathOf(input({ ...s, courses: rows(s.state!, list, "truth") }, goals)) };
}

const rowNamed = (i: PlannerInput, name: string) => i.courses.find((c) => c.name === name)!;
const reasons = (path: PlannedPath) => suggestions(path).flatMap((s) => s.reasons.map((r) => r.text));
const nowLines = (path: PlannedPath) => suggestions(path).filter((s) => s.needsPlanNow).flatMap((s) => s.reasons.map((r) => r.text));
const gapLines = (path: PlannedPath) => path.gaps.map((g) => g.text).join("\n");

const TN_RECORD: Row[] = [
  ["English I", "english", 9],
  ["Algebra I", "math", 9],
  ["Biology", "science", 9],
  ["World History", "social_studies", 9],
  ["Spanish I", "world_language", 9],
  ["English II", "english", 10],
  ["Geometry", "math", 10],
  ["Chemistry", "science", 10],
  ["Spanish II", "world_language", 10],
  ["Art", "arts", 10, { as: "arts.visual" }],
  ["English III", "english", 11],
  ["Algebra II", "math", 11],
  ["Physics", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["English IV", "english", 12],
  ["Precalculus", "math", 12],
];

const UT_RECORD: Row[] = [
  ["English 9", "english", 9],
  ["Secondary Math I", "math", 9],
  ["Earth Science", "science", 9],
  ["Geography", "social_studies", 9, { units: 2 }],
  ["Fitness for Life", "health_pe", 9, { units: 2 }],
  ["Health", "health_pe", 9, { units: 2 }],
  ["Exploring Computer Science", "computer_science", 9, { units: 2 }],
  ["English 10", "english", 10],
  ["Secondary Math II", "math", 10],
  ["Biology", "science", 10],
  ["World History", "social_studies", 10, { units: 2 }],
  ["Participation Skills and Techniques", "health_pe", 10, { units: 2 }],
  ["Ceramics", "arts", 10, { as: "arts.visual" }],
  ["English 11", "english", 11],
  ["Secondary Math III", "math", 11],
  ["Chemistry", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["Individual Lifetime Activities", "health_pe", 11, { units: 2 }],
  ["English 12", "english", 12],
  ["Statistics", "math", 12],
];

const upTo = (list: Row[], grade: number) => list.filter(([, , g]) => g <= grade);
const without = (list: Row[], name: string) => list.filter(([n]) => n !== name);

// 1. Tennessee's "Health" ------------------------------------------------------------------------------

describe("Tennessee: a class typed \"Health\" may be the required Lifetime Wellness (exact-titles.ts, course-type-guess.ts)", () => {
  const HEALTH: Row = ["Health", "health_pe", 9, { as: "health.wellness" }];

  it("isn't exact there, and the guess lists Lifetime Wellness too; Tennessee's own \"Health Education\" is still sure", () => {
    expect(resolveRowCourseType({ name: "Health", subject: "health_pe", level: "regular" }, "TN")).toMatchObject({ typeId: "health.health", source: "guess", assumed: true });
    expect(guessCourseType("Health", "health_pe", "TN")).toEqual({ typeId: "health.health", confident: false, candidates: ["health.health", "health.wellness"] });
    expect(resolveRowCourseType({ name: "Health Education", subject: "health_pe", level: "regular" }, "TN")).toMatchObject({ typeId: "health.health", source: "exact" });
    expect(guessCourseType("Health Education", "health_pe", "TN")).toMatchObject({ typeId: "health.health", confident: true });
    // Elsewhere "Health" is the health class, sure.
    expect(resolveRowCourseType({ name: "Health", subject: "health_pe", level: "regular" }, "UT")).toMatchObject({ typeId: "health.health", source: "exact" });
    expect(resolveRowCourseType({ name: "Health", subject: "health_pe", level: "regular" }, "TX")).toMatchObject({ typeId: "health.health", source: "exact" });
  });

  it("a 12th grader whose \"Health\" (1 credit, 9th grade) is Lifetime Wellness: no Lifetime Wellness \"Required by\" or \"needs a plan now\"; the row is on Confirm your classes", () => {
    const list = [...TN_RECORD, HEALTH];
    const { typed, app, appPath, truth } = student({ state: "TN", grade: 12, colleges: [UTK] }, list, ["engineering"]);
    expect(requirement(truth, "tn.grad", "wellness").status).toBe("done");
    expect(requirement(appPath, "tn.grad", "wellness").status).toBe("waiting_confirm");
    expect(reasons(appPath).filter((r) => /Lifetime Wellness/.test(r))).toEqual([]);
    expect(nowLines(appPath).filter((r) => /Lifetime Wellness/.test(r))).toEqual([]);
    expect([...claims(appPath)].filter((c) => c.includes("wellness"))).toEqual([]);
    expect(appPath.confirm.map((c) => c.courseId)).toContain(rowNamed(app, "Health").id);
    expect(misreadClaims(typed, truth)).toEqual([]);
  });

  it("a 10th grader with the same \"Health\": no extra \"Required by … Lifetime Wellness\"", () => {
    const list = [...upTo(TN_RECORD, 10), HEALTH];
    const { typed, appPath, truth } = student({ state: "TN", grade: 10, colleges: [UTK] }, list, ["engineering"]);
    expect(reasons(appPath).filter((r) => /Lifetime Wellness/.test(r))).toEqual([]);
    expect(misreadClaims(typed, truth)).toEqual([]);
  });

  it("a row the student saved as \"Not sure\" is never exact, even with an exact title", () => {
    expect(resolveRowCourseType({ name: "Health", subject: "health_pe", level: "regular", courseTypeSource: "unsure" }, "TN")).toMatchObject({ source: "guess", assumed: true });
    expect(resolveRowCourseType({ name: "Algebra I", subject: "math", level: "regular", courseTypeSource: "unsure" }, "TX")).toEqual({ typeId: "math.alg1", level: "regular", source: "guess", assumed: true });
    expect(resolveRowCourseType({ name: "Algebra I", subject: "math", level: "regular", courseTypeSource: null }, "TX")).toMatchObject({ source: "exact", assumed: false });
  });
});

// 2. Utah's government class from 2027-28 ---------------------------------------------------------------

describe("Utah: from 2027-28 a government class is American Constitutional Government and Citizenship (exact-titles.ts, course-type-guess.ts)", () => {
  const GOV_NAMES = ["U.S. Government", "United States Government", "U.S. Government and Citizenship", "US Government", "AP U.S. Government"];

  it("U.S. Government titles are exact in Utah only before 2027-28 (and never when the year isn't known); the guess lists ACGC from then on", () => {
    for (const name of GOV_NAMES.slice(0, 4)) {
      expect(resolveRowCourseType({ name, subject: "social_studies", level: "regular" }, "UT", 2026), name).toMatchObject({ typeId: "ss.us_gov", source: "exact" });
      expect(resolveRowCourseType({ name, subject: "social_studies", level: "regular" }, "UT", 2027), name).toMatchObject({ typeId: "ss.us_gov", source: "guess", assumed: true });
      expect(resolveRowCourseType({ name, subject: "social_studies", level: "regular" }, "UT"), name).toMatchObject({ source: "guess", assumed: true });
      expect(guessCourseType(name, "social_studies", "UT", { schoolYear: 2026 }), name).toMatchObject({ typeId: "ss.us_gov", confident: true });
      expect(guessCourseType(name, "social_studies", "UT", { schoolYear: 2028 }), name).toEqual({ typeId: "ss.us_gov", confident: false, candidates: ["ss.us_gov", "ss.ut_acgc"] });
    }
    // Texas and Tennessee keep their government class.
    for (const state of ["TX", "TN"] as const) {
      expect(resolveRowCourseType({ name: "U.S. Government", subject: "social_studies", level: "regular" }, state, 2028), state).toMatchObject({ typeId: "ss.us_gov", source: "exact" });
      expect(guessCourseType("Government", "social_studies", state, { schoolYear: 2028 }).candidates, state).not.toContain("ss.ut_acgc");
    }
    expect(guessCourseType("Government", "social_studies", "UT", { schoolYear: 2028 }).candidates).toContain("ss.ut_acgc");
    expect(guessCourseType("Gov/Econ", "social_studies", "UT", { schoolYear: 2028 }).candidates).toContain("ss.ut_acgc");
    // Unknown year (the add form without a cohort): might be either.
    expect(guessCourseType("U.S. Government", "social_studies", "UT")).toMatchObject({ confident: false, candidates: ["ss.us_gov", "ss.ut_acgc"] });
    // ACGC's own name is sure.
    expect(resolveRowCourseType({ name: "American Constitutional Government and Citizenship", subject: "social_studies", level: "regular" }, "UT", 2028)).toMatchObject({ typeId: "ss.ut_acgc", source: "exact" });
  });

  for (const name of GOV_NAMES) {
    it(`a class-of-2029 senior in 2028-29 taking "${name}" that's really ACGC: no ACGC claim, "needs a plan now" or "doesn't fit"`, () => {
      const s: Omit<Scenario, "courses"> = { state: "UT", grade: 12, schoolYear: 2028, colleges: [USU] };
      const list: Row[] = [...UT_RECORD, [name, "social_studies", 12, { as: "ss.ut_acgc", ...(name.startsWith("AP") ? { level: "ap" as const, asLevel: "regular" as const } : {}) }]];
      const { typed, app, appPath, truth } = student(s, list, ["engineering"]);
      expect(requirement(truth, "ut.grad", "ss.acgc").status).not.toBe("room_to_add");
      expect(requirement(appPath, "ut.grad", "ss.acgc").status).toBe("waiting_confirm");
      expect([...claims(appPath)].filter((c) => c.includes("acgc"))).toEqual([]);
      expect(gapLines(appPath)).not.toMatch(/doesn't fit/);
      expect(appPath.confirm.map((c) => c.courseId)).toContain(rowNamed(app, name).id);
      expect(misreadClaims(typed, truth)).toEqual([]);
    });
  }

  it("a class-of-2029 10th grader with \"U.S. Government\" planned for 12th grade: no \"Room to add: Physics. It doesn't fit\" for USU or engineering prep", () => {
    const s: Omit<Scenario, "courses"> = { state: "UT", grade: 10, schoolYear: 2026, colleges: [USU] };
    for (const name of GOV_NAMES.slice(0, 3)) {
      const list: Row[] = [...upTo(UT_RECORD, 10), [name, "social_studies", 12, { as: "ss.ut_acgc" }]];
      const { typed, appPath, truth } = student(s, list, ["engineering"]);
      expect(gapLines(appPath), name).not.toMatch(/Physics[^\n]*doesn't fit/);
      expect(misreadClaims(typed, truth), name).toEqual([]);
    }
  });

  it("before 2027-28, U.S. Government is still that class: a class-of-2027 senior's is sure and counts", () => {
    const s: Omit<Scenario, "courses"> = { state: "UT", grade: 12, schoolYear: 2026, colleges: [USU] };
    const list: Row[] = [...UT_RECORD, ["U.S. Government", "social_studies", 12, { units: 2 }]];
    const { app, appPath } = student(s, list, ["engineering"]);
    expect(rowNamed(app, "U.S. Government")).toMatchObject({ typeId: "ss.us_gov", typeSource: "exact", assumed: false });
    expect(appPath.confirm.map((c) => c.courseId)).not.toContain(rowNamed(app, "U.S. Government").id);
  });
});

// 3. Utah's college-credit English 11 --------------------------------------------------------------------

describe("Utah: a college-credit English 11 may be ENGL 1010 (exact-titles.ts, course-type-guess.ts)", () => {
  const CASES: [name: string, level: "regular" | "dual_enrollment"][] = [
    ["English 11 CE", "regular"],
    ["English 11 CE", "dual_enrollment"],
    ["CE English 11", "regular"],
    ["English III Dual Credit", "regular"],
    ["English 11 Concurrent Enrollment", "regular"],
    ["English 11", "dual_enrollment"],
  ];

  it("isn't exact at a college level in Utah, and the guess lists college composition too", () => {
    for (const [name, level] of CASES) {
      expect(resolveRowCourseType({ name, subject: "english", level }, "UT", 2026), `${name} (${level})`).toMatchObject({ typeId: "ela.11", source: "guess", assumed: true });
      expect(guessCourseType(name, "english", "UT", { level }), `${name} (${level})`).toMatchObject({ typeId: "ela.11", confident: false, candidates: ["ela.11", "ela.lang_comp"] });
    }
    // At a regular or honors level it's English 11, sure; Texas's and Tennessee's dual-credit English III stays exact.
    expect(resolveRowCourseType({ name: "English 11", subject: "english", level: "regular" }, "UT", 2026)).toMatchObject({ typeId: "ela.11", source: "exact" });
    expect(resolveRowCourseType({ name: "English 11H", subject: "english", level: "regular" }, "UT", 2026)).toMatchObject({ typeId: "ela.11", level: "honors", source: "exact" });
    expect(guessCourseType("English 11", "english", "UT", { level: "regular" })).toMatchObject({ typeId: "ela.11", confident: true });
    expect(resolveRowCourseType({ name: "English III Dual Credit", subject: "english", level: "regular" }, "TX", 2026)).toMatchObject({ typeId: "ela.11", level: "dual_enrollment", source: "exact" });
  });

  for (const [name, level] of CASES) {
    it(`an 11th grader in 2026-27 with "${name}" (${level}) that's really ENGL 1010: ELA 11 isn't done, and no "Required by … ELA 12"`, () => {
      const s: Omit<Scenario, "courses"> = { state: "UT", grade: 11, schoolYear: 2026, colleges: [USU] };
      const list: Row[] = [...without(upTo(UT_RECORD, 11), "English 11"), [name, "english", 11, { level, as: "ela.lang_comp", asLevel: "dual_enrollment" }]];
      const { typed, app, appPath, truth } = student(s, list, ["nursing"]);
      expect(requirement(truth, "ut.grad", "ela.11").status).not.toBe("done");
      expect(requirement(appPath, "ut.grad", "ela.11").status).not.toBe("done");
      expect([...claims(appPath)].filter((c) => /ela\.1[12]/.test(c))).toEqual([]);
      expect(appPath.confirm.map((c) => c.courseId)).toContain(rowNamed(app, name).id);
      expect(misreadClaims(typed, truth)).toEqual([]);
    });
  }
});

// 4. The audit: names a state's schools use for another kind -----------------------------------------------

describe("names a state's schools use for another kind: as the app reads them, no claim the real class wouldn't make (testing/exact.ts misreadClaims)", () => {
  // From real usage: Tennessee's required Lifetime Wellness is usually called "Health" (Policy 2.103
  // I(14)); Utah retires U.S. Government and Citizenship in 2027-28 for the new ACGC (UT-S4 p. 1);
  // Utah's CE English 11 is ENGL 1010, which no longer counts for level 11 from 2026-27 (UT-S3 p. 2).
  const MISREAD: { state: PlannerState; row: Row; base: Row[]; grades: SchoolGrade[]; schoolYear: (grade: SchoolGrade) => number; goals: FamilyId[]; colleges: CollegeTarget[] }[] = [
    { state: "TN", row: ["Health", "health_pe", 9, { as: "health.wellness" }], base: TN_RECORD, grades: [9, 10, 11, 12], schoolYear: () => 2026, goals: ["engineering"], colleges: [UTK] },
    { state: "TN", row: ["Health", "health_pe", 10, { as: "health.wellness" }], base: TN_RECORD, grades: [10, 11, 12], schoolYear: () => 2026, goals: ["nursing"], colleges: [] },
    // Class of 2029 on: grade 12 in 2028-29 (grade 10 in 2026-27).
    ...["U.S. Government", "United States Government", "U.S. Government and Citizenship"].map((name) => ({
      state: "UT" as const,
      row: [name, "social_studies", 12, { as: "ss.ut_acgc" }] as Row,
      base: UT_RECORD,
      grades: [9, 10, 11, 12] as SchoolGrade[],
      schoolYear: (grade: SchoolGrade) => 2028 - (12 - grade),
      goals: ["engineering"] as FamilyId[],
      colleges: [USU],
    })),
    ...(["English 11 CE", "English III Dual Credit"] as const).map((name) => ({
      state: "UT" as const,
      row: [name, "english", 11, { as: "ela.lang_comp", asLevel: "dual_enrollment" }] as Row,
      base: without(UT_RECORD, "English 11"),
      grades: [11, 12] as SchoolGrade[],
      schoolYear: (grade: SchoolGrade) => 2026 + (grade - 11),
      goals: ["nursing"] as FamilyId[],
      colleges: [USU],
    })),
  ];

  for (const m of MISREAD) {
    it(`${m.state} "${m.row[0]}" (really ${m.row[3]!.as})`, () => {
      let audited = 0;
      for (const grade of m.grades) {
        const { typed, truth } = student({ state: m.state, grade, schoolYear: m.schoolYear(grade), colleges: m.colleges }, [...upTo(m.base, grade), m.row], m.goals);
        expect(misreadClaims(typed, truth), `${m.state} ${grade}th in ${m.schoolYear(grade)}`).toEqual([]);
        audited++;
      }
      expect(audited).toBe(m.grades.length);
    });
  }
});
