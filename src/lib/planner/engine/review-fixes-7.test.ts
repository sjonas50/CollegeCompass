import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db, schema } from "@/db";
import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolGrade } from "../common";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType, isCollegeLevel } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import { updatePlanPrefs } from "../prefs";
import { studentPath } from "../service";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's seventh review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (G14, K5, K21, T19 ...), typed class names through the real
// guesses, and G14 and G2 through studentPath.

const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const USU: CollegeTarget = { unitId: 230728, name: "Utah State University", state: "UT", public: true, admissionRate: 0.925, openAdmission: null };
const UOFU: CollegeTarget = { unitId: 230764, name: "University of Utah", state: "UT", public: true, admissionRate: 0.86, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };

type Goal = { familyId: FamilyId; because: string | null; cip6?: string | null; source?: FamilyTarget["source"] };

/** A student on the real content, with goals named as the reviewer named them. */
function real(s: Scenario, goals: Goal[] = []): PlannedPath {
  const input = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) input.targets.families = goals.map((g) => ({ familyId: g.familyId, source: g.source ?? "north_star", cip6: g.cip6 ?? null, because: g.because }));
  return planned(plan(input));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => `${g.text} :: ${g.reasons.map((r) => r.text).join(" / ")}`).join("\n");
const questions = (path: PlannedPath) => path.askCounselor.map((q) => q.text);
/** Warnings on the student's own rows in Plan A. */
const ownWarnings = (path: PlannedPath) => path.plans.flatMap((p) => (p.id === "A" ? p.years : [])).flatMap((y) => y.slots.flatMap((s) => (s.kind === "yours" ? s.warnings : [])));
const typesAt = (path: PlannedPath, grade: number, id: "A" | "B" = "A") => suggestions(path, id).filter((s) => s.grade === grade).map((s) => s.typeId);

const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const ACCOUNTANT: Goal[] = [{ familyId: "business", because: "Accountants and Auditors" }];

/** A class the student typed, its kind guessed by the real guesser. */
type Row = [name: string, subject: CourseSubject, grade: SchoolGrade, extra?: Partial<CourseSpec>];
const typed = (state: PlannerState, rows: Row[]): CourseSpec[] =>
  rows.map(([name, subject, grade, extra]) => ({ type: guessCourseTypeId(name, subject, state), grade, name, assumed: true, ...extra }));

/** A student entered through the service, class names typed (no kinds picked). */
async function seedStudent(db: Db, state: PlannerState, grade: number, rows: [string, CourseSubject, number, CourseLevel?][]): Promise<string> {
  const [household] = await db.insert(schema.households).values({}).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: `${2026 - grade - 5}-01-15`, grade, gradeSchoolYear: 2026, homeState: state })
    .returning({ id: schema.users.id });
  for (const [name, subject, g, level] of rows) {
    const status = g < grade ? "completed" : "in_progress";
    await db.insert(schema.studentCourses).values({ userId: user.id, name, subject, level: level ?? "regular", gradeLevel: g, credits: 1, status, finalGrade: status === "completed" ? "A" : null, highSchoolCredit: true });
  }
  return user.id;
}

// 1. Typed names: level letters and common titles --------------------------------------------------

describe("Typed class names: level letters and common titles are placed (course-type-guess.ts)", () => {
  it.each([
    ["Sec Math 1H", "math", "UT", "math.ut_sec1"],
    ["Secondary Math IIH", "math", "UT", "math.ut_sec2"],
    ["Secondary Math IE", "math", "UT", "math.ut_sec1"],
    ["Secondary Math IIE", "math", "UT", "math.ut_sec2"],
    ["Secondary Math IIIE", "math", "UT", "math.ut_sec3"],
    ["Math 1H", "math", "UT", "math.ut_sec1"],
    ["English 9H", "english", "UT", "ela.9"],
    ["English 10H", "english", "UT", "ela.10"],
    ["Eng 12", "english", "UT", "ela.12"],
    ["American Literature", "english", "TN", "ela.11"],
    ["British Literature", "english", "TN", "ela.12"],
    ["Senior English", "english", "TN", "ela.12"],
    ["CE English 2010", "english", "UT", "ela.lang_comp"],
    ["ENGL 2010", "english", "UT", "ela.lang_comp"],
    ["CE ENGL 1010", "english", "UT", "ela.lang_comp"],
    ["ENGL 1302", "english", "TX", "ela.lang_comp"],
    ["Bridge Math", "math", "TN", "math.applied.decision"],
    ["Applied Mathematical Concepts", "math", "TN", "math.applied.decision"],
    ["SAILS Math", "math", "TN", "math.applied.decision"],
    ["Alg 2", "math", "TX", "math.alg2"],
    ["Alg. II", "math", "TX", "math.alg2"],
    ["Pre-Cal", "math", "TX", "math.precalc"],
    ["Govt", "social_studies", "TX", "ss.us_gov"],
    // Still what they were.
    ["Dual Credit English IV", "english", "TX", "ela.12"],
    ["AP English Literature", "english", "TN", "ela.lit_comp"],
    ["Algebraic Reasoning", "math", "TX", "math.alg_reasoning"],
    ["English III", "english", "TX", "ela.11"],
  ] as const)("%s (%s, %s) → %s", (name, subject, state, expected) => {
    expect(guessCourseTypeId(name, subject, state)).toBe(expected);
  });

  it("the content: Tennessee's approved list has Mathematical Reasoning for Decision Making, the 4th-year class Bridge Math is guessed as", () => {
    const tn = plannerContentFor("TN");
    const fourth = tn.rules.flatMap((f) => f.ruleSets).find((r) => r.id === "tn.grad")!.variants[0];
    expect(JSON.stringify(fourth.requirements)).toContain("math.applied.decision");
  });
});

describe("G14 through studentPath: a Utah 10th grader's Sec Math 1H, 2H and English 9H, 10H count (typed names)", () => {
  let db: Db;
  const NOW = new Date("2026-09-25T15:00:00Z");
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("no Secondary Math I or II and no 9th or 10th grade English are added, and Secondary Math III comes in 11th", async () => {
    const id = await seedStudent(db, "UT", 10, [
      ["Sec Math 1H", "math", 9, "honors"],
      ["English 9H", "english", 9, "honors"],
      ["Sec Math 2H", "math", 10, "honors"],
      ["English 10H", "english", 10, "honors"],
    ]);
    const path = await studentPath(db, id, NOW);
    if (path.kind !== "planned") throw new Error(`expected a planned path, got ${path.kind}`);
    const result = planned(path.result);
    const types = suggestions(result).map((s) => s.typeId);
    for (const t of ["math.ut_sec1", "math.ut_sec2", "ela.9", "ela.10"]) expect(types, t).not.toContain(t);
    expect(typesAt(result, 11)).toContain("math.ut_sec3");
    expect(gapLines(result)).not.toMatch(/would take more than one math class a year|Grade 9 language arts|Grade 10 language arts/);
    // Still guesses: the audit flags them, and one question asks.
    expect(requirement(result, "ut.grad", "math.sec1").modifiers).toContain("guessed_type");
    expect(questions(result).some((q) => /look like .*Secondary Math I/.test(q))).toBe(true);
  });
});

describe("Typed names on the real content: no required class added twice, nothing called impossible", () => {
  it("G12: Secondary Math IE, IIE and IIIE count as Secondary Math I-III (USBE's extended courses)", () => {
    const path = real({ state: "UT", grade: 11, colleges: [UOFU], courses: typed("UT", [["Secondary Math IE", "math", 9, { level: "honors" }], ["Secondary Math IIE", "math", 10, { level: "honors" }], ["Secondary Math IIIE", "math", 11, { level: "honors" }]]) }, ENGINEER);
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("math.ut_sec1");
    expect(path.gaps.filter((g) => g.kind === "ladder_infeasible" && /Secondary Math/.test(g.text))).toEqual([]);
    for (const id of ["math.sec1", "math.sec2", "math.sec3"]) expect(requirement(path, "ut.grad", id).modifiers, id).not.toContain("needs_plan_now");
  });

  const TN_ROWS: Row[] = [
    ["English 9", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["Lifetime Wellness", "health_pe", 9],
    ["Spanish I", "world_language", 9],
    ["Art I", "arts", 9],
    ["World History", "social_studies", 9],
    ["English 10", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["Spanish II", "world_language", 10],
    ["Physical Education", "health_pe", 10, { units: 2 }],
    ["Economics", "social_studies", 10, { units: 2 }],
    ["Algebra II", "math", 11],
    ["Physical Science", "science", 11],
    ["U.S. History", "social_studies", 11],
    ["Personal Finance", "social_studies", 11, { units: 2 }],
    ["Government", "social_studies", 11, { units: 2 }],
    ["Psychology", "social_studies", 11],
  ];

  it("G11: American Literature, British Literature and Bridge Math: no AP English or 4th math added this year", () => {
    const path = real({ state: "TN", grade: 12, courses: typed("TN", [...TN_ROWS, ["American Literature", "english", 11], ["British Literature", "english", 12], ["Bridge Math", "math", 12]]) }, NURSE);
    const english = suggestions(path).filter((s) => getCourseType(s.typeId).subject === "english");
    expect(english).toEqual([]);
    expect(allReasons(path)).not.toMatch(/Required by Tennessee: (English III|English IV|A 4th math credit)/);
    expect(suggestions(path).filter((s) => s.needsPlanNow && ["english", "math"].includes(getCourseType(s.typeId).subject))).toEqual([]);
  });

  it("G6: Bridge Math is the 4th math credit, so Physics isn't added as one", () => {
    const path = real({ state: "TN", grade: 12, courses: typed("TN", [...TN_ROWS, ["English 11", "english", 11], ["English 12", "english", 12], ["Bridge Math", "math", 12]]) }, NURSE);
    expect(allReasons(path)).not.toMatch(/Required by Tennessee: A 4th math credit/);
    expect(requirement(path, "tn.grad", "math.fourth").modifiers).not.toContain("needs_plan_now");
  });

  it("G1: CE English 2010 is Utah's 12th-grade language arts, so English IV isn't added", () => {
    const UT_ROWS: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["Earth Science", "science", 9],
      ["English 10", "english", 10],
      ["Secondary Math II", "math", 10],
      ["Biology", "science", 10],
      ["English 11", "english", 11],
      ["Secondary Math III", "math", 11],
      ["Chemistry", "science", 11],
      ["CE English 2010", "english", 12, { level: "dual_enrollment" }],
    ];
    const path = real({ state: "UT", grade: 12, courses: typed("UT", UT_ROWS) }, NURSE);
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("ela.12");
    expect(allReasons(path)).not.toMatch(/Grade 12 language arts/);
  });

  it("the safety net: typed rows the names don't place are taken as their grade's class and asked about, never added again", () => {
    const path = real(
      {
        state: "UT",
        grade: 10,
        colleges: [UOFU],
        courses: typed("UT", [
          ["Honors Math 9", "math", 9, { level: "honors" }],
          ["Language and Literature 9", "english", 9, { level: "honors" }],
          ["Honors Math 10", "math", 10, { level: "honors" }],
          ["Lang Lit 10", "english", 10, { level: "honors" }],
        ]),
      },
      ENGINEER,
    );
    // The names alone don't place them.
    expect(guessCourseTypeId("Honors Math 9", "math", "UT")).toBe("math.other");
    expect(guessCourseTypeId("Language and Literature 9", "english", "UT")).toBe("ela.other");
    const types = suggestions(path).map((s) => s.typeId);
    for (const t of ["math.ut_sec1", "math.ut_sec2", "ela.9", "ela.10"]) expect(types, t).not.toContain(t);
    expect(typesAt(path, 11)).toContain("math.ut_sec3");
    expect(gapLines(path)).not.toMatch(/Secondary Math (I|II|III)\b|language arts/);
    expect(questions(path).find((q) => /look like/.test(q))).toMatch(/English I, English II, Secondary Math I and Secondary Math II/);
    expect(ownWarnings(path).map((w) => w.text)).toContain('We planned around this as Secondary Mathematics II because of its grade. Set "What kind of class is this?" on it to be sure it counts.');
  });

  it("the safety net never takes a senior's only math class for Algebra I", () => {
    const path = real({ state: "TN", grade: 12, courses: typed("TN", [["Math Lab", "math", 12]]) });
    expect(ownWarnings(path).filter((w) => w.kind === "guess")).toEqual([]);
  });
});

// 2. Another state's math is a question, never "Needs a plan now" ---------------------------------

describe("A senior's classes from another state's math sequence are counselor questions, not plans needed now (gaps.ts, audit.ts, fill.ts equivalentTaken)", () => {
  const TN_TRANSCRIPT: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "pe.general", grade: 9, units: 2 },
    { type: "arts.visual", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10, letter: "B" },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "lang.es.2", grade: 10 },
    { type: "cs.prog1", grade: 10 },
    { type: "ss.world_geo", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11, letter: "C" },
    { type: "sci.phys", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "arts.music", grade: 11 },
    { type: "ss.psych", grade: 11 },
    { type: "cte.health.1", grade: 11 },
  ];
  const UT_TRANSCRIPT = TN_TRANSCRIPT.map((c) => ({ ...c, type: c.type === "math.alg1" ? "math.ut_sec1" : c.type === "math.geom" ? "math.ut_sec2" : c.type === "math.alg2" ? "math.ut_sec3" : c.type }) as CourseSpec);

  it("K5 (Utah senior from Tennessee): Secondary Math I-III may count the same way, with one question", () => {
    const path = real({ state: "UT", grade: 12, courses: TN_TRANSCRIPT }, NURSE);
    for (const id of ["math.sec1", "math.sec2", "math.sec3"]) {
      const r = requirement(path, "ut.grad", id);
      expect(r.status, id).toBe("ask_counselor");
      expect(r.modifiers, id).not.toContain("needs_plan_now");
    }
    expect(gapLines(path)).not.toMatch(/Needs a plan now: Secondary Math/);
    expect(gapLines(path)).toMatch(/Secondary Math I: you've taken a class that may count the same way\. Ask your counselor whether it does here\./);
    expect(gapLines(path)).not.toMatch(/Secondary Math[^\n]*Summer school or credit recovery/);
    expect(questions(path)).toContain("Do my Algebra I, Geometry and Algebra II count as Secondary Math I, Secondary Math II and Secondary Math III here?");
  });

  it("K32 (Texas senior from Utah): Algebra I, Geometry and the 3rd math credit are questions, and no 3rd math class is added", () => {
    const path = real({ state: "TX", grade: 12, courses: UT_TRANSCRIPT }, NURSE);
    expect(gapLines(path)).not.toMatch(/Needs a plan now: (Algebra I|Geometry)/);
    expect(gapLines(path)).toMatch(/A 3rd math credit: you've taken a class that may count the same way/);
    expect(allReasons(path)).not.toMatch(/Required by Texas: A 3rd math credit/);
    expect(requirement(path, "tx.fhsp.grad", "math.third").status).toBe("ask_counselor");
    expect(questions(path)).toContain("Do my Secondary Math I, Secondary Math II and Secondary Math III count as Algebra I, Geometry and a 3rd math credit here?");
  });

  it("a Texas junior from Utah in Secondary Math III still gets a 12th-grade math class: the other state's class stands in for one credit, not two", () => {
    const courses = UT_TRANSCRIPT.filter((c) => c.grade <= 11);
    const path = real({ state: "TX", grade: 11, choices: { txEndorsements: ["stem"] }, courses }, ENGINEER);
    const senior = suggestions(path).filter((s) => s.grade === 12 && s.typeId.startsWith("math."));
    expect(senior.map((s) => s.typeId)).toEqual(["math.precalc"]);
    // Secondary Math III and Precalculus together make the 3rd and 4th math credits, if the
    // counselor counts Secondary Math III: one question, no class missing.
    expect(gapLines(path)).not.toMatch(/Room to add: A (3rd|4th) math credit/);
    expect(questions(path).find((q) => q.startsWith("Do my Secondary Math I"))).toBeDefined();
  });

  it("K33 (Tennessee senior from Utah): the integrated math question names Tennessee's own lines", () => {
    const path = real({ state: "TN", grade: 12, courses: UT_TRANSCRIPT }, NURSE);
    expect(gapLines(path)).not.toMatch(/Needs a plan now: (Algebra|Geometry)/);
    for (const id of ["math.alg1", "math.geom", "math.alg2"]) expect(requirement(path, "tn.grad", id).modifiers, id).not.toContain("needs_plan_now");
    expect(questions(path)).toContain(
      "Do my Secondary Math I, Secondary Math II and Secondary Math III count as Algebra I (or Integrated Math I), Geometry (or Integrated Math II) and Algebra II (or Integrated Math III) here?",
    );
  });
});

// 3. A senior's credit shortfall ------------------------------------------------------------------

describe("A senior's credit shortfall needs a plan now even when this spring's open periods would hold it (gaps.ts, plan.ts audits)", () => {
  const TX_BASE: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "pe.athletics", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10, letter: "B" },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "lang.es.2", grade: 10 },
  ];

  it("K21 (STEM, UT Austin, 25 of 26 credits): a gap for the endorsement's credits, and the DLA isn't told its endorsement is on the plan", () => {
    const path = real(
      {
        state: "TX",
        grade: 12,
        colleges: [UT_AUSTIN],
        choices: { txEndorsements: ["stem"] },
        courses: [
          ...TX_BASE,
          { type: "cs.prog1", grade: 9 },
          { type: "cte.engineering.1", grade: 10 },
          { type: "arts.visual", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "cte.engineering.2", grade: 11 },
          { type: "cs.prog2", grade: 11 },
          { type: "pe.athletics", grade: 11 },
          { type: "ela.12", grade: 12 },
          { type: "math.precalc", grade: 12 },
          { type: "sci.env", grade: 12 },
          { type: "ss.us_gov", grade: 12 },
          { type: "ss.econ", grade: 12 },
          { type: "cte.engineering.3", grade: 12 },
        ],
      },
      ENGINEER,
    );
    const gap = path.gaps.find((g) => g.id === "gap:tx.endorse.stem/e.electives")!;
    expect(gap.text).toBe("Needs a plan now: the STEM endorsement needs at least 26 credits in all (1 more). Add 1 credit this spring (your open periods); ask your counselor.");
    expect(gap.options.map((o) => o.kind)).toContain("ask_counselor");
    const dla = ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.endorsement")!;
    expect(dla.status).toBe("room_to_add");
    expect(dla.text).not.toMatch(/on your plan too/);
  });

  it("K30 (no endorsement, 1 credit short of 22 after the plan's art and PE): a total-credits gap, and TEXAS Grant isn't told the Foundation program is on the plan", () => {
    const path = real(
      {
        state: "TX",
        grade: 12,
        courses: [
          ...TX_BASE,
          { type: "cs.prog1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "ss.psych", grade: 11 },
          { type: "ela.12", grade: 12 },
          { type: "math.stats", grade: 12 },
          { type: "ss.us_gov", grade: 12 },
          { type: "ss.econ", grade: 12 },
        ],
      },
      NURSE,
    );
    expect(path.gaps.find((g) => g.id === "gap:tx.fhsp.grad/total")?.text).toBe("Needs a plan now: total credits needs 1 more. Add 1 credit this spring (your open periods); ask your counselor.");
    const grant = ruleSet(path, "tx.texas-grant.priority").checks.find((c) => c.checkId === "fhsp")!;
    expect(grant.text).not.toMatch(/on your plan too/);
  });

  it("a junior with a year left isn't given the senior's gap", () => {
    const path = real({ state: "TX", grade: 11, choices: { txEndorsements: ["stem"] }, courses: [...TX_BASE, { type: "ela.11", grade: 11 }, { type: "math.alg2", grade: 11 }] }, ENGINEER);
    expect(gapLines(path)).not.toMatch(/this spring \(your open periods\)/);
  });
});

// 4. The class route to UT Austin's calculus readiness ---------------------------------------------

describe("UT Austin's class route says what it would really take (timeline.ts movesToReach)", () => {
  const TX11: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10, letter: "B" },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "lang.es.2", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.phys", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
  ];

  it.each([
    ["T19 (opted in, B or better)", { accelerateMath: true }],
    ["Z22 (not opted in)", {}],
  ])("%s: in Algebra II in 11th, Calculus I by the end of 11th can't happen, and the December 10 rule is named", (_label, limits) => {
    const path = real({ state: "TX", grade: 11, colleges: [UT_AUSTIN], limits, choices: { txEndorsements: ["stem"] }, courses: TX11 }, ENGINEER);
    const note = path.deadlines.find((d) => d.kind === "test")!.note!;
    expect(note).not.toMatch(/summer class|two math classes/);
    expect(note).toMatch(/the class can't be finished by the end of 11th grade\. A college class in the fall of 12th grade counts only if its final grade is on your transcript by December 10 of 12th grade/);
  });
});

// 5. Utah U.S. Government for the class of 2027 --------------------------------------------------

describe("Utah: a class-of-2027 senior without U.S. Government gets the class, not summer school (ut/generic-catalog.json lastSchoolYear)", () => {
  it("K31: U.S. Government and Citizenship is placed in 12th, with no summer or credit-recovery wording", () => {
    const rows: CourseSpec[] = [
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "health.health", grade: 9, units: 2 },
      { type: "pe.fitness", grade: 9, units: 2 },
      { type: "ss.world_geo", grade: 9, units: 2 },
      { type: "cte.business_office", grade: 9, units: 2 },
      { type: "arts.visual", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.ut_sec2", grade: 10 },
      { type: "sci.bio", grade: 10 },
      { type: "ss.world_hist", grade: 10, units: 2 },
      { type: "pe.skills", grade: 10, units: 2 },
      { type: "pe.lifetime", grade: 10, units: 2 },
      { type: "arts.ensemble", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.ut_sec3", grade: 11 },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "cte.hospitality.1", grade: 11 },
      { type: "ss.psych", grade: 11, units: 2 },
    ];
    const path = real({ state: "UT", grade: 12, courses: rows }, NURSE);
    const gov = suggestions(path).find((s) => s.typeId === "ss.us_gov");
    expect(gov?.grade).toBe(12);
    expect(requirement(path, "ut.grad", "ss.us_gov").status).toBe("planned");
    expect(gapLines(path)).not.toMatch(/U\.S\. Government/);
    expect(gov && reasonsOf(gov)).not.toMatch(/Summer school or credit recovery/);
  });

  it("a class-of-2029 10th grader is never offered the retiring class", () => {
    const path = real({ state: "UT", grade: 10, courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.ut_sec2", grade: 10 }] }, NURSE);
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("ss.us_gov");
    expect(suggestions(path).map((s) => s.typeId)).toContain("ss.ut_acgc");
  });
});

// 6. Career and technical levels from typed names --------------------------------------------------

describe("Career and technical classes: later levels by name, and one level a year in a cluster (course-type-guess.ts, fill.ts cteYears)", () => {
  it.each([
    ["Engineering Design and Presentation I", "TX", "cte.engineering.2"],
    ["Engineering Design and Presentation II", "TX", "cte.engineering.3"],
    ["Construction Technology I", "TX", "cte.architecture_construction.2"],
    ["Electrical Technology I", "TX", "cte.architecture_construction.2"],
    ["Electrical Technology II", "TX", "cte.architecture_construction.3"],
    ["Automotive Technology I", "TX", "cte.transportation.3"],
    ["Medical Therapeutics", "TN", "cte.health.2"],
    ["Nursing Education", "TN", "cte.health.4"],
    ["Marketing and Management I", "TN", "cte.business.2"],
    // Tennessee's Engineering Design I and II stay the lab-science substitute (Policy 3.103).
    ["Engineering Design II", "TN", "cte.engineering_design"],
  ] as const)("%s (%s) → %s", (name, state, expected) => {
    expect(guessCourseTypeId(name, "career_technical", state)).toBe(expected);
  });

  it("G10 (Texas STEM junior in EDP II): no engineering level at or below level 3 is planned", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        choices: { txEndorsements: ["stem"] },
        courses: typed("TX", [
          ["English I", "english", 9],
          ["Algebra I", "math", 9],
          ["Biology", "science", 9],
          ["World Geography", "social_studies", 9],
          ["Principles of Applied Engineering", "career_technical", 9],
          ["Spanish I", "world_language", 9],
          ["English II", "english", 10],
          ["Geometry", "math", 10],
          ["Chemistry", "science", 10],
          ["World History", "social_studies", 10],
          ["Engineering Design and Presentation I", "career_technical", 10],
          ["Spanish II", "world_language", 10],
          ["English III", "english", 11],
          ["Algebra II", "math", 11],
          ["Physics", "science", 11],
          ["U.S. History", "social_studies", 11],
          ["Engineering Design and Presentation II", "career_technical", 11],
        ]),
      },
      ENGINEER,
    );
    expect(suggestions(path).filter((s) => getCourseType(s.typeId).ladder?.id === "cte.engineering")).toEqual([]);
    expect(gapLines(path)).not.toMatch(/Engineering and STEM, level [1-3]/);
  });

  it("two years of Tennessee's Engineering Design count as two levels", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        choices: { tnElectiveFocus: "cte" },
        courses: typed("TN", [
          ["English 9", "english", 9],
          ["Algebra I", "math", 9],
          ["Principles of Engineering and Technology", "career_technical", 9],
          ["English 10", "english", 10],
          ["Geometry", "math", 10],
          ["Engineering Design I", "career_technical", 10],
          ["English 11", "english", 11],
          ["Algebra II", "math", 11],
          ["Engineering Design II", "career_technical", 11],
        ]),
      },
      ENGINEER,
    );
    expect(suggestions(path).filter((s) => getCourseType(s.typeId).ladder?.id === "cte.engineering").map((s) => getCourseType(s.typeId).ladder!.rank)).toEqual([]);
  });

  describe("G2 through studentPath: a Tennessee junior in the nursing program of study (typed names)", () => {
    let db: Db;
    const NOW = new Date("2026-09-25T15:00:00Z");
    beforeEach(async () => {
      db = await createTestDb();
    });

    it("after Health Science Education, Medical Therapeutics and Anatomy and Physiology, no health science level is planned", async () => {
      const id = await seedStudent(db, "TN", 11, [
        ["English 9", "english", 9],
        ["Algebra I", "math", 9],
        ["Biology", "science", 9],
        ["Lifetime Wellness", "health_pe", 9],
        ["Health Science Education", "career_technical", 9],
        ["Spanish I", "world_language", 9],
        // A 3rd lab science of its own, so Anatomy and Physiology can count for the focus.
        ["Physical Science", "science", 9],
        ["English 10", "english", 10],
        ["Geometry", "math", 10],
        ["Chemistry", "science", 10],
        ["World History", "social_studies", 10],
        ["Medical Therapeutics", "career_technical", 10],
        ["Spanish II", "world_language", 10],
        ["English 11", "english", 11],
        ["Algebra II", "math", 11],
        ["Anatomy and Physiology", "career_technical", 11],
        ["U.S. History", "social_studies", 11],
      ]);
      await updatePlanPrefs(db, id, { choices: { tnElectiveFocus: "cte" } }, NOW);
      const path = await studentPath(db, id, NOW);
      if (path.kind !== "planned") throw new Error(`expected a planned path, got ${path.kind}`);
      const result = planned(path.result);
      expect(suggestions(result).filter((s) => getCourseType(s.typeId).ladder?.id === "cte.health")).toEqual([]);
      expect(gapLines(result)).not.toMatch(/Health science, level/);
      expect(allReasons(result)).not.toMatch(/The next levels, in order, make you a completer/);
      expect(requirement(result, "tn.focus.cte", "focus").missing).toBe(0);
    });
  });
});

// 7. Two goals in Texas: each plan has its goal's endorsement ---------------------------------------

describe("Texas two-goal plans plan with each goal's endorsement (plan.ts targetSplit, goalEndorsement)", () => {
  it("Z25 (nursing and engineering, no endorsement named): Plan A audits Public Services, Plan B STEM", () => {
    const path = real(
      {
        state: "TX",
        grade: 9,
        colleges: [TAMU],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "pe.athletics", grade: 9 },
        ],
      },
      [...NURSE, ...ENGINEER],
    );
    expect(path.planChoice?.kind).toBe("target_split");
    const a = path.plans.find((p) => p.id === "A")!;
    const b = path.plans.find((p) => p.id === "B")!;
    expect(a.audit.map((x) => x.ruleSetId)).toContain("tx.endorse.public-services");
    expect(b.audit.map((x) => x.ruleSetId)).toContain("tx.endorse.stem");
    for (const p of [a, b]) {
      const checks = p.audit.flatMap((x) => x.checks.map((c) => c.text)).join("\n");
      expect(checks, p.label).not.toMatch(/covers only the Foundation program|This also needs one of/);
      expect(checks, p.label).toMatch(/this plan uses the (Public Services|STEM) endorsement for now/);
    }
    // Naming one is still the student's decision.
    expect(path.decisions.map((d) => d.key)).toContain("txEndorsements");
  });
});

// 8. College-level load across the years ------------------------------------------------------------

describe("An AP or IB focus spreads its college-level classes across years (fill.ts upgradeForCollegeOnlyNeeds)", () => {
  it("K11 (Tennessee 9th grader, AP/IB focus): at most two college-level classes in 10th, and U.S. History isn't AP in 10th", () => {
    const path = real(
      {
        state: "TN",
        grade: 9,
        colleges: [UTK],
        choices: { tnElectiveFocus: "ap_ib" },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "B+" },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "lang.es.1", grade: 9 },
        ],
      },
      ACCOUNTANT,
    );
    const college = (g: number) => suggestions(path).filter((s) => s.grade === g && isCollegeLevel(s.level)).length;
    expect(college(10)).toBeLessThanOrEqual(2);
    expect(college(10) + college(11)).toBeGreaterThanOrEqual(3);
    expect(suggestions(path).find((s) => s.typeId === "ss.us_hist" && s.grade === 10)?.level).not.toBe("ap");
    expect(requirement(path, "tn.focus.ap-ib", "focus").missing).toBe(0);
  });
});

// 9-11. Recommendations, swaps and a floor for math ---------------------------------------------------

describe("A recommendation takes a lower-priority class's place, or says which swap would meet it (fill.ts swapFor, gaps.ts swapHint)", () => {
  it("K6 (Utah junior in Health Science 2, Utah State): Physics takes the 12th-grade slot the pathway's level 3 had", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        colleges: [USU],
        limits: { classesPerYear: 5 },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "cte.business_office", grade: 9, units: 2 },
          { type: "lang.es.1", grade: 9 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "cte.health.1", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "arts.visual", grade: 10, units: 2 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "cte.health.2", grade: 11 },
          { type: "ss.psych", grade: 11 },
          { type: "pe.skills", grade: 11, units: 2 },
          { type: "pe.lifetime", grade: 11, units: 2 },
        ],
      },
      NURSE,
    );
    expect(typesAt(path, 12)).toContain("sci.phys");
    expect(typesAt(path, 12)).not.toContain("cte.health.3");
    expect(gapLines(path)).not.toMatch(/Room to add: Physics/);
  });

  it("U5 (nursing, Utah State): 12th-grade Statistics stays (round 2), and the gap says Precalculus in its place would meet Utah State's recommendation", () => {
    const U5: Scenario = {
      state: "UT",
      grade: 10,
      colleges: [USU],
      courses: [
        { type: "ela.9", grade: 9, letter: "B" },
        { type: "math.ut_sec1", grade: 9, letter: "B" },
        { type: "sci.earth", grade: 9, letter: "A-" },
        { type: "ss.world_geo", grade: 9 },
        { type: "pe.fitness", grade: 9 },
        { type: "health.health", grade: 9 },
        { type: "cte.business_office", grade: 9 },
        { type: "arts.visual", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.ut_sec2", grade: 10 },
        { type: "sci.bio", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "lang.es.1", grade: 10 },
        { type: "cte.health.1", grade: 10 },
      ],
    };
    const path = real(U5, NURSE);
    expect(typesAt(path, 12).filter((t) => t.startsWith("math."))).toEqual(["math.stats"]);
    const gap = path.gaps.find((g) => g.id === "gap:usu.recommended/math.beyond3")!;
    expect(gap.text).toBe("Room to add: One class beyond Secondary Math III. Precalculus in place of Statistics in 12th grade would meet this.");
  });

  it("K14 (Tennessee senior in AP Calculus, math and science focus): the focus's last credit isn't a math class below calculus", () => {
    const path = real({
      state: "TN",
      grade: 12,
      colleges: [UTK],
      choices: { tnElectiveFocus: "math_science" },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "health.wellness", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "ss.world_hist", grade: 9 },
        { type: "pe.general", grade: 9, units: 2 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "arts.visual", grade: 10 },
        { type: "cs.prog1", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "math.precalc", grade: 11 },
        { type: "ela.12", grade: 12 },
        { type: "math.calc", grade: 12, level: "ap" },
        { type: "sci.chem2", grade: 12, level: "ap" },
        { type: "ss.us_gov", grade: 12, units: 2 },
        { type: "ss.econ", grade: 12, units: 2 },
        { type: "ss.pfl", grade: 12, units: 2 },
      ],
    });
    const added = suggestions(path).filter((s) => s.grade === 12);
    expect(added.length).toBeGreaterThan(0);
    for (const t of ["math.applied.decision", "math.college_prep", "math.adv_quant"] as CourseTypeId[]) expect(added.map((s) => s.typeId), t).not.toContain(t);
  });
});

// 12. Tennessee integrated math ------------------------------------------------------------------

describe("Tennessee: a student on the integrated track stays on it (tn/generic-catalog.json, plan.ts alternatives)", () => {
  it("G9 (Integrated Math I and II): Integrated Math III in 11th, not Algebra II", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        colleges: [UTK],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.int1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.int2", grade: 10 },
          { type: "sci.chem", grade: 10 },
        ],
      },
      ENGINEER,
    );
    expect(typesAt(path, 11)).toContain("math.int3");
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("math.alg2");
    const int3 = suggestions(path).find((s) => s.typeId === "math.int3")!;
    expect(int3.alternatives.map((a) => a.typeId)).not.toContain("math.alg2");
  });

  it("a student on Algebra I and Geometry isn't offered Integrated Math III", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        colleges: [UTK],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
        ],
      },
      ENGINEER,
    );
    const alg2 = suggestions(path).find((s) => s.typeId === "math.alg2")!;
    expect(alg2.alternatives.map((a) => a.typeId)).not.toContain("math.int3");
  });

  it("the content: Tennessee's list has Integrated Math I-III, citing Policy 3.205", () => {
    const rows = plannerContentFor("TN").genericCatalog.courses.filter((c) => ["math.int1", "math.int2", "math.int3"].includes(c.typeId));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.cite).toContain("tn-3205-math");
  });
});
