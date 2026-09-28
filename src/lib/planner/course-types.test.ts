import { describe, expect, it } from "vitest";
import { COURSE_LEVELS, COURSE_SUBJECTS } from "@/lib/courses/catalog";
import {
  allCourseTypes,
  CAPABILITIES,
  COURSE_LEVEL_TO_TYPE_LEVEL,
  COURSE_TYPE_IDS,
  COURSE_TYPE_LEVELS,
  type CourseType,
  type CourseTypeId,
  courseTypesForSubject,
  courseTypeTitle,
  CTE_CLUSTERS,
  getCourseType,
  isCollegeLevel,
  isCourseTypeId,
  LANGUAGES,
  ladderIds,
  ladderTypes,
  levelLabel,
  SUBJECT_FALLBACK_TYPE,
} from "./course-types";

const TYPES = allCourseTypes();

/** Types that can be taken once everything in `taken` is done. */
function takeable(type: CourseType, taken: ReadonlySet<CourseTypeId>) {
  return type.prereqs.every((p) => p.anyOf.some((id) => taken.has(id)));
}

/** Takes each type in order, failing if one's prerequisites aren't met yet. */
function takeInOrder(ids: CourseTypeId[]) {
  const taken = new Set<CourseTypeId>();
  for (const id of ids) {
    expect(takeable(getCourseType(id), taken), `${id} after ${[...taken].join(", ") || "nothing"}`).toBe(true);
    taken.add(id);
  }
}

describe("course type vocabulary", () => {
  it("has unique, well-formed ids", () => {
    expect(new Set(COURSE_TYPE_IDS).size).toBe(COURSE_TYPE_IDS.length);
    for (const id of COURSE_TYPE_IDS) expect(id).toMatch(/^[a-z]+(\.[a-z0-9_]+)+$/);
    expect(isCourseTypeId("math.alg2")).toBe(true);
    expect(isCourseTypeId("math.algebra2")).toBe(false);
  });

  it("gives every type a sane shape", () => {
    for (const t of TYPES) {
      expect(t.title.length, t.id).toBeGreaterThan(0);
      expect(COURSE_SUBJECTS, t.id).toContain(t.subject);
      expect(t.altSubjects, t.id).not.toContain(t.subject);
      expect(t.levels.length, t.id).toBeGreaterThan(0);
      for (const l of t.levels) expect(COURSE_TYPE_LEVELS, t.id).toContain(l);
      expect(Number.isInteger(t.units) && t.units >= 1 && t.units <= 8, t.id).toBe(true);
      const [from, to] = t.grades;
      expect(from >= 7 && to <= 12 && from <= to, t.id).toBe(true);
    }
  });

  it("only references types that exist", () => {
    for (const t of TYPES) for (const p of t.prereqs) for (const id of p.anyOf) expect(isCourseTypeId(id), `${t.id} needs ${id}`).toBe(true);
  });

  it("has no prerequisite cycles", () => {
    const state = new Map<CourseTypeId, "visiting" | "done">();
    const visit = (id: CourseTypeId, path: CourseTypeId[]) => {
      if (state.get(id) === "done") return;
      expect(state.get(id), `cycle: ${[...path, id].join(" -> ")}`).not.toBe("visiting");
      state.set(id, "visiting");
      for (const p of getCourseType(id).prereqs) for (const next of p.anyOf) visit(next, [...path, id]);
      state.set(id, "done");
    };
    for (const id of COURSE_TYPE_IDS) visit(id, []);
  });

  it("makes every type reachable from classes with no prerequisites", () => {
    const taken = new Set<CourseTypeId>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of TYPES) {
        if (!taken.has(t.id) && takeable(t, taken)) {
          taken.add(t.id);
          grew = true;
        }
      }
    }
    expect(COURSE_TYPE_IDS.filter((id) => !taken.has(id))).toEqual([]);
  });

  it("has a subject fallback for every subject, in that subject", () => {
    for (const subject of COURSE_SUBJECTS) expect(getCourseType(SUBJECT_FALLBACK_TYPE[subject]).subject).toBe(subject);
    const fallbacks = TYPES.filter((t) => t.fallback);
    expect(new Set(fallbacks.map((t) => t.subject)).size).toBe(fallbacks.length);
  });

  it("maps every stored level, and counts only AP, IB, Cambridge and college credit as college-level", () => {
    for (const level of COURSE_LEVELS) expect(COURSE_TYPE_LEVELS).toContain(COURSE_LEVEL_TO_TYPE_LEVEL[level]);
    expect(COURSE_TYPE_LEVELS.filter(isCollegeLevel)).toEqual(["ap", "ib", "cambridge", "dual_enrollment"]);
  });

  it("uses every capability, and only on the right subjects", () => {
    for (const cap of CAPABILITIES) expect(TYPES.some((t) => t.capabilities.includes(cap)), cap).toBe(true);
    for (const t of TYPES.filter((t) => t.capabilities.includes("alg2_or_beyond"))) expect(t.subject, t.id).toBe("math");
    for (const t of TYPES.filter((t) => t.capabilities.includes("advanced_math_after_alg2"))) {
      expect(t.capabilities, t.id).toContain("alg2_or_beyond");
    }
  });

  it("puts every CTE type in a cluster", () => {
    for (const t of TYPES) {
      const catchAll = t.id === "cte.ms" || t.id === "cte.other";
      if (t.cte !== "never" && !catchAll) expect(t.cteCluster, t.id).not.toBeNull();
      if (t.cte === "never") expect(t.cteCluster, t.id).toBeNull();
      if (t.subject === "career_technical") expect(t.cte, t.id).toBe("always");
    }
  });
});

describe("ladders", () => {
  it("has the expected ladders", () => {
    const ids = ladderIds();
    expect(ids).toContain("math");
    expect(ids).toContain("ela");
    for (const code of LANGUAGES) expect(ids).toContain(`lang.${code}`);
    for (const cluster of CTE_CLUSTERS) expect(ids).toContain(`cte.${cluster}`);
  });

  it("has no missing rungs", () => {
    for (const ladder of ladderIds()) {
      const ranks = [...new Set(ladderTypes(ladder).map((t) => t.ladder!.rank))];
      const lowest = ranks[0];
      expect(ranks, ladder).toEqual(ranks.map((_, i) => lowest + i));
    }
  });

  // Rank 0 is middle-school math and rank 1 the first high school level: both are entry points.
  // Above rank 1, a rung needs a lower rung of its own ladder (other prerequisites, like ESOL for
  // English II or Algebra I for Chemistry, may sit beside it).
  it("only points prerequisites down the ladder, and reaches every rung from the bottom", () => {
    for (const ladder of ladderIds()) {
      const onLadder = (id: CourseTypeId) => getCourseType(id).ladder?.id === ladder;
      const types = ladderTypes(ladder);
      for (const t of types) {
        const rank = t.ladder!.rank;
        for (const p of t.prereqs) {
          for (const id of p.anyOf.filter(onLadder)) expect(getCourseType(id).ladder!.rank, `${t.id} needs ${id}`).toBeLessThan(rank);
        }
        if (rank > 1) expect(t.prereqs.some((p) => p.anyOf.some(onLadder)), `${t.id} (rank ${rank}) has nothing below it on ${ladder}`).toBe(true);
      }
      const reached = new Set(types.filter((t) => t.ladder!.rank <= 1).map((t) => t.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of types) {
          if (reached.has(t.id)) continue;
          const ladderPrereqs = t.prereqs.filter((p) => p.anyOf.some(onLadder));
          if (ladderPrereqs.every((p) => p.anyOf.some((id) => reached.has(id)))) {
            reached.add(t.id);
            grew = true;
          }
        }
      }
      expect(types.filter((t) => !reached.has(t.id)).map((t) => t.id), ladder).toEqual([]);
    }
  });

  it("orders the math ladder: Algebra I, Geometry, Algebra II, Precalculus, Calculus", () => {
    const rank = (id: CourseTypeId) => getCourseType(id).ladder?.rank;
    expect(["math.alg1", "math.geom", "math.alg2", "math.precalc", "math.calc"].map((id) => rank(id as CourseTypeId))).toEqual([1, 2, 3, 4, 5]);
    expect(["math.int1", "math.int2", "math.int3"].map((id) => rank(id as CourseTypeId))).toEqual([1, 2, 3]);
    expect(["math.ut_sec1", "math.ut_sec2", "math.ut_sec3"].map((id) => rank(id as CourseTypeId))).toEqual([1, 2, 3]);
    takeInOrder(["math.alg1", "math.geom", "math.alg2", "math.precalc", "math.calc", "math.calc2"]);
    // Texas lets Algebra II come before Geometry, but precalculus needs both.
    takeInOrder(["math.alg1", "math.alg2", "math.geom", "math.precalc"]);
    expect(takeable(getCourseType("math.precalc"), new Set<CourseTypeId>(["math.alg1", "math.alg2"]))).toBe(false);
  });

  it("reaches calculus through Integrated Math and Utah's Secondary Math", () => {
    takeInOrder(["math.int1", "math.int2", "math.int3", "math.precalc", "math.calc"]);
    // College Algebra (Math 1050) alone isn't a calculus prerequisite: Math 1060 (trigonometry) is.
    takeInOrder(["math.ut_sec1", "math.ut_sec2", "math.ut_sec3", "math.college_alg", "math.trig", "math.calc"]);
    expect(takeable(getCourseType("math.calc"), new Set<CourseTypeId>(["math.ut_sec1", "math.ut_sec2", "math.ut_sec3", "math.college_alg"]))).toBe(false);
    takeInOrder(["math.ut_sec1", "math.ut_sec2", "math.ut_sec3", "math.trig", "math.calc"]);
    expect(takeable(getCourseType("math.calc"), new Set<CourseTypeId>(["math.ut_sec1", "math.ut_sec2", "math.ut_sec3"]))).toBe(false);
  });

  it("steps world languages and CTE clusters one level at a time", () => {
    takeInOrder(["lang.es.1", "lang.es.2", "lang.es.3", "lang.es.4"]);
    expect(takeable(getCourseType("lang.fr.2"), new Set<CourseTypeId>(["lang.es.1"]))).toBe(false);
    takeInOrder(["cte.health_principles", "cte.medical_terminology", "cte.nurse_aide", "cte.health.4"]);
    takeInOrder(["cte.manufacturing.1", "cte.manufacturing.2", "cte.manufacturing.3", "cte.manufacturing.4"]);
  });

  it("marks Algebra II and everything after it", () => {
    const beyond = TYPES.filter((t) => t.capabilities.includes("alg2_or_beyond")).map((t) => t.id);
    expect(beyond).toEqual(expect.arrayContaining(["math.alg2", "math.int3", "math.ut_sec3", "math.precalc", "math.calc"]));
    expect(beyond).not.toContain("math.geom");
    expect(beyond).not.toContain("math.stats");
  });
});

describe("coverage for the Utah, Tennessee and Texas rules and the 32 families", () => {
  // Types the state research and major-prep research name. If one is renamed, content breaks.
  const NEEDED: string[] = [
    // Utah graduation [UT S1, S3]
    "ela.9", "ela.10", "ela.11", "ela.12", "ela.speech", "math.ut_sec1", "math.ut_sec2", "math.ut_sec3",
    "math.applied.decision", "math.applied.finance", "math.applied.medical", "math.applied.business", "cte.accounting",
    "sci.earth", "sci.bio", "sci.chem", "sci.phys", "cs.principles", "cs.advanced", "ss.world_geo", "ss.world_hist",
    "ss.us_hist", "ss.us_gov", "ss.ut_acgc", "ss.pfl", "health.health", "pe.skills", "pe.fitness", "pe.lifetime",
    "cte.business_office", "cs.prog1", "cs.intro", "cs.web", "arts.visual", "ela.ms", "math.ms", "sci.ms", "ss.ms", "cte.ms", "cs.ms",
    // Tennessee [TN S1, S3, S6b]
    "math.alg1", "math.geom", "math.alg2", "math.int1", "math.int2", "math.int3", "math.precalc", "math.stats", "math.calc",
    "sci.ipc", "sci.env", "sci.anat", "sci.bio2", "sci.chem2", "sci.phys2", "sci.research", "ss.econ", "health.wellness", "pe.general",
    "cte.agriscience", "cte.animal_science", "cte.engineering_design", "cte.floral_design", "cte.design_foundations", "cte.landscape_design",
    "arts.media", "lang.asl.1", "lang.la.2", "cs.data_science", "cs.cyber",
    // Texas [TX S1, S2]
    "math.applied.models", "math.applied.technical", "math.applied.engineering", "math.adv_quant", "math.alg_reasoning", "math.discrete",
    "math.college_prep", "cte.digital_electronics", "cte.robotics", "sci.phys_eng", "sci.aquatic", "sci.astronomy", "sci.forensic",
    "sci.biotech", "sci.microbio", "ss.pfl_econ", "ela.esol", "ela.debate", "ela.journalism", "ela.creative_writing", "ela.research",
    "ela.humanities", "ela.professional_comm", "ela.college_prep", "arts.dance", "arts.theatre", "pe.athletics", "other.jrotc", "cs.prog2",
    // Admission patterns and the families [MP §2]
    "arts.music_theory", "arts.art_history", "arts.ensemble", "arts.music", "ss.psych", "ss.soc", "cte.cad", "cte.biomed",
    "cte.health_principles", "cte.medical_terminology", "cte.nurse_aide", "cte.emt", "math.trig", "math.college_alg", "math.calc2",
    "ela.lang_comp", "ela.lit_comp", "cte.it.1", "cte.law.2", "cte.hospitality.1", "cte.human_services.1", "cte.transportation.3",
    "cte.architecture_construction.2", "cte.education.1", "cte.manufacturing.4", "cte.arts_av.2", "cte.ag.4",
  ];

  it("has every type the rules and families need", () => {
    expect(NEEDED.filter((id) => !isCourseTypeId(id))).toEqual([]);
  });

  it("uses each state's own names and college-credit label", () => {
    expect(courseTypeTitle("math.ut_sec3", "UT")).toBe("Secondary Mathematics III");
    expect(courseTypeTitle("math.ut_sec3", null)).toBe("Secondary Math III");
    expect(courseTypeTitle("ss.us_hist", "TN")).toBe("U.S. History and Geography");
    expect(levelLabel("dual_enrollment", "UT")).toBe("Concurrent enrollment (CE)");
    expect(levelLabel("dual_enrollment", "TX")).toBe("Dual credit");
    expect(levelLabel("dual_enrollment", null)).toBe("College credit");
    expect(levelLabel("ap", "UT")).toBe("AP");
  });

  it("offers types filed under another subject in that subject's picker", () => {
    const cte = courseTypesForSubject("career_technical").map((t) => t.id);
    expect(cte).toContain("sci.anat");
    expect(cte).toContain("cte.nurse_aide");
    expect(courseTypesForSubject("math").map((t) => t.id)).toContain("cte.accounting");
  });
});
