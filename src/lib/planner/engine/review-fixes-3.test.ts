import { describe, expect, it } from "vitest";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType } from "../course-types";
import type { CatalogCourse, CatalogView, CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import type { Req } from "../rules";
import { earlyWithoutCredit } from "./audit";
import { sameContent } from "./fill";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions, typesIn } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";
import { item } from "./testing/items";
import { randomInput } from "./testing/random";

// Regression tests for the counselor's third review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (U3, T4, X5, X7 ...).

const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const TXST: CollegeTarget = { unitId: 228459, name: "Texas State", state: "TX", public: true, admissionRate: 0.8, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const UTC: CollegeTarget = { unitId: 221740, name: "UT Chattanooga", state: "TN", public: true, admissionRate: 0.8, openAdmission: null };
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
const mathIn = (path: PlannedPath, grade: number, planId: "A" | "B" = "A") => typesIn(path, grade, planId).filter((t) => getCourseType(t as CourseTypeId).subject === "math");

const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const CIVIL: Goal[] = [{ familyId: "engineering", because: "Civil Engineers" }];
const ACCOUNTANT: Goal[] = [{ familyId: "business", because: "Accountants and Auditors" }];
const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const GRAPHIC: Goal[] = [{ familyId: "visual_arts", because: "Graphic Designers" }];
const WELDER: Goal[] = [{ familyId: "manufacturing", because: "Welders, Cutters, Solderers, and Brazers" }];

// Utah -------------------------------------------------------------------------------------------

const U3: Scenario = {
  state: "UT",
  grade: 9,
  courses: [
    { type: "math.ms", grade: 8, letter: "B+", hsCredit: false },
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "pe.fitness", grade: 9 },
    { type: "cs.intro", grade: 9 },
    { type: "arts.ensemble", grade: 9 },
  ],
};

const T4: Scenario = {
  state: "UT",
  grade: 9,
  courses: [
    { type: "math.ms", grade: 8, letter: "A", hsCredit: false },
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9, units: 2 },
    { type: "pe.fitness", grade: 9, units: 2 },
    { type: "cte.engineering.1", grade: 9 },
    { type: "arts.visual", grade: 9 },
  ],
};

const T23: Scenario = {
  state: "UT",
  grade: 10,
  colleges: [UOFU, USU],
  limits: { accelerateMath: true },
  courses: [
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9, letter: "B" },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9, units: 2 },
    { type: "pe.fitness", grade: 9, units: 2 },
    { type: "health.health", grade: 9, units: 2 },
    { type: "cs.intro", grade: 9, units: 2 },
    { type: "ela.10", grade: 10 },
    { type: "math.ut_sec2", grade: 10 },
    { type: "sci.bio", grade: 10 },
    { type: "ss.world_hist", grade: 10, units: 2 },
    { type: "cte.engineering.1", grade: 10 },
  ],
};

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

const U10: Scenario = {
  state: "UT",
  grade: 10,
  courses: [
    { type: "ela.9", grade: 9, letter: "B" },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9, letter: "B" },
    { type: "ss.world_geo", grade: 9, letter: "B" },
    { type: "pe.athletics", grade: 9 },
    { type: "lang.es.1", grade: 9, letter: "B" },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "lang.es.2", grade: 10 },
  ],
};

/** A Utah senior who finished Secondary Math III in 11th and has no math in 12th. */
const UT_SENIOR: CourseSpec[] = [
  { type: "ela.9", grade: 9 },
  { type: "math.ut_sec1", grade: 9, letter: "B" },
  { type: "sci.earth", grade: 9 },
  { type: "ss.world_geo", grade: 9, units: 2 },
  { type: "pe.fitness", grade: 9, units: 2 },
  { type: "health.health", grade: 9, units: 2 },
  { type: "cs.intro", grade: 9, units: 2 },
  { type: "arts.visual", grade: 9 },
  { type: "ela.10", grade: 10 },
  { type: "math.ut_sec2", grade: 10, letter: "B" },
  { type: "sci.bio", grade: 10 },
  { type: "ss.world_hist", grade: 10, units: 2 },
  { type: "arts.visual", grade: 10 },
  { type: "lang.es.1", grade: 10 },
  { type: "cte.engineering.1", grade: 10 },
  { type: "ela.11", grade: 11 },
  { type: "math.ut_sec3", grade: 11, letter: "B" },
  { type: "sci.chem", grade: 11 },
  { type: "ss.us_hist", grade: 11 },
  { type: "ss.pfl", grade: 11, units: 2 },
  { type: "pe.skills", grade: 11, units: 2 },
  { type: "lang.es.2", grade: 11 },
  { type: "ss.psych", grade: 11, units: 2 },
  { type: "pe.lifetime", grade: 11, units: 2 },
  { type: "ela.12", grade: 12 },
  { type: "ss.us_gov", grade: 12, units: 2 },
  { type: "sci.phys", grade: 12 },
];

describe("Utah: a goal through precalculus gets a precalculus-level class in 12th, not College Prep Math (fill.ts placeLadder, seniorMathOrder)", () => {
  it("U3, T4: a 9th grader with a calculus goal and Utah State as the default gets AP Precalculus in 12th", () => {
    for (const [s, goals] of [
      [U3, SOFTWARE],
      [T4, ENGINEER],
    ] as const) {
      const path = real(s, goals);
      expect(mathIn(path, 12)).toEqual(["math.precalc"]);
      expect(allSuggestions(path).map((x) => x.typeId)).not.toContain("math.college_prep");
      // The lower target the calculus gap offers is on the plan.
      expect(gapText(path)).toMatch(/Aim for the minimum that keeps the path open: Precalculus/);
      const sec3 = suggestions(path).find((x) => x.typeId === "math.ut_sec3")!;
      expect(reasonsOf(sec3)).toMatch(/Secondary Mathematics III in 11th keeps precalculus by 12th open\./);
    }
  });

  it("T23: an engineering 10th grader with the U of U and Utah State gets AP Precalculus in 12th", () => {
    const path = real(T23, ENGINEER);
    for (const p of path.plans) expect(mathIn(path, 12, p.id), p.label).toContain("math.precalc");
    expect(allSuggestions(path).map((x) => x.typeId)).not.toContain("math.college_prep");
  });

  it("U5: a nursing student's Secondary Math III doesn't promise precalculus when 12th has Statistics", () => {
    const path = real(U5, NURSE);
    expect(mathIn(path, 12)).toEqual(["math.stats"]);
    const sec3 = suggestions(path).find((x) => x.typeId === "math.ut_sec3")!;
    expect(reasonsOf(sec3)).not.toMatch(/keeps precalculus/);
    expect(reasonsOf(sec3)).toMatch(/Secondary Mathematics III in 11th reaches the math your goals ask for\./);
    expect(path.deadlines.map((d) => d.text).join(" ")).not.toMatch(/keeps precalculus/);
  });

  it("a senior with an engineering goal who hasn't shown college-ready math gets precalculus, one without a goal College Prep Math", () => {
    const withGoal = real({ state: "UT", grade: 12, colleges: [USU], choices: { utMathCompetencyMet: false }, courses: UT_SENIOR }, ENGINEER);
    expect(mathIn(withGoal, 12)).toEqual(["math.precalc"]);
    const undecided = real({ state: "UT", grade: 12, path: "undecided", colleges: [USU], choices: { utMathCompetencyMet: false }, courses: UT_SENIOR });
    expect(mathIn(undecided, 12)).toEqual(["math.college_prep"]);
  });
});

describe("Texas List A counts only Accounting II and Robotics II as a 3rd math credit (19 TAC §74.12(b)(2)(A))", () => {
  const leaves = (reqs: readonly Req[]): Req[] => reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? leaves(r.of) : r.kind === "option" ? leaves([r.on, r.off]) : [r]));
  const types = (state: "TX" | "UT", ruleSetId: string, reqId: string) =>
    plannerContentFor(state)
      .rules.flatMap((f) => f.ruleSets)
      .find((r) => r.id === ruleSetId)!
      .variants.flatMap((v) => leaves(v.requirements))
      .filter((l) => l.id === reqId)
      .flatMap((l) => (l.kind === "credits" ? l.select.flatMap((s) => s.types ?? []) : []));

  it("Texas's 3rd math takes the level II classes only; Utah's applied lists keep both levels", () => {
    const tx = types("TX", "tx.fhsp.grad", "math.third");
    expect(tx).toEqual(expect.arrayContaining(["cte.accounting2", "cte.robotics2"]));
    expect(tx).not.toContain("cte.accounting");
    expect(tx).not.toContain("cte.robotics");
    expect(types("UT", "ut.grad", "math.third.applied")).toEqual(expect.arrayContaining(["cte.accounting", "cte.accounting2"]));
    expect(types("UT", "ut.grad", "sci.more")).toEqual(expect.arrayContaining(["cte.robotics", "cte.robotics2"]));
    expect(guessCourseTypeId("Accounting II", "career_technical")).toBe("cte.accounting2");
    expect(guessCourseTypeId("Accounting I", "career_technical")).toBe("cte.accounting");
    expect(guessCourseTypeId("Robotics 2", "career_technical")).toBe("cte.robotics2");
  });

  it("X5: a 10th grader's Accounting I isn't the 3rd math credit; Algebra II is, and Precalculus is the required 4th", () => {
    const path = real(
      {
        state: "TX",
        grade: 10,
        colleges: [TAMU],
        choices: { txEndorsements: ["business_industry"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "B+" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "cte.business.1", grade: 9 },
          { type: "pe.athletics", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "cte.accounting", grade: 10 },
        ],
      },
      ACCOUNTANT,
    );
    const third = requirement(path, "tx.fhsp.grad", "math.third");
    expect(third.status).toBe("planned");
    expect(third.counted.every((c) => c.ref.kind === "suggestion")).toBe(true);
    const alg2 = suggestions(path).find((s) => s.typeId === "math.alg2")!;
    expect(reasonsOf(alg2)).toMatch(/Required by Texas: A 3rd math credit/);
    const precalc = suggestions(path).find((s) => s.typeId === "math.precalc")!;
    expect(reasonsOf(precalc)).toMatch(/Required by the Business and Industry endorsement: A 4th math credit/);
  });
});

describe("An endorsement's 26 credits count for the DLA, with a gap a senior can act on (plan.ts audits, gaps.ts addedCreditTotal)", () => {
  const X7: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9, letter: "C" },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "pe.athletics", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10, letter: "C" },
    { type: "sci.chem", grade: 10 },
    { type: "lang.es.2", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.applied.models", grade: 11, letter: "B" },
    { type: "sci.env", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "cte.business.1", grade: 11 },
    { type: "ela.12", grade: 12 },
    { type: "sci.anat", grade: 12 },
  ];

  it("X7: a senior who can't reach 26 credits isn't told the DLA is planned, and gets a \"Needs a plan now\" gap with options", () => {
    const path = real({ state: "TX", grade: 12, choices: { txEndorsements: ["multidisciplinary"] }, courses: X7 });
    const dla = ruleSet(path, "tx.dla");
    expect(dla.status).not.toBe("planned");
    const check = dla.checks.find((c) => c.checkId === "dla.endorsement")!;
    expect(check.status).toBe("room_to_add");
    expect(check.text).not.toMatch(/on your plan too/);
    const gap = path.gaps.find((g) => g.id === "gap:tx.endorse.multidisciplinary/e.electives")!;
    // The year in progress counts only for its spring term (round 5): one open period is half a credit.
    expect(gap.text).toMatch(/^Needs a plan now: Your plan has room for about 0\.5 more credits, and the Multidisciplinary Studies endorsement needs at least 26 credits in all \(4\.5 more\)\.$/);
    expect(gap.options.map((o) => o.kind)).toEqual(["credit_by_exam", "ask_counselor"]);
    expect(gap.reasons[0].citations).toContain("tx-74-13-c");
  });

  it("T15: a senior half a credit short of 26 gets the same gap", () => {
    const path = real({
      state: "TX",
      grade: 12,
      colleges: [TXST],
      choices: { txEndorsements: ["multidisciplinary"] },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "pe.athletics", grade: 9, units: 4 },
        { type: "arts.visual", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "cte.business.1", grade: 10 },
        { type: "ss.psych", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.stats", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "cte.business.2", grade: 11 },
        { type: "sci.env", grade: 11 },
        { type: "ela.12", grade: 12 },
        { type: "ss.us_gov", grade: 12, units: 2 },
        { type: "ss.econ", grade: 12, units: 2 },
      ],
    });
    expect(ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.endorsement")!.status).toBe("room_to_add");
    // Three open periods this year, 3.5 short: half a credit out of reach even with all of them,
    // and 1.5 credits of room once the year counts only for its spring term (round 5).
    const gap = path.gaps.find((g) => g.id === "gap:tx.endorse.multidisciplinary/e.electives")!;
    expect(gap.text).toBe("Needs a plan now: Your plan has room for about 1.5 more credits, and the Multidisciplinary Studies endorsement needs at least 26 credits in all (3.5 more).");
  });

  it("a 9th grader with years of room keeps the DLA's endorsement check and no credit gap", () => {
    const path = real({ state: "TX", grade: 9, colleges: [UT_AUSTIN], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] }, SOFTWARE);
    for (const p of path.plans) {
      expect(p.audit.find((a) => a.ruleSetId === "tx.dla")!.checks.find((c) => c.checkId === "dla.endorsement")!.status, p.label).toBe("ok");
      expect(p.gaps.filter((g) => g.id.endsWith("/e.electives")), p.label).toEqual([]);
    }
  });
});

describe("AP Computer Science A is suggested without a first programming class (fill.ts cheaperLevelExists, retry)", () => {
  it("R1, N8, U3: a computer science goal gets its second programming class, after the first when it's the regular level", () => {
    const cases: [Scenario, Goal[]][] = [
      [{ state: "TX", grade: 9, colleges: [UT_AUSTIN], courses: [{ type: "math.ms", grade: 8, letter: "B", hsCredit: false }, { type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "pe.athletics", grade: 9 }] }, SOFTWARE],
      [{ state: "TN", grade: 9, colleges: [UTK], limits: { accelerateMath: true }, courses: [{ type: "math.alg1", grade: 8, letter: "B", hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "health.wellness", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "cs.intro", grade: 9 }] }, SOFTWARE],
      [U3, SOFTWARE],
    ];
    for (const [s, goals] of cases) {
      const path = real(s, goals);
      for (const p of path.plans) {
        const all = suggestions(path, p.id);
        const second = all.find((x) => x.typeId === "cs.prog2");
        expect(second, `${s.state} ${p.label}`).toBeDefined();
        if (second!.level !== "ap" && second!.level !== "ib") {
          const first = all.find((x) => x.typeId === "cs.principles" || x.typeId === "cs.prog1");
          expect(first && first.grade < second!.grade, `${s.state} ${p.label}`).toBe(true);
        }
      }
    }
  });

  it("with no AP version on the list, Computer Science II comes after the CS Principles the plan adds first", () => {
    const list = listWithout("TX", (c) => c.typeId === "cs.prog2" && c.level !== "regular");
    const path = real({ state: "TX", grade: 9, colleges: [UT_AUSTIN], catalogs: { 9: list, 10: list, 11: list, 12: list }, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }] }, SOFTWARE);
    for (const p of path.plans) {
      const all = suggestions(path, p.id);
      const second = all.find((x) => x.typeId === "cs.prog2")!;
      expect(second, p.label).toBeDefined();
      expect(all.some((x) => (x.typeId === "cs.principles" || x.typeId === "cs.prog1") && x.grade < second.grade), p.label).toBe(true);
    }
  });

  it("a math credit from computer science is that year's math class: no AP CS A next to Algebra II without the opt-in", () => {
    const path = real({ state: "TX", grade: 11, limits: { classesPerYear: 8 }, courses: [{ type: "ela.9", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.alg1", grade: 10, letter: "B+" }, { type: "ela.11", grade: 11 }, { type: "math.geom", grade: 11 }] });
    const twelfth = suggestions(path).filter((s) => s.grade === 12);
    expect(twelfth.map((s) => s.typeId)).toContain("math.alg2");
    expect(twelfth.map((s) => s.typeId)).not.toContain("cs.prog2");
  });
});

/** A state's generic list as a school list, without some rows. */
function listWithout(state: "TX" | "UT" | "TN", drop: (c: { typeId: CourseTypeId; level: string }) => boolean): CatalogView {
  const courses: CatalogCourse[] = [];
  for (const c of plannerContentFor(state).genericCatalog.courses) {
    const t = getCourseType(c.typeId);
    for (const level of c.levels) {
      if (drop({ typeId: c.typeId, level })) continue;
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
  return { id: "school", source: "school_published", state, schoolYear: 2026, lastYears: false, classesPerYear: 7, schedule: "traditional", localTotalUnits: null, confirmedSubjects: "all", courses };
}

describe("Classes that teach the same content aren't stacked (course-types overlaps, fill.ts alreadyHas)", () => {
  it("X14: a Texas 11th grader gets Economics once, with the required line, and no Personal Financial Literacy and Economics next to it", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        colleges: [UT_AUSTIN],
        limits: { accelerateMath: true },
        choices: { txEndorsements: ["stem"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "B" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "pe.athletics", grade: 9 },
          { type: "cte.engineering.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10, letter: "C" },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "arts.visual", grade: 10 },
          { type: "cte.engineering.2", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "cte.engineering.3", grade: 11 },
        ],
      },
      ENGINEER,
    );
    const ss = typesIn(path, 12).filter((t) => t.startsWith("ss."));
    expect(ss.filter((t) => t === "ss.econ" || t === "ss.pfl_econ")).toHaveLength(1);
    if (ss.includes("ss.pfl_econ")) expect(ss).not.toContain("ss.pfl");
    const econ = suggestions(path).find((s) => s.typeId === "ss.econ" || s.typeId === "ss.pfl_econ")!;
    expect(reasonsOf(econ)).toMatch(/Required by Texas: Economics \(or personal financial literacy and economics\)/);
  });

  it("T25: a business student's PFL credit is Personal Financial Literacy, leaving room for the goal's Economics", () => {
    const path = real(
      {
        state: "TX",
        grade: 9,
        colleges: [TAMU],
        choices: { txEndorsements: ["business_industry"] },
        courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "cte.business.1", grade: 9 }],
      },
      ACCOUNTANT,
    );
    const ss = allSuggestions(path).map((s) => s.typeId);
    expect(ss).toContain("ss.pfl");
    expect(ss).toContain("ss.econ");
    expect(ss).not.toContain("ss.pfl_econ");
  });

  it("property: no plan suggests a class whose content the student already has or another suggestion covers (random students, real content)", () => {
    const bad: string[] = [];
    for (let i = 0; i < 200; i++) {
      const seed = 9100 + i * 7919;
      const input = randomInput(seed);
      if (!input.state) continue;
      input.content = plannerContentFor(input.state);
      const result = plan(input);
      if (result.mode === "no_state" || result.stage === "middle_school") continue;
      for (const p of result.plans) {
        const own = input.courses.filter((c) => !(c.status === "completed" && ["F", "W", "I"].includes(String(c.finalGrade)))).map((c) => c.typeId);
        const mine = suggestions(result, p.id);
        for (const s of mine) {
          const others = [...own, ...mine.filter((x) => x.key !== s.key).map((x) => x.typeId)];
          if (others.some((t) => t !== s.typeId && sameContent(t, s.typeId))) bad.push(`seed ${seed} ${p.id}: ${s.typeId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("Tennessee's AP or IB focus counts an AP class that stands in for a requirement too (Policy 3.103 I(4)(b))", () => {
  it("T7: the gaps agree with the audit: no U.S. or World History gap for a student with AP World History and AP U.S. History planned", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        colleges: [UTC],
        choices: { tnElectiveFocus: "ap_ib" },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "A" },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10, level: "honors" },
          { type: "math.geom", grade: 10, level: "honors" },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "ss.world_hist", grade: 10, level: "ap", id: "apwh" },
          { type: "cs.principles", grade: 10, level: "ap" },
        ],
      },
      ACCOUNTANT,
    );
    for (const id of ["tn.grad/ss.us_hist", "tn.grad/ss.world_hist", "tn.grad/ss.rest"]) expect(path.gaps.map((g) => g.demandId)).not.toContain(id);
    expect(requirement(path, "tn.grad", "ss.world_hist").status).toBe("done");
    const focus = requirement(path, "tn.focus.ap-ib", "focus");
    expect(focus.status).toBe("planned");
    expect(focus.counted.some((c) => c.ref.kind === "course" && c.ref.courseId === "apwh")).toBe(true);
    expect(requirement(path, "tn.grad", "ss.world_hist").counted.some((c) => c.ref.kind === "course" && c.ref.courseId === "apwh")).toBe(true);
  });

  it("the content says so, with Policy 3.103 I(4)(b) cited on the focus", () => {
    const focus = plannerContentFor("TN")
      .rules.flatMap((f) => f.ruleSets)
      .filter((r) => r.id === "tn.focus.ap-ib" || r.id === "tn.focus.cambridge");
    expect(focus).toHaveLength(2);
    for (const rs of focus) {
      for (const v of rs.variants) {
        // The focus is sized by the family's waivers (round 4): every size counts the same way.
        const walk = (reqs: readonly Req[]): Req[] => reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? walk(r.of) : r.kind === "option" ? walk([r.on, r.off]) : [r]));
        const leaves = walk(v.requirements).filter((r) => r.id === "focus" || r.id.startsWith("focus."));
        expect(leaves.map((l) => l.id)).toContain("focus");
        for (const leaf of leaves) {
          expect(leaf.kind === "credits" && leaf.shareable).toBe(true);
          expect(leaf.kind === "credits" && leaf.cite).toContain("tn-3103-i-4b");
        }
      }
      expect(rs.plainSummary).not.toMatch(/on top of your other requirements/);
    }
  });
});

describe("Guessed class types count as the plan counts them for a program that counts only on a condition (audit.ts counts_unless)", () => {
  const S1 = (assumed: boolean): Scenario => ({
    state: "TX",
    grade: 10,
    colleges: [UT_AUSTIN, TAMU],
    courses: (
      [
        { type: "math.alg1", grade: 9, letter: "B+" },
        { type: "ss.world_geo", grade: 9 },
        { type: "ela.9", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "pe.athletics", grade: 9 },
        { type: "math.geom", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "ela.10", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "cs.principles", grade: 10, level: "ap" },
      ] as CourseSpec[]
    ).map((c) => ({ ...c, assumed })),
  });

  it("S1 (T11a/T11b): typed class names give the same two endorsement plans as confirmed types", () => {
    const confirmed = real(S1(false), SOFTWARE);
    const guessed = real(S1(true), SOFTWARE);
    expect(guessed.plans.map((p) => p.label)).toEqual(confirmed.plans.map((p) => p.label));
    expect(guessed.plans.map((p) => p.label).join(" ")).not.toMatch(/Business and Industry/);
  });
});

describe("A class taken before 9th grade without high school credit is a question for the counselor, asked once (gaps.ts, fill.ts blockReason)", () => {
  it("T12, T13: Algebra I in 8th with no credit marked, Geometry now", () => {
    const tn = real({ state: "TN", grade: 9, colleges: [UTK], courses: [{ type: "math.alg1", grade: 8, letter: "A", hsCredit: false }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "health.wellness", grade: 9 }, { type: "lang.es.1", grade: 9 }] }, ENGINEER);
    const tx = real({ state: "TX", grade: 9, colleges: [TAMU], choices: { txEndorsements: ["stem"] }, courses: [{ type: "math.alg1", grade: 8, letter: "A", hsCredit: false }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }] }, CIVIL);
    for (const path of [tn, tx]) {
      const gaps = path.gaps.filter((g) => /Algebra I\b/.test(g.text));
      expect(gaps).toHaveLength(1);
      expect(gaps[0].text).toBe("Your 8th-grade Algebra I isn't marked for high school credit. Ask your counselor whether it counts.");
      expect(gaps[0].options.map((o) => o.kind)).toEqual(["ask_counselor"]);
      expect(gapText(path)).not.toMatch(/Room to add: Algebra I/);
      expect(allSuggestions(path).map((s) => s.typeId)).not.toContain("math.alg1");
    }
    expect(requirement(tx, "tx.fhsp.grad", "math.alg1").status).toBe("ask_counselor");
  });

  it("a middle school class (8th-grade English) isn't one of them, and neither is one with credit or an F", () => {
    const english = [{ subjects: ["english" as const] }];
    expect(earlyWithoutCredit([item("ela.ms", { grade: 8, hsCredit: false })], english)).toBeNull();
    expect(earlyWithoutCredit([item("math.alg1", { grade: 8, hsCredit: true })], [{ types: ["math.alg1" as const] }])).toBeNull();
    expect(earlyWithoutCredit([item("math.alg1", { grade: 8, hsCredit: false, letter: "F" })], [{ types: ["math.alg1" as const] }])).toBeNull();
    expect(earlyWithoutCredit([item("math.alg1", { grade: 8, hsCredit: false })], [{ types: ["math.alg1" as const] }])?.typeId).toBe("math.alg1");
    const path = real({ state: "TX", grade: 9, colleges: [TAMU], courses: [{ type: "ela.ms", grade: 8, hsCredit: false }, { type: "math.alg1", grade: 8, letter: "A", hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }] }, CIVIL);
    expect(path.gaps.filter((g) => /isn't marked for high school credit/.test(g.text))).toEqual([]);
  });
});

describe("Utah's World Geography under its course names (course-type-guess.ts)", () => {
  it("S2: a typed \"Geography for Life\" is World Geography, so none is added", () => {
    expect(guessCourseTypeId("Geography for Life", "social_studies", "UT")).toBe("ss.world_geo");
    const path = real(
      {
        state: "UT",
        grade: 11,
        colleges: [UOFU],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9, letter: "B" },
          { type: "sci.earth", grade: 9 },
          { type: guessCourseTypeId("Geography for Life", "social_studies", "UT"), grade: 9, units: 2, assumed: true },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cs.intro", grade: 9, units: 2 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10, letter: "B" },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "lang.es.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.es.2", grade: 11 },
        ],
      },
      NURSE,
    );
    expect(allSuggestions(path).map((s) => s.typeId)).not.toContain("ss.world_geo");
    expect(requirement(path, "ut.grad", "ss.world_geo").modifiers).toContain("guessed_type");
  });
});

describe("The DLA's \"on schedule\" line lists only what's missing (audit.ts on_schedule_by)", () => {
  it("X6: with Algebra II and a 4th science planned for 12th, only the 4th math credit is \"room to add\"", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        choices: { txEndorsements: ["public_services"] },
        courses: [
          { type: "ela.9", grade: 9, letter: "C" },
          { type: "math.other", grade: 9, letter: "C" },
          { type: "sci.bio", grade: 9, letter: "C" },
          { type: "ss.world_geo", grade: 9, letter: "B" },
          { type: "pe.athletics", grade: 9 },
          { type: "ela.10", grade: 10, letter: "C" },
          { type: "math.alg1", grade: 10, letter: "C" },
          { type: "sci.ipc", grade: 10, letter: "C" },
          { type: "lang.es.1", grade: 10, letter: "C" },
          { type: "arts.visual", grade: 10 },
          { type: "cte.health.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.geom", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.es.2", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "cte.health.2", grade: 11 },
        ],
      },
      NURSE,
    );
    expect(requirement(path, "tx.dla", "dla.alg2").missing).toBe(0);
    const check = ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")!;
    expect(check.text).toBe("Room to add a 4th math credit to your plan by the end of 11th grade (it can come as late as 12th).");
  });
});

describe("World language in consecutive years (fill.ts placeLanguageLevels)", () => {
  it("U5: Spanish II follows Spanish I in 11th, with a class that fits 12th just as well moved there", () => {
    const path = real(U5, NURSE);
    expect(typesIn(path, 11)).toContain("lang.es.2");
    for (const s of suggestions(path)) expect(reasonsOf(s)).not.toMatch(/year without Spanish/);
  });
});

describe("A route other rule sets also ask for, and one that fits the goal (fill.ts prefer, allocate.ts pickAlternative fit)", () => {
  it("U10: Utah's one more science credit is Physics, which Utah State recommends too, not Earth science and a Physics gap", () => {
    const path = real(U10, ACCOUNTANT);
    const sciences = suggestions(path).filter((s) => getCourseType(s.typeId).subject === "science").map((s) => s.typeId);
    expect(sciences).toContain("sci.phys");
    expect(sciences).not.toContain("sci.earth");
    expect(path.gaps.map((g) => g.demandId)).not.toContain("usu.recommended/science.phys");
  });

  it("T8: a graphic design goal with Arts and Humanities takes art after 9th grade, not four levels of Spanish", () => {
    const path = real(
      {
        state: "TX",
        grade: 9,
        choices: { txEndorsements: ["arts_humanities"], txAimDla: false },
        courses: [{ type: "math.ms", grade: 8, letter: "B", hsCredit: false }, { type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "arts.visual", grade: 9 }, { type: "lang.es.1", grade: 9 }],
      },
      GRAPHIC,
    );
    const art = suggestions(path).filter((s) => getCourseType(s.typeId).subject === "arts");
    expect(art.length).toBeGreaterThanOrEqual(2);
    for (const s of suggestions(path)) expect(reasonsOf(s)).not.toMatch(/Four levels of one language/);
    expect(allSuggestions(path).map((s) => s.typeId)).not.toContain("lang.es.4");
  });
});

describe("A middle schooler's sketch agrees with the \"by when\" strip (fill.ts placeLadder)", () => {
  it("T18: a 7th grader told Algebra I in 8th keeps calculus open sees the 9th-grade Algebra I as the path without it", () => {
    const path = real({ state: "TX", grade: 7, courses: [{ type: "math.ms", grade: 7, level: "honors", hsCredit: false }, { type: "ela.ms", grade: 7, hsCredit: false }] }, CIVIL);
    expect(path.deadlines.map((d) => d.text)).toContain("Algebra I in 8th keeps calculus in 12th open.");
    const sketch = path.middleSchool!.ninthGradeSketch!;
    const alg1 = sketch.slots.find((s) => s.kind === "suggested" && s.typeId === "math.alg1") as Suggested;
    expect(reasonsOf(alg1)).toMatch(/If you don't take Algebra I in 8th: Algebra I in 9th keeps/);
  });

  it("a 7th grader with no deadline in 8th gets the plain wording", () => {
    const path = real({ state: "TX", grade: 7, path: "undecided", courses: [{ type: "math.ms", grade: 7, hsCredit: false }, { type: "ela.ms", grade: 7, hsCredit: false }] });
    expect(path.deadlines.map((d) => d.text).join(" ")).not.toMatch(/in 8th keeps/);
    expect(JSON.stringify(path.middleSchool)).not.toMatch(/If you don't take/);
  });
});

describe("Required fine arts and career classes start where the student is (fill.ts pick)", () => {
  it("N3, T1, T12: a Tennessee student with no music background isn't given Music theory for the fine arts credit", () => {
    const cases: [Scenario, Goal[]][] = [
      [{ state: "TN", grade: 9, colleges: [UTK], courses: [{ type: "math.ms", grade: 8, letter: "B", hsCredit: false }, { type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "health.wellness", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "cte.business.1", grade: 9 }] }, ACCOUNTANT],
      [{ state: "TN", grade: 10, colleges: [UTK], limits: { accelerateMath: true }, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "B" }, { type: "sci.bio", grade: 9 }, { type: "health.wellness", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "ss.world_hist", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }, { type: "sci.chem", grade: 10 }, { type: "lang.es.2", grade: 10 }, { type: "cs.intro", grade: 10 }] }, ENGINEER],
      [{ state: "TN", grade: 12, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "D" }, { type: "sci.bio", grade: 9 }, { type: "health.wellness", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "ss.world_hist", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10, letter: "C" }, { type: "sci.chem", grade: 10, letter: "D" }, { type: "lang.es.2", grade: 10 }, { type: "pe.general", grade: 10 }, { type: "cte.manufacturing.1", grade: 10 }, { type: "ela.11", grade: 11 }, { type: "math.alg2", grade: 11, letter: "D" }, { type: "ss.us_hist", grade: 11 }, { type: "cte.manufacturing.2", grade: 11 }, { type: "sci.earth", grade: 11 }, { type: "ela.12", grade: 12 }, { type: "cte.manufacturing.3", grade: 12 }, { type: "ss.us_gov", grade: 12 }, { type: "ss.econ", grade: 12 }], path: "training" }, WELDER],
    ];
    for (const [s, goals] of cases) {
      const path = real(s, goals);
      const arts = allSuggestions(path).filter((x) => getCourseType(x.typeId).subject === "arts");
      expect(arts.length, `${s.state} ${s.grade}`).toBeGreaterThan(0);
      expect(arts.map((x) => x.typeId)).not.toContain("arts.music_theory");
    }
    expect(getCourseType("arts.music_theory").usuallyAfter).toEqual(expect.arrayContaining(["arts.ensemble"]));
  });

  it("S2, U10: Utah's career and technical credit starts the goal's pathway, not Biotechnology", () => {
    const nurse = real(
      {
        state: "UT",
        grade: 11,
        colleges: [UOFU],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9, letter: "B" },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cs.intro", grade: 9, units: 2 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10, letter: "B" },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "lang.es.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.es.2", grade: 11 },
        ],
      },
      NURSE,
    );
    const cte = (path: PlannedPath) => suggestions(path).filter((s) => reasonsOf(s).includes("Required by Utah: Career and technical education"));
    expect(cte(nurse).map((s) => getCourseType(s.typeId).ladder?.id)).toEqual(["cte.health"]);
    const accountant = real(U10, ACCOUNTANT);
    expect(cte(accountant).map((s) => getCourseType(s.typeId).ladder?.id)).toEqual(["cte.business"]);
  });
});

describe("Other choices respect the family's opt-out (plan.ts buildYear)", () => {
  it("T5: Secondary Math III isn't offered in place of the applied third math after a written opt-out", () => {
    const path = real(
      {
        state: "UT",
        grade: 10,
        path: "training",
        choices: { utMath3OptOut: true },
        courses: [
          { type: "ela.9", grade: 9, letter: "C" },
          { type: "math.ut_sec1", grade: 9, letter: "C" },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cte.manufacturing.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "cte.manufacturing.2", grade: 10 },
        ],
      },
      WELDER,
    );
    const math = allSuggestions(path).filter((s) => getCourseType(s.typeId).subject === "math");
    expect(math.length).toBeGreaterThan(0);
    for (const s of math) expect(s.alternatives.map((a) => a.typeId)).not.toContain("math.ut_sec3");
  });
});

describe("\"Two that fit your goals\" only when both endorsements come from the goals (plan.ts endorsementSplit)", () => {
  it("X10, R1: a computer science goal's STEM next to the Multidisciplinary fallback names only Plan A as fitting", () => {
    for (const courses of [
      [{ type: "math.alg1", grade: 8, letter: "B+", hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }, { type: "cs.prog1", grade: 9 }],
      [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }],
    ] as CourseSpec[][]) {
      const path = real({ state: "TX", grade: 9, colleges: [UT_AUSTIN], courses }, SOFTWARE);
      expect(path.plans.map((p) => p.label)).toEqual(["Plan A: with the STEM endorsement.", "Plan B: with the Multidisciplinary Studies endorsement."]);
      expect(path.planChoice!.text).not.toMatch(/two that fit your goals/);
      expect(path.planChoice!.text).toMatch(/Plan A's endorsement fits your goals/);
    }
  });
});
