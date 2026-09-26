import { describe, expect, it } from "vitest";
import { plannerContentFor } from "../content";
import { getCourseType } from "../course-types";
import type { CatalogCourse, CatalogView, CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions, typesIn } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";
import { randomInput } from "./testing/random";
import { creditNoun, lowerFirstWord } from "./util";

// Regression tests for the counselor's second review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described. The typed-name students (S1-S3) and the Software Developers
// routing run against a real database in test/course-path.test.ts and routing.test.ts.

const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UH: CollegeTarget = { unitId: 225511, name: "University of Houston", state: "TX", public: true, admissionRate: 0.66, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const UOFU: CollegeTarget = { unitId: 230764, name: "University of Utah", state: "UT", public: true, admissionRate: 0.86, openAdmission: null };
const USU: CollegeTarget = { unitId: 230728, name: "Utah State University", state: "UT", public: true, admissionRate: 0.925, openAdmission: null };

type Goal = { familyId: FamilyId; because: string | null; source?: FamilyTarget["source"] };

/** A student on the real content, with goals named as the reviewer named them. */
function real(s: Scenario, goals: Goal[] = []): PlannedPath {
  const input = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) input.targets.families = goals.map((g) => ({ familyId: g.familyId, source: g.source ?? "north_star", cip6: null, because: g.because }));
  return planned(plan(input));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const gapText = (path: PlannedPath, planId: "A" | "B" = "A") =>
  path.plans
    .find((p) => p.id === planId)!
    .gaps.map((g) => `${g.text} ${g.options.map((o) => o.text).join(" ")}`)
    .join("\n");
const allSuggestions = (path: PlannedPath) => path.plans.flatMap((p) => suggestions(path, p.id));

const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const ACCOUNTANT: Goal[] = [{ familyId: "business", because: "Accountants and Auditors" }];
const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];

describe("Texas 4th English credit: the level III speech, debate and journalism classes only (19 TAC §74.12(b)(1))", () => {
  it("the Foundation program's 4th credit doesn't take speech, debate or journalism classes of any level", () => {
    const fhsp = plannerContentFor("TX").rules.flatMap((f) => f.ruleSets).find((r) => r.id === "tx.fhsp.grad")!;
    const json = JSON.stringify(fhsp.variants.map((v) => v.requirements));
    const ela4 = [...json.matchAll(/"id":"ela\.4".*?"select":(\[.*?\])/g)].map((m) => m[1]);
    expect(ela4).toHaveLength(2);
    for (const select of ela4) expect(select).not.toMatch(/ela\.(speech|debate|journalism)/);
  });

  it("X5: a Texas business-goal student keeps English IV, with one speech class", () => {
    for (const choices of [{ txEndorsements: ["business_industry" as const] }, {}]) {
      const path = real(
        {
          state: "TX",
          grade: 10,
          colleges: [TAMU],
          choices,
          courses: [
            { type: "ela.9", grade: 9 },
            { type: "math.alg1", grade: 9, letter: "B" },
            { type: "sci.bio", grade: 9 },
            { type: "ss.world_geo", grade: 9 },
            { type: "ela.10", grade: 10 },
            { type: "math.geom", grade: 10 },
          ],
        },
        ACCOUNTANT,
      );
      for (const p of path.plans) {
        expect(typesIn(path, 12, p.id), p.label).toContain("ela.12");
        expect(suggestions(path, p.id).filter((s) => s.typeId === "ela.speech").length, p.label).toBeLessThanOrEqual(1);
      }
      expect(requirement(path, "tx.fhsp.grad", "ela.4").counted.some((c) => c.ref.kind === "suggestion" && c.ref.key.includes("/ela.12/"))).toBe(true);
    }
  });

  it("X9: a Texas 11th grader from Tennessee keeps English IV next to the business goal's speech class", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "B" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10, letter: "B" },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
        ],
      },
      ACCOUNTANT,
    );
    expect(typesIn(path, 12)).toContain("ela.12");
    expect(typesIn(path, 12).filter((t) => t === "ela.speech").length).toBeLessThanOrEqual(1);
  });
});

describe("An extension picks its base's route (fill.ts pickOptions: Tennessee elective focus)", () => {
  it("N9: a Tennessee nursing student with a math and science focus has no focus gap", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        colleges: [UTK],
        choices: { tnElectiveFocus: "math_science" },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "A" },
          { type: "sci.bio", grade: 9, letter: "A" },
          { type: "ss.world_hist", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10, level: "honors" },
          { type: "sci.chem", grade: 10, level: "honors" },
        ],
      },
      NURSE,
    );
    expect(path.gaps.filter((g) => g.demandId?.startsWith("tn.focus"))).toEqual([]);
    expect(requirement(path, "tn.focus.math-science", "focus").status).toBe("planned");
    expect(gapText(path)).not.toMatch(/Algebra I in summer/);
  });
});

/** Lab sciences in a plan year (the student's own, not failed, and suggestions; not summer). */
function labSciences(path: PlannedPath, planId: string, grade: number, input: { courses: { id: string; finalGrade: string | null }[] }): number {
  const y = path.plans.find((p) => p.id === planId)!.years.find((x) => x.grade === grade)!;
  return y.slots.filter((s) => {
    if (s.kind === "your_choice" || !getCourseType(s.typeId).capabilities.includes("lab_science")) return false;
    if (s.kind === "suggested") return s.term !== "summer";
    const letter = input.courses.find((c) => c.id === s.courseId)?.finalGrade;
    return !["F", "W", "I"].includes(String(letter));
  }).length;
}

describe("Sciences spread across years; required classes don't move for a recommended language (moveOut, the reserve)", () => {
  const U3: Scenario = { state: "UT", grade: 9, courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.earth", grade: 9 }] };

  it("U3: a Utah 9th grader's sciences aren't stacked in 12th, and each stays in its usual grades", () => {
    const input = scenario({ ...U3, content: plannerContentFor("UT") });
    input.targets.families = [{ familyId: "computer_data_science", source: "north_star", cip6: null, because: "Software Developers" }];
    const path = planned(plan(input));
    for (const g of [10, 11, 12]) expect(labSciences(path, "A", g, input), `${g}`).toBeLessThanOrEqual(2);
    for (const s of suggestions(path).filter((x) => ["sci.bio", "sci.chem"].includes(x.typeId))) {
      const [from, to] = getCourseType(s.typeId).grades;
      expect(s.grade, s.typeId).toBeGreaterThanOrEqual(from);
      expect(s.grade, s.typeId).toBeLessThanOrEqual(to);
    }
  });

  it("property: no year with 3 or more lab sciences while an earlier year has none (random students, real content)", () => {
    const bad: string[] = [];
    for (let i = 0; i < 250; i++) {
      const seed = 5000 + i * 7919;
      const input = randomInput(seed);
      if (!input.state) continue;
      input.content = plannerContentFor(input.state);
      const result = plan(input);
      if (result.mode === "no_state" || result.stage === "middle_school") continue;
      const inProgress = input.asOf.month === 6 || input.asOf.month === 7 ? null : input.student.grade;
      for (const p of result.plans) {
        const future = p.years.filter((y) => y.grade !== inProgress).map((y) => y.grade);
        for (const g of future) {
          const heavy = labSciences(result, p.id, g, input) >= 3 && suggestions(result, p.id).some((s) => s.grade === g && getCourseType(s.typeId).capabilities.includes("lab_science"));
          if (!heavy) continue;
          const empty = future.filter((e) => e < g && labSciences(result, p.id, e, input) === 0);
          if (empty.length) bad.push(`seed ${seed} plan ${p.id}: ${g} has 3+, ${empty.join(",")} none`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("Acceleration in gap options only with the opt-in and a B or better (gaps.ts optionsFor)", () => {
  it("N3: a Tennessee 9th grader who hasn't opted in gets the lower target and the counselor, not summer precalculus", () => {
    const path = real({ state: "TN", grade: 9, colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }] }, ACCOUNTANT);
    const calc = path.gaps.find((g) => g.demandId === "prep:business/math.CALC")!;
    expect(calc.options.map((o) => o.kind)).toEqual(["lower_target", "ask_counselor"]);
  });

  it("X14: a Texas 11th grader who opted in but got a C in Geometry isn't offered college-credit calculus", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        colleges: [UT_AUSTIN],
        limits: { accelerateMath: true },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "B" },
          { type: "sci.bio", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10, letter: "C" },
          { type: "sci.chem", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
        ],
      },
      [{ familyId: "engineering", because: "Mechanical Engineers" }],
    );
    const calc = path.gaps.find((g) => g.demandId === "prep:engineering/math.CALC")!;
    expect(calc.options.map((o) => o.kind)).not.toContain("college_credit");
    expect(calc.options.map((o) => o.kind)).not.toContain("summer");
  });

  it("a Utah student a year short of calculus is never told to take calculus online", () => {
    for (const accelerateMath of [false, true]) {
      const path = real(
        { state: "UT", grade: 10, colleges: [UOFU], limits: { accelerateMath }, courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9, letter: "A" }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.ut_sec2", grade: 10 }] },
        SOFTWARE,
      );
      for (const p of path.plans) expect(gapText(path, p.id)).not.toMatch(/Take (AP )?Calculus online/i);
    }
  });
});

describe("Gap options name a class the student can take next (gaps.ts typeForNeed)", () => {
  it("N5: a Tennessee 11th grader past Algebra I isn't told to take Algebra I in summer", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        courses: [
          { type: "math.alg1", grade: 8, letter: "B", hsCredit: true },
          { type: "ela.9", grade: 9 },
          { type: "math.geom", grade: 9, letter: "C" },
          { type: "sci.bio", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.alg2", grade: 10, letter: "W" },
          { type: "sci.chem", grade: 10 },
          { type: "ela.11", grade: 11 },
        ],
      },
      [{ familyId: "education", because: "Elementary School Teachers" }],
    );
    expect(gapText(path)).not.toMatch(/Algebra I/);
    // Four years of math is years, not credits: a summer or college class adds no year.
    const years = path.gaps.find((g) => g.demandId === "prep:education/math.fourth_year")!;
    expect(years.options.map((o) => o.kind)).toEqual(["ask_counselor"]);
  });
});

const U9_COURSES: CourseSpec[] = [
  { type: "math.ut_sec1", grade: 8, hsCredit: true, letter: "A" },
  { type: "ela.9", grade: 9 },
  { type: "math.ut_sec2", grade: 9, letter: "A" },
  { type: "sci.bio", grade: 9 },
  { type: "ss.world_geo", grade: 9, units: 2 },
  { type: "health.health", grade: 9, units: 2 },
  { type: "pe.fitness", grade: 9, units: 2 },
  { type: "arts.visual", grade: 9 },
  { type: "ela.10", grade: 10 },
  { type: "math.ut_sec3", grade: 10, letter: "A" },
  { type: "sci.chem", grade: 10 },
  { type: "ss.world_hist", grade: 10, units: 2 },
  { type: "pe.skills", grade: 10, units: 2 },
  { type: "cs.principles", grade: 10 },
  { type: "arts.music", grade: 10, units: 2 },
  { type: "ela.11", grade: 11 },
  { type: "math.calc", grade: 11, level: "ap", letter: "A" },
  { type: "ss.us_hist", grade: 11 },
  { type: "ss.pfl", grade: 11, units: 2 },
  { type: "pe.lifetime", grade: 11, units: 2 },
  { type: "cte.engineering_design", grade: 11 },
  { type: "ss.psych", grade: 11, units: 2 },
  { type: "ela.12", grade: 12 },
  { type: "sci.phys2", grade: 12, level: "ap" },
  { type: "ss.us_gov", grade: 12, units: 2 },
];

describe("Utah's senior-year math is conditional (R277-700-9): worded so, asked first, never college-prep math after calculus", () => {
  it("U9: a senior with an A in AP Calculus gets the question, not College-preparatory math flagged \"Needs a plan now\"", () => {
    const path = real({ state: "UT", grade: 12, colleges: [UOFU], courses: U9_COURSES }, [{ familyId: "engineering", because: "Mechanical Engineers" }]);
    expect(allSuggestions(path).map((s) => s.typeId)).not.toContain("math.college_prep");
    expect(allSuggestions(path).filter((s) => s.needsPlanNow && getCourseType(s.typeId).subject === "math")).toEqual([]);
    const gap = path.gaps.find((g) => g.demandId === "ut.grad/ut.grad.senior-math")!;
    expect(gap.text).not.toMatch(/Needs a plan now/);
    expect(gap.text).toMatch(/ask your counselor whether you've already shown college-ready math/);
    expect(gap.options.map((o) => o.kind)).toEqual(["test_score", "ask_counselor"]);
    expect(gap.reasons[0].text).toBe("Utah asks college-bound students to show college-ready math or take a full year of math in 12th grade.");
  });

  it("U5: a nursing student's 12th-grade math is Statistics, not College-preparatory math, with no second statistics class", () => {
    const path = real(
      { state: "UT", grade: 10, colleges: [USU], courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.ut_sec2", grade: 10 }, { type: "sci.chem", grade: 10 }] },
      NURSE,
    );
    const senior = typesIn(path, 12).filter((t) => getCourseType(t as never).subject === "math");
    expect(senior).toEqual(["math.stats"]);
    const stats = suggestions(path).find((s) => s.typeId === "math.stats")!;
    expect(reasonsOf(stats)).toMatch(/Utah asks college-bound students to show college-ready math/);
    expect(reasonsOf(stats)).not.toMatch(/Required by Utah: a full year of math/);
    expect(gapText(path)).not.toMatch(/Statistics (online|for college credit)/);
  });
});

describe("Texas students with no endorsement named (audit no_endorsement_after, plan.ts default endorsement)", () => {
  it("X8: a training-path 10th grader in Transportation 1-2 is planned with Business and Industry, and Transportation 3", () => {
    const path = real(
      {
        state: "TX",
        grade: 10,
        path: "training",
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "F" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "cte.transportation.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.alg1", grade: 10 },
          { type: "cte.transportation.2", grade: 10 },
        ],
      },
      [{ familyId: "transportation_maintenance", because: "Automotive Service Technicians" }],
    );
    expect(path.audit.map((a) => a.ruleSetId)).toContain("tx.endorse.business");
    expect(allSuggestions(path).map((s) => s.typeId)).toContain("cte.transportation.3");
    expect(path.decisions.map((d) => d.key)).not.toContain("ctePathway");
    expect(path.decisions.map((d) => d.key)).toContain("txEndorsements");
    const check = ruleSet(path, "tx.fhsp.grad").checks.find((c) => c.kind === "no_endorsement_after")!;
    expect(check.status).toBe("ask_counselor");
    expect(check.text).toMatch(/^You haven't named an endorsement, so this plan uses the Business and Industry endorsement/);
  });

  it("X9: an 11th grader from Tennessee with no career classes is planned with Multidisciplinary Studies", () => {
    const path = real({ state: "TX", grade: 11, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }, { type: "ela.11", grade: 11 }, { type: "math.alg2", grade: 11 }] }, ACCOUNTANT);
    expect(path.audit.map((a) => a.ruleSetId)).toContain("tx.endorse.multidisciplinary");
    expect(ruleSet(path, "tx.fhsp.grad").checks.find((c) => c.kind === "no_endorsement_after")!.text).not.toBe("You're planning with an endorsement.");
  });

  it("a senior with no endorsement is told the plan covers only the Foundation program", () => {
    const path = real({ state: "TX", grade: 12, courses: [{ type: "ela.9", grade: 9 }, { type: "ela.12", grade: 12 }] });
    const check = ruleSet(path, "tx.fhsp.grad").checks.find((c) => c.kind === "no_endorsement_after")!;
    expect(check).toMatchObject({ status: "ask_counselor" });
    expect(check.text).toMatch(/covers only the Foundation program \(22 credits\)/);
  });
});

describe("A second programming class comes after the first (course-types.ts sequencePrereqs)", () => {
  it("regular Coding II / Computer Science II needs Coding I or CS Principles; AP Computer Science A needs Algebra I only", () => {
    const t = getCourseType("cs.prog2");
    expect(t.sequencePrereqs.map((p) => [...p.anyOf])).toEqual([["cs.prog1", "cs.principles"]]);
    expect(t.prereqs.map((p) => [...p.anyOf])).toEqual([["math.alg1", "math.int1", "math.ut_sec1"]]);
  });

  it("N3, N9: a Tennessee student's first computer science class is never Coding II", () => {
    for (const goals of [ACCOUNTANT, NURSE]) {
      const path = real({ state: "TN", grade: 10, colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "A" }, { type: "sci.bio", grade: 9 }] }, goals);
      for (const p of path.plans) {
        const cs = suggestions(path, p.id).filter((s) => getCourseType(s.typeId).subject === "computer_science").sort((a, b) => a.grade - b.grade);
        if (cs.length) expect(cs[0].typeId === "cs.prog2" && cs[0].level !== "ap", `${p.id}: ${cs.map((s) => s.typeId)}`).toBe(false);
      }
    }
  });
});

describe("A degree-path senior's required math is weighed by everything it serves (pick)", () => {
  it("X7: a Texas senior with no Algebra II gets Algebra II for the 4th math, and no DLA gap", () => {
    const path = real({
      state: "TX",
      grade: 12,
      choices: { txEndorsements: ["multidisciplinary"] },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9, letter: "C" },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "pe.athletics", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10, letter: "C" },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "arts.visual", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.applied.models", grade: 11, letter: "B" },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "cs.prog1", grade: 11 },
        { type: "sci.env", grade: 11 },
        { type: "ela.12", grade: 12 },
        { type: "ss.us_gov", grade: 12, units: 2 },
        { type: "ss.econ", grade: 12, units: 2 },
      ],
    });
    expect(typesIn(path, 12).filter((t) => getCourseType(t as never).subject === "math")).toEqual(["math.alg2"]);
    expect(path.gaps.filter((g) => g.demandId === "tx.dla/dla.alg2")).toEqual([]);
    expect(gapText(path)).not.toMatch(/with the classes you're taking now/);
  });
});

/** The Texas generic list with dual-credit precalculus and calculus, as a school list. */
function txListWithDualMath(): CatalogView {
  const courses: CatalogCourse[] = [];
  for (const c of plannerContentFor("TX").genericCatalog.courses) {
    const t = getCourseType(c.typeId);
    const levels = c.typeId === "math.precalc" || c.typeId === "math.calc" ? [...new Set([...c.levels, "dual_enrollment" as const])] : c.levels;
    for (const level of levels) {
      const units = c.units ?? t.units;
      courses.push({
        id: `s-${c.typeId}-${level}`,
        typeId: c.typeId,
        level,
        subject: t.subject,
        title: t.title,
        units,
        grades: null,
        terms: units <= 2 ? ["fall", "spring"] : ["full_year"],
        prereqs: [],
        approvals: [],
        cte: t.cte === "always",
        lectureOnly: false,
        delivery: "in_person",
        firstSchoolYear: null,
        everyOtherYear: false,
      });
    }
  }
  return { id: "school", source: "school_published", state: "TX", schoolYear: 2026, lastYears: false, classesPerYear: 7, schedule: "traditional", localTotalUnits: null, confirmedSubjects: "all", courses };
}

describe("UT Austin's calculus by 11th for a student who opted in with a B (mathRoute, timeline)", () => {
  const X11: Scenario = {
    state: "TX",
    grade: 9,
    colleges: [UT_AUSTIN, TAMU],
    limits: { accelerateMath: true },
    courses: [{ type: "math.alg1", grade: 8, letter: "B+", hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }],
  };

  it("X11: the class-route note doesn't ask an opted-in student whether they want it", () => {
    const path = real(X11, SOFTWARE);
    const test = path.deadlines.find((d) => d.kind === "test")!;
    expect(test.note).toMatch(/would take a summer class or two math classes in one year/);
    expect(test.note).not.toMatch(/Only if you want that/);
  });

  it("with dual-credit precalculus and calculus on the list, Plan B takes them in 11th, fall then spring", () => {
    const list = txListWithDualMath();
    const path = real({ ...X11, catalogs: { 9: list, 10: list, 11: list, 12: list } }, SOFTWARE);
    expect(path.planChoice?.kind).toBe("math_route");
    expect(path.plans[1]!.label).toBe("Plan B: calculus by the end of 11th grade, adds two college-credit math classes in one year.");
    const eleventh = suggestions(path, "B").filter((s) => s.grade === 11 && s.typeId.startsWith("math."));
    expect(eleventh.map((s) => [s.typeId, s.level, s.term])).toEqual([
      ["math.precalc", "dual_enrollment", "fall"],
      ["math.calc", "dual_enrollment", "spring"],
    ]);
  });
});

describe("\"Required by\" only when the class is needed, and choices named as the whole requirement (plan.ts slotReasons)", () => {
  it("U10: a Utah transfer with Biology and Chemistry sees Earth science as part of Utah's science, not as \"Earth science\"", () => {
    const path = real({
      state: "UT",
      grade: 10,
      courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }, { type: "sci.chem", grade: 10 }],
    });
    const earth = suggestions(path).find((s) => s.typeId === "sci.earth")!;
    expect(reasonsOf(earth)).not.toMatch(/Required by Utah: Earth science/);
    expect(reasonsOf(earth)).toMatch(/Required by Utah: Science \(two of the five foundation science areas and one more science credit\)/);
    // Other choices never go back below the math the student has (Secondary Math I after III).
    const senior = suggestions(path).filter((x) => x.grade === 12 && x.typeId.startsWith("math."));
    expect(senior.length).toBeGreaterThan(0);
    for (const s of senior) {
      expect(s.alternatives.length).toBeGreaterThan(0);
      expect(s.alternatives.map((a) => a.typeId).filter((t) => ["math.ut_sec1", "math.ut_sec2", "math.alg1", "math.geom"].includes(t))).toEqual([]);
    }
  });

  it("X3: World History isn't \"Required by UT Austin: 3 social studies credits\" when other classes make the 3", () => {
    const path = real({ state: "TX", grade: 9, colleges: [UH, UT_AUSTIN], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] }, NURSE);
    for (const p of path.plans) {
      for (const s of suggestions(path, p.id).filter((x) => x.typeId === "ss.world_hist")) expect(reasonsOf(s)).not.toMatch(/Social studies: 3 credits/);
    }
  });

  it("N8: a Tennessee 9th grader's Computer Science Foundations is the CS credit (and the 4th math), so no Coding I is \"Required\"", () => {
    const path = real({ state: "TN", grade: 9, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "cs.intro", grade: 9 }, { type: "ss.world_hist", grade: 9 }] }, SOFTWARE);
    const cs = requirement(path, "tn.grad", "cs");
    expect(cs.status).toBe("done");
    expect(cs.counted.every((c) => c.ref.kind === "course")).toBe(true);
    for (const s of suggestions(path)) expect(reasonsOf(s)).not.toMatch(/Required by Tennessee: Computer science/);
  });
});

describe("Endorsement plans that count only on a condition (endorsementSplit, §74.13(f)(7)(B))", () => {
  it("X10: no plan uses an IT program for Business and Industry while it also meets STEM's math and science", () => {
    for (const familyId of ["computer_data_science", "it_cybersecurity"] as const) {
      const path = real(
        { state: "TX", grade: 9, colleges: [UT_AUSTIN, TAMU], limits: { accelerateMath: true }, courses: [{ type: "math.alg1", grade: 8, letter: "B+", hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] },
        [{ familyId, because: "Software Developers" }],
      );
      for (const p of path.plans) for (const a of p.audit) for (const c of a.checks) expect(c.kind === "counts_unless" && c.status === "ask_counselor", `${familyId} ${p.label} ${c.checkId}`).toBe(false);
    }
  });
});

describe("The ladder's reason names only what the plan reaches (placeLadder)", () => {
  it("N3: precalculus in 12th says calculus would come in college, never that it keeps calculus open", () => {
    const path = real({ state: "TN", grade: 9, colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }] }, ACCOUNTANT);
    expect(path.gaps.some((g) => g.demandId === "prep:business/math.CALC")).toBe(true);
    const precalc = suggestions(path).find((s) => s.typeId === "math.precalc")!;
    expect(reasonsOf(precalc)).not.toMatch(/keeps calculus/);
    expect(reasonsOf(precalc)).toMatch(/Precalculus in 12th: calculus would come in college\./);
  });
});

describe("A family the student chose is planned around; words keep their capitals (targetSplit, lowerFirstWord)", () => {
  it("U4: a Utah student who chose computer science over their Software Developers goal's IT family gets one plan", () => {
    const path = real({ state: "UT", grade: 9, colleges: [UOFU, USU], courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.earth", grade: 9 }] }, [
      { familyId: "computer_data_science", because: null, source: "chosen" },
      { familyId: "it_cybersecurity", because: "Software Developers" },
    ]);
    expect(path.planChoice?.kind).not.toBe("target_split");
    expect(JSON.stringify(path)).not.toMatch(/iT, networking|for it, networking/);
  });

  it("acronyms keep their capitals, and 1 credit is singular", () => {
    expect(lowerFirstWord("IT, networking and cybersecurity")).toBe("IT, networking and cybersecurity");
    expect(lowerFirstWord("Arts, A/V technology and communications")).toBe("arts, A/V technology and communications");
    expect(lowerFirstWord("Health science")).toBe("health science");
    expect(`${1} more ${creditNoun(1)}`).toBe("1 more credit");
    expect(`${0.5} more ${creditNoun(0.5)}`).toBe("0.5 more credits");
  });
});

describe("Projected rules say so on the suggestion (requirementReason)", () => {
  it("X3: a class of 2030 nursing student's lines from UH's projected rules read \"Expected by\"", () => {
    const path = real({ state: "TX", grade: 9, colleges: [UH, UT_AUSTIN], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] }, NURSE);
    expect(ruleSet(path, "uh.nursing").projected).toBe(true);
    const lines = allSuggestions(path).flatMap((s) => s.reasons.filter((r) => r.ruleSetId === "uh.nursing" && r.kind === "requirement"));
    expect(lines.length).toBeGreaterThan(0);
    for (const r of lines) expect(r.text).toMatch(/^Expected by UH College of Nursing \(.*rules for your class aren't published yet\): /);
  });
});

describe("Other choices never go below the math the student has (buildYear alternatives)", () => {
  it("N7: a Tennessee 11th grader from Utah isn't offered Algebra I instead of 12th-grade math", () => {
    const path = real(
      { state: "TN", grade: 11, courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.earth", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.ut_sec2", grade: 10 }, { type: "sci.bio", grade: 10 }, { type: "ela.11", grade: 11 }, { type: "math.ut_sec3", grade: 11 }] },
      ACCOUNTANT,
    );
    for (const s of suggestions(path).filter((x) => x.grade === 12 && x.typeId.startsWith("math."))) {
      expect(s.alternatives.map((a) => a.typeId)).not.toContain("math.alg1");
      expect(s.alternatives.map((a) => a.typeId)).not.toContain("math.geom");
    }
  });
});

describe("A senior short of total credits sees the state's verified options (gaps.ts)", () => {
  it("U8: a Utah senior short of 24 credits is offered Utah's online program as well as the counselor", () => {
    const path = real({
      state: "UT",
      grade: 12,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.ut_sec1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.ut_sec2", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_geo", grade: 10, units: 2 },
        { type: "ss.world_hist", grade: 10, units: 2 },
        { type: "ela.11", grade: 11 },
        { type: "sci.earth", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "arts.visual", grade: 11 },
        { type: "health.health", grade: 11, units: 2 },
        { type: "pe.fitness", grade: 11, units: 2 },
        { type: "ela.12", grade: 12 },
      ],
    });
    const total = path.gaps.find((g) => g.id === "gap:ut.grad/total")!;
    expect(total.options.map((o) => o.kind)).toEqual(["state_online", "ask_counselor"]);
    expect(total.options[0].text).toMatch(/Statewide Online Education Program/);
  });
});
