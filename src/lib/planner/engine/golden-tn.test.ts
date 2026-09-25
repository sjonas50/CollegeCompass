import { describe, expect, it } from "vitest";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions, typesIn } from "./testing/helpers";
import { failedClass, tn1bCsAsFourthMath, tn1Nursing, tn2Waiver, tn3FloralDesign, tn4AlgebraIn8th, tn5NoFocus } from "./testing/scenarios";
import { planLines } from "./testing/summary";

// Golden scenarios for Tennessee (design §10.2, with the fixture rules in ./testing/content-tn.ts).

describe("TN-1: started 9th grade in 2025, UT Knoxville nursing", () => {
  const path = planned(plan(tn1Nursing()));

  it("shows UT Knoxville's 16 units as strongly encouraged, in its own words", () => {
    const utk = ruleSet(path, "utk.core16");
    expect(utk.strength).toBe("strongly_encouraged");
    expect(utk.requirements[0].reasons[0].text).toMatch(/^Strongly encouraged by UT Knoxville/);
  });

  it("includes the computer science credit for 2024-25 entry and later", () => {
    expect(ruleSet(path, "tn.grad").variantId).toBe("tn.grad.2024");
    expect(requirement(path, "tn.grad", "cs").status).toBe("planned");
  });

  it("plans the STATS target and the nursing sciences, with honors before any AP", () => {
    const all = suggestions(path).map((s) => s.typeId);
    expect(all).toEqual(expect.arrayContaining(["math.stats", "sci.chem", "sci.anat"]));
    const chem = suggestions(path).find((s) => s.typeId === "sci.chem")!;
    expect(chem.level).toBe("honors");
    expect(chem.reasons.some((r) => r.kind === "rigor")).toBe(true);
    expect(planLines(path)).toMatchInlineSnapshot(`
      [
        "Your path",
        "  10: Visual art | English II | Geometry | Spanish II (4/7)",
        "  11: Visual art | Computer programming 1 | English III | Physical education | Algebra II | Statistics (AP) | Chemistry (H) | Personal financial literacy (7/7)",
        "  12: Visual art | English IV | Anatomy and physiology | U.S. government | Economics | U.S. history | Spanish III (6/7)",
      ]
    `);
  });
});

describe("TN-1b: computer science as the 4th math, aiming at UT Knoxville", () => {
  const path = planned(plan(tn1bCsAsFourthMath()));

  it("counts it for the diploma and flags that UT Knoxville may not", () => {
    const fourth = requirement(path, "tn.grad", "math.fourth");
    expect(fourth.status).not.toBe("room_to_add");
    expect(fourth.conflicts.map((c) => c.admission.ruleSetId)).toContain("utk.core16");
    expect(fourth.conflicts[0].text).toBe("This counts for your diploma, but UT Knoxville may not count it. Ask your counselor.");
    expect(path.askCounselor.map((q) => q.text)).toContain("My plan counts Computer programming 1 as a math credit for my diploma. Will UT Knoxville count it that way for admission?");
  });
});

describe("TN-2: world language waived, UT Chattanooga and UT Martin on the list", () => {
  const path = planned(plan(tn2Waiver()));

  it("uses the waiver branch for the diploma and warns about both colleges", () => {
    const waived = requirement(path, "tn.grad", "lang.waived");
    const notes = waived.reasons.filter((r) => r.kind === "conflict").map((r) => r.text);
    expect(notes.some((t) => t.includes("UT Chattanooga"))).toBe(true);
    expect(notes.some((t) => t.includes("UT Martin"))).toBe(true);
    expect(path.askCounselor.map((q) => q.text)).toContain("If I use the world language waiver, will UT Chattanooga still admit me?");
  });

  it("still plans the language the colleges require", () => {
    expect(suggestions(path).filter((s) => s.typeId.startsWith("lang.")).length).toBeGreaterThanOrEqual(2);
    expect(requirement(path, "utc.units", "utc.lang").status).toBe("planned");
  });
});

describe("TN-3: Floral Design as fine arts, UT Martin on the list", () => {
  const path = planned(plan(tn3FloralDesign()));

  it("covers the diploma's fine arts and flags UT Martin's arts unit", () => {
    const arts = requirement(path, "tn.grad", "arts.credit");
    expect(["done", "planned"]).toContain(arts.status);
    expect(arts.conflicts.map((c) => c.admission.ruleSetId)).toEqual(["utm.units"]);
    expect(path.askCounselor.map((q) => q.text)).toContain("My plan counts Floral design as a fine arts credit for my diploma. Will UT Martin count it that way for admission?");
  });
});

describe("TN-4: Algebra I in 8th", () => {
  const path = planned(plan(tn4AlgebraIn8th()));

  it("counts it toward credits, and still enforces math in three years of high school", () => {
    expect(requirement(path, "tn.grad", "math.alg1").status).toBe("done");
    const senior = suggestions(path).filter((s) => s.grade === 12 && s.typeId.startsWith("math."));
    expect(senior).toHaveLength(1);
    expect(senior[0].needsPlanNow).toBe(true);
    expect(ruleSet(path, "tn.grad").checks.find((c) => c.kind === "enrolled_years")?.status).toBe("ok");
  });
});

describe("TN-5: grade 10, no elective focus yet", () => {
  it("asks for the choice by the end of 10th grade", () => {
    const path = planned(plan(tn5NoFocus()));
    const decision = path.decisions.find((d) => d.key === "tnElectiveFocus");
    expect(decision?.by).toEqual({ grade: 10, point: "end" });
    expect(path.deadlines.some((d) => d.kind === "decision" && d.id === "decision:tnElectiveFocus")).toBe(true);
  });
});

describe("A failed and a withdrawn class (June, before 11th grade)", () => {
  const path = planned(plan(failedClass()));

  it("plans from the next grade in June and July", () => {
    expect(path.plans[0]!.years[0].grade).toBe(11);
  });

  it("plans the withdrawn class again: plans change, here's what still fits", () => {
    const bio = suggestions(path).find((s) => s.typeId === "sci.bio");
    expect(bio?.reasons.map((r) => r.text)).toContain("Plans change. Here's what still fits.");
    expect(requirement(path, "tn.grad", "math.alg1").status).toBe("done");
    expect(typesIn(path, 11)).not.toContain("math.alg1");
  });
});
