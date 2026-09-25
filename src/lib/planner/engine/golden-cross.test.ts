import { describe, expect, it } from "vitest";
import { comingLaterNote } from "../copy";
import { plan } from "./index";
import { expectNeutralLabels, planned, requirement, suggestions, year } from "./testing/helpers";
import { p6Ohio, p7Move, x1CalcInfeasible, x2Cap, x3SeniorMissingCredit, x4TwoGoals, x5PrereqCycle } from "./testing/scenarios";

// Cross-state golden scenarios (design §10.2 X-1 to X-5, P6, P7).

describe("X-1: grade 10, Algebra I in 9th, a calculus target", () => {
  it("is infeasible at one math class a year: summer, the lower target, or ask", () => {
    const path = planned(plan(x1CalcInfeasible()));
    const gap = path.gaps.find((g) => g.demandId === "prep:engineering/math.CALC")!;
    expect(gap.kind).toBe("ladder_infeasible");
    expect(gap.text).toBe("Calculus by the end of 12th grade would take more than one math class a year from here.");
    expect(gap.options.map((o) => o.kind)).toEqual(["summer", "lower_target", "ask_counselor"]);
    expect(gap.options[1]?.closes).toBe("calculus in your first college year instead");
    expect(path.planChoice).toBeNull();
  });

  it("doesn't offer doubling up without the opt-in and a B or better", () => {
    const noOptIn = planned(plan(x1CalcInfeasible()));
    expect(noOptIn.gaps.flatMap((g) => g.options.map((o) => o.kind))).not.toContain("double_up");
    const lowGrade = planned(plan(x1CalcInfeasible({ accelerate: true, letter: "B-" })));
    expect(lowGrade.planChoice).toBeNull();
    expect(lowGrade.gaps.flatMap((g) => g.options.map((o) => o.kind))).not.toContain("double_up");
  });

  it("with the opt-in and a B or better, adds a math-route Plan B labeled by what differs", () => {
    const path = planned(plan(x1CalcInfeasible({ accelerate: true })));
    expect(path.planChoice?.kind).toBe("math_route");
    expect(path.plans).toHaveLength(2);
    expect(path.plans.map((p) => p.label)).toEqual(["Plan A: one math class a year.", "Plan B: calculus by the end of 12th grade, adds a summer class."]);
    expectNeutralLabels(path);
    const b = suggestions(path, "B");
    expect(b.some((s) => s.term === "summer" && s.typeId.startsWith("math."))).toBe(true);
    expect(b.some((s) => s.typeId === "math.calc")).toBe(true);
  });
});

describe("X-2: a cap of 2, and the student's own classes make 4 college-level classes in 11th", () => {
  const path = planned(plan(x2Cap()));

  it("suggests nothing college-level in that year and warns softly", () => {
    const eleven = year(path, 11);
    expect(eleven.load.cap).toBe(2);
    expect(eleven.load.collegeLevel).toBe(4);
    expect(eleven.load.warning).toBe(true);
    expect(suggestions(path).filter((s) => s.grade === 11 && s.collegeLevel)).toEqual([]);
  });

  it("never goes past the cap in any year", () => {
    for (const y of path.plans[0]!.years) {
      const suggested = y.slots.filter((s) => s.kind === "suggested" && s.collegeLevel).length;
      if (suggested > 0) expect(y.load.collegeLevel).toBeLessThanOrEqual(y.load.cap);
    }
  });
});

describe("X-3: a senior missing a required credit", () => {
  it("places it now and flags it", () => {
    const path = planned(plan(x3SeniorMissingCredit()));
    const gov = suggestions(path).find((s) => s.typeId === "ss.us_gov")!;
    expect(gov.grade).toBe(12);
    expect(gov.needsPlanNow).toBe(true);
    expect(requirement(path, "tx.fhsp.grad", "ss.us_gov").modifiers).toContain("needs_plan_now");
    // No rigor or admission extras in the senior year.
    expect(suggestions(path).every((s) => s.priority === 0)).toBe(true);
  });
});

describe("X-4: two north stars that don't both fit", () => {
  it("splits into two plans, one for each goal", () => {
    const path = planned(plan(x4TwoGoals()));
    expect(path.planChoice?.kind).toBe("target_split");
    expect(path.plans.map((p) => p.label)).toEqual(["Plan A: prepares for registered nursing.", "Plan B: prepares for engineering."]);
    expectNeutralLabels(path);
    expect(suggestions(path, "A").some((s) => s.typeId === "sci.anat")).toBe(true);
    expect(suggestions(path, "B").some((s) => s.typeId === "sci.phys")).toBe(true);
  });
});

describe("X-5: a school list with a prerequisite loop", () => {
  const path = planned(plan(x5PrereqCycle()));

  it("ignores the loop, plans both classes, and asks the counselor", () => {
    expect(path.mode).toBe("catalog");
    const sci = suggestions(path).filter((s) => s.typeId === "sci.chem" || s.typeId === "sci.phys");
    expect(sci.map((s) => s.title).sort()).toEqual(["Chemistry", "Physics"]);
    expect(sci.every((s) => s.catalogCourseId?.startsWith("s-"))).toBe(true);
    expect(path.askCounselor.map((q) => q.text)).toContain("The class list shows Chemistry and Physics each needing the other first. Which comes first?");
  });

  it("names the list by its status, never the school", () => {
    expect(path.builtFrom.catalogs[0].catalog.label).toBe("2026-27 list, checked by College Compass staff");
    expect(JSON.stringify(path)).not.toContain("guide-1");
  });
});

describe("P6: a student in Ohio", () => {
  it("keeps today's checklist, with a coming-later line", () => {
    expect(plan(p6Ohio())).toEqual({ mode: "no_state", homeState: "OH", comingLater: comingLaterNote("Ohio") });
  });
});

describe("P7: moved from Tennessee to Texas in 10th grade", () => {
  const path = planned(plan(p7Move()));

  it("keeps finished classes by type and follows Texas rules by the grade-9 entry year", () => {
    expect(requirement(path, "tx.fhsp.grad", "sci.bio").status).toBe("done");
    expect(path.audit.find((r) => r.ruleSetId === "tx.fhsp.grad")?.cohort).toEqual({ key: "grade9_entry_year", value: 2025 });
    expect(path.askCounselor.map((q) => q.text)).toContain("I changed schools. Will the classes I finished count the same way here?");
  });

  it("asks rather than repeating Integrated Math I as Algebra I", () => {
    expect(suggestions(path).some((s) => s.typeId === "math.alg1")).toBe(false);
    expect(requirement(path, "tx.fhsp.grad", "math.alg1").status).toBe("ask_counselor");
    const gap = path.gaps.find((g) => g.demandId === "tx.fhsp.grad/math.alg1")!;
    expect(gap.options.map((o) => o.kind)).toEqual(["ask_counselor"]);
  });
});
