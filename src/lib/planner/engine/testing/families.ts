import type { MajorFamiliesFile, MajorFamilyContent } from "../../content-types";
import { FAMILY_IDS, type FamilyId } from "../../families";
import { cites, header } from "./common";

// Major-prep test content: realistic entries for the families the golden scenarios use (after
// design Appendix B), minimal ones for the rest. Invented quotes; see ./common.ts.

const DETAILED: Partial<Record<FamilyId, Omit<MajorFamilyContent, "id">>> = {
  engineering: {
    summary: "Engineering majors.",
    path: "degree",
    math: { target: ["CALC"], cite: ["mp-math"] },
    sciences: ["sci.phys", "sci.chem"],
    keyCourses: [],
    rigorFirst: ["math.calc", "sci.phys"],
    ctePathways: [{ state: "TX", cluster: "engineering", name: "Engineering foundations", cite: ["mp-cte"] }],
    txEndorsement: { value: "stem", cite: ["mp-cte"] },
    gates: [{ id: "ut-calc", text: "UT Austin engineering requires calculus readiness.", evidence: "A", colleges: [228778], ruleSetId: "utaustin.calc_ready", cite: ["mp-gate"] }],
    cautions: [],
  },
  computer_data_science: {
    summary: "Computer science and data science.",
    path: "degree",
    math: { target: ["CALC"], cite: ["mp-math"] },
    sciences: ["sci.phys"],
    keyCourses: ["cs.prog2"],
    rigorFirst: ["math.calc", "cs.prog2", "sci.phys"],
    ctePathways: [],
    txEndorsement: { value: "stem", cite: ["mp-cte"] },
    gates: [{ id: "ut-cs", text: "UT Austin computer science requires calculus readiness.", evidence: "A", colleges: [228778], ruleSetId: "utaustin.calc_ready", cite: ["mp-gate"] }],
    cautions: [],
  },
  nursing: {
    summary: "Registered nursing.",
    path: "degree",
    math: { target: ["STATS"], cite: ["mp-math"] },
    sciences: ["sci.bio", "sci.chem", "sci.anat"],
    keyCourses: [],
    rigorFirst: ["sci.chem", "sci.anat", "math.stats"],
    ctePathways: [{ state: "TX", cluster: "health", name: "Nursing science", cite: ["mp-cte"] }],
    txEndorsement: { value: "public_services", cite: ["mp-cte"] },
    gates: [
      {
        id: "utk-dual-hours",
        text: "UT Knoxville nursing notes that students with 45 or more dual enrollment hours apply differently.",
        evidence: "A",
        colleges: [221759],
        collegeCredit: true,
        cite: ["mp-caution"],
      },
    ],
    cautions: [],
  },
  construction_trades: {
    summary: "Construction and building trades.",
    path: "training",
    math: { target: ["APPLIED"], cite: ["mp-math"] },
    sciences: ["sci.phys"],
    keyCourses: ["math.applied.technical"],
    rigorFirst: [],
    ctePathways: [
      { state: "TX", cluster: "architecture_construction", name: "Construction", cite: ["mp-cte"] },
      { state: "UT", cluster: "architecture_construction", name: "Construction", cite: ["mp-cte"] },
    ],
    gates: [],
    cautions: [],
  },
  math_physical_sciences: {
    summary: "Mathematics and physical sciences.",
    path: "degree",
    math: { target: ["CALC"], cite: ["mp-math"] },
    sciences: ["sci.chem", "sci.phys"],
    keyCourses: [],
    rigorFirst: ["math.calc", "sci.chem", "sci.phys"],
    ctePathways: [],
    txEndorsement: { value: "stem", cite: ["mp-cte"] },
    gates: [],
    cautions: [],
  },
  business: {
    summary: "Business, accounting and finance.",
    path: "degree",
    math: { target: ["PRECALC"], orTarget: ["STATS"], cite: ["mp-math"] },
    sciences: ["sci.bio"],
    keyCourses: ["ss.econ"],
    rigorFirst: ["math.precalc"],
    ctePathways: [],
    gates: [],
    cautions: [],
  },
};

export function testFamilies(): MajorFamiliesFile {
  return {
    ...header("test.major-prep.families", "MP"),
    citations: cites("MP", [
      ["mp-math", "§1", "math targets synthesized from program catalogs."],
      ["mp-cte", "§2", "a program of study in this cluster."],
      ["mp-gate", "§2", "a published program gate."],
      ["mp-caution", "§2", "a published program caution."],
      ["mp-default", "§2", "general preparation for this family."],
    ]),
    families: FAMILY_IDS.map((id) => {
      const detailed = DETAILED[id];
      if (detailed) return { id, ...detailed };
      return {
        id,
        summary: `Preparation for ${id.replace(/_/g, " ")}.`,
        path: "both",
        math: { target: ["ALG2+"], cite: ["mp-default"] },
        sciences: ["sci.bio"],
        keyCourses: [],
        rigorFirst: [],
        ctePathways: [],
        gates: [],
        cautions: [],
      } satisfies MajorFamilyContent;
    }),
  };
}
