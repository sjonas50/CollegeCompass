import { describe, expect, it } from "vitest";
import { plannerContentFor } from "../content";
import { getCourseType } from "../course-types";
import { plan } from "./index";
import { unverifiedQuestion } from "./questions";
import { planned, requirement, suggestions } from "./testing/helpers";
import { type Scenario, scenario } from "./testing/input";

// The engine on the real Utah, Tennessee and Texas content (the golden tests use fixture content
// with invented quotes). These are the personas the product walkthrough uses; they pin the
// integration of the engine with the content, not every class choice.

const utAustin = { unitId: 228778, name: "The University of Texas at Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };
const tamu = { unitId: 228723, name: "Texas A&M University-College Station", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const utk = { unitId: 221759, name: "The University of Tennessee-Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };

function real(s: Scenario) {
  return plan(scenario({ ...s, content: plannerContentFor(s.state!) }));
}

const TX_NINTH: Scenario = {
  state: "TX",
  grade: 9,
  families: ["computer_data_science"],
  colleges: [utAustin, tamu],
  courses: [
    { type: "math.alg1", grade: 8, hsCredit: true, letter: "A-" },
    { type: "ela.9", grade: 9, level: "honors" },
    { type: "math.geom", grade: 9, level: "honors" },
    { type: "sci.bio", grade: 9, level: "honors" },
    { type: "ss.world_geo", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "cs.principles", grade: 9 },
  ],
};

const TN_ELEVENTH: Scenario = {
  state: "TN",
  grade: 11,
  families: ["engineering"],
  colleges: [utk],
  courses: [
    { type: "ela.9", grade: 9, letter: "B+" },
    { type: "math.alg1", grade: 9, letter: "B" },
    { type: "sci.bio", grade: 9 },
    { type: "ss.world_hist", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "arts.visual", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10, letter: "B+" },
    { type: "sci.chem", grade: 10 },
    { type: "ss.us_hist", grade: 10 },
    { type: "lang.es.2", grade: 10 },
    { type: "cs.principles", grade: 10 },
    { type: "pe.fitness", grade: 10, units: 2 },
    { type: "ela.11", grade: 11 },
    { type: "math.alg2", grade: 11 },
    { type: "sci.phys", grade: 11 },
    { type: "ss.econ", grade: 11, units: 2 },
    { type: "ss.us_gov", grade: 11, units: 2 },
    { type: "ss.pfl", grade: 11, units: 2 },
  ],
};

const UT_SEVENTH: Scenario = { state: "UT", grade: 7, families: ["nursing"], courses: [{ type: "math.ms", grade: 7 }, { type: "ela.ms", grade: 7 }] };

describe("the engine on the real content", () => {
  it("plans a Texas 9th grader toward the DLA, UT Austin and Texas A&M", () => {
    const path = planned(real(TX_NINTH));
    expect(path.mode).toBe("generic");
    expect(requirement(path, "tx.dla", "dla.alg2").status).toBe("planned");
    expect(path.audit.map((a) => a.ruleSetId)).toEqual(expect.arrayContaining(["tx.fhsp.grad", "tx.dla", "utaustin.prereq", "utaustin.calc-ready", "tamu.recommended"]));
    // Algebra II on the plan by the end of 11th grade for the DLA's "on schedule" rule.
    expect(path.deadlines.some((d) => d.kind === "rule" && d.by.grade === 11 && /Algebra II/.test(d.text))).toBe(true);
    // The test-score route for UT Austin calculus readiness is shown, not assumed.
    expect(path.audit.find((a) => a.ruleSetId === "utaustin.calc-ready")?.testRoutes.length).toBeGreaterThan(0);
  });

  it("never repeats a level of a career pathway, and goes up levels in order", () => {
    const path = planned(real(TX_NINTH));
    for (const p of path.plans) {
      const cte = suggestions(path, p.id).filter((s) => getCourseType(s.typeId).ladder?.id.startsWith("cte."));
      const seen = new Set<string>();
      for (const s of cte) {
        expect(seen.has(s.typeId), `${p.id}: ${s.typeId} twice`).toBe(false);
        seen.add(s.typeId);
        const { id, rank } = getCourseType(s.typeId).ladder!;
        if (rank > 1) expect(cte.some((c) => c.typeId === `${id}.${rank - 1}` && c.grade < s.grade), `${s.typeId} after its level ${rank - 1}`).toBe(true);
      }
    }
  });

  it("counts a full-credit U.S. history and world history toward Tennessee's social studies", () => {
    const path = planned(real(TN_ELEVENTH));
    for (const req of ["ss.us_hist", "ss.world_hist", "ss.econ", "ss.gov", "ss.rest"]) expect(requirement(path, "tn.grad", req).status).toBe("done");
    expect(path.gaps.filter((g) => g.priority === 0)).toEqual([]);
    expect(path.decisions.map((d) => d.key)).toContain("tnElectiveFocus");
  });

  it("gives a Utah 7th grader the middle-school view", () => {
    const path = planned(real(UT_SEVENTH));
    expect(path.stage).toBe("middle_school");
    expect(path.plans).toEqual([]);
    expect(path.middleSchool?.stateNotes.length).toBeGreaterThan(0);
    // The class of 2032 is past what Utah has published: projected, never done.
    const grad = path.audit.find((a) => a.ruleSetId === "ut.grad")!;
    expect(grad.projected).toBe(true);
    expect(grad.requirements.every((r) => r.status !== "done")).toBe(true);
  });

  it("keeps its guarantees for every persona: the cap, capacity, locked classes, determinism", () => {
    for (const s of [TX_NINTH, TN_ELEVENTH, UT_SEVENTH, { ...TX_NINTH, limits: { maxCollegeLevelPerYear: 1 } }]) {
      const result = real(s);
      expect(real(s)).toEqual(result);
      const path = planned(result);
      const cap = s.limits?.maxCollegeLevelPerYear ?? 3;
      for (const p of path.plans) {
        for (const y of p.years) {
          expect(y.slots.filter((x) => x.kind === "suggested" && x.collegeLevel).length).toBeLessThanOrEqual(cap);
          expect(y.capacity.used).toBeLessThanOrEqual(y.capacity.classes);
        }
        const yours = p.years.flatMap((y) => y.slots.flatMap((x) => (x.kind === "yours" ? [x.courseId] : [])));
        const recorded = (s.courses ?? []).filter((c) => c.grade >= p.years[0].grade).length;
        expect(yours).toHaveLength(recorded);
      }
    }
  });

  it("asks about unconfirmed items without repeating their own advice", () => {
    expect(unverifiedQuestion("A 2025 law changed which exams count. Ask your counselor which exams you need.")).toBe(
      "A 2025 law changed which exams count. Can you check this for me?",
    );
    expect(unverifiedQuestion("It depends on the program. We plan for three; ask your counselor what your program needs.")).toBe(
      "It depends on the program. We plan for three. Can you check this for me?",
    );
    for (const s of [TX_NINTH, TN_ELEVENTH]) {
      for (const q of planned(real(s)).askCounselor) expect(q.text).not.toMatch(/ask your counselor/i);
    }
  });
});
