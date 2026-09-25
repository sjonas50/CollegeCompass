import { describe, expect, it } from "vitest";
import { getCourseType } from "../course-types";
import { fixturePlannerInput } from "../fixtures";
import { staleLabel } from "../review";
import { plan } from "./index";
import { allText, planned, requirement, ruleSet, suggestions } from "./testing/helpers";
import { COLLEGES, scenario } from "./testing/input";
import { schoolList, tn1Nursing, tx1WorkedExample, x5PrereqCycle } from "./testing/scenarios";

// plan(): modes, provenance, runtime labels, dismissals and privacy.

describe("plan()", () => {
  it("returns no_state outside the planner's states, with a coming-later line only when a state is set", () => {
    expect(plan(scenario({ state: null, homeState: "OH", grade: 10 }))).toEqual({
      mode: "no_state",
      homeState: "OH",
      comingLater: "Full class planning for Ohio is coming later. For now you'll see a general college-prep checklist.",
    });
    expect(plan(scenario({ state: null, homeState: null, grade: 10 }))).toEqual({ mode: "no_state", homeState: null, comingLater: null });
  });

  it("runs on the contracts' own fixture input", () => {
    const path = planned(plan(fixturePlannerInput()));
    expect(path.state).toBe("TX");
    expect(path.plans).toHaveLength(1);
  });

  it("has a fingerprint that changes with the input and nothing else", () => {
    const a = planned(plan(tx1WorkedExample()));
    expect(planned(plan(tx1WorkedExample())).inputsFingerprint).toBe(a.inputsFingerprint);
    const more = tx1WorkedExample();
    more.courses.push({ ...more.courses[1], id: "extra", grade: 10, status: "planned", finalGrade: null });
    expect(planned(plan(more)).inputsFingerprint).not.toBe(a.inputsFingerprint);
    const content = tx1WorkedExample();
    content.content!.rules[0].citations[0].quote = "Fixture: changed.";
    expect(planned(plan(content)).inputsFingerprint).not.toBe(a.inputsFingerprint);
  });

  it("gives every suggestion a stable, unique key and honors 'Not for me'", () => {
    const path = planned(plan(tx1WorkedExample()));
    const keys = suggestions(path).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const chem = suggestions(path).find((s) => s.typeId === "sci.chem")!;
    expect(chem.key).toMatch(/^[a-z0-9._:-]+\/[a-z0-9._-]+\/sci\.chem\/honors$/);
    const again = planned(plan(tx1WorkedExample({ dismissed: [chem.key] })));
    expect(suggestions(again).map((s) => s.key)).not.toContain(chem.key);
    expect(suggestions(again).some((s) => s.typeId === "sci.chem")).toBe(true);
  });

  it("offers other choices at the same school for the same need", () => {
    const path = planned(plan(tx1WorkedExample()));
    const chem = suggestions(path).find((s) => s.typeId === "sci.chem")!;
    expect(chem.alternatives.length).toBeGreaterThan(0);
    for (const alt of chem.alternatives) expect(alt.key).not.toBe(chem.key);
  });

  it("labels stale content at runtime and never shows it Done", () => {
    const path = planned(plan(tx1WorkedExample({ today: "2027-09-01", schoolYear: 2027, grade: 10 })));
    expect(path.notices.review.every((n) => n.stale && n.staleLabel === staleLabel(2026))).toBe(true);
    const fhsp = ruleSet(path, "tx.fhsp.grad");
    expect(fhsp.stale).toBe(true);
    for (const r of fhsp.requirements) {
      expect(r.status).not.toBe("done");
      expect(r.modifiers).toContain("stale");
    }
  });

  it("labels a cohort past the published rules as projected, never Done or Planned", () => {
    const input = tx1WorkedExample();
    input.content!.rules[0].ruleSets[0].projectedBeyond = 2025;
    const path = planned(plan(input));
    const fhsp = ruleSet(path, "tx.fhsp.grad");
    expect(fhsp.projected).toBe(true);
    expect(path.builtFrom.ruleSets.find((r) => r.id === "tx.fhsp.grad")?.projected).toBe(true);
    for (const r of fhsp.requirements) {
      expect(["done", "planned"]).not.toContain(r.status);
      expect(r.modifiers).toContain("projected");
    }
    expect(path.askCounselor.map((q) => q.text)).toContain("The Foundation High School Program rules for my class aren't final yet. Which ones apply to me?");
  });

  it("asks the counselor when a college's sources disagree, and never treats it as required", () => {
    const input = tn1Nursing();
    input.content!.rules.find((f) => f.kind === "admissions")!.ruleSets[0].confidence = "conflicting";
    const path = planned(plan(input));
    for (const r of ruleSet(path, "utk.core16").requirements) {
      expect(r.modifiers).toContain("sources_disagree");
      expect(["done", "planned"]).not.toContain(r.status);
    }
    expect(path.demands.filter((d) => d.id.startsWith("utk.core16/")).every((d) => d.priority >= 2)).toBe(true);
  });

  it("turns a confirmed school total into a requirement", () => {
    const list = { ...schoolList(), localTotalUnits: 104 };
    const path = planned(plan(scenario({ state: "TX", grade: 10, month: 7, schoolYear: 2025, catalogs: { 11: list, 12: list }, courses: [{ type: "ela.9", grade: 9 }] })));
    const local = ruleSet(path, "local.tx.total");
    expect(local.kind).toBe("local_graduation");
    expect(local.requirements[0].required).toBe(104);
    expect(requirement(path, "tx.fhsp.grad", "total").status).toBe("room_to_add");
  });

  it("lists conditions as 'We don't track this' and unverified items once", () => {
    const fhsp = ruleSet(planned(plan(tx1WorkedExample())), "tx.fhsp.grad");
    expect(fhsp.conditions.map((c) => c.id)).toEqual(["eoc", "fafsa"]);
    expect(fhsp.unverified.map((u) => u.id)).toEqual(["eoc-schedule"]);
  });

  it("keeps the school's local names to the student's own screens", () => {
    const input = x5PrereqCycle();
    for (const g of [10, 11, 12] as const) {
      for (const c of input.catalogs[g]!.courses) c.title = `${c.title} w/ Mr. Smith at Lincoln High`;
    }
    const path = planned(plan(input));
    const local = suggestions(path);
    expect(local.every((s) => s.title.includes("Lincoln High"))).toBe(true);
    for (const s of local) expect(s.genericTitle).toBe(getCourseType(s.typeId).title);
    const aiFacing = JSON.stringify({ q: path.askCounselor, d: path.demands, g: path.gaps, a: path.audit, dl: path.deadlines, b: path.builtFrom });
    expect(aiFacing).not.toMatch(/Lincoln|Smith/);
    expect(allText(path)).not.toContain(input.catalogs[11]!.id);
  });

  it("returns an empty plan for a senior in June or July (graduated)", () => {
    const path = planned(plan(scenario({ state: "UT", grade: 12, month: 7, courses: [{ type: "ela.12", grade: 12 }] })));
    expect(path.plans).toEqual([]);
    expect(path.gaps).toEqual([]);
  });

  it("sets the review label on every file the path used", () => {
    const path = planned(plan(scenario({ state: "TN", grade: 10, families: ["nursing"], colleges: [COLLEGES.utk] })));
    expect(path.notices.review.map((n) => n.fileId).sort()).toEqual(
      ["test.major-prep.families", "test.tn.admissions", "test.tn.facts", "test.tn.generic-catalog", "test.tn.graduation"].sort(),
    );
  });
});
