import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db, schema } from "@/db";
import type { CourseSubject } from "@/db/schema";
import { addNorthStar } from "@/lib/goals";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType, isCollegeLevel } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import type { Req } from "../rules";
import { updatePlanPrefs } from "../prefs";
import { studentPath } from "../service";
import { compileVariant } from "./compile";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's fifth review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (W12, V12, W2, E9 ...).

const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
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
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const typed = (courses: CourseSpec[]): CourseSpec[] => courses.map((c) => ({ ...c, assumed: true }));
const leavesOf = (reqs: readonly Req[]): Req[] => reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? leavesOf(r.of) : r.kind === "option" ? leavesOf([r.on, r.off]) : [r]));
const ruleSetOf = (state: "UT" | "TN" | "TX", id: string) =>
  plannerContentFor(state)
    .rules.flatMap((f) => f.ruleSets)
    .find((r) => r.id === id)!;
/** The type of each class a requirement counts (the student's rows by their scenario id, suggestions by key). */
const countedTypes = (path: PlannedPath, s: Scenario, ruleSetId: string, reqId: string) =>
  requirement(path, ruleSetId, reqId).counted.map((c) =>
    c.ref.kind === "course" ? (s.courses ?? [])[Number(c.ref.courseId.slice(1)) - 1].type : suggestions(path).find((x) => x.key === (c.ref as { key: string }).key)?.typeId,
  );

const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const ELECTRICIAN: Goal[] = [{ familyId: "construction_trades", because: "Electricians" }];
const CHEF: Goal[] = [{ familyId: "culinary_hospitality", because: "Chefs and Head Cooks" }];
const WELDER: Goal[] = [{ familyId: "manufacturing", because: "Welders, Cutters, Solderers, and Brazers" }];

// 1. Tennessee computer science substitutes for one credit ---------------------------------------------

describe("Tennessee: computer science stands in for one math or one science credit, not both (Policy 2.103 I(4)(b)1, compile.ts substituteOnce)", () => {
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
    { type: "ss.us_hist", grade: 11 },
    { type: "cs.principles", grade: 11, level: "ap" },
  ];
  const W12: Scenario = { state: "TN", grade: 11, colleges: [UTK], choices: { tnElectiveFocus: "computer_science" }, courses: V17 };
  const CS = new Set(["cs.intro", "cs.principles", "cs.prog1", "cs.prog2", "cs.cyber", "cs.data_science"]);

  /** The requirements among the 4th math and the 3rd lab science that a computer science class meets. */
  const csStandIns = (path: PlannedPath, s: Scenario) => {
    const out: string[] = [];
    for (const id of ["math.fourth", "sci.third"]) if (countedTypes(path, s, "tn.grad", id).some((t) => t && CS.has(t))) out.push(id);
    return out;
  };

  it("W12: Coding I, Coding II and AP CSP stand in for at most one of the 4th math and the 3rd lab science", () => {
    const path = real(W12, SOFTWARE);
    expect(csStandIns(path, W12).length).toBeLessThanOrEqual(1);
    // The other is still open, so the 12th-grade class that meets it says Tennessee requires it.
    const physics = suggestions(path).find((s) => s.typeId === "sci.phys");
    const precalc = suggestions(path).find((s) => s.typeId === "math.precalc");
    const required = [physics, precalc].filter((s) => s && /Required by Tennessee: A (3rd lab science|4th math credit)/.test(reasonsOf(s)));
    expect(required).toHaveLength(1);
    // Its note says why computer science can't count there too.
    expect(reasonsOf(required[0]!)).toMatch(/Computer science can stand in for only one requirement, and your plan counts it for another one\./);
  });

  it("Y30: a 10th grader whose plan adds three computer science classes still has Physics or Precalculus required by Tennessee", () => {
    const Y30: Scenario = { ...W12, grade: 10, courses: [...V17.filter((c) => c.grade === 9 && !c.type.startsWith("cs.")), { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }, { type: "sci.chem", grade: 10 }, { type: "ss.world_hist", grade: 10 }] };
    const path = real(Y30, SOFTWARE);
    expect(suggestions(path).filter((s) => getCourseType(s.typeId).subject === "computer_science").length).toBeGreaterThanOrEqual(3);
    expect(csStandIns(path, Y30).length).toBeLessThanOrEqual(1);
    expect(allReasons(path)).toMatch(/Required by Tennessee: A (3rd lab science|4th math credit)/);
  });

  it("the content marks the 2024 computer science credit as one substitution, quoting the rule", () => {
    const cs = leavesOf(ruleSetOf("TN", "tn.grad").variants.find((v) => v.id === "tn.grad.2024")!.requirements).find((r) => r.id === "cs")!;
    expect(cs.kind === "credits" && cs.substituteOnce).toBe(true);
    expect(cs.kind === "credits" && cs.substitutesForOneOf).toEqual(["math.fourth", "sci.third"]);
    expect(cs.cite).toContain("tn-2103-i-4b1-only");
  });

  it("no compiled route keeps computer science as a substitute for both requirements", () => {
    const rs = ruleSetOf("TN", "tn.grad");
    const v = rs.variants.find((x) => x.id === "tn.grad.2024")!;
    const alts = compileVariant(v, { strength: rs.strength, strengthCite: rs.strengthCite }, [], {});
    expect(alts).toHaveLength(4);
    for (const alt of alts) {
      const csSub = alt.leaves.find((l) => l.id === "cs")!.subFor;
      const keeps = ["math.fourth", "sci.third"].filter((id) => {
        const leaf = alt.leaves.find((l) => l.id === id)!;
        return leaf.req.kind === "credits" && leaf.req.select.some((s) => s.substitute && s.types?.includes("cs.prog1"));
      });
      // At most one computer science substitution per route: the credit itself, or one requirement's selector.
      expect(keeps.filter((id) => id !== csSub).length + (csSub ? 1 : 0), `route ${alt.index}`).toBeLessThanOrEqual(1);
    }
  });
});

// 2. Tennessee waivers expand the focus ---------------------------------------------------------------

describe("Tennessee: waived credits expand the elective focus next to a 3-credit program (Policy 2.103 I(16)-(18), Rule 0520-01-03-.06)", () => {
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

  it("V12: no unrelated cluster is added as \"Required by Tennessee\"; the program is the student's own pathway", () => {
    const path = real(V12, ELECTRICIAN);
    const cte = suggestions(path).filter((s) => s.typeId.startsWith("cte."));
    expect(cte.map((s) => s.typeId)).toEqual(["cte.architecture_construction.2", "cte.architecture_construction.3"]);
    expect(allReasons(path)).not.toMatch(/6 credits in one career and technical program/);
    const focus = requirement(path, "tn.focus.cte", "focus");
    expect(focus.label).toBe("3 credits in one career and technical program");
    expect(focus.missing).toBe(0);
  });

  it("V12: the 3 waived credits are their own lines, worded as expanding the focus with the counselor deciding what counts", () => {
    const path = real(V12, ELECTRICIAN);
    const wl = requirement(path, "tn.grad", "wl.waived");
    const arts = requirement(path, "tn.grad", "arts.waived");
    expect(wl.label).toBe("2 more credits that expand your elective focus (world language waived; ask your counselor which classes count)");
    expect(arts.label).toBe("1 more credit that expands your elective focus (fine arts waived; ask your counselor which classes count)");
    expect(ruleSet(path, "tn.focus.cte").warnings.map((w) => w.id)).toContain("focus.waivers");
  });
});

// 3. Utah: suggestions that could stand in for each other --------------------------------------------

describe("Utah: a required credit only suggestions meet keeps its \"Required by\" line (plan.ts neededFor)", () => {
  const UT9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9, units: 2 },
    { type: "pe.fitness", grade: 9, units: 2 },
    { type: "health.health", grade: 9, units: 2 },
    { type: "cs.intro", grade: 9, units: 2 },
    { type: "arts.visual", grade: 9 },
  ];
  const UT10: CourseSpec[] = [...UT9, { type: "ela.10", grade: 10 }, { type: "math.ut_sec2", grade: 10 }, { type: "sci.bio", grade: 10 }];

  it.each([
    ["W2 (nurse, Utah State)", { state: "UT", grade: 10, colleges: [USU], courses: UT10 } as Scenario, NURSE],
    ["T5 (welder, opt-out)", { state: "UT", grade: 10, path: "training", choices: { utMath3OptOut: true }, courses: UT10 } as Scenario, WELDER],
    ["U11 (engineering, U of U)", { state: "UT", grade: 10, colleges: [UOFU], courses: UT10 } as Scenario, ENGINEER],
  ])("%s: the only planned 3rd science credit says Utah requires it", (_label, s, goals) => {
    const path = real(s, goals);
    const counted = requirement(path, "ut.grad", "sci.more").counted.filter((c) => c.ref.kind === "suggestion");
    expect(counted).toHaveLength(1);
    const carrier = suggestions(path).find((x) => x.key === (counted[0].ref as { key: string }).key)!;
    expect(reasonsOf(carrier)).toMatch(/Required by Utah: (One more science credit|Science \(two of the five)/);
  });

  it("Y6: a transfer from Texas with Biology and Chemistry: Earth science, Utah's only planned 3rd science credit, says Utah requires it", () => {
    const path = real(
      {
        state: "UT",
        grade: 10,
        colleges: [UOFU],
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
        ],
      },
      NURSE,
    );
    const earth = suggestions(path).find((s) => s.typeId === "sci.earth")!;
    expect(reasonsOf(earth)).toMatch(/Required by Utah: Science \(two of the five foundation science areas and one more science credit\)/);
    expect(reasonsOf(earth)).not.toMatch(/idea for an open slot/);
  });

  it("V33: the applied math credit that replaces Secondary Math III under the opt-out says Utah requires it", () => {
    const path = real({ state: "UT", grade: 9, path: "training", choices: { utMath3OptOut: true }, courses: [{ type: "math.ms", grade: 8, letter: "B", hsCredit: false }, ...UT9] }, CHEF);
    const finance = suggestions(path).find((s) => s.typeId === "math.applied.finance")!;
    expect(reasonsOf(finance)).toMatch(/Required by Utah: A third math credit from the state's applied list/);
  });

  it("no required (P0-P1) suggestion ever reads as an idea for an open slot", () => {
    const cases: [Scenario, Goal[]][] = [
      [{ state: "UT", grade: 10, colleges: [USU], courses: UT10 }, NURSE],
      [{ state: "UT", grade: 10, path: "training", choices: { utMath3OptOut: true }, courses: UT10 }, WELDER],
      [{ state: "UT", grade: 9, path: "training", choices: { utMath3OptOut: true }, courses: UT9 }, CHEF],
      [{ state: "UT", grade: 10, colleges: [UOFU], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }, { type: "ela.10", grade: 10 }, { type: "math.geom", grade: 10 }, { type: "sci.chem", grade: 10 }] }, NURSE],
    ];
    for (const [s, goals] of cases) {
      const path = real(s, goals);
      for (const x of suggestions(path)) if (x.priority <= 1) expect(reasonsOf(x), `${x.typeId} ${x.grade}`).not.toMatch(/idea for an open slot/);
    }
  });
});

// 4. UT Austin calculus readiness by major -----------------------------------------------------------------

describe("UT Austin's calculus readiness applies to geosciences majors (CIP 40.06) as well as whole families (context.ts gate cips)", () => {
  const TX10: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
  ];
  const E9: Scenario = { state: "TX", grade: 10, colleges: [UT_AUSTIN], choices: { txEndorsements: ["stem"] }, courses: TX10 };

  it("E9: a Geoscientists goal (math and physical sciences, CIP 40.0601) gets the gate, its December 10 test date and the tier raise", () => {
    const path = real(E9, [{ familyId: "math_physical_sciences", because: "Geoscientists, Except Hydrologists and Geographers", cip6: "40.0601" }]);
    expect(path.audit.map((a) => a.ruleSetId)).toContain("utaustin.calc-ready");
    expect(path.deadlines.some((d) => d.kind === "test" && d.id.startsWith("test:utaustin.calc-ready/"))).toBe(true);
    expect(path.builtFrom.rigor.tier).toBe("very_selective");
  });

  it("a physics major in the same family doesn't (UT Austin doesn't list it)", () => {
    const path = real(E9, [{ familyId: "math_physical_sciences", because: "Physicists", cip6: "40.0801" }]);
    expect(path.audit.map((a) => a.ruleSetId)).not.toContain("utaustin.calc-ready");
    expect(path.builtFrom.rigor.tier).toBe("admits_fewer_than_half");
  });

  it("the content names geosciences by CIP, and the raise quotes the geosciences line", () => {
    expect(ruleSetOf("TX", "utaustin.calc-ready").appliesWhen.cips).toEqual(["40.06"]);
    const raise = plannerContentFor("TX").rigor!.raises.find((r) => r.id === "ut-austin-calculus-readiness")!;
    expect(raise.cips).toEqual(["40.06"]);
    expect(raise.cite).toContain("tx-ut-calc-majors");
  });
});

describe("E9 through studentPath: a Geoscientists north star with UT Austin (service.ts, real routing)", () => {
  let db: Db;
  const NOW = new Date("2026-09-25T15:00:00Z");
  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(schema.occupations).values([
      { code: "19-2042.00", title: "Geoscientists, Except Hydrologists and Geographers", description: "Studies the earth.", jobZone: 4 },
      { code: "19-2041.00", title: "Environmental Scientists and Specialists, Including Health", description: "Protects the environment.", jobZone: 4 },
    ]);
    // Geoscientists' related majors in the NCES CIP-SOC crosswalk are geology and earth sciences (40.06).
    const geo: [string, string][] = [
      ["40.0601", "Geology/Earth Science, General"],
      ["40.0602", "Geochemistry"],
      ["40.0603", "Geophysics and Seismology"],
      ["40.0699", "Geological and Earth Sciences/Geosciences, Other"],
    ];
    await db.insert(schema.majors).values([...geo.map(([cipCode, title]) => ({ cipCode, title })), { cipCode: "03.0104", title: "Environmental Science" }]);
    await db.insert(schema.cipSocLinks).values([...geo.map(([cipCode]) => ({ cipCode, socCode: "19-2042" })), { cipCode: "03.0104", socCode: "19-2041" }]);
    await db.insert(schema.colleges).values([{ unitId: 228778, name: "The University of Texas at Austin", state: "TX", control: 1, admissionRate: 0.29 }]);
  });

  async function student(star: string): Promise<string> {
    const [household] = await db.insert(schema.households).values({}).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: "2011-01-15", grade: 10, gradeSchoolYear: 2026, homeState: "TX" })
      .returning({ id: schema.users.id });
    // Typed class names only: the planner guesses their kinds.
    const rows: [string, CourseSubject, number][] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World Geography", "social_studies", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
    ];
    for (const [name, subject, grade] of rows) {
      const status = grade < 10 ? "completed" : "in_progress";
      await db.insert(schema.studentCourses).values({ userId: user.id, name, subject, level: "regular", gradeLevel: grade, credits: 1, status, finalGrade: status === "completed" ? "A" : null, highSchoolCredit: true });
    }
    expect((await addNorthStar(db, user.id, star)).ok).toBe(true);
    const [c] = await db.select().from(schema.colleges).where(eq(schema.colleges.unitId, 228778));
    await db.insert(schema.collegeList).values({ userId: user.id, unitId: 228778, name: c.name });
    await updatePlanPrefs(db, user.id, { choices: { txEndorsements: ["stem"] } }, NOW);
    return user.id;
  }

  it.each([
    ["E9 Geoscientists", "19-2042.00"],
    ["E10 Environmental Scientists (control)", "19-2041.00"],
  ])("%s: calculus readiness is on the plan, with its December 10 test date", async (_label, star) => {
    const id = await student(star);
    const path = await studentPath(db, id, NOW);
    if (path.kind !== "planned") throw new Error(`expected a planned path, got ${path.kind}`);
    expect(path.input.targets.families.length).toBeGreaterThan(0);
    expect(path.result.audit.map((a) => a.ruleSetId)).toContain("utaustin.calc-ready");
    expect(path.result.deadlines.find((d) => d.id.startsWith("test:utaustin.calc-ready/"))?.text).toMatch(/December 10 of 12th grade/);
  });
});

// 5. Credit totals: the year in progress ---------------------------------------------------------------

describe("Credit totals count the year in progress only for its spring term (gaps.ts freeUnits)", () => {
  it("Y7: a Utah 11th grader 3 credits short with two open periods now gets a gap that says it fits only if classes are added this year", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        path: "training",
        choices: { utMath3OptOut: true },
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
          { type: "pe.skills", grade: 10, units: 2 },
          { type: "cte.architecture_construction.1", grade: 10 },
          { type: "sci.chem", grade: 10, letter: "W" },
          { type: "ela.11", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "cte.architecture_construction.2", grade: 11 },
          { type: "math.applied.finance", grade: 11 },
          { type: "pe.lifetime", grade: 11, units: 2 },
        ],
      },
      [{ familyId: "construction_trades", because: "Heating, Air Conditioning, and Refrigeration Mechanics and Installers" }],
    );
    const gap = path.gaps.find((g) => g.id === "gap:ut.grad/total")!;
    expect(gap).toBeDefined();
    expect(gap.priority).toBe(0);
    expect(gap.text).toMatch(/after this fall, and total credits needs 3 more\. That fits only if you add classes this year; ask your counselor\.$/);
  });
});

// 6. Other choices keep the route met ------------------------------------------------------------------

describe("Other choices never take a sibling of the same route (plan.ts requiredChecks)", () => {
  const TX9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "pe.athletics", grade: 9 },
  ];
  const offers = (path: PlannedPath, pred: (s: Suggested) => boolean) =>
    suggestions(path)
      .filter(pred)
      .flatMap((s) => s.alternatives.map((a) => a.typeId as CourseTypeId));

  it("Y24: a required World History in Multidisciplinary Studies offers only social studies classes", () => {
    const path = real({ state: "TX", grade: 9, choices: { txEndorsements: ["multidisciplinary"] }, courses: TX9 });
    const alts = offers(path, (s) => s.typeId === "ss.world_hist");
    expect(alts.length).toBeGreaterThan(0);
    for (const t of alts) expect(getCourseType(t).subject, t).toBe("social_studies");
  });

  it("Y24: no core class offers a class of another core subject", () => {
    const path = real({ state: "TX", grade: 9, choices: { txEndorsements: ["multidisciplinary"] }, courses: TX9 });
    for (const s of suggestions(path)) {
      const subject = getCourseType(s.typeId).subject;
      if (!["english", "math", "science", "social_studies"].includes(subject)) continue;
      for (const a of s.alternatives) expect(getCourseType(a.typeId).subject, `${s.typeId} -> ${a.typeId}`).toBe(subject);
    }
  });

  it("X12: an Arts and Humanities fine arts slot offers only fine arts", () => {
    const path = real({ state: "TX", grade: 9, choices: { txEndorsements: ["arts_humanities"] }, courses: TX9 }, [{ familyId: "visual_arts", because: "Graphic Designers" }]);
    const alts = offers(path, (s) => getCourseType(s.typeId).subject === "arts");
    expect(alts.length).toBeGreaterThan(0);
    for (const t of alts) expect(getCourseType(t).subject, t).toBe("arts");
  });
});

// 7. Guessed class kinds: the route as the plan was built -------------------------------------------------

describe("Typed class names: the audit, checks and deadlines show the route the plan was built on (audit.ts confirmedEval)", () => {
  it("E4: a senior adding Physics sees it under the 3rd lab science, and no lab science reads \"Room to add\" with \"Needs a plan now\"", () => {
    const E4: Scenario = {
      state: "TX",
      grade: 12,
      courses: typed([
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "pe.athletics", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: guessCourseTypeId("Integrated Physics and Chemistry", "science"), grade: 10, name: "Integrated Physics and Chemistry" },
        { type: "ss.world_hist", grade: 10 },
        { type: "lang.es.2", grade: 10 },
        { type: "arts.visual", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "ela.12", grade: 12 },
      ]),
    };
    const path = real(E4);
    const physics = suggestions(path).find((s) => s.typeId === "sci.phys")!;
    expect(reasonsOf(physics)).toMatch(/Required by Texas: A 3rd lab science/);
    expect(countedTypes(path, E4, "tx.fhsp.grad", "sci.third")).toEqual(["sci.phys"]);
    for (const id of ["sci.bio", "sci.physical", "sci.third"]) {
      const r = requirement(path, "tx.fhsp.grad", id);
      expect(r.status === "room_to_add" && r.modifiers.includes("needs_plan_now"), id).toBe(false);
    }
    // The typed IPC waits for its kind to be confirmed.
    expect(requirement(path, "tx.fhsp.grad", "sci.physical").modifiers).toContain("guessed_type");
  });

  it("D1: a typed \"Algebra 2\" taken now isn't an Algebra II deadline, and the DLA check says the plan counts a guess", () => {
    const path = real(
      {
        state: "TX",
        grade: 11,
        choices: { txEndorsements: ["stem"] },
        courses: typed([
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: guessCourseTypeId("Algebra 2", "math"), grade: 11, name: "Algebra 2" },
          { type: "sci.phys", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ]),
      },
      ENGINEER,
    );
    expect(path.deadlines.map((d) => d.text).join("\n")).not.toMatch(/Algebra II on your plan by the end of 11th grade/);
    const check = ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on-schedule")!;
    expect(check.status).toBe("ok");
    expect(check.text).toMatch(/counts a class whose kind we guessed/);
  });

  it("D7: a STEM 10th grader with a typed IPC keeps the 4th science planned (the route the plan was built on)", () => {
    const path = real(
      {
        state: "TX",
        grade: 10,
        colleges: [UT_AUSTIN],
        choices: { txEndorsements: ["stem"] },
        courses: typed([
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: guessCourseTypeId("Integrated Physics and Chemistry", "science"), grade: 9, name: "Integrated Physics and Chemistry" },
          { type: "ss.world_geo", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.bio", grade: 10 },
        ]),
      },
      ENGINEER,
    );
    for (const [rs, id] of [
      ["tx.endorse.stem", "e.science4"],
      ["tx.dla", "dla.science4"],
    ]) {
      const r = requirement(path, rs, id);
      expect(r.status, `${rs}/${id}`).not.toBe("room_to_add");
      expect(r.counted.length, `${rs}/${id}`).toBeGreaterThan(0);
    }
  });
});

// 8. Diploma-vs-admission conflicts with typed names ------------------------------------------------------

describe("Typed class names raise diploma-vs-admission questions only for real substitutions (audit.ts admissionConflicts)", () => {
  const questions = (path: PlannedPath) => path.askCounselor.map((q) => q.text).join("\n");

  it("D8: Utah State counts a typed Secondary Math I like the diploma does", () => {
    const path = real(
      {
        state: "UT",
        grade: 11,
        colleges: [USU],
        courses: typed([
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "ss.world_geo", grade: 9, units: 2 },
          { type: "ela.10", grade: 10 },
          { type: "math.ut_sec2", grade: 10 },
          { type: "sci.bio", grade: 10 },
          { type: "ss.world_hist", grade: 10, units: 2 },
          { type: "ela.11", grade: 11 },
          { type: "math.ut_sec3", grade: 11 },
          { type: "sci.chem", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
        ]),
      },
      NURSE,
    );
    expect(questions(path)).not.toMatch(/Will Utah State University count it that way for admission/);
    expect(ruleSet(path, "ut.grad").requirements.flatMap((r) => r.conflicts)).toEqual([]);
  });

  it("E2: UT Knoxville is asked about the computer science 4th math, not a typed World History", () => {
    const path = real(
      {
        state: "TN",
        grade: 11,
        colleges: [UTK],
        courses: typed([
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "lang.es.2", grade: 11 },
        ]),
      },
      NURSE,
    );
    expect(questions(path)).not.toMatch(/World or European history as a social studies credit/);
    const conflicts = ruleSet(path, "tn.grad").requirements.filter((r) => r.conflicts.length).map((r) => r.reqId);
    expect(conflicts.every((id) => id === "math.fourth" || id === "sci.third" || id === "arts.credit")).toBe(true);
  });
});

// 9. Texas Business and Industry programs ----------------------------------------------------------------

describe("Texas Business and Industry: the goal's program from TEA's programs of study, and never one that wouldn't count (generic-catalog.json, fill.ts runFill)", () => {
  const TX9: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "pe.athletics", grade: 9 },
  ];
  const Y29: Scenario = { state: "TX", grade: 9, path: "training", choices: { txEndorsements: ["business_industry"] }, courses: TX9 };

  it("Y29: a welder's named Business and Industry endorsement is planned with the manufacturing (welding) program", () => {
    const path = real(Y29, WELDER);
    const cte = suggestions(path).filter((s) => s.typeId.startsWith("cte."));
    expect(cte.map((s) => s.typeId)).toEqual(["cte.manufacturing.1", "cte.manufacturing.2", "cte.manufacturing.3"]);
    expect(requirement(path, "tx.endorse.business", "bi.cte.manufacturing").missing).toBe(0);
    expect(ruleSet(path, "tx.endorse.business").checks.filter((c) => c.kind === "counts_unless" && c.status === "ask_counselor")).toEqual([]);
  });

  it("a goal whose pathway is a conditional program still gets a Business and Industry program that counts", () => {
    const path = real(Y29, [{ familyId: "engineering_tech", because: "Mechanical Engineering Technologists and Technicians" }]);
    const bi = ruleSet(path, "tx.endorse.business");
    expect(bi.checks.filter((c) => c.kind === "counts_unless" && c.status === "ask_counselor")).toEqual([]);
    expect(bi.requirements.map((r) => r.reqId)).not.toContain("bi.cte.engineering");
    expect(bi.requirements.find((r) => r.reqId.startsWith("bi.cte."))?.missing).toBe(0);
  });

  it("the content: Texas's generic list has manufacturing, arts/AV and human services levels, citing TEA's programs of study", () => {
    const content = plannerContentFor("TX").genericCatalog;
    for (const cluster of ["manufacturing", "arts_av", "human_services"]) {
      const rows = content.courses.filter((c) => c.typeId.startsWith(`cte.${cluster}.`));
      expect(rows.map((r) => r.typeId), cluster).toEqual([1, 2, 3].map((n) => `cte.${cluster}.${n}`));
      for (const r of rows) expect(r.cite?.some((c) => c.startsWith("tx-pos-")), r.typeId).toBe(true);
    }
    const quotes = content.citations.filter((c) => c.id.endsWith("-bi")).map((c) => c.quote);
    for (const q of quotes) expect(q).toMatch(/will fulfill requirements of the Business and Industry endorsement\.$/);
  });
});

// 10-13. Smaller fixes -------------------------------------------------------------------------------------

describe("Smaller fixes from the fifth review", () => {
  it("Y12: a senior's Spanish II doesn't ask for 10th grade, which is past", () => {
    const path = real({
      state: "TN",
      grade: 12,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "health.wellness", grade: 9 },
        { type: "lang.es.1", grade: 9, letter: "D" },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.alg2", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "ela.12", grade: 12 },
      ],
    });
    const spanish = suggestions(path).find((s) => s.typeId === "lang.es.2")!;
    expect(spanish.needsPlanNow).toBe(true);
    expect(reasonsOf(spanish)).not.toMatch(/There's a year without/);
  });

  it("Utah's note about math before 9th grade shows only to a student who took high school math before 9th grade", () => {
    const note = /A math class passed before 9th grade still leaves 3 math credits/;
    const UT9: CourseSpec[] = [
      { type: "ela.9", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_geo", grade: 9, units: 2 },
    ];
    const none = real({ state: "UT", grade: 9, courses: [{ type: "math.ms", grade: 8, hsCredit: false }, { type: "math.ut_sec1", grade: 9 }, ...UT9] }, ENGINEER);
    expect(allReasons(none)).not.toMatch(note);
    expect(requirement(none, "ut.grad", "math.hs_credits").reasons.map((r) => r.text).join(" ")).not.toMatch(note);
    const early = real({ state: "UT", grade: 9, courses: [{ type: "math.ut_sec1", grade: 8, hsCredit: true }, { type: "math.ut_sec2", grade: 9 }, ...UT9] }, ENGINEER);
    expect(requirement(early, "ut.grad", "math.hs_credits").reasons.map((r) => r.text).join(" ")).toMatch(note);
  });

  it("W6, Y32: a retake's Other choices are never AP or college classes", () => {
    const W6 = real({
      state: "UT",
      grade: 11,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.ut_sec1", grade: 9 },
        { type: "sci.earth", grade: 9 },
        { type: "ela.10", grade: 10, letter: "F" },
        { type: "math.ut_sec2", grade: 10 },
        { type: "sci.bio", grade: 10 },
        { type: "ela.11", grade: 11 },
        { type: "math.ut_sec3", grade: 11 },
      ],
    });
    const Y32 = real({
      state: "TX",
      grade: 12,
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "ela.10", grade: 10 },
        { type: "math.geom", grade: 10 },
        { type: "sci.chem", grade: 10 },
        { type: "ss.world_hist", grade: 10 },
        { type: "ela.11", grade: 11, letter: "F" },
        { type: "math.alg2", grade: 11 },
        { type: "sci.phys", grade: 11 },
        { type: "ss.us_hist", grade: 11 },
        { type: "ela.12", grade: 12 },
      ],
    });
    for (const [path, retake] of [
      [W6, "ela.10"],
      [Y32, "ela.11"],
    ] as const) {
      const slot = suggestions(path).find((s) => s.typeId === retake)!;
      expect(reasonsOf(slot)).toMatch(/Plans change/);
      for (const a of slot.alternatives) expect(isCollegeLevel(a.level), `${retake} -> ${a.typeId} ${a.level}`).toBe(false);
    }
  });

  it("Y24: English IV names Multidisciplinary Studies' core route once", () => {
    const path = real({
      state: "TX",
      grade: 9,
      choices: { txEndorsements: ["multidisciplinary"] },
      courses: [
        { type: "ela.9", grade: 9 },
        { type: "math.alg1", grade: 9 },
        { type: "sci.bio", grade: 9 },
        { type: "ss.world_geo", grade: 9 },
        { type: "lang.es.1", grade: 9 },
        { type: "pe.athletics", grade: 9 },
      ],
    });
    const english4 = suggestions(path).find((s) => s.typeId === "ela.12")!;
    const lines = english4.reasons.map((r) => r.text);
    expect(lines.filter((t) => /one way: four credits in each core subject/.test(t))).toHaveLength(1);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("the whole plan's reasons never repeat a line on one class", () => {
    for (const path of [
      real({ state: "TX", grade: 10, choices: { txEndorsements: ["multidisciplinary"] }, courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] }),
      real({ state: "UT", grade: 10, colleges: [USU], courses: [{ type: "ela.9", grade: 9 }, { type: "math.ut_sec1", grade: 9 }, { type: "sci.earth", grade: 9 }] }, NURSE),
    ]) {
      for (const s of suggestions(path)) {
        const lines = s.reasons.map((r) => r.text);
        expect(new Set(lines).size, `${s.typeId} ${s.grade}`).toBe(lines.length);
      }
    }
  });
});
