import { describe, expect, it } from "vitest";
import type { Req } from "../rules";
import { countAlternatives, MAX_ALTERNATIVES_PER_VARIANT, variantAlternatives } from "../validate";
import { evaluateAlternative, pickAlternative } from "./allocate";
import { alternatives, item, variant } from "./testing/items";

// Allocation (design §5.5) on small, hand-checked cases, in quarter-credit units.

const credits = (id: string, units: number, select: Extract<Req, { kind: "credits" }>["select"], extra: Partial<Extract<Req, { kind: "credits" }>> = {}): Req => ({
  id,
  label: id,
  kind: "credits",
  units,
  select,
  cite: ["c"],
  ...extra,
});

function evaluate(reqs: Req[], items: ReturnType<typeof item>[], allocation: "exclusive" | "independent" = "exclusive", index = 0) {
  const alts = alternatives(variant(reqs, allocation));
  const r = evaluateAlternative(alts[index], items, allocation);
  return Object.fromEntries(r.leaves.map((l) => [l.leaf.id, l]));
}

describe("exclusive allocation", () => {
  it("fills Texas-style science: each class counts once", () => {
    const r = evaluate(
      [
        credits("bio", 4, [{ types: ["sci.bio"] }]),
        credits("second", 4, [{ types: ["sci.ipc", "sci.chem", "sci.phys"] }]),
        credits("third", 4, [{ capabilities: ["lab_science"] }]),
      ],
      [item("sci.bio"), item("sci.chem"), item("sci.phys")],
    );
    expect([r.bio.missing, r.second.missing, r.third.missing]).toEqual([0, 0, 0]);
    const keys = [...r.bio.counted, ...r.second.counted, ...r.third.counted].map((c) => c.item.key);
    expect(new Set(keys).size).toBe(3);
  });

  it("gives specific requirements first pick and broad ones the leftovers", () => {
    const r = evaluate(
      [credits("any_science", 4, [{ subjects: ["science"] }]), credits("chem", 4, [{ types: ["sci.chem"] }])],
      [item("sci.chem"), item("sci.earth")],
    );
    expect(r.chem.counted.map((c) => c.item.typeId)).toEqual(["sci.chem"]);
    expect(r.any_science.counted.map((c) => c.item.typeId)).toEqual(["sci.earth"]);
  });

  it("prefers finished classes over planned ones, so a requirement shows Done", () => {
    const r = evaluate([credits("sci", 4, [{ subjects: ["science"] }])], [item("sci.chem", { status: "planned" }), item("sci.phys", { status: "completed" })]);
    expect(r.sci.firm).toBe(4);
    expect(r.sci.planned).toBe(0);
  });

  it("counts in quarter-credit units, including a 0.25-credit class", () => {
    const r = evaluate([credits("pe", 3, [{ subjects: ["health_pe"] }])], [item("pe.general", { units: 1 }), item("pe.fitness", { units: 2 })]);
    expect(r.pe.firm).toBe(3);
    expect(r.pe.missing).toBe(0);
  });

  it("never counts F, W or I, or a class without high school credit", () => {
    const r = evaluate(
      [credits("math", 12, [{ subjects: ["math"] }])],
      [item("math.alg1", { letter: "F" }), item("math.geom", { letter: "W" }), item("math.alg2", { hsCredit: false }), item("math.precalc", { letter: "C" })],
    );
    expect(r.math.firm).toBe(4);
    expect(r.math.counted.map((c) => c.item.typeId)).toEqual(["math.precalc"]);
  });

  it("puts a class toward one requirement plus electives, unless both requirements allow splitting", () => {
    const half = (id: string, allowSplit: boolean) => credits(id, 2, [{ subjects: ["social_studies"] }], allowSplit ? { allowSplit } : {});
    const noSplit = evaluate([half("a", false), half("b", false)], [item("ss.us_hist", { units: 4 })]);
    expect(noSplit.a.missing + noSplit.b.missing).toBe(2);
    const split = evaluate([half("a", true), half("b", true)], [item("ss.us_hist", { units: 4 })]);
    expect(split.a.missing + split.b.missing).toBe(0);
  });

  it("lets the rest of a class go to electives", () => {
    const r = evaluate(
      [credits("health", 2, [{ types: ["health.health"] }]), { id: "electives", label: "Electives", kind: "remaining_electives", units: 4, cite: ["c"] }],
      [item("health.health", { units: 4 })],
    );
    expect(r.health.firm).toBe(2);
    expect(r.electives.firm).toBe(2);
  });

  it("counts a shareable requirement without using up the class (Texas §74.11(n), §74.13(g))", () => {
    const r = evaluate(
      [credits("stem.alg2", 4, [{ types: ["math.alg2"] }], { shareable: true }), credits("math", 4, [{ subjects: ["math"] }])],
      [item("math.alg2")],
    );
    expect(r["stem.alg2"].missing).toBe(0);
    expect(r.math.missing).toBe(0);
  });

  it("matches guessed class types only by subject, and flags them", () => {
    const guessed = item("sci.chem", { assumed: true });
    const r = evaluate([credits("chem", 4, [{ types: ["sci.chem"] }]), credits("sci", 4, [{ subjects: ["science"] }])], [guessed]);
    expect(r.chem.missing).toBe(4);
    expect(r.chem.guessed).toBe(true);
    expect(r.sci.missing).toBe(0);
    expect(r.sci.guessed).toBe(true);
  });

  it("doesn't count a class after a requirement's deadline grade; a summer class counts toward the next grade", () => {
    const req = credits("alg2", 4, [{ types: ["math.alg2"] }], { deadlineGrade: 11 });
    expect(evaluate([req], [item("math.alg2", { grade: 12, status: "planned" })]).alg2.missing).toBe(4);
    expect(evaluate([req], [item("math.alg2", { grade: 11, status: "planned" })]).alg2.missing).toBe(0);
    expect(evaluate([req], [item("math.alg2", { grade: 10, term: "summer", status: "planned" })]).alg2.missing).toBe(0);
    expect(evaluate([req], [item("math.alg2", { grade: 11, term: "summer", status: "planned" })]).alg2.missing).toBe(4);
  });

  it("measures a minimum letter only on finished classes", () => {
    const req = credits("calc", 4, [{ types: ["math.calc"], minLetter: "C" }]);
    expect(evaluate([req], [item("math.calc", { letter: "C" })]).calc.missing).toBe(0);
    expect(evaluate([req], [item("math.calc", { letter: "D" })]).calc.missing).toBe(4);
    expect(evaluate([req], [item("math.calc", { status: "planned" })]).calc.missing).toBe(0);
  });
});

describe("same language", () => {
  const lang = (id: string, levels: number): Req => ({ id, label: id, kind: "same_language", levels, cite: ["c"] });

  it("counts the language that gets furthest, finished levels first", () => {
    const r = evaluate([lang("lote", 2)], [item("lang.fr.1"), item("lang.es.1"), item("lang.es.2", { status: "planned" })]);
    expect(r.lote.counted.map((c) => c.item.typeId)).toEqual(["lang.es.1", "lang.es.2"]);
    expect([r.lote.firm, r.lote.planned, r.lote.missing]).toEqual([1, 1, 0]);
  });

  it("uses its classes up, so they don't also count as electives", () => {
    const r = evaluate([lang("lote", 2), { id: "electives", label: "Electives", kind: "remaining_electives", units: 8, cite: ["c"] }], [item("lang.es.1"), item("lang.es.2")]);
    expect(r.electives.firm).toBe(0);
  });

  it("lets two language requirements in one allocation share one sequence (§74.13(g))", () => {
    const r = evaluate([lang("lote", 2), lang("ah.lang4", 4)], [item("lang.es.1"), item("lang.es.2"), item("lang.es.3"), item("lang.es.4")]);
    expect(r.lote.missing).toBe(0);
    expect(r["ah.lang4"].missing).toBe(0);
  });
});

describe("independent allocation", () => {
  it("checks each requirement on its own, so a class can count for several", () => {
    const reqs = [credits("math3", 12, [{ subjects: ["math"] }]), credits("math4", 16, [{ subjects: ["math"] }], { strength: "recommended", strengthCite: "c" })];
    const items = [item("math.alg1"), item("math.geom"), item("math.alg2")];
    const r = evaluate(reqs, items, "independent");
    expect(r.math3.missing).toBe(0);
    expect(r.math4.missing).toBe(4);
  });

  it("counts courses, not credits, for a count requirement", () => {
    const r = evaluate([{ id: "ap", label: "ap", kind: "count", n: 2, select: [{ levels: ["ap"] }], cite: ["c"] }], [item("ss.econ", { level: "ap", units: 2 }), item("sci.bio", { level: "ap" })], "independent");
    expect([r.ap.firm, r.ap.missing]).toEqual([2, 0]);
  });
});

describe("compilation and alternatives", () => {
  it("expands all, any, choose and substitutions the way the validator counts them", () => {
    const reqs: Req[] = [
      {
        id: "sci",
        label: "sci",
        kind: "choose",
        n: 2,
        of: ["sci.earth", "sci.bio", "sci.chem", "sci.phys"].map((t) => credits(t, 4, [{ types: [t as "sci.bio"] }])),
      },
      { id: "lote", label: "lote", kind: "any", of: [{ id: "lang", label: "lang", kind: "same_language", levels: 2, cite: ["c"] }, credits("cs", 8, [{ subjects: ["computer_science"] }])] },
      credits("m4", 4, [{ capabilities: ["alg2_or_beyond"] }]),
      credits("csc", 4, [{ subjects: ["computer_science"] }], { substitutesForOneOf: ["m4"] }),
    ];
    const v = variant(reqs);
    expect(alternatives(v)).toHaveLength(variantAlternatives(v));
    expect(variantAlternatives(v)).toBe(6 * 2 * 2);
    expect(reqs.map(countAlternatives)).toEqual([6, 2, 1, 2]);
  });

  it("follows the family's choice for an option (waivers and opt-outs)", () => {
    const opt: Req = {
      id: "lang",
      label: "lang",
      kind: "option",
      pref: "tnWorldLanguageWaiver",
      cite: ["c"],
      on: credits("waived", 8, [{ subjects: ["career_technical"] }]),
      off: { id: "same", label: "same", kind: "same_language", levels: 2, cite: ["c"] },
    };
    expect(alternatives(variant([opt]))[0].leaves.map((l) => l.id)).toEqual(["same"]);
    const on = alternatives(variant([opt]), [], { tnWorldLanguageWaiver: true })[0].leaves;
    expect(on.map((l) => l.id)).toEqual(["waived"]);
    expect(on[0].optionPref).toBe("tnWorldLanguageWaiver");
  });

  it("joins the leaves of an extended variant, marked as not the rule set's own", () => {
    const base = variant([credits("math", 12, [{ subjects: ["math"] }])], "exclusive", "base.v");
    const ext = { ...variant([credits("math4", 4, [{ subjects: ["math"] }])], "exclusive", "ext.v"), extends: "base.v" };
    const [alt] = alternatives(ext, [base]);
    expect(alt.leaves.map((l) => [l.id, l.own])).toEqual([
      ["math", false],
      ["math4", true],
    ]);
    const r = evaluateAlternative(alt, [item("math.alg1"), item("math.geom"), item("math.alg2")], "exclusive");
    expect(r.leaves.map((l) => l.missing)).toEqual([0, 4]);
  });

  it("stops at the 256-alternative cap", () => {
    const wide: Req[] = Array.from({ length: 9 }, (_, i) => ({
      id: `g${i}`,
      label: `g${i}`,
      kind: "any" as const,
      of: [credits(`g${i}a`, 4, [{ subjects: ["math"] }]), credits(`g${i}b`, 4, [{ subjects: ["science"] }])],
    }));
    expect(alternatives(variant(wide))).toHaveLength(MAX_ALTERNATIVES_PER_VARIANT);
  });

  it("uses a Tennessee computer science credit for the 4th math only when that helps", () => {
    const reqs = [credits("m4", 4, [{ capabilities: ["alg2_or_beyond"] }]), credits("cs", 4, [{ subjects: ["computer_science"] }], { substitutesForOneOf: ["m4"] })];
    const alts = alternatives(variant(reqs));
    const withCsOnly = alts.map((a) => evaluateAlternative(a, [item("cs.prog1")], "exclusive"));
    const best = pickAlternative(withCsOnly);
    expect(best.leaves.every((l) => l.missing === 0)).toBe(true);
    expect(best.alt.leaves.find((l) => l.id === "cs")?.subFor).toBe("m4");
  });

  it("never prefers a route only college-level classes can finish", () => {
    const reqs: Req[] = [
      {
        id: "multi",
        label: "multi",
        kind: "any",
        of: [
          credits("core", 16, [{ subjects: ["science"] }]),
          { id: "adv", label: "adv", kind: "count", n: 1, select: [{ levels: ["ap", "ib", "dual_enrollment"] }], cite: ["c"] },
        ],
      },
    ];
    const results = alternatives(variant(reqs)).map((a) => evaluateAlternative(a, [item("sci.bio")], "exclusive"));
    expect(pickAlternative(results).alt.leaves[0].id).toBe("core");
  });

  it("skips an alternative that can't be finished in time", () => {
    const reqs: Req[] = [{ id: "m", label: "m", kind: "any", of: [credits("seq", 12, [{ subjects: ["math"] }]), credits("calc", 4, [{ types: ["math.calc"] }])] }];
    const results = alternatives(variant(reqs)).map((a) => evaluateAlternative(a, [], "exclusive"));
    expect(pickAlternative(results).alt.leaves[0].id).toBe("calc");
    expect(pickAlternative(results, { feasible: (r) => !r.leaves.some((l) => l.leaf.id === "calc" && l.missing > 0) }).alt.leaves[0].id).toBe("seq");
  });
});
