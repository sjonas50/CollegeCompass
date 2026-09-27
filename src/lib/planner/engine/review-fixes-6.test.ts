import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db, schema } from "@/db";
import type { CourseSubject } from "@/db/schema";
import type { PlannerState } from "../common";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import { updatePlanPrefs } from "../prefs";
import type { Req } from "../rules";
import { studentPath } from "../service";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions } from "./testing/helpers";
import { auditExactTitles } from "./testing/exact";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's sixth review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (U10, Z28, Z25, F3 ...).

const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const USU: CollegeTarget = { unitId: 230728, name: "Utah State University", state: "UT", public: true, admissionRate: 0.925, openAdmission: null };
const UOFU: CollegeTarget = { unitId: 230764, name: "University of Utah", state: "UT", public: true, admissionRate: 0.86, openAdmission: null };

type Goal = { familyId: FamilyId; because: string | null; cip6?: string | null; source?: FamilyTarget["source"] };

/** A student on the real content, with goals named as the reviewer named them. */
function real(s: Scenario, goals: Goal[] = []): PlannedPath {
  const input = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) input.targets.families = goals.map((g) => ({ familyId: g.familyId, source: g.source ?? "north_star", cip6: g.cip6 ?? null, because: g.because }));
  return planned(plan(input));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => `${g.text} :: ${g.options.map((o) => o.text).join(" | ")}`).join("\n");
const questions = (path: PlannedPath) => path.askCounselor.map((q) => q.text);

const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const ACCOUNTANT: Goal[] = [{ familyId: "business", because: "Accountants and Auditors" }];
const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const WELDER: Goal[] = [{ familyId: "manufacturing", because: "Welders, Cutters, Solderers, and Brazers" }];
const ELECTRICIAN: Goal[] = [{ familyId: "construction_trades", because: "Electricians" }];

// 1. Utah: the Secondary Math route stays in the audit ------------------------------------------------

describe("Utah: a transfer without Secondary Math I keeps the Secondary Math I-III route, never calculus alone (R277-700-6(6), fill.ts notExcluded)", () => {
  // Texas or Tennessee Algebra I and Geometry, taken before moving to Utah.
  const TRANSFER: CourseSpec[] = [
    { type: "ela.9", grade: 9, letter: "B" },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9, letter: "B" },
    { type: "ss.world_geo", grade: 9, letter: "B" },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
  ];
  const U10: Scenario = {
    state: "UT",
    grade: 10,
    courses: [...TRANSFER, { type: "pe.athletics", grade: 9 }, { type: "lang.es.1", grade: 9, letter: "B" }, { type: "lang.es.2", grade: 10 }],
  };
  const Y6: Scenario = {
    state: "UT",
    grade: 10,
    colleges: [UOFU],
    courses: [...TRANSFER, { type: "lang.es.1", grade: 9 }, { type: "pe.athletics", grade: 9 }, { type: "ss.world_hist", grade: 10 }, { type: "lang.es.2", grade: 10 }],
  };
  const Z3: Scenario = { state: "UT", grade: 10, colleges: [USU], limits: { accelerateMath: true }, courses: TRANSFER };

  it.each([
    ["U10 (accountant)", U10, ACCOUNTANT],
    ["Y6 (nurse, U of U)", Y6, NURSE],
    ["Z3 (engineer, Utah State, opted in)", Z3, ENGINEER],
  ])("%s: Secondary Math I and II ask the counselor, and the 11th-grade Secondary Math III says Utah requires it", (_label, s, goals) => {
    const path = real(s, goals);
    const ids = ruleSet(path, "ut.grad").requirements.map((r) => r.reqId);
    expect(ids).toEqual(expect.arrayContaining(["math.sec1", "math.sec2", "math.sec3"]));
    // The calculus route counts only once calculus is passed (6(10)): it isn't the route reported.
    expect(ids).not.toContain("math.calculus");
    expect(requirement(path, "ut.grad", "math.sec1").status).toBe("ask_counselor");
    expect(requirement(path, "ut.grad", "math.sec2").status).toBe("ask_counselor");
    expect(gapLines(path)).toMatch(/Secondary Math I: you've taken a class that may count the same way\. Ask your counselor whether it does here\./);
    const sec3 = suggestions(path).find((x) => x.typeId === "math.ut_sec3" && x.grade === 11)!;
    expect(reasonsOf(sec3)).toMatch(/Required by Utah: Secondary Math III\./);
  });

  it("Z29 (transfer in 11th, Algebra II now): all three Secondary Math lines ask the counselor", () => {
    const Z29: Scenario = {
      state: "UT",
      grade: 11,
      colleges: [UOFU],
      courses: [
        ...TRANSFER,
        { type: "ss.world_hist", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
      ],
    };
    const path = real(Z29, SOFTWARE);
    for (const id of ["math.sec1", "math.sec2", "math.sec3"]) expect(requirement(path, "ut.grad", id).status, id).toBe("ask_counselor");
    expect(ruleSet(path, "ut.grad").requirements.map((r) => r.reqId)).not.toContain("math.calculus");
  });

  it.each([
    ["T17 (nurse)", NURSE],
    ["Y1 (engineer)", ENGINEER],
  ])("%s: an 8th grader with Secondary Math I without high school credit sees Secondary Math I-III, and her sketch's Secondary Math II is Utah's", (_label, goals) => {
    const path = real({ state: "UT", grade: 8, courses: [{ type: "math.ut_sec1", grade: 8, letter: "B", hsCredit: false }] }, goals);
    const ids = ruleSet(path, "ut.grad").requirements.map((r) => r.reqId);
    expect(ids).toEqual(expect.arrayContaining(["math.sec1", "math.sec2", "math.sec3"]));
    expect(ids).not.toContain("math.calculus");
    const sec2 = path.middleSchool?.ninthGradeSketch?.slots.find((x): x is Suggested => x.kind === "suggested" && x.typeId === "math.ut_sec2");
    expect(sec2 && reasonsOf(sec2)).toMatch(/Expected by Utah \(rules for your class aren't published yet\): Secondary Math II\./);
  });
});

// 2. Tennessee: waived credits count only beyond the focus ----------------------------------------------

describe("Tennessee: waived world language and fine arts credits count only classes beyond the elective focus (Policy 2.103 I(16)-(18))", () => {
  const Z28C: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "pe.general", grade: 9, units: 2 },
    { type: "cte.manufacturing.1", grade: 9 },
    { type: "other.study_support", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "cte.manufacturing.2", grade: 10 },
    { type: "arts.visual", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.earth", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "cte.manufacturing.3", grade: 11 },
    { type: "other.study_support", grade: 11 },
    { type: "ela.12", grade: 12 },
    { type: "math.applied.decision", grade: 12 },
    { type: "ss.us_gov", grade: 12, units: 2 },
    { type: "ss.econ", grade: 12, units: 2 },
    { type: "ss.pfl", grade: 12, units: 2 },
  ];
  const Z28: Scenario = { state: "TN", grade: 12, path: "training", choices: { tnElectiveFocus: "cte", tnWorldLanguageWaiver: true }, courses: Z28C };

  it("Z28: Manufacturing 1-3 meet the focus, so the waived line is short by 2 credits and needs a plan now", () => {
    const path = real(Z28, WELDER);
    expect(requirement(path, "tn.focus.cte", "focus").status).toBe("done");
    const wl = requirement(path, "tn.grad", "wl.waived");
    expect(wl.status).toBe("room_to_add");
    expect(wl.missing).toBe(8);
    expect(wl.counted).toHaveLength(0);
    expect(wl.modifiers).toContain("needs_plan_now");
    // The counselor decides which classes count: a gap with the counselor as the option, no class added.
    const gap = path.gaps.find((g) => g.id === "gap:tn.grad/wl.waived")!;
    expect(gap.text).toBe("Needs a plan now: 2 more credits that expand your elective focus (world language waived; ask your counselor which classes count).");
    expect(gap.options.map((o) => o.kind)).toEqual(["ask_counselor"]);
  });

  it("Z12: a 4th manufacturing class beyond the focus counts, and the line says 1 credit is left", () => {
    const Z12: Scenario = { ...Z28, courses: [...Z28C.filter((c) => c.type !== "other.study_support"), { type: "cte.manufacturing.4", grade: 12 }] };
    const path = real(Z12, WELDER);
    const wl = requirement(path, "tn.grad", "wl.waived");
    expect(wl.missing).toBe(4);
    expect(wl.counted).toHaveLength(1);
    expect(wl.status).not.toBe("done");
    expect(path.gaps.find((g) => g.id === "gap:tn.grad/wl.waived")?.text).toMatch(/\(1 credit left\)\.$/);
  });

  it("V12: the plan's Construction 2-3 count for the focus only; both waived lines are open, with the counselor deciding", () => {
    const V12: Scenario = {
      state: "TN",
      grade: 9,
      path: "training",
      choices: { tnElectiveFocus: "cte", tnWorldLanguageWaiver: true, tnFineArtsWaiver: true, ctePathway: { cluster: "architecture_construction" } },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "health.wellness", grade: 9 },
        { type: "cte.architecture_construction.1", grade: 9 },
      ],
    };
    const path = real(V12, ELECTRICIAN);
    const focus = requirement(path, "tn.focus.cte", "focus");
    for (const id of ["wl.waived", "arts.waived"]) {
      const r = requirement(path, "tn.grad", id);
      expect(r.status, id).toBe("room_to_add");
      expect(r.counted.filter((c) => focus.counted.some((f) => JSON.stringify(f.ref) === JSON.stringify(c.ref))), id).toHaveLength(0);
      expect(path.gaps.find((g) => g.id === `gap:tn.grad/${id}`)?.options.map((o) => o.kind), id).toEqual(["ask_counselor"]);
    }
  });

  it("an AP focus: the AP classes the focus counts don't also count as the waived credits", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        colleges: [UTK],
        choices: { tnElectiveFocus: "ap_ib", tnWorldLanguageWaiver: true },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10, level: "ap" },
          { type: "ela.11", grade: 11, level: "ap" },
          { type: "math.alg2", grade: 11 },
          { type: "ss.us_hist", grade: 11, level: "ap" },
        ],
      },
      ENGINEER,
    );
    expect(requirement(path, "tn.focus.ap-ib", "focus").missing).toBe(0);
    const wl = requirement(path, "tn.grad", "wl.waived");
    expect(wl.missing).toBe(8);
    expect(wl.status).not.toBe("done");
  });

  it("no elective focus yet: the waived line asks the counselor and counts nothing", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        choices: { tnWorldLanguageWaiver: true },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ela.10", grade: 10 },
        ],
      },
      ELECTRICIAN,
    );
    const wl = requirement(path, "tn.grad", "wl.waived");
    expect(wl.status).toBe("ask_counselor");
    expect(wl.counted).toHaveLength(0);
  });

  it("the content: every waived line names the focus it expands, citing the waiver rules", () => {
    const leavesOf = (reqs: readonly Req[]): Req[] => reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? leavesOf(r.of) : r.kind === "option" ? leavesOf([r.on, r.off]) : [r]));
    const variants = plannerContentFor("TN").rules.flatMap((f) => f.ruleSets).find((r) => r.id === "tn.grad")!.variants;
    expect(variants.length).toBeGreaterThan(1);
    for (const v of variants) {
      for (const [id, rule] of [["wl.waived", "tn-2103-i-16"], ["arts.waived", "tn-2103-i-17"]]) {
        const leaf = leavesOf(v.requirements).find((r) => r.id === id)!;
        expect(leaf.kind === "remaining_electives" && leaf.expands, `${v.id} ${id}`).toBe("focus");
        expect(leaf.cite, `${v.id} ${id}`).toEqual([rule, "tn-0520-01-03-06-waiver"]);
      }
    }
  });
});

// 3. Two goals: each plan follows its own goal's rules ------------------------------------------------

describe("Two goals: each split plan uses only its own goal's program rules (plan.ts targetSplit)", () => {
  const Z25: Scenario = {
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
  };
  const GOALS: Goal[] = [...NURSE, ...ENGINEER];

  it("Z25: the nursing plan leaves out Texas A&M's engineering math and plans nursing's statistics", () => {
    const path = real(Z25, GOALS);
    expect(path.planChoice?.kind).toBe("target_split");
    const a = path.plans.find((p) => p.id === "A")!;
    expect(a.label).toBe("Plan A: prepares for registered nursing.");
    expect(a.audit.map((x) => x.ruleSetId)).not.toContain("tamu.engineering");
    expect(suggestions(path, "A").map((s) => s.typeId)).toContain("math.stats");
    expect(suggestions(path, "A").map(reasonsOf).join("\n")).not.toMatch(/Texas A&M engineering/);
    expect(a.gaps.map((g) => g.text).join("\n")).not.toMatch(/Statistics/);
    // The engineering plan keeps them.
    const b = path.plans.find((p) => p.id === "B")!;
    expect(b.audit.map((x) => x.ruleSetId)).toContain("tamu.engineering");
    // They differ in math, so it's a real choice.
    const math = (id: "A" | "B") => suggestions(path, id).filter((s) => s.typeId.startsWith("math.")).map((s) => `${s.grade}:${s.typeId}`).sort().join(",");
    expect(math("A")).not.toBe(math("B"));
  });
});

// 4 and 6. Career and technical levels -----------------------------------------------------------------

describe("Career and technical classes: typed names carry their level, and no level at or below one reached is planned (course-type-guess.ts, fill.ts)", () => {
  const cte = (name: string, grade: 9 | 10 | 11 | 12, state: PlannerState): CourseSpec => ({ type: guessCourseTypeId(name, "career_technical", state), grade, name, assumed: true });
  const CORE: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.phys", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
  ];
  const UT_CORE = CORE.map((c) => ({ ...c, type: c.type === "math.alg1" ? "math.ut_sec1" : c.type === "math.geom" ? "math.ut_sec2" : c.type === "math.alg2" ? "math.ut_sec3" : c.type }) as CourseSpec);
  const cteSuggestions = (path: PlannedPath) => suggestions(path).filter((s) => s.typeId.startsWith("cte."));

  it.each([
    ["F3 (education and training)", "public_services", ["Principles of Education and Training", "Human Growth and Development", "Instructional Practices"], "ps.cte.education", "tx.endorse.public-services"],
    ["F11 (health science)", "public_services", ["Principles of Health Science", "Health Science Theory", "Practicum in Health Science"], "ps.cte.health", "tx.endorse.public-services"],
    ["F12 (welding)", "business_industry", ["Principles of Manufacturing", "Welding I", "Welding II"], "bi.cte.manufacturing", "tx.endorse.business"],
  ] as const)("%s: a Texas junior finishing a program of study isn't given its levels again", (_label, endorsement, names, reqId, ruleSetId) => {
    const path = real({ state: "TX", grade: 11, choices: { txEndorsements: [endorsement] }, courses: [...CORE, ...names.map((n, i) => cte(n, (9 + i) as 9 | 10 | 11, "TX"))] }, NURSE);
    expect(cteSuggestions(path)).toEqual([]);
    expect(gapLines(path)).not.toMatch(/level [1-3]\. Ask your counselor about the next class/);
    // The program counts the student's own three classes.
    expect(requirement(path, ruleSetId, reqId).counted).toHaveLength(3);
  });

  it.each([
    ["D8 (Utah, Accounting 1 and 2)", "UT" as const, ["Accounting 1", "Accounting 2"]],
    ["F2 (Tennessee, Accounting I and II)", "TN" as const, ["Accounting I", "Accounting II"]],
  ])("%s: a student past the business ladder's first levels isn't sent back to an intro class", (_label, state, names) => {
    const courses = [...(state === "UT" ? UT_CORE : CORE), ...names.map((n, i) => cte(n, (10 + i) as 10 | 11, state))];
    const path = real({ state, grade: 11, courses }, ACCOUNTANT);
    expect(suggestions(path).map(reasonsOf).join("\n")).not.toMatch(/The next levels, in order, make you a completer/);
    expect(gapLines(path)).not.toMatch(/Business, marketing and finance, level [12]/);
  });

  it("V4: after Business office (level 1) and Accounting (level 2), only level 3 is still ahead", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "cte.business_office", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "cte.accounting", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
        ],
      },
      ACCOUNTANT,
    );
    const pathway = [...cteSuggestions(path).filter((s) => /The next levels, in order/.test(reasonsOf(s))).map((s) => s.typeId), ...path.gaps.filter((g) => g.id.startsWith("gap:cte:")).map((g) => g.id)];
    expect(pathway.length).toBeGreaterThan(0);
    for (const x of pathway) expect(x).toMatch(/business\.3|accounting2|cte:business\/3/);
  });
});

// 5. Guessed class kinds: one question, after the plan's own ------------------------------------------

describe("Counselor questions: guessed class kinds are one question, asked last (questions.ts)", () => {
  const typed = (cs: CourseSpec[]): CourseSpec[] => cs.map((c) => ({ ...c, assumed: true }));

  it("E2: a Tennessee junior with every class typed gets one guessed-kind question, and the district total is still asked", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        colleges: [UTK],
        choices: { tnElectiveFocus: "computer_science" },
        courses: typed([
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
          { type: "ss.us_hist", grade: 11 },
          { type: "sci.phys", grade: 11 },
        ]),
      },
      SOFTWARE,
    );
    const q = questions(path);
    const guesses = q.filter((t) => /looks? like/.test(t));
    expect(guesses).toHaveLength(1);
    expect(guesses[0]).toMatch(/^Some of my classes' kinds are guesses: they look like .+\. Do they count that way for graduation\?$/);
    expect(q[q.length - 1]).toBe(guesses[0]);
    expect(q).toContain("Does our district require more than the state's 22 credits?");
  });

  it("F5: a Utah transfer's typed math classes are one question, and the transfer question stays", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        colleges: [UOFU],
        cohort: { grade9Entry: { year: 2024, reason: "transferred" } },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, assumed: true, name: "Algebra 1" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10, assumed: true, name: "Geometry" },
          { type: "sci.chem", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11, assumed: true, name: "Algebra 2" },
        ],
      },
      SOFTWARE,
    );
    const q = questions(path);
    expect(q).toContain("I changed schools. Will the classes I finished count the same way here?");
    expect(q.filter((t) => /looks? like/.test(t)).length).toBeLessThanOrEqual(1);
    // Typed names never reach the questions: only generic titles.
    expect(q.join("\n")).not.toMatch(/Algebra 1|Algebra 2/);
  });
});

// 7. College-credit notes ---------------------------------------------------------------------------

describe("Counselor questions: a college-credit class brings up only notes about college credit, for colleges on the list (questions.ts)", () => {
  const UT11: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.ut_sec2", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "ela.11", grade: 11, level: "dual_enrollment" },
    { type: "math.ut_sec3", grade: 11 },
  ];

  it("Z4: a Utah nurse taking CE English isn't asked about Texas's nursing endorsement", () => {
    const path = real({ state: "UT", grade: 11, colleges: [UOFU], courses: UT11 }, NURSE);
    expect(questions(path).join("\n")).not.toMatch(/In Texas|How does that apply to me\?/);
  });

  it("a Tennessee nurse with UT Knoxville on the list and a dual enrollment class is asked about UT Knoxville's 45-hour note", () => {
    const TN11: CourseSpec[] = UT11.map((c) => ({ ...c, type: c.type === "math.ut_sec1" ? "math.alg1" : c.type === "math.ut_sec2" ? "math.geom" : c.type === "math.ut_sec3" ? "math.alg2" : c.type }) as CourseSpec);
    const withUtk = questions(real({ state: "TN", grade: 11, colleges: [UTK], courses: TN11 }, NURSE));
    expect(withUtk.find((t) => t.startsWith("UT Knoxville's freshman direct admission to nursing"))).toMatch(/45 dual enrollment hours.*How does that apply to me\?$/);
    expect(withUtk.join("\n")).not.toMatch(/In Texas/);
    // Without UT Knoxville on the list, its note isn't asked.
    const without = questions(real({ state: "TN", grade: 11, courses: TN11 }, NURSE));
    expect(without.join("\n")).not.toMatch(/45 dual enrollment hours/);
  });

  it("the content: the note about college credit is tagged, scoped to UT Knoxville and cited", () => {
    const nursing = plannerContentFor("TN").families!.families.find((f) => f.id === "nursing")!;
    const gate = nursing.gates.find((g) => g.id === "utk-nursing-dual-hours")!;
    expect(gate.collegeCredit).toBe(true);
    expect(gate.colleges).toEqual([221759]);
    expect(gate.cite).toContain("mp-utk-nursing-45-hours");
    expect(nursing.cautions.filter((c) => c.collegeCredit)).toEqual([]);
  });
});

// 8. Tennessee summer ---------------------------------------------------------------------------------

describe("Tennessee: a first-time class in summer is only offered to a student who opted into acceleration (Policy 2.103 I(20))", () => {
  const TN11: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "pe.general", grade: 9 },
    { type: "arts.visual", grade: 9 },
    { type: "other.study_support", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.earth", grade: 10 },
    { type: "ss.world_hist", grade: 10 },
    { type: "arts.music", grade: 10 },
    { type: "other.study_support", grade: 10 },
    { type: "other.driver_ed", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.chem", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "lang.es.1", grade: 11 },
    { type: "other.study_support", grade: 11 },
    { type: "other.other", grade: 11 },
  ];
  const transfer = (accelerateMath: boolean): Scenario => ({
    state: "TN",
    grade: 11,
    colleges: [UTK],
    cohort: { grade9Entry: { year: 2024, reason: "transferred" } },
    limits: { accelerateMath },
    courses: TN11,
  });

  it.each([
    ["Z24 (nurse)", NURSE, /Anatomy and physiology/],
    ["Y13 (engineer)", ENGINEER, /Physics/],
  ])("%s, not opted in: no first-time summer class", (_label, goals, what) => {
    const path = real(transfer(false), goals);
    expect(gapLines(path)).toMatch(what);
    expect(gapLines(path)).not.toMatch(/in summer/);
  });

  it("opted in: summer is an option again", () => {
    expect(gapLines(real(transfer(true), NURSE))).toMatch(/Take Anatomy and physiology in summer\./);
  });

  it("the content: Tennessee's summer fact is for accelerated students, quoting the rule", () => {
    const summer = plannerContentFor("TN").facts.options.find((o) => o.kind === "summer")!;
    expect(summer.firstAttemptAccelerated).toBe(true);
    expect(summer.cite).toContain("tn-2103-i-20");
  });
});

// 9. Texas default endorsement on the training path ---------------------------------------------------

describe("Texas training path: the default endorsement follows the pathway the plan places (plan.ts withDefaultEndorsement)", () => {
  const TX9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "pe.athletics", grade: 9 },
  ];

  it.each([
    ["Z21 (electrician)", [{ familyId: "construction_trades", because: "Electricians" }] as Goal[], "cte.architecture_construction."],
    ["Y28 (cosmetologist)", [{ familyId: "cosmetology", because: "Hairdressers, Hairstylists, and Cosmetologists" }] as Goal[], "cte.human_services."],
  ])("%s: Business and Industry, not Multidisciplinary Studies, and no World History for it", (_label, goals, cluster) => {
    const path = real({ state: "TX", grade: 9, path: "training", courses: TX9 }, goals);
    const ids = path.audit.map((a) => a.ruleSetId);
    expect(ids).toContain("tx.endorse.business");
    expect(ids).not.toContain("tx.endorse.multidisciplinary");
    expect(suggestions(path).map(reasonsOf).join("\n")).not.toMatch(/Multidisciplinary Studies/);
    expect(suggestions(path).some((s) => s.typeId === "ss.world_hist")).toBe(false);
    expect(suggestions(path).filter((s) => s.typeId.startsWith(cluster)).length).toBe(3);
  });
});

// 10. Utah senior-year math -----------------------------------------------------------------------------

describe("Utah: a 12th-grade math class the senior-year math check counts says so (R277-700-9(2), plan.ts slotReasons)", () => {
  it.each([
    [
      "U11 (engineer, U of U)",
      {
        state: "UT",
        grade: 10,
        colleges: [UOFU],
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
        ],
      } as Scenario,
      ENGINEER,
    ],
    [
      "Z29 (transfer, U of U)",
      {
        state: "UT",
        grade: 11,
        colleges: [UOFU],
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ],
      } as Scenario,
      SOFTWARE,
    ],
  ])("%s: the 12th-grade Precalculus names Utah's senior-year math", (_label, s, goals) => {
    const path = real(s, goals);
    expect(ruleSet(path, "ut.grad").checks.find((c) => c.checkId === "ut.grad.senior-math")?.status).toBe("ok");
    const senior = suggestions(path).filter((x) => x.grade === 12 && x.typeId.startsWith("math."));
    expect(senior).toHaveLength(1);
    expect(reasonsOf(senior[0])).toMatch(/Utah asks college-bound students to show college-ready math or take a full year of math in 12th grade\./);
  });

  it("on the training path the check doesn't apply, so the line isn't added", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        path: "training",
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
        ],
      },
      WELDER,
    );
    expect(suggestions(path).map(reasonsOf).join("\n")).not.toMatch(/asks college-bound students/);
  });
});

// Typed names through the service ----------------------------------------------------------------------

describe("F3 through studentPath: a Texas junior's typed Education and Training classes (service.ts, real guesses)", () => {
  let db: Db;
  const NOW = new Date("2026-09-25T15:00:00Z");
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("counts Human Growth and Development and Instructional Practices for the program, and adds no education level", async () => {
    const [household] = await db.insert(schema.households).values({}).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: "2010-01-15", grade: 11, gradeSchoolYear: 2026, homeState: "TX" })
      .returning({ id: schema.users.id });
    const rows: [string, CourseSubject, number][] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World Geography", "social_studies", 9],
      ["Principles of Education and Training", "career_technical", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["World History", "social_studies", 10],
      ["Human Growth and Development", "career_technical", 10],
      ["English III", "english", 11],
      ["Algebra II", "math", 11],
      ["Physics", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Instructional Practices", "career_technical", 11],
    ];
    for (const [name, subject, grade] of rows) {
      const status = grade < 11 ? "completed" : "in_progress";
      await db.insert(schema.studentCourses).values({ userId: user.id, name, subject, level: "regular", gradeLevel: grade, credits: 1, status, finalGrade: status === "completed" ? "A" : null, highSchoolCredit: true });
    }
    await updatePlanPrefs(db, user.id, { choices: { txEndorsements: ["public_services"] } }, NOW);
    const path = await studentPath(db, user.id, NOW);
    if (path.kind !== "planned") throw new Error(`expected a planned path, got ${path.kind}`);
    const result = planned(path.result);
    expect(suggestions(result).filter((s) => s.typeId.startsWith("cte.education."))).toEqual([]);
    expect(requirement(result, "tx.endorse.public-services", "ps.cte.education").counted).toHaveLength(3);
  });
});

auditExactTitles(5);
