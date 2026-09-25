import { describe, expect, it } from "vitest";
import { DRAFT_BANNER, LOAD_WARNING, STANDING_PLAN_NOTE, TX_ALGEBRA_2_NOTE, TX_DLA_DEFAULT_NOTE } from "../copy";
import { REVIEW_LABELS } from "../review";
import { plan } from "./index";
import { allText, expectNeutralLabels, planned, requirement, ruleSet, suggestions, typesIn, year } from "./testing/helpers";
import { COLLEGES, scenario } from "./testing/input";
import { p3Sam, p4Ana, tx1WorkedExample, tx2Entry2025, tx3NoAlgebra2, tx4ArtsSwap, tx5DropEndorsement } from "./testing/scenarios";
import { planLines } from "./testing/summary";

// Golden scenarios for Texas (design §10.2, with the fixture rules in ./testing/content-tx.ts).

describe("TX-1: the design's worked example (§5.13)", () => {
  const path = planned(plan(tx1WorkedExample()));

  it("plans 10th to 12th like the worked example, with one plan and no Plan B", () => {
    expect(path.mode).toBe("generic");
    expect(path.stage).toBe("high_school");
    expect(path.planChoice).toBeNull();
    expect(path.plans).toHaveLength(1);
    expect(typesIn(path, 10)).toEqual(expect.arrayContaining(["math.alg2", "sci.chem", "lang.es.2", "ela.10"]));
    expect(typesIn(path, 11)).toEqual(expect.arrayContaining(["math.precalc", "sci.phys", "ela.11"]));
    expect(typesIn(path, 12)).toEqual(expect.arrayContaining(["math.calc", "ss.us_gov", "ss.pfl", "ela.12"]));
    expect(planLines(path)).toMatchInlineSnapshot(`
      [
        "Your path",
        "  9: [English I (9th grade English)] | [Geometry] | [Biology] | [World or human geography] | [Spanish I] | [Computer programming 1 (Computer Science I, Coding I)] | [School athletics (a sports season)] (6.5/7)",
        "  10: Visual art | English II (H) | Chemistry (H) | U.S. history | Spanish II | Algebra II (H) | Your choice (6/7)",
        "  11: Computer programming 2 or AP Computer Science A (AP) | English III (H) | School athletics | Physics (AP) | Environmental science or ecology | Precalculus (H) | Your choice (5.5/7)",
        "  12: English IV (H) | U.S. government | Personal financial literacy | Calculus (AP) (3/7)",
      ]
    `);
  });

  it("keeps the student's own classes exactly as entered", () => {
    const nine = year(path, 9);
    expect(nine.slots.filter((s) => s.kind === "yours")).toHaveLength(7);
    expect(nine.slots.some((s) => s.kind === "suggested")).toBe(false);
  });

  it("shows the by-when strip: Algebra II and precalculus with zero slack, the DLA, and the December 10 test date", () => {
    const texts = path.deadlines.map((d) => d.text);
    expect(texts).toContain("Algebra II by the end of 10th keeps calculus in 12th open.");
    expect(texts).toContain("Precalculus by the end of 11th keeps calculus in 12th open.");
    expect(path.deadlines.find((d) => d.kind === "rule")?.text).toMatch(/Algebra II on your plan by the end of 11th grade, for Distinguished Level of Achievement/);
    const test = path.deadlines.find((d) => d.kind === "test");
    expect(test?.by).toEqual({ grade: 12, point: "date", month: 12, day: 10 });
    expect(path.deadlines.map((d) => d.by.grade)).toEqual([...path.deadlines.map((d) => d.by.grade)].sort((a, b) => a - b));
  });

  it("offers calculus readiness by test score first, and a class route only as an option", () => {
    const gap = path.gaps.find((g) => g.demandId === "utaustin.calc_ready/cr.calc");
    expect(gap?.kind).toBe("ladder_infeasible");
    expect(gap?.options.map((o) => o.kind)).toEqual(["test_score", "summer", "ask_counselor"]);
    expect(gap?.options[0].text).toMatch(/SAT Math score of 620/);
  });

  it("counts AP Computer Science A for both math and language, with the recording note (§74.11(n))", () => {
    const stem = ruleSet(path, "tx.endorse.stem");
    const csa = stem.requirements.find((r) => r.reqId === "end.math4.csa");
    expect(csa?.status).toBe("planned");
    expect(csa?.reasons.some((r) => r.text.includes("Ask how your school records it."))).toBe(true);
  });

  it("explains every suggestion, and Spanish II counts for Texas, UT Austin and Texas A&M at once", () => {
    for (const s of suggestions(path)) {
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.reasons.some((r) => r.citations.length > 0)).toBe(true);
    }
    const spanish = suggestions(path).find((s) => s.typeId === "lang.es.2")!;
    expect(new Set(spanish.reasons.map((r) => r.ruleSetId))).toEqual(new Set(["tx.fhsp.grad", "utaustin.prereq", "tamu.recommended"]));
    const alg2 = suggestions(path).find((s) => s.typeId === "math.alg2")!;
    expect(alg2.reasons.map((r) => r.text)).toContain(TX_ALGEBRA_2_NOTE);
  });

  it("aims at the DLA by default on the degree path, as the course route", () => {
    expect(path.demands.some((d) => d.reasons.some((r) => r.text === TX_DLA_DEFAULT_NOTE))).toBe(true);
    expect(ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on_schedule")?.status).toBe("ok");
  });

  it("judges rigor against the colleges, one step up for the calculus gate, without counting AP classes", () => {
    expect(path.builtFrom.rigor.tier).toBe("very_selective");
    expect(year(path, 11).load.collegeLevel).toBeLessThanOrEqual(3);
    expect(allText(path)).not.toMatch(/rigor score|AP count/i);
  });

  it("labels drafts and the standing note, and resolves every citation", () => {
    expect(path.notices.draft).toBe(DRAFT_BANNER);
    expect(path.notices.standing).toBe(STANDING_PLAN_NOTE);
    expect(path.notices.review.every((n) => n.label === REVIEW_LABELS.draft)).toBe(true);
    const cited = new Set<string>();
    JSON.stringify(path, (key, value) => {
      if (key === "citations" && Array.isArray(value)) for (const c of value) cited.add(c);
      return value;
    });
    for (const id of cited) expect(path.citations[id]?.quote).toMatch(/^Fixture: /);
  });
});

describe("TX-2: started 9th grade in 2025", () => {
  const path = planned(plan(tx2Entry2025()));

  it("uses the Economics variant", () => {
    const fhsp = ruleSet(path, "tx.fhsp.grad");
    expect(fhsp.variantId).toBe("tx.fhsp.grad.2022");
    expect(fhsp.requirements.map((r) => r.reqId)).toContain("ss.econ");
    expect(fhsp.requirements.map((r) => r.reqId)).not.toContain("ss.pfl");
  });

  it("counts Math Models for the Foundation's 3rd math, never for the endorsement's 4th", () => {
    const models = path.plans[0]!.years.flatMap((y) => y.slots).find((s) => s.kind === "yours" && s.typeId === "math.applied.models");
    expect(models?.kind).toBe("yours");
    const courseId = models?.kind === "yours" ? models.courseId : "";
    const third = requirement(path, "tx.fhsp.grad", "math.third");
    expect(third.counted.some((c) => c.ref.kind === "course" && c.ref.courseId === courseId)).toBe(true);
    const fourth = requirement(path, "tx.endorse.multi", "end.math4.listb");
    expect(fourth.counted.some((c) => c.ref.kind === "course" && c.ref.courseId === courseId)).toBe(false);
  });
});

describe("TX-3: no Algebra II by the end of 11th", () => {
  const path = planned(plan(tx3NoAlgebra2()));

  it("closes the DLA's course route but keeps the test route open", () => {
    expect(ruleSet(path, "tx.dla").checks.find((c) => c.checkId === "dla.on_schedule")?.status).not.toBe("ok");
    const gap = path.gaps.find((g) => g.demandId === "tx.dla/dla.alg2")!;
    expect(gap.options[0].kind).toBe("test_score");
    expect(gap.reasons.map((r) => r.text)).toContain(TX_ALGEBRA_2_NOTE);
  });

  it("never says Algebra II decides the TEXAS Grant or TEOG", () => {
    expect(allText(path)).not.toMatch(/no TEXAS Grant|no TEOG|not eligible/i);
  });
});

describe("TX-4: Arts and Humanities with the parent's 4th-science swap", () => {
  it("uses the swap branch", () => {
    const path = planned(plan(tx4ArtsSwap()));
    const ids = ruleSet(path, "tx.endorse.ah").requirements.map((r) => r.reqId);
    expect(ids).toContain("ah.sci4.swap");
    expect(ids).not.toContain("ah.sci4.lab");
  });
});

describe("TX-5: a 10th grader asks to graduate with no endorsement", () => {
  const path = planned(plan(tx5DropEndorsement()));

  it("isn't allowed before the end of 10th, needs the parent's written permission, and rules out the DLA", () => {
    const check = ruleSet(path, "tx.fhsp.grad").checks.find((c) => c.kind === "no_endorsement_after")!;
    expect(check.status).toBe("ask_counselor");
    expect(check.text).toMatch(/until after 10th grade/);
    expect(check.text).toMatch(/parent's written permission/);
    expect(check.text).toMatch(/rules out the Distinguished Level of Achievement/);
    expect(path.audit.map((r) => r.ruleSetId)).not.toContain("tx.dla");
    expect(path.audit.map((r) => r.ruleSetId)).not.toContain("tx.endorse.stem");
  });
});

describe("P3 (Sam): five AP classes in 11th, UT Austin engineering", () => {
  const path = planned(plan(p3Sam()));

  it("warns about the load, with the sleep guidance, and adds no rigor", () => {
    const eleven = year(path, 11);
    expect(eleven.load.warning).toBe(true);
    expect(eleven.load.reasons.map((r) => r.text)).toContain(LOAD_WARNING);
    expect(suggestions(path).some((s) => s.reasons.some((r) => r.kind === "rigor"))).toBe(false);
    expect(suggestions(path).filter((s) => s.grade === 11 && s.collegeLevel)).toHaveLength(0);
  });

  it("shows calculus readiness by test score, by December 10, and no Plan B without opting in", () => {
    expect(path.deadlines.some((d) => d.kind === "test" && d.by.point === "date")).toBe(true);
    expect(path.planChoice).toBeNull();
    expect(path.gaps.find((g) => g.demandId === "utaustin.calc_ready/cr.calc")?.options[0].kind).toBe("test_score");
  });
});

describe("P4 (Ana): electrician, training path", () => {
  const path = planned(plan(p4Ana()));

  it("plans a CTE pathway in order as a full plan, at the open tier", () => {
    expect(path.builtFrom.rigor.tier).toBe("open");
    const cte = suggestions(path).filter((s) => s.typeId.startsWith("cte.architecture_construction."));
    expect(cte.map((s) => [s.grade, s.typeId])).toEqual([
      [11, "cte.architecture_construction.1"],
      [12, "cte.architecture_construction.2"],
    ]);
    expect(path.audit.map((r) => r.ruleSetId)).not.toContain("tx.dla");
  });

  it("uses the honest Algebra II wording", () => {
    const alg2 = suggestions(path).find((s) => s.typeId === "math.alg2")!;
    expect(alg2.reasons.map((r) => r.text)).toContain(TX_ALGEBRA_2_NOTE);
  });
});

describe("Texas endorsement not chosen yet", () => {
  it("in 8th grade, asks for it when 9th grade starts", () => {
    const path = planned(plan(scenario({ state: "TX", grade: 8, courses: [{ type: "math.alg1", grade: 8, hsCredit: true }] })));
    expect(path.stage).toBe("middle_school");
    expect(path.decisions.find((d) => d.key === "txEndorsements")?.by).toEqual({ grade: 9, point: "start" });
    expect(path.deadlines.some((d) => d.id === "decision:txEndorsements" && d.by.point === "start")).toBe(true);
  });

  it("in 9th grade, shows two endorsement plans labeled by what differs", () => {
    const path = planned(
      plan(
        scenario({
          state: "TX",
          grade: 9,
          courses: [
            { type: "ela.9", grade: 9 },
            { type: "math.alg1", grade: 9 },
            { type: "sci.bio", grade: 9 },
          ],
          families: ["nursing"],
          colleges: [COLLEGES.tamu],
        }),
      ),
    );
    expect(path.planChoice?.kind).toBe("endorsement");
    expect(path.plans.map((p) => p.label)).toEqual(["Plan A: with the STEM endorsement.", "Plan B: with the Multidisciplinary Studies endorsement."]);
    expectNeutralLabels(path);
    expect(path.audit.map((r) => r.ruleSetId)).toContain("tx.endorse.stem");
    expect(path.decisions.map((d) => d.key)).toContain("txEndorsements");
  });
});
