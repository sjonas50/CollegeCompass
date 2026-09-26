import { describe, expect, it } from "vitest";
import { plan } from "./index";
import { planned, requirement, ruleSet, suggestions, year } from "./testing/helpers";
import { p1Mia, ut1Engineering, ut2ClassOf2028, ut3OptOut, ut4LectureOnlyBio, ut5CalculusWithC, x6UtahTotals } from "./testing/scenarios";
import { planLines } from "./testing/summary";

// Golden scenarios for Utah (design §10.2, with the fixture rules in ./testing/content-ut.ts).

describe("UT-1: class of 2030, engineering, Secondary Math I in 8th", () => {
  const path = planned(plan(ut1Engineering()));

  it("climbs Secondary Math III, then precalculus, then calculus", () => {
    const math = suggestions(path)
      .filter((s) => s.typeId.startsWith("math."))
      .map((s) => [s.grade, s.typeId]);
    expect(math).toEqual([
      [10, "math.ut_sec3"],
      [11, "math.precalc"],
      [12, "math.calc"],
    ]);
    expect(path.deadlines.map((d) => d.text)).toContain("Secondary Mathematics III by the end of 10th keeps calculus in 12th open.");
    expect(planLines(path)).toMatchInlineSnapshot(`
      [
        "Your path",
        "  9: [English I (9th grade English)] | [Secondary Math II] | [Earth and space science (geology)] | [Health] | [Fitness for life (lifetime fitness)] | [Introduction to computer science (Exploring Computer Science)] (5/7)",
        "  10: Visual art | Engineering design | English II | Chemistry | American Constitutional Government and Citizenship | U.S. history | Secondary Math III (7/7)",
        "  11: English III | Physics (AP) | Personal financial literacy | World or European history | Psychology | Precalculus | Spanish I | Your choice (6/7)",
        "  12: Visual art | English IV | Fitness for life | Fitness for life | Calculus (AP) | Spanish II (5/7)",
      ]
    `);
  });

  it("places the new citizenship course no earlier than 2027-28", () => {
    const acgc = suggestions(path).find((s) => s.typeId === "ss.ut_acgc")!;
    expect(year(path, acgc.grade).schoolYear).toBeGreaterThanOrEqual(2027);
    expect(requirement(path, "ut.grad", "digital").status).toBe("done");
    expect(["done", "planned"]).toContain(requirement(path, "ut.grad", "finlit").status);
  });

  it("shows the Opportunity Scholarship course part as projected, never on track, and never adds a class for it", () => {
    const op = ruleSet(path, "ut.opportunity");
    expect(op.projected).toBe(true);
    for (const r of op.requirements) {
      expect(r.modifiers).toContain("projected");
      expect(["done", "planned"]).not.toContain(r.status);
    }
    expect(suggestions(path).some((s) => s.reasons.some((r) => r.ruleSetId === "ut.opportunity"))).toBe(false);
  });
});

describe("UT-2: class of 2028", () => {
  it("uses 3.0 social studies with U.S. Government and 5.5 elective credits", () => {
    const path = planned(plan(ut2ClassOf2028()));
    const grad = ruleSet(path, "ut.grad");
    expect(grad.variantId).toBe("ut.grad.2027");
    expect(grad.requirements.map((r) => r.reqId)).toContain("ss.gov");
    expect(grad.requirements.map((r) => r.reqId)).not.toContain("ss.acgc");
    expect(requirement(path, "ut.grad", "electives").required).toBe(22);
  });
});

describe("UT-3: the parent opted out of Secondary Math III", () => {
  const path = planned(plan(ut3OptOut()));

  it("never suggests Secondary Math III, counts an applied math, and shows the state's warning", () => {
    expect(suggestions(path).some((s) => s.typeId === "math.ut_sec3")).toBe(false);
    const third = requirement(path, "ut.grad", "math.oo.third");
    expect(["done", "planned"]).toContain(third.status);
    expect(ruleSet(path, "ut.grad").warnings.map((w) => w.id)).toContain("optout");
    expect(path.askCounselor.map((q) => q.text)).toContain("If I use the Secondary Math III opt-out, will Utah State still admit me?");
  });

  it("asks for a senior year of math unless the competency is recorded", () => {
    expect(ruleSet(path, "ut.grad").checks.find((c) => c.kind === "senior_year_math")?.status).toBe("ok");
    expect(suggestions(path).some((s) => s.grade === 12 && s.typeId.startsWith("math."))).toBe(true);
    const met = planned(plan(ut3OptOut(true)));
    expect(ruleSet(met, "ut.grad").checks.find((c) => c.kind === "senior_year_math")?.text).toMatch(/competency/);
  });
});

describe("UT-4: lecture-only concurrent enrollment biology", () => {
  const path = planned(plan(ut4LectureOnlyBio()));

  it("doesn't count it as the foundation biology credit and says so on the class", () => {
    const bioSlot = path.plans[0]!.years.flatMap((y) => y.slots).find((s) => s.kind === "yours" && s.typeId === "sci.bio");
    expect(bioSlot).toBeUndefined(); // taken in 10th, before the plan's years
    const found = ruleSet(path, "ut.grad").requirements.filter((r) => r.reqId.startsWith("sci.f."));
    expect(found.map((r) => r.reqId)).not.toContain("sci.f.bio");
    expect(path.askCounselor.map((q) => q.text)).toContain("My Biology class is listed without a lab. Will it count as a lab science?");
  });

  it("warns on a planned lecture-only class", () => {
    const input = ut4LectureOnlyBio();
    input.courses.push({ ...input.courses.find((c) => c.typeId === "sci.bio")!, id: "bio12", grade: 12, schoolYear: 2028, status: "planned", finalGrade: null });
    const slot = planned(plan(input)).plans[0]!.years.find((y) => y.grade === 12)!.slots.find((s) => s.kind === "yours" && s.courseId === "bio12");
    expect(slot?.kind === "yours" && slot.warnings.map((w) => w.kind)).toContain("conflict");
  });
});

describe("UT-5: calculus with a C in 11th", () => {
  it("covers math through the calculus alternative, with no Secondary Math suggested", () => {
    const path = planned(plan(ut5CalculusWithC()));
    const calc = requirement(path, "ut.grad", "math.calc_c");
    expect(calc.status).toBe("done");
    expect(suggestions(path).some((s) => s.typeId.startsWith("math.ut_sec"))).toBe(false);
  });
});

describe("X-6: generic mode in Utah", () => {
  it("never shows the state minimum total as Done", () => {
    const path = planned(plan(x6UtahTotals()));
    expect(path.mode).toBe("generic");
    const total = requirement(path, "ut.grad", "total");
    expect(total.firm + total.planned).toBeGreaterThanOrEqual(total.required);
    expect(total.status).toBe("ask_counselor");
    expect(path.askCounselor.map((q) => q.text)).toContain("Does our district require more than the state's 24 credits?");
  });
});

describe("P1 (Mia): grade 7, Utah, nursing", () => {
  const path = planned(plan(p1Mia()));

  it("shows only the middle-school view: the math card, state notes, exploration and a 9th-grade sketch", () => {
    expect(path.stage).toBe("middle_school");
    expect(path.plans).toEqual([]);
    expect(path.gaps).toEqual([]);
    const ms = path.middleSchool!;
    // Utah's own name for the first high school math class.
    expect(ms.mathPlacement.text).toMatch(/Secondary Mathematics I in 8th leaves room for calculus by 12th/);
    expect(ms.stateNotes[0].text).toMatch(/Utah gives high school math credit before 9th grade only in a few cases/);
    expect(ms.exploration.length).toBeGreaterThan(0);
    expect(ms.ninthGradeSketch?.grade).toBe(9);
    const sketch = ms.ninthGradeSketch!.slots.filter((s) => s.kind === "suggested");
    expect(sketch.length).toBeGreaterThan(0);
    expect(sketch.every((s) => s.kind === "suggested" && !s.collegeLevel && s.catalogCourseId === null)).toBe(true);
  });
});
