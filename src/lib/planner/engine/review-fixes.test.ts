import { describe, expect, it } from "vitest";
import { plannerContentFor } from "../content";
import { getCourseType } from "../course-types";
import type { CollegeTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { Req } from "../rules";
import { evaluateAlternative, pickAlternative } from "./allocate";
import type { CatalogRow } from "./catalog";
import { buildContext } from "./context";
import { prereqsMetIn } from "./fill";
import { plan } from "./index";
import { needsFromEval } from "./needs";
import { planned, requirement, ruleSet, suggestions, typesIn } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";
import { alternatives, item, variant } from "./testing/items";
import { x1CalcInfeasible } from "./testing/scenarios";

// Regression tests for the counselor and engineering review of the course planner (each block
// names the finding it pins). They run the engine on the real Utah, Tennessee and Texas content,
// with the students the reviewers described.

const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UH: CollegeTarget = { unitId: 225511, name: "University of Houston", state: "TX", public: true, admissionRate: 0.66, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };

function real(s: Scenario): PlannedPath {
  return planned(plan(scenario({ ...s, content: plannerContentFor(s.state!) })));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;

/** Math classes in each plan year: the student's own (not failed) and suggestions. */
function mathPerYear(path: PlannedPath, planId: "A" | "B" = "A"): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const y of path.plans.find((p) => p.id === planId)!.years) {
    const math = y.slots.flatMap((s) => (s.kind !== "your_choice" && getCourseType(s.typeId).subject === "math" && !(s.kind === "suggested" && s.term === "summer") ? [s.typeId] : []));
    out.set(y.grade, math);
  }
  return out;
}

const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const allGapText = (path: PlannedPath) => path.gaps.map((g) => `${g.text} ${g.options.map((o) => o.text).join(" ")}`).join("\n");

const UT_THROUGH_10: CourseSpec[] = [
  { type: "ela.9", grade: 9 },
  { type: "math.ut_sec1", grade: 9, letter: "C" },
  { type: "sci.earth", grade: 9 },
  { type: "ss.world_geo", grade: 9, units: 2 },
  { type: "health.health", grade: 9, units: 2 },
  { type: "pe.fitness", grade: 9, units: 2 },
  { type: "ela.10", grade: 10 },
  { type: "math.ut_sec2", grade: 10, letter: "C" },
  { type: "sci.bio", grade: 10 },
  { type: "ss.world_hist", grade: 10, units: 2 },
  { type: "pe.skills", grade: 10, units: 2 },
  { type: "arts.visual", grade: 10 },
];

describe("Utah math: Secondary Math I-III is the route, calculus counts only once passed (fill.ts leafFeasible, pickAlternative)", () => {
  it("an 8th grader's audit never shows the calculus alternative as the requirement", () => {
    const path = real({ state: "UT", grade: 8, courses: [{ type: "math.ms", grade: 8 }] });
    const ids = ruleSet(path, "ut.grad").requirements.map((r) => r.reqId);
    expect(ids).toEqual(expect.arrayContaining(["math.sec1", "math.sec2", "math.sec3"]));
    expect(ids).not.toContain("math.calculus");
  });

  it("an 11th grader in Secondary Math II sees Secondary Math III required by Utah", () => {
    const path = real({ state: "UT", grade: 11, courses: [...UT_THROUGH_10, { type: "ela.11", grade: 11 }] });
    const sec3 = suggestions(path).find((s) => s.typeId === "math.ut_sec3")!;
    expect(reasonsOf(sec3)).toMatch(/Required by Utah: Secondary Math III/);
  });

  it("a training-path 9th grader aiming at the trades isn't planned toward precalculus or calculus, and gets the full pathway", () => {
    const path = real({ state: "UT", grade: 9, path: "training", families: ["construction_trades"], courses: [{ type: "math.ut_sec1", grade: 9 }, { type: "ela.9", grade: 9 }] });
    const all = suggestions(path).map((s) => s.typeId);
    expect(all).not.toContain("math.precalc");
    expect(all).not.toContain("math.calc");
    expect(all).toEqual(expect.arrayContaining(["math.ut_sec2", "math.ut_sec3", "cte.architecture_construction.1", "cte.architecture_construction.2", "cte.architecture_construction.3"]));
    expect(allGapText(path)).not.toMatch(/calculus/i);
  });

  it("a 10th grader who failed Secondary Math I retakes it, then takes Secondary Math III, with no calculus gap", () => {
    const path = real({
      state: "UT",
      grade: 10,
      courses: [
        { type: "math.ut_sec1", grade: 9, letter: "F" },
        { type: "ela.9", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.ut_sec2", grade: 10 },
      ],
    });
    expect(typesIn(path, 11)).toContain("math.ut_sec1");
    expect(typesIn(path, 12)).toContain("math.ut_sec3");
    expect(allGapText(path)).not.toMatch(/calculus/i);
    expect(requirement(path, "ut.grad", "math.sec3").status).toBe("planned");
  });

  it("the calculus alternative still finishes math once calculus is passed with a C", () => {
    const v = variant([
      {
        id: "math",
        label: "Math",
        kind: "any",
        of: [
          { id: "seq", label: "Sequence", kind: "credits", units: 12, select: [{ types: ["math.ut_sec1", "math.ut_sec2", "math.ut_sec3"] }], cite: ["c"] },
          { id: "calc", label: "Calculus with a C", kind: "credits", units: 4, select: [{ types: ["math.calc"], minLetter: "C" }], cite: ["c"], onlyWhenDone: true },
        ],
      },
    ]);
    const alts = alternatives(v);
    const choose = (items: ReturnType<typeof item>[]) => pickAlternative(alts.map((a) => evaluateAlternative(a, items, "exclusive"))).leaves.map((l) => l.leaf.id);
    // Not finished (in progress): the sequence is still the route, even though it's further from done.
    expect(choose([item("math.ut_sec1"), item("math.calc", { status: "in_progress" })])).toEqual(["seq"]);
    // Finished with a C: done.
    expect(choose([item("math.ut_sec1"), item("math.calc", { letter: "C" })])).toEqual(["calc"]);
  });
});

describe("A failed rung isn't stood in for by a higher one (prereqsMetIn, the ladder)", () => {
  const TX_F_ALG1: Scenario = {
    state: "TX",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "F" },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
    ],
  };

  it("an F in Algebra I and Geometry now: the Algebra I retake first, then Algebra II, never both in one year", () => {
    const path = real(TX_F_ALG1);
    for (const p of path.plans) {
      const math = mathPerYear(path, p.id);
      expect(math.get(11), p.id).toEqual(["math.alg1"]);
      expect(math.get(12), p.id).toEqual(["math.alg2"]);
    }
  });

  it("flags the Geometry row: Algebra I isn't passed yet", () => {
    const path = real(TX_F_ALG1);
    const geometry = path.plans[0]!.years.find((y) => y.grade === 10)!.slots.find((s) => s.kind === "yours" && s.typeId === "math.geom");
    expect(geometry?.kind === "yours" && geometry.warnings.map((w) => w.text)).toContain(
      "You haven't passed Algebra I yet, and this class builds on it. Ask your counselor about retaking it.",
    );
  });

  it("prerequisites: a higher rung meets a lower one only when the lower one wasn't failed since", () => {
    const row = { prereqGroups: [{ types: ["math.alg1", "math.int1", "math.ut_sec1"], catalogIds: [], minLetter: null, concurrentOk: false }] } as unknown as CatalogRow;
    const none = () => null;
    expect(prereqsMetIn([item("math.geom", { grade: 10 })], row, 11, none)).toBe(true);
    expect(prereqsMetIn([item("math.alg1", { grade: 9, letter: "F" }), item("math.geom", { grade: 10 })], row, 11, none)).toBe(false);
    expect(prereqsMetIn([item("math.alg1", { grade: 9, letter: "F" }), item("math.geom", { grade: 10 }), item("math.alg1", { grade: 11 })], row, 12, none)).toBe(true);
  });
});

describe("One math class a year without the opt-in and a B or better (candidates, pick)", () => {
  const cases: [string, Scenario][] = [
    [
      "a Tennessee 10th-grade nursing student with a B in Algebra I",
      { state: "TN", grade: 10, families: ["nursing"], colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "B" }, { type: "sci.bio", grade: 9 }, { type: "lang.es.1", grade: 9 }] },
    ],
    [
      "a Texas 11th grader behind in math",
      { state: "TX", grade: 11, courses: [{ type: "ela.9", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.alg1", grade: 10, letter: "C" }, { type: "ela.11", grade: 11 }, { type: "math.geom", grade: 11 }] },
    ],
    [
      "a Tennessee student who failed Algebra I",
      { state: "TN", grade: 10, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "F" }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }] },
    ],
    ["an undecided Texas 9th grader", { state: "TX", grade: 9, path: "undecided", courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }] }],
  ];
  for (const [name, s] of cases) {
    it(name, () => {
      const path = real(s);
      for (const p of path.plans) for (const [grade, math] of mathPerYear(path, p.id)) expect(math.length, `${p.id} ${grade}: ${math.join(", ")}`).toBeLessThanOrEqual(1);
    });
  }

  it("with the opt-in and a B or better, a second math class may go in a year", () => {
    const behind: Scenario = {
      state: "TX",
      grade: 11,
      limits: { classesPerYear: 8 },
      courses: [{ type: "ela.9", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.alg1", grade: 10, letter: "B+" }, { type: "ela.11", grade: 11 }, { type: "math.geom", grade: 11 }],
    };
    const without = real(behind);
    expect(mathPerYear(without).get(12)).toEqual(["math.alg2"]);
    expect(without.gaps.some((g) => g.demandId === "tx.dla/dla.math4")).toBe(true);
    const optedIn = real({ ...behind, limits: { classesPerYear: 8, accelerateMath: true } });
    expect(mathPerYear(optedIn).get(12)).toHaveLength(2);
    expect(optedIn.gaps.some((g) => g.demandId === "tx.dla/dla.math4")).toBe(false);
  });
});

describe("\"Required by\" only from the final audit, and suggestions nothing needs are taken out (plan.ts, prune)", () => {
  const ENGINEER: Scenario = {
    state: "TX",
    grade: 9,
    families: ["engineering"],
    colleges: [UT_AUSTIN, TAMU],
    choices: { txEndorsements: ["stem"] },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "lang.es.1", grade: 9 },
    ],
  };

  it("a Texas engineering 9th grader with Spanish I: no \"two programming credits\" reason, and four lab sciences", () => {
    const path = real(ENGINEER);
    for (const s of suggestions(path)) expect(reasonsOf(s)).not.toMatch(/computer programming credits/i);
    expect(requirement(path, "tx.fhsp.grad", "lote.same").status).toBe("planned");
    const sciences = path.plans[0]!.years.flatMap((y) => y.slots).filter((s) => s.kind !== "your_choice" && getCourseType(s.typeId).subject === "science");
    expect(sciences).toHaveLength(4);
  });

  it("every suggestion's \"Required by\" line matches a requirement that counts it in the audit", () => {
    const path = real(ENGINEER);
    for (const s of suggestions(path)) {
      for (const r of s.reasons.filter((x) => x.kind === "requirement" && x.ruleSetId && x.reqId)) {
        const req = requirement(path, r.ruleSetId!, r.reqId!);
        expect(req.counted.some((c) => c.ref.kind === "suggestion" && c.ref.key === s.key), `${s.typeId}: ${r.text}`).toBe(true);
      }
    }
  });
});

describe("Texas endorsement plans (endorsementSplit)", () => {
  it("STEM is never Plan A without a STEM goal, even for a 10th grader who failed Algebra I", () => {
    const path = real({ state: "TX", grade: 10, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "F" }, { type: "sci.bio", grade: 9 }] });
    expect(path.plans[0]!.label).not.toMatch(/STEM/);
    expect(path.audit.map((a) => a.ruleSetId)).not.toContain("tx.endorse.stem");
  });

  it("a nursing student already in Health Science 1 gets Public Services first, with one pathway", () => {
    const path = real({
      state: "TX",
      grade: 10,
      families: ["nursing"],
      courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "B" }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "cte.health.1", grade: 10 }],
    });
    expect(path.planChoice?.kind).toBe("endorsement");
    expect(path.plans[0]!.label).toBe("Plan A: with the Public Services endorsement.");
    expect(path.planChoice?.text).toMatch(/fit your goals/);
    for (const p of path.plans) {
      const clusters = new Set(suggestions(path, p.id).flatMap((s) => (getCourseType(s.typeId).ladder?.id.startsWith("cte.") ? [getCourseType(s.typeId).ladder!.id] : [])));
      expect(clusters.size, p.label).toBeLessThanOrEqual(1);
    }
  });

  it("an engineering student gets STEM first", () => {
    const path = real({ state: "TX", grade: 9, families: ["engineering"], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }] });
    expect(path.plans[0]!.label).toBe("Plan A: with the STEM endorsement.");
  });
});

describe("An endorsement's program of study is one cluster (tx/options.json, 19 TAC §74.13(f)(6)-(8))", () => {
  const BI = { state: "TX" as const, grade: 12 as const, choices: { txEndorsements: ["business_industry" as const] } };

  it("Agriculture 1 and 2 with Architecture 1 isn't a Business and Industry program", () => {
    const path = real({ ...BI, courses: [{ type: "cte.ag.1", grade: 10 }, { type: "cte.architecture_construction.1", grade: 11 }, { type: "cte.ag.2", grade: 11 }] });
    const set = ruleSet(path, "tx.endorse.business").requirements;
    expect(set.some((r) => r.reqId.startsWith("bi.cte.") && r.firm >= 12)).toBe(false);
  });

  it("Agriculture 1-3 is", () => {
    const path = real({ ...BI, courses: [{ type: "cte.ag.1", grade: 9 }, { type: "cte.ag.2", grade: 10 }, { type: "cte.ag.3", grade: 11 }] });
    expect(requirement(path, "tx.endorse.business", "bi.cte.ag").status).toBe("done");
  });

  it("an engineering program counts for Business and Industry only while STEM's math and science aren't met (§74.13(f)(7)(B))", () => {
    const engineering: CourseSpec[] = [
      { type: "cte.engineering.1", grade: 9 },
      { type: "cte.engineering.2", grade: 10 },
      { type: "cte.engineering.3", grade: 11 },
    ];
    const without = real({ ...BI, courses: engineering });
    const check = (p: PlannedPath) => ruleSet(p, "tx.endorse.business").checks.find((c) => c.checkId === "bi.cte.engineering.unless-stem");
    expect(check(without)?.status).toBe("ok");
    const stemMathScience: CourseSpec[] = [
      { type: "math.alg2", grade: 10 },
      { type: "math.precalc", grade: 11 },
      { type: "math.calc", grade: 12, status: "planned" },
      { type: "sci.chem", grade: 10 },
      { type: "sci.phys", grade: 11 },
    ];
    expect(check(real({ ...BI, courses: [...engineering, ...stemMathScience] }))?.status).toBe("ask_counselor");
  });

  it("the Texas generic list offers levels 1-3 of its career clusters", () => {
    const rows = new Set(plannerContentFor("TX").genericCatalog.courses.map((c) => c.typeId));
    for (const cluster of ["health", "business", "it", "engineering", "ag", "law", "hospitality", "architecture_construction", "education"]) {
      for (const level of [1, 2, 3]) expect(rows.has(`cte.${cluster}.${level}` as never), `cte.${cluster}.${level}`).toBe(true);
    }
  });
});

describe("The DLA's Algebra II may be planned for 12th (TEC §51.803(d) \"on schedule\")", () => {
  it("an 11th grader with Algebra II planned for 12th is on schedule, with no DLA gap", () => {
    const path = real({
      state: "TX",
      grade: 11,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.applied.models", grade: 11 },
        { type: "math.alg2", grade: 12, status: "planned" },
      ],
    });
    expect(requirement(path, "tx.dla", "dla.alg2").status).toBe("planned");
    expect(ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")?.status).toBe("ok");
    expect(path.gaps.filter((g) => g.demandId?.startsWith("tx.dla/"))).toEqual([]);
    expect(allGapText(path)).not.toMatch(/isn't on your plan/);
  });
});

describe("Tennessee's computer science credit covers the 4th math or 3rd science it stands in for (needsFromEval)", () => {
  it("one missing CS class is one need, not two, on the substitution route", () => {
    const v = variant([
      { id: "math.fourth", label: "4th math", kind: "credits", units: 4, select: [{ subjects: ["math"] }], cite: ["c"] },
      { id: "sci.third", label: "3rd science", kind: "credits", units: 4, select: [{ subjects: ["science"] }], cite: ["c"] },
      { id: "cs", label: "Computer science", kind: "credits", units: 4, select: [{ subjects: ["computer_science"] }], substitutesForOneOf: ["math.fourth", "sci.third"], cite: ["c"] } as Req,
    ]);
    const results = alternatives(v).map((a) => evaluateAlternative(a, [], "exclusive"));
    // The plain route needs three classes; each substitution route, two.
    const best = pickAlternative(results);
    expect(best.leaves.find((l) => l.leaf.id === "cs")?.leaf.subFor).not.toBeNull();
    const ctx = buildContext(scenario({ state: "TN", grade: 11, content: plannerContentFor("TN") }) as never);
    const rc = { ...ctx.ruleSets[0], allocation: "exclusive" as const, rs: { ...ctx.ruleSets[0].rs, kind: "state_graduation" as const, testRoutes: [] } };
    const ids = needsFromEval(ctx, rc, best).map((n) => n.id.split("/").pop());
    expect(ids).toContain("cs");
    expect(ids).toHaveLength(2);
  });
});

describe("Core subjects spread across years (gradePreference)", () => {
  it("a Texas engineering 9th grader's 11th grade isn't stacked with sciences while 12th has room", () => {
    const path = real({
      state: "TX",
      grade: 9,
      families: ["engineering"],
      colleges: [UT_AUSTIN, TAMU],
      choices: { txEndorsements: ["stem"] },
      courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "lang.es.1", grade: 9 }],
    });
    for (const g of [10, 11, 12]) {
      const sciences = typesIn(path, g).filter((t) => getCourseType(t as never).subject === "science");
      expect(sciences.length, `${g}: ${sciences.join(", ")}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("UT Austin calculus readiness: the test route by December 10 is the default (admissions.json, timeline)", () => {
  it("the test route carries its date", () => {
    const route = plannerContentFor("TX").rules.flatMap((f) => f.ruleSets).find((r) => r.id === "utaustin.calc-ready")!.testRoutes![0];
    expect(route.by).toEqual({ grade: 12, month: 12, day: 10 });
  });

  it("a 9th grader a year ahead gets the date and the class route as a line, not a P1 gap", () => {
    const path = real({
      state: "TX",
      grade: 9,
      families: ["engineering"],
      colleges: [UT_AUSTIN],
      courses: [{ type: "math.alg1", grade: 8, hsCredit: true, letter: "A" }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }],
    });
    expect(path.gaps.filter((g) => g.demandId?.startsWith("utaustin.calc-ready/"))).toEqual([]);
    const test = path.deadlines.find((d) => d.kind === "test")!;
    expect(test.by).toEqual({ grade: 12, point: "date", month: 12, day: 10 });
    expect(test.note).toMatch(/^Or show it with a class: Calculus I with a B or higher by the end of 11th grade\./);
    expect(JSON.stringify(path)).not.toMatch(/graded by December 10 of 12th grade on your plan/);
  });
});

describe("Gap options that apply (gaps.ts optionsFor)", () => {
  const UT_CTE_DIGITAL: Scenario = { state: "UT", grade: 11, courses: [...UT_THROUGH_10, { type: "ela.11", grade: 11 }, { type: "math.ut_sec3", grade: 11 }] };

  it("Utah's math-competency route is offered only for the senior-year math check", () => {
    const content = plannerContentFor("UT");
    const route = content.rules.flatMap((f) => f.ruleSets).find((r) => r.id === "ut.grad")!.testRoutes![0];
    expect(route.reqIds).toEqual(["ut.grad.senior-math"]);
    const path = real({ ...UT_CTE_DIGITAL, limits: { classesPerYear: 5 } });
    for (const g of path.gaps.filter((x) => !/math/i.test(x.text))) expect(g.options.map((o) => o.kind)).not.toContain("test_score");
  });

  it("a CTE credit's option names a CTE class, and college credit is offered only where the class has it", () => {
    const path = real({ ...UT_CTE_DIGITAL, limits: { classesPerYear: 5 } });
    const text = allGapText(path);
    expect(text).not.toMatch(/Take (English|Algebra II|Spanish I) .*college credit/);
    expect(text).not.toMatch(/\(ce\)|concurrent enrollment \(ce\)/);
  });
});

describe("Nursing's sciences: no microbiology gap (families.json, gaps)", () => {
  it("no gap asks a nursing student to add microbiology", () => {
    const path = real({ state: "TN", grade: 10, families: ["nursing"], colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }] });
    expect(allGapText(path)).not.toMatch(/microbiology/i);
    expect(plannerContentFor("TN").families!.families.find((f) => f.id === "nursing")!.sciences).not.toContain("sci.microbio");
  });
});

describe("Rigor tier raises come from reviewed program gates only (context.ts, rigor.json)", () => {
  const tier = (s: Scenario) => real(s).builtFrom.rigor.tier;
  const base = { grade: 10 as const, courses: [{ type: "ela.9" as const, grade: 9 as const }] };

  it("a Texas nursing student with UH and UT Austin isn't raised by UH's minimum course list", () => {
    expect(tier({ ...base, state: "TX", families: ["nursing"], colleges: [UH, UT_AUSTIN] })).toBe("admits_fewer_than_half");
  });

  it("Texas A&M's \"encouraged\" engineering note doesn't raise it", () => {
    expect(tier({ ...base, state: "TX", families: ["engineering"], colleges: [TAMU] })).toBe("admits_most");
  });

  it("the reviewed UT Knoxville nursing raise does", () => {
    expect(tier({ ...base, state: "TN", families: ["nursing"], colleges: [UTK] })).toBe("very_selective");
  });
});

describe("Admission math units start at Algebra I (admissions.json selectors)", () => {
  it("a Tennessee 11th grader's Math Foundations doesn't count toward UT Knoxville's 4 math units", () => {
    const path = real({ state: "TN", grade: 11, colleges: [UTK], courses: [{ type: "math.other", grade: 9 }, { type: "math.alg1", grade: 10 }, { type: "math.geom", grade: 11 }, { type: "math.alg2", grade: 12, status: "planned" }] });
    const math = requirement(path, "utk.core16", "math");
    expect(math.firm).toBe(8);
    expect(math.status).not.toBe("planned");
  });
});

describe("Required classes can move lower-priority suggestions out (exactFit, evictFor)", () => {
  it("a Utah 11th grader's CTE and Digital Studies credits fit, and no lone Spanish I is left in 12th", () => {
    const path = real({ state: "UT", grade: 11, courses: [...UT_THROUGH_10, { type: "ela.11", grade: 11 }, { type: "math.ut_sec3", grade: 11 }] });
    expect(requirement(path, "ut.grad", "cte").status).toBe("planned");
    expect(requirement(path, "ut.grad", "digital").status).toBe("planned");
    const langs = suggestions(path).filter((s) => getCourseType(s.typeId).subject === "world_language");
    expect(langs.length === 0 || langs.length >= 2).toBe(true);
  });
});

describe("Utah: a math class passed before 9th grade still leaves 3 math credits (R277-700-6(9))", () => {
  it("Secondary Math I in 8th: three more math credits in high school", () => {
    const path = real({ state: "UT", grade: 9, courses: [{ type: "math.ut_sec1", grade: 8, hsCredit: true }, { type: "ela.9", grade: 9 }, { type: "math.ut_sec2", grade: 9 }] });
    const credits = requirement(path, "ut.grad", "math.hs_credits");
    expect(credits.required).toBe(12);
    expect(credits.missing).toBe(0);
    const hsMath = path.plans[0]!.years.flatMap((y) => y.slots).filter((s) => s.kind !== "your_choice" && getCourseType(s.typeId).subject === "math");
    expect(hsMath.length).toBeGreaterThanOrEqual(3);
  });
});

describe("AP Chemistry follows a year of chemistry (generic catalogs, rigor)", () => {
  it("Texas and Utah list AP (and Utah CE) chemistry as the second-year class", () => {
    for (const state of ["TX", "UT"] as const) {
      const courses = plannerContentFor(state).genericCatalog.courses;
      expect(courses.find((c) => c.typeId === "sci.chem")!.levels, state).not.toContain("ap");
      expect(courses.find((c) => c.typeId === "sci.chem")!.levels, state).not.toContain("dual_enrollment");
      expect(courses.find((c) => c.typeId === "sci.chem2")!.levels, state).toContain("ap");
    }
  });

  it("a Texas engineering student's first chemistry isn't suggested at the AP level", () => {
    const path = real({ state: "TX", grade: 9, families: ["engineering"], colleges: [UT_AUSTIN], courses: [{ type: "math.alg1", grade: 8, hsCredit: true, letter: "A" }, { type: "ela.9", grade: 9 }, { type: "math.geom", grade: 9 }, { type: "sci.bio", grade: 9 }] });
    for (const p of path.plans) for (const s of suggestions(path, p.id).filter((x) => x.typeId === "sci.chem")) expect(s.level).not.toBe("ap");
  });
});

describe("AP Statistics comes after Algebra II (course-types.ts collegePrereqs)", () => {
  it("the college-level statistics classes need Algebra II; regular statistics needs Algebra I", () => {
    const stats = getCourseType("math.stats");
    expect(stats.prereqs.map((p) => [...p.anyOf])).toEqual([["math.alg1", "math.int1", "math.ut_sec1"]]);
    expect(stats.collegePrereqs.map((p) => [...p.anyOf])).toEqual([["math.alg2", "math.int3", "math.ut_sec3"]]);
  });

  it("no AP Statistics next to Algebra II, and the rigor reason doesn't overclaim", () => {
    const path = real({ state: "TN", grade: 10, families: ["nursing"], colleges: [UTK], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9, letter: "B" }, { type: "sci.bio", grade: 9 }, { type: "lang.es.1", grade: 9 }] });
    for (const s of suggestions(path)) {
      if (s.typeId === "math.stats" && s.level === "ap") expect(typesIn(path, s.grade)).not.toContain("math.alg2");
      expect(reasonsOf(s)).not.toMatch(/matters most for/);
    }
  });
});

describe("Recommendations from a default target, and major prep, show \"Ask your counselor\" only (optionsFor)", () => {
  it("a Utah 11th grader behind in math sees no summer, online or college-credit option for Utah State's recommendations", () => {
    const path = real({ state: "UT", grade: 11, courses: [...UT_THROUGH_10.map((c) => (c.type === "math.ut_sec2" ? { ...c, grade: 11 as const } : c)), { type: "ela.11", grade: 11 }] });
    for (const g of path.gaps.filter((x) => x.priority >= 2)) expect(g.options.map((o) => o.kind), g.text).toEqual(["ask_counselor"]);
  });
});

describe("A senior's required math credit is the class most likely to be passed (pick)", () => {
  it("a Tennessee senior on the training path missing only the 4th math isn't given precalculus", () => {
    const path = real({
      state: "TN",
      grade: 12,
      path: "training",
      families: ["construction_trades"],
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_hist", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "health.wellness", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "arts.visual", grade: 10 },
        { type: "pe.general", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "sci.env", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "ss.pfl", grade: 11 },
        { type: "ss.econ", grade: 11 },
        { type: "ela.12", grade: 12 },
        { type: "ss.us_gov", grade: 12 },
      ],
    });
    const planNow = suggestions(path).filter((s) => s.needsPlanNow);
    expect(planNow.map((s) => s.typeId)).toEqual(["math.applied.decision"]);
  });
});

describe("Career pathways have their later levels (generic catalogs)", () => {
  it("Utah and Tennessee list levels 1-3 of each cluster", () => {
    for (const state of ["UT", "TN"] as const) {
      const courses = plannerContentFor(state).genericCatalog.courses;
      const clusters = new Set(courses.flatMap((c) => (c.typeId.startsWith("cte.") && /\.\d$/.test(c.typeId) ? [c.typeId.slice(0, -2)] : [])));
      for (const cluster of clusters) for (const level of [1, 2, 3]) expect(courses.some((c) => c.typeId === `${cluster}.${level}`), `${state} ${cluster}.${level}`).toBe(true);
    }
  });
});

describe("The year in progress is a last resort (pick)", () => {
  it("a Tennessee 10th-grade nursing student in September gets no new classes in 10th while later years have room", () => {
    const path = real({
      state: "TN",
      grade: 10,
      families: ["nursing"],
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9, letter: "B" },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_hist", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "lang.es.2", grade: 10 },
      ],
    });
    expect(typesIn(path, 10)).toEqual([]);
  });
});

describe("The world-language deadline (timeline.ts)", () => {
  it("a Utah 8th grader (no state language requirement) isn't told to pick a language by 9th grade", () => {
    const path = real({ state: "UT", grade: 8, courses: [{ type: "math.ms", grade: 8 }] });
    expect(path.decisions.find((d) => d.key === "worldLanguage")?.by ?? null).toBeNull();
    expect(path.deadlines.some((d) => d.id === "decision:worldLanguage")).toBe(false);
  });

  it("a Tennessee 8th grader (two required levels) has until the start of 11th grade", () => {
    const path = real({ state: "TN", grade: 8, courses: [{ type: "math.ms", grade: 8 }] });
    expect(path.decisions.find((d) => d.key === "worldLanguage")?.by).toEqual({ grade: 11, point: "start" });
  });
});

describe("Words as the source and the state write them", () => {
  it("state terms keep their capitals in gap options and summaries", () => {
    const path = real({ state: "UT", grade: 11, courses: [...UT_THROUGH_10, { type: "ela.11", grade: 11 }] });
    expect(allGapText(path)).not.toMatch(/\(ce\)|Take One /);
    const summaries = plannerContentFor("TN").rules.flatMap((f) => f.ruleSets).map((r) => r.plainSummary);
    expect(summaries.join(" ")).not.toMatch(/is ap or ib|is cambridge/);
  });

  it("UT Austin's 4th math reads \"Strongly recommended\", its own word", () => {
    const path = real({ state: "TX", grade: 10, colleges: [UT_AUSTIN], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }] });
    expect(requirement(path, "utaustin.prereq", "math4").reasons[0].text).toMatch(/^Strongly recommended by UT Austin/);
  });
});

describe("Each plan carries its own audit, gaps, dates and questions (plan.ts)", () => {
  it("X-1 with the opt-in: Plan B (calculus by 12th) has no calculus gap", () => {
    const path = planned(plan(x1CalcInfeasible({ accelerate: true })));
    const [a, b] = path.plans;
    expect(a!.gaps.some((g) => g.demandId === "prep:engineering/math.CALC")).toBe(true);
    expect(b!.gaps.some((g) => g.demandId === "prep:engineering/math.CALC")).toBe(false);
    // What counts in Plan B only counts Plan B's suggestions.
    const keysB = new Set(suggestions(path, "B").map((s) => s.key));
    for (const rs of b!.audit) for (const r of rs.requirements) for (const c of r.counted) if (c.ref.kind === "suggestion") expect(keysB.has(c.ref.key), `${rs.ruleSetId}/${r.reqId}`).toBe(true);
    // The path's own fields are Plan A's.
    expect(path.gaps).toEqual(a!.gaps);
  });
});

describe("Guessed language classes (blockReason)", () => {
  it("a Texas 11th grader's guessed Spanish I and II give no language gap, and the line says the type is a guess", () => {
    const path = real({
      state: "TX",
      grade: 11,
      colleges: [TAMU],
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "lang.es.1", grade: 9, assumed: true },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "lang.es.2", grade: 10, assumed: true },
      ],
    });
    expect(allGapText(path)).not.toMatch(/language/i);
    expect(requirement(path, "tx.fhsp.grad", "lote.same").modifiers).toContain("guessed_type");
  });
});
