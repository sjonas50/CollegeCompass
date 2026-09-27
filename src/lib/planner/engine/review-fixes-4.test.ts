import { describe, expect, it } from "vitest";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import type { Req } from "../rules";
import { pastIntro } from "./fill";
import { plan } from "./index";
import { itemFromSuggestion } from "./model";
import { planned, requirement, ruleSet, suggestions, typesIn } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's fourth review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (W14, V17, V15 ...).

const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
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
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => `${g.text} ${g.options.map((o) => o.text).join(" ")}`).join("\n");
const mathIn = (path: PlannedPath, grade: number) => typesIn(path, grade).filter((t) => getCourseType(t as CourseTypeId).subject === "math");
/** The type of each counted class (the student's rows by their scenario id, suggestions by key). */
const countedTypes = (path: PlannedPath, s: Scenario, ruleSetId: string, reqId: string) =>
  requirement(path, ruleSetId, reqId).counted.map((c) =>
    c.ref.kind === "course" ? (s.courses ?? [])[Number(c.ref.courseId.slice(1)) - 1].type : suggestions(path).find((x) => x.key === (c.ref as { key: string }).key)?.typeId,
  );
const leavesOf = (reqs: readonly Req[]): Req[] => reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? leavesOf(r.of) : r.kind === "option" ? leavesOf([r.on, r.off]) : [r]));
const variantsOf = (state: "UT" | "TN" | "TX", ruleSetId: string) =>
  plannerContentFor(state)
    .rules.flatMap((f) => f.ruleSets)
    .find((r) => r.id === ruleSetId)!.variants;

const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const ACCOUNTANT: Goal[] = [{ familyId: "business", because: "Accountants and Auditors" }];
const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const TEACHER: Goal[] = [{ familyId: "education", because: "Elementary School Teachers, Except Special Education" }];
const POLICE: Goal[] = [{ familyId: "public_safety", because: "Police and Sheriff's Patrol Officers" }];
const CHEF: Goal[] = [{ familyId: "culinary_hospitality", because: "Chefs and Head Cooks" }];
const ELECTRICIAN: Goal[] = [{ familyId: "construction_trades", because: "Electricians" }];
const PSYCHOLOGIST: Goal[] = [{ familyId: "psychology", because: "Clinical and Counseling Psychologists" }];

// 1. Utah social studies -------------------------------------------------------------------------

describe("Utah: a full-credit social studies class covers a half-credit requirement and the elective (ut/graduation.json allowSplit)", () => {
  const W14: Scenario = {
    state: "UT",
    grade: 12,
    colleges: [USU],
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_geo", grade: 9, units: 4 },
      { type: "pe.fitness", grade: 9, units: 2 },
      { type: "health.health", grade: 9, units: 2 },
      { type: "cs.intro", grade: 9, units: 2 },
      { type: "arts.visual", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.ut_sec2", grade: 10 },
      { type: "sci.bio", grade: 10 },
      { type: "ss.world_hist", grade: 10, units: 2 },
      { type: "arts.visual", grade: 10 },
      { type: "lang.es.1", grade: 10 },
      { type: "cte.engineering.1", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.ut_sec3", grade: 11 },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "ss.pfl", grade: 11, units: 2 },
      { type: "pe.skills", grade: 11, units: 2 },
      { type: "lang.es.2", grade: 11 },
      { type: "pe.lifetime", grade: 11, units: 2 },
      { type: "ela.12", grade: 12 },
      { type: "ss.us_gov", grade: 12, units: 2 },
      { type: "sci.phys", grade: 12 },
      { type: "math.precalc", grade: 12 },
    ],
  };

  it("W14: a senior with exactly 3.0 social studies credits (a full-year World Geography) needs no more", () => {
    const path = real(W14);
    expect(requirement(path, "ut.grad", "ss.elective").status).toBe("done");
    expect(requirement(path, "ut.grad", "ss.world_geo").status).toBe("done");
    expect(typesIn(path, 12)).not.toContain("ss.econ");
    expect(allReasons(path)).not.toMatch(/Social studies elective/);
    expect(gapLines(path)).not.toMatch(/Social studies elective/);
  });

  it("W1: AP Human Geography and AP World History cover the elective; ACGC in 12th isn't followed by an Economics requirement", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 4, level: "ap" },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cs.intro", grade: 9, units: 2 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 4, level: "ap" },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11, level: "ap" },
          { type: "ss.ut_acgc", grade: 12, units: 4 },
        ],
      },
      ENGINEER,
    );
    expect(requirement(path, "ut.grad", "ss.elective").status).toBe("done");
    expect(requirement(path, "ut.grad", "ss.us_gov").status).toBe("planned");
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("ss.econ");
    expect(allReasons(path)).not.toMatch(/Required by Utah: Social studies elective/);
  });

  it("the content allows the split in both variants, citing USBE's own words", () => {
    for (const v of variantsOf("UT", "ut.grad")) {
      const leaves = leavesOf(v.requirements).filter((r) => ["ss.world_geo", "ss.world_hist", "ss.us_gov", "ss.elective"].includes(r.id));
      expect(leaves.length).toBeGreaterThanOrEqual(3);
      for (const leaf of leaves) {
        expect(leaf.kind === "credits" && leaf.allowSplit, `${v.id} ${leaf.id}`).toBe(true);
        expect(leaf.kind === "credits" && leaf.cite).toContain("ut-usbe-2627-ss-half");
      }
    }
  });
});

// 2. Tennessee computer science focus ---------------------------------------------------------------

describe("Tennessee: the computer science credit counts toward a computer science focus too (Policy 2.103 I(4)(b)1)", () => {
  const V17: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "cs.prog1", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "lang.es.2", grade: 10 },
    { type: "cs.prog2", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.phys", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "cs.principles", grade: 11, level: "ap" },
  ];
  const cs = (courses: CourseSpec[], grade: 10 | 11): Scenario => ({ state: "TN", grade, colleges: [UTK], choices: { tnElectiveFocus: "computer_science" }, courses });

  it("V17, W12: Coding I, Coding II and AP CSP meet the focus; no intro class is added in 12th", () => {
    for (const courses of [V17, V17.filter((c) => c.type !== "sci.phys")]) {
      const path = real(cs(courses, 11), SOFTWARE);
      expect(suggestions(path).map((s) => s.typeId)).not.toContain("cs.intro");
      expect(requirement(path, "tn.focus.computer-science", "focus").status).toBe("done");
      expect(requirement(path, "tn.grad", "cs").status).toBe("done");
    }
  });

  it("V17: 12th-grade Precalculus isn't called Tennessee's 4th math when the audit shows the 4th math done", () => {
    const path = real(cs(V17, 11), SOFTWARE);
    expect(requirement(path, "tn.grad", "math.fourth").status).toBe("done");
    const precalc = suggestions(path).find((s) => s.typeId === "math.precalc")!;
    expect(reasonsOf(precalc)).not.toMatch(/Required by Tennessee: A 4th math credit/);
    expect(reasonsOf(precalc)).toMatch(/Strongly encouraged by UT Knoxville/);
  });

  it("W3: a 10th grader with Coding I gets two more computer science classes, never an intro class after them", () => {
    const path = real(cs(V17.filter((c) => c.grade <= 10 && c.type !== "cs.prog2"), 10), SOFTWARE);
    const added = suggestions(path).filter((s) => getCourseType(s.typeId).subject === "computer_science");
    expect(added.map((s) => s.typeId)).not.toContain("cs.intro");
    expect(added).toHaveLength(2);
  });

  it("an introductory class is never suggested after a class it introduces", () => {
    const coding = itemFromSuggestion({ n: 0, key: "k", typeId: "cs.prog1", level: "regular", grade: 10, schoolYear: 2027, term: "full_year", units: 4, cte: false, lectureOnly: false });
    expect(pastIntro([coding], "cs.intro", 12)).toBe(true);
    expect(pastIntro([coding], "cs.intro", 9)).toBe(false);
    expect(pastIntro([coding], "cs.principles", 12)).toBe(false);
  });

  it("the content: the focus is shareable and cites the substitution rules", () => {
    for (const v of variantsOf("TN", "tn.focus.computer-science")) {
      for (const leaf of leavesOf(v.requirements).filter((r) => r.id.startsWith("focus"))) {
        expect(leaf.kind === "credits" && leaf.shareable).toBe(true);
        expect(leaf.kind === "credits" && leaf.cite).toEqual(expect.arrayContaining(["tn-2103-i-4b1", "tn-2103-i-4b1-only", "tn-3103-i-4b"]));
      }
    }
  });
});

// 3. Tennessee: Physics as a 4th math only when nothing plainer works --------------------------------

describe("Tennessee: Physics is the 3rd lab science and the 4th math is what's missing (allocate.ts substitute cost)", () => {
  const V15: Scenario = {
    state: "TN",
    grade: 12,
    colleges: [UTK],
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.general", grade: 10, units: 2 },
      { type: "ss.pfl", grade: 10, units: 2 },
      { type: "ela.11", grade: 11 },
      { type: "math.alg2", grade: 11 },
      { type: "sci.phys", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "ela.12", grade: 12 },
      { type: "ss.us_gov", grade: 12, units: 2 },
      { type: "ss.econ", grade: 12, units: 2 },
    ],
  };

  const cases: [string, Scenario, Goal[]][] = [
    ["V15 (engineering, UTK)", V15, ENGINEER],
    ["W4 (accountant)", V15, ACCOUNTANT],
    ["W4b (undecided, no colleges)", { ...V15, path: "undecided", colleges: [] }, []],
    ["W4c (engineering, CTE focus)", { ...V15, choices: { tnElectiveFocus: "cte" }, courses: [...V15.courses!, { type: "cte.engineering.1", grade: 10 }, { type: "cte.engineering.2", grade: 11 }] }, ENGINEER],
  ];

  it.each(cases)("%s: a senior with Biology, Chemistry and Physics gets a 4th math in 12th, not a 4th science", (_label, s, goals) => {
    const path = real(s, goals);
    expect(countedTypes(path, s, "tn.grad", "sci.third")).toEqual(["sci.phys"]);
    const fourth = requirement(path, "tn.grad", "math.fourth");
    expect(fourth.status).toBe("planned");
    expect(mathIn(path, 12)).toHaveLength(1);
    const math = suggestions(path).find((x) => x.grade === 12 && getCourseType(x.typeId).subject === "math")!;
    expect(math.needsPlanNow).toBe(true);
    expect(reasonsOf(math)).toMatch(/Required by Tennessee: A 4th math credit/);
    expect(allReasons(path)).not.toMatch(/Required by Tennessee: A 3rd lab science/);
    expect(suggestions(path).map((x) => x.typeId)).not.toEqual(expect.arrayContaining(["cs.prog1"]));
    expect(suggestions(path).map((x) => x.typeId)).not.toContain("sci.bio2");
  });

  it("V15: UT Knoxville's 4 math shows the 12th-grade class", () => {
    const path = real(V15, ENGINEER);
    expect(requirement(path, "utk.core16", "math").status).toBe("planned");
  });

  it("the content marks Physics and computer science as substitutions for the 4th math and 3rd lab science", () => {
    for (const v of variantsOf("TN", "tn.grad")) {
      for (const id of ["math.fourth", "sci.third"]) {
        const leaf = leavesOf(v.requirements).find((r) => r.id === id)!;
        const subs = leaf.kind === "credits" ? leaf.select.filter((s) => s.substitute) : [];
        expect(subs.length, `${v.id} ${id}`).toBe(2);
      }
    }
  });
});

// 4. Utah Secondary Math III opt-out --------------------------------------------------------------

describe("Utah: after the Secondary Math III opt-out, Secondary Math II comes by 10th, then the applied class (fill.ts optedOutRank)", () => {
  const UT9: CourseSpec[] = [
    { type: "math.ms", grade: 8, letter: "B", hsCredit: false },
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9, units: 2 },
    { type: "pe.fitness", grade: 9, units: 2 },
    { type: "health.health", grade: 9, units: 2 },
    { type: "cs.intro", grade: 9, units: 2 },
    { type: "arts.visual", grade: 9 },
  ];
  const cases: [string, Scenario, Goal[]][] = [
    ["V33 (chef, training path)", { state: "UT", grade: 9, path: "training", choices: { utMath3OptOut: true }, courses: UT9 }, CHEF],
    ["W8 (nursing, Utah State)", { state: "UT", grade: 9, colleges: [USU], choices: { utMath3OptOut: true }, courses: UT9 }, NURSE],
    ["W9 (undecided)", { state: "UT", grade: 9, path: "undecided", choices: { utMath3OptOut: true }, courses: UT9 }, []],
  ];

  it.each(cases)("%s", (_label, s, goals) => {
    const path = real(s, goals);
    expect(mathIn(path, 10)).toEqual(["math.ut_sec2"]);
    const applied = requirement(path, "ut.grad", "math.third.applied");
    expect(applied.status).toBe("planned");
    const appliedGrades = applied.counted.map((c) => suggestions(path).find((x) => x.key === (c.ref as { key: string }).key)!.grade);
    expect(Math.min(...appliedGrades)).toBeGreaterThan(10);
    const sec2 = suggestions(path).find((x) => x.typeId === "math.ut_sec2")!;
    expect(reasonsOf(sec2)).not.toMatch(/would come in college/);
    // Nothing offers the class the family opted out of in writing.
    expect(gapLines(path)).not.toMatch(/Secondary Mathematics III (online|in summer)/);
    expect(suggestions(path).map((x) => x.typeId)).not.toContain("math.ut_sec3");
  });

  it("W8: Secondary Math II's reason says what comes next", () => {
    const path = real(cases[1][1], NURSE);
    const sec2 = suggestions(path).find((x) => x.typeId === "math.ut_sec2")!;
    expect(reasonsOf(sec2)).toMatch(/Secondary Mathematics II in 10th comes before the applied math class that takes the place of Secondary Mathematics III\./);
  });

  it("the content: Utah's applied statistics and financial math come after Secondary Math II", () => {
    const rows = plannerContentFor("UT").genericCatalog.courses.filter((c) => c.typeId === "math.stats" || c.typeId === "math.applied.finance");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.prereqs?.flat()).toContain("math.ut_sec2");
      expect(r.cite).toContain("ut-usbe-2627-math-applied");
    }
  });
});

// 5. Texas Public Services program ----------------------------------------------------------------

describe("Texas Public Services: the goal's own program, worded as one way to earn it (fill.ts pathway preference)", () => {
  const TX9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "pe.athletics", grade: 9 },
  ];

  it("V20: a future teacher with no endorsement named plans Public Services with Education and Training", () => {
    const path = real({ state: "TX", grade: 9, courses: TX9 }, TEACHER);
    expect(path.plans[0]!.label).toMatch(/Public Services/);
    const cte = suggestions(path).filter((s) => s.typeId.startsWith("cte."));
    expect(cte.map((s) => s.typeId)).toEqual(["cte.education.1", "cte.education.2", "cte.education.3"]);
  });

  it("W11, W13: the goal's pathway (teaching, law) is the program; the reason names it as one way; other programs are Other choices", () => {
    for (const [goals, cluster] of [
      [TEACHER, "education"],
      [POLICE, "law"],
    ] as const) {
      const path = real({ state: "TX", grade: 9, choices: { txEndorsements: ["public_services"] }, courses: TX9 }, goals);
      const cte = suggestions(path).filter((s) => s.typeId.startsWith("cte."));
      expect(cte.map((s) => s.typeId)).toEqual([`cte.${cluster}.1`, `cte.${cluster}.2`, `cte.${cluster}.3`]);
      for (const s of cte) {
        expect(reasonsOf(s)).toMatch(/Required by the Public Services endorsement: A public services career and technical program of study \(one way: [a-z]/);
        expect(reasonsOf(s)).not.toMatch(/Health science program/);
      }
      const first = cte[0].alternatives.map((a) => a.typeId);
      expect(first).toContain("cte.health.1");
      expect(first.every((t) => getCourseType(t).ladder?.rank === 1)).toBe(true);
      // A later level offers no other program's level 1.
      expect(cte[1].alternatives.map((a) => a.typeId)).not.toContain("cte.health.1");
    }
  });
});

// 6. Failed English retakes --------------------------------------------------------------------------

describe("A failed English level is retaken in a later grade, never as an AP class (catalog.ts, fill.ts lateEnglish, gaps.ts)", () => {
  it("V29: a Tennessee 11th grader with an F in English II retakes it in 12th, with credit recovery named", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        path: "training",
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "ela.10", grade: 10, letter: "F" },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "arts.visual", grade: 10 },
          { type: "cs.intro", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ],
      },
      POLICE,
    );
    expect(typesIn(path, 12)).toEqual(expect.arrayContaining(["ela.10", "ela.12"]));
    expect(requirement(path, "tn.grad", "ela.2").status).toBe("planned");
    const retake = suggestions(path).find((s) => s.typeId === "ela.10")!;
    expect(reasonsOf(retake)).toMatch(/Plans change/);
    expect(reasonsOf(retake)).toMatch(/Credit recovery is another way to retake it/);
    expect(retake.reasons.flatMap((r) => r.citations)).toContain("tn-2103-vi-1");
    expect(gapLines(path)).not.toMatch(/Room to add: English II/);
  });

  it("W7: a Texas 11th grader with an F in English I retakes it in 12th", () => {
    const path = real({
      state: "TX",
      grade: 11,
      choices: { txEndorsements: ["multidisciplinary"] },
      courses: [
        { type: "ela.9", grade: 9, letter: "F" },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
      ],
    });
    expect(typesIn(path, 12)).toEqual(expect.arrayContaining(["ela.9", "ela.12"]));
    expect(requirement(path, "tx.fhsp.grad", "ela.1").status).toBe("planned");
    expect(gapLines(path)).not.toMatch(/Room to add: English I\b/);
  });

  it("W6: a Utah 11th grader with an F in English 10 retakes English 10, not AP Seminar in the year in progress", () => {
    const path = real({
      state: "UT",
      grade: 11,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.ut_sec1", grade: 9 },
        { type: "sci.earth", grade: 9 },
        { type: "ss.world_geo", grade: 9, units: 2 },
        { type: "pe.fitness", grade: 9, units: 2 },
        { type: "health.health", grade: 9, units: 2 },
        { type: "cs.intro", grade: 9, units: 2 },
        { type: "ela.10", grade: 10, letter: "F" },
        { type: "math.ut_sec2", grade: 10 },
        { type: "sci.bio", grade: 10 },
        { type: "ss.world_hist", grade: 10, units: 2 },
        { type: "ela.11", grade: 11 },
        { type: "math.ut_sec3", grade: 11 },
        { type: "sci.chem", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
      ],
    });
    expect(suggestions(path).map((s) => s.typeId)).not.toContain("ela.seminar");
    expect(typesIn(path, 12)).toContain("ela.10");
    expect(requirement(path, "ut.grad", "ela.10").status).toBe("planned");
  });

  it("a Tennessee senior with no room this year gets summer and credit recovery for the retake, without the first-attempt note", () => {
    const path = real({
      state: "TN",
      grade: 12,
      limits: { classesPerYear: 5 },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "health.wellness", grade: 9 },
        { type: "ss.world_hist", grade: 9 },
        { type: "ela.10", grade: 10, letter: "F" },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "lang.es.1", grade: 10 },
        { type: "arts.visual", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "lang.es.2", grade: 11 },
        { type: "ela.12", grade: 12 },
        { type: "math.stats", grade: 12 },
        { type: "ss.us_gov", grade: 12, units: 2 },
        { type: "ss.econ", grade: 12, units: 2 },
        { type: "ss.pfl", grade: 12, units: 2 },
        { type: "pe.general", grade: 12, units: 2 },
        { type: "cs.intro", grade: 12 },
      ],
    });
    const gap = path.gaps.find((g) => g.demandId === "tn.grad/ela.2")!;
    expect(gap.text).toBe("Needs a plan now: English II.");
    expect(gap.options.map((o) => o.kind)).toEqual(["summer", "credit_recovery", "ask_counselor"]);
    const summer = gap.options.find((o) => o.kind === "summer")!;
    expect(summer.text).toBe("Retake English II in summer.");
    expect(summer.note).not.toMatch(/first-time class/i);
    expect(gap.options.find((o) => o.kind === "credit_recovery")!.citations).toEqual(["tn-2103-vi-1", "tn-2103-vi-3a1", "tn-2103-vi-3a1-accept"]);
  });
});

// 7. Texas Arts and Humanities: two languages ---------------------------------------------------------

describe("Texas Arts and Humanities: two levels each of two languages completes it (19 TAC §74.13(f)(4)(C))", () => {
  it("V27: Spanish I-II and French I-II meet the endorsement; no social studies class is required for it", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        choices: { txEndorsements: ["arts_humanities"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "pe.athletics", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "lang.fr.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.fr.2", grade: 11 },
        ],
      },
      PSYCHOLOGIST,
    );
    expect(requirement(path, "tx.endorse.arts-humanities", "ah.two-languages.first").status).toBe("done");
    expect(requirement(path, "tx.endorse.arts-humanities", "ah.two-languages.second").status).toBe("done");
    expect(allReasons(path)).not.toMatch(/Arts and Humanities endorsement: (Five social studies credits|Social studies, a language or fine arts)/);
    expect(ruleSet(path, "tx.endorse.arts-humanities").unverified.map((u) => u.id)).not.toContain("ah.two-languages");
  });

  it("with Spanish I-II and French I, the plan adds French II, not a third year of Spanish", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        choices: { txEndorsements: ["arts_humanities"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.fr.1", grade: 11 },
        ],
      },
      PSYCHOLOGIST,
    );
    expect(typesIn(path, 12)).toContain("lang.fr.2");
    expect(typesIn(path, 12)).not.toContain("lang.es.3");
    const fr2 = suggestions(path).find((s) => s.typeId === "lang.fr.2")!;
    expect(reasonsOf(fr2)).toMatch(/\(one way: two levels each of two different languages\)/);
  });

  it("the content has the route in both variants, cited", () => {
    for (const v of variantsOf("TX", "tx.endorse.arts-humanities")) {
      const second = leavesOf(v.requirements).find((r) => r.id === "ah.two-languages.second")!;
      expect(second.kind === "same_language" && second.differentFrom).toBe("ah.two-languages.first");
      expect(second.cite).toContain("tx-74-13-f4c");
      expect((v.unverified ?? []).map((u) => u.id)).not.toContain("ah.two-languages");
    }
  });
});

// 8. Integrated Physics and Chemistry ----------------------------------------------------------------

describe("A typed \"Integrated Physics and Chemistry\" is IPC, not Physics (course-type-guess.ts)", () => {
  it("D7: a STEM engineering student who typed it still gets Physics", () => {
    const ipc = guessCourseTypeId("Integrated Physics and Chemistry", "science");
    expect(ipc).toBe("sci.ipc");
    const path = real(
      {
        state: "TX",
        grade: 10,
        colleges: [UT_AUSTIN],
        choices: { txEndorsements: ["stem"] },
        courses: [
          { type: "ela.9", grade: 9, assumed: true },
          { type: "math.alg1", grade: 9, assumed: true },
          { type: ipc, grade: 9, assumed: true, name: "Integrated Physics and Chemistry" },
          { type: "ss.world_geo", grade: 9, assumed: true },
          { type: "ela.10", grade: 10, assumed: true },
          { type: "math.geom", grade: 10, assumed: true },
          { type: "sci.bio", grade: 10, assumed: true },
        ],
      },
      ENGINEER,
    );
    expect(suggestions(path).map((s) => s.typeId)).toContain("sci.phys");
  });
});

// 9. Tennessee waivers expand the focus ---------------------------------------------------------------

describe("Tennessee: world language and fine arts waivers add credits that expand the elective focus (Policy 2.103 I(16)-(17))", () => {
  // Round 5 replaced round 4's "6 credits in one career and technical program": the waived credits
  // expand the focus as the district decides, next to the 3-credit program (review-fixes-5.test.ts).
  const TN9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "cte.architecture_construction.1", grade: 9 },
  ];

  it("V12: with both waivers, the plan finishes the career and technical program and lists the 3 waived credits", () => {
    const path = real({ state: "TN", grade: 9, path: "training", choices: { tnElectiveFocus: "cte", tnWorldLanguageWaiver: true, tnFineArtsWaiver: true }, courses: TN9 }, ELECTRICIAN);
    const focus = requirement(path, "tn.focus.cte", "focus");
    expect(focus.required).toBe(12);
    expect(focus.missing).toBe(0);
    const waived = ["wl.waived", "arts.waived"].map((id) => requirement(path, "tn.grad", id));
    expect(waived.reduce((n, r) => n + r.required, 0)).toBe(12);
    for (const r of waived) expect(r.label).toMatch(/expands? your elective focus/);
    const construction = suggestions(path).filter((s) => s.typeId.startsWith("cte.architecture_construction."));
    expect(construction.length).toBe(2);
  });

  it("without waivers the focus is still 3 credits", () => {
    const path = real({ state: "TN", grade: 9, path: "training", choices: { tnElectiveFocus: "cte" }, courses: TN9 }, ELECTRICIAN);
    expect(requirement(path, "tn.focus.cte", "focus").required).toBe(12);
  });

  it("the content: every focus is 3 credits and says what the waivers do", () => {
    const focusSets = plannerContentFor("TN")
      .rules.flatMap((f) => f.ruleSets)
      .filter((r) => r.appliesWhen.choice?.key === "tnElectiveFocus");
    expect(focusSets).toHaveLength(7);
    for (const rs of focusSets) {
      for (const v of rs.variants) {
        const sizes = leavesOf(v.requirements).map((r) => (r.kind === "credits" ? r.units : 0));
        expect(sizes, `${v.id}`).toEqual([12]);
        expect((v.warnings ?? []).find((w) => w.id === "focus.waivers")?.cite, v.id).toEqual(["tn-2103-i-16", "tn-2103-i-17"]);
      }
    }
  });
});

// 10. The DLA after 11th grade; required rule sets only planned ---------------------------------------

describe("Texas seniors: the DLA's \"on schedule\" is a question for the counselor, and planned isn't done (audit.ts)", () => {
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

  it("X7: Algebra II added in 12th isn't \"on schedule by the end of 11th grade\"", () => {
    const path = real({ state: "TX", grade: 12, choices: { txEndorsements: ["multidisciplinary"] }, courses: X7 });
    const check = ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")!;
    expect(check.status).toBe("ask_counselor");
    expect(check.text).toMatch(/ask your counselor whether your transcript showed you on schedule at the end of 11th grade\.$/);
    expect(check.text).not.toMatch(/you're on schedule/);
  });

  it("V23: a STEM senior adding Physics now: the DLA asks, and the TEXAS Grant's course part isn't Done", () => {
    const path = real(
      {
        state: "TX",
        grade: 12,
        choices: { txEndorsements: ["stem"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "pe.athletics", grade: 9 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "cs.prog1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.env", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "cs.prog2", grade: 11 },
          { type: "ela.12", grade: 12 },
          { type: "math.precalc", grade: 12 },
        ],
      },
      ENGINEER,
    );
    expect(ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")!.status).toBe("ask_counselor");
    expect(ruleSet(path, "tx.fhsp.grad").status).not.toBe("done");
    expect(ruleSet(path, "tx.texas-grant.priority").status).not.toBe("done");
  });

  it("a senior who finished the DLA's classes by 11th grade is on schedule", () => {
    const path = real({
      state: "TX",
      grade: 12,
      choices: { txEndorsements: ["multidisciplinary"] },
      courses: [...X7.filter((c) => c.type !== "math.applied.models"), { type: "math.alg2", grade: 11 }, { type: "math.precalc", grade: 11 }, { type: "sci.phys", grade: 11 }],
    });
    const check = ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")!;
    expect(check.status).toBe("ok");
    expect(check.text).toMatch(/on your transcript by the end of 11th grade/);
  });
});

// 12-17. Low-severity findings -----------------------------------------------------------------------

describe("Smaller fixes from the fourth review", () => {
  it("V13: Other choices for a required U.S. History are only classes that meet U.S. History", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        choices: { tnElectiveFocus: "humanities" },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "arts.visual", grade: 10 },
        ],
      },
      TEACHER,
    );
    const ush = suggestions(path).find((s) => s.typeId === "ss.us_hist")!;
    expect(reasonsOf(ush)).toMatch(/Required by Tennessee: U.S. History and Geography/);
    expect(ush.alternatives.length).toBeGreaterThan(0);
    expect(ush.alternatives.every((a) => a.typeId === "ss.us_hist")).toBe(true);
  });

  it("V5: the test-score question names college-ready math, not Utah's graduation requirements", () => {
    const path = real(
      {
        state: "UT",
        grade: 12,
        colleges: [USU],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cs.intro", grade: 9, units: 2 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "arts.visual", grade: 10 },
          { type: "cte.health.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "ss.pfl", grade: 11, units: 2 },
          { type: "pe.skills", grade: 11, units: 2 },
          { type: "pe.lifetime", grade: 11, units: 2 },
          { type: "ela.12", grade: 12 },
          { type: "ss.us_gov", grade: 12, units: 2 },
          { type: "sci.anat", grade: 12 },
        ],
      },
      NURSE,
    );
    const texts = path.askCounselor.map((q) => q.text);
    expect(texts).toContain("Should I plan to show college-ready math (Utah's senior-year math) with a test score or with a class, and when do scores need to be in?");
    expect(texts.join("\n")).not.toMatch(/show Utah high school graduation requirements/);
  });

  it("V4: a required Chemistry retake goes in 12th in place of an optional class, not into the year in progress", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        path: "training",
        colleges: [USU],
        choices: { utMathCompetencyMet: true },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "cs.intro", grade: 9, units: 2 },
          { type: "arts.visual", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.chem", grade: 10, letter: "W" },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "cte.business.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.bio", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ],
      },
      ACCOUNTANT,
    );
    expect(typesIn(path, 11)).not.toContain("sci.chem");
    expect(typesIn(path, 12)).toContain("sci.chem");
  });

  it("V22: \"may count the same way\" is asked once per class, not again for Texas A&M", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        colleges: [TAMU],
        choices: { txEndorsements: ["business_industry"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ],
      },
      ACCOUNTANT,
    );
    const same = path.gaps.filter((g) => /may count the same way/.test(g.text));
    expect(same.map((g) => g.text)).toEqual([
      "Algebra I: you've taken a class that may count the same way. Ask your counselor whether it does here.",
      "Geometry: you've taken a class that may count the same way. Ask your counselor whether it does here.",
    ]);
    expect(same.every((g) => g.priority === 0)).toBe(true);
  });

  it("D3: a senior with only typed class names isn't told every requirement needs a plan now", () => {
    const courses: CourseSpec[] = [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.general", grade: 10, units: 2 },
      { type: "ss.pfl", grade: 10, units: 2 },
      { type: "ela.11", grade: 11 },
      { type: "math.alg2", grade: 11 },
      { type: "sci.phys", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "ela.12", grade: 12 },
      { type: "math.stats", grade: 12 },
      { type: "ss.us_gov", grade: 12, units: 2 },
      { type: "ss.econ", grade: 12, units: 2 },
    ];
    const path = real({ state: "TN", grade: 12, courses: courses.map((c) => ({ ...c, assumed: true })) }, TEACHER);
    // Round 9: requirements a guessed class decides wait on the student to confirm it.
    const guessed = ruleSet(path, "tn.grad").requirements.filter((r) => r.modifiers.includes("guessed_type") && r.status === "waiting_confirm");
    expect(guessed.length).toBeGreaterThan(10);
    for (const r of guessed) expect(r.modifiers, r.reqId).not.toContain("needs_plan_now");
  });

  it("V1, V2: Utah's list has the goal's pathway, so the CTE credit starts it (ut/generic-catalog.json)", () => {
    const graphic = real({ state: "UT", grade: 7, courses: [{ type: "ela.ms", grade: 7 }, { type: "math.ms", grade: 7 }] }, [{ familyId: "visual_arts", because: "Graphic Designers" }]);
    const sketch = graphic.middleSchool!.ninthGradeSketch!.slots.flatMap((s) => (s.kind === "suggested" ? [s.typeId] : []));
    expect(sketch).toContain("cte.arts_av.1");
    expect(sketch).not.toContain("cte.ag.1");
    const teacher = real({ state: "UT", grade: 9, courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.earth", grade: 9 }] }, TEACHER);
    const cte = suggestions(teacher).filter((s) => getCourseType(s.typeId).cte === "always");
    expect(cte.map((s) => s.typeId)).toContain("cte.education.1");
    expect(cte.map((s) => s.typeId)).not.toContain("cte.business_office");
    for (const t of ["cte.arts_av.1", "cte.education.1", "cte.law.1", "cte.human_services.1"]) {
      expect(plannerContentFor("UT").genericCatalog.courses.find((c) => c.typeId === t)?.cite?.length, t).toBeGreaterThan(0);
    }
  });
});
