import type { CatalogCourse, CatalogView, PlannerInput } from "../../engine-io";
import { COLLEGES, scenario } from "./input";

// The golden scenarios (design §10.2), as inputs. golden-*.test.ts pins what each must show.

/** §5.13 worked example: Texas, class of 2030, STEM, software developer, UT Austin and Texas A&M. */
export function tx1WorkedExample(overrides: Partial<Parameters<typeof scenario>[0]> = {}): PlannerInput {
  return scenario({
    state: "TX",
    grade: 9,
    courses: [
      { type: "math.alg1", grade: 8, letter: "A-", hsCredit: true },
      { type: "ela.9", grade: 9, level: "honors" },
      { type: "math.geom", grade: 9, level: "honors" },
      { type: "sci.bio", grade: 9, level: "honors" },
      { type: "ss.world_geo", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "cs.prog1", grade: 9 },
      { type: "pe.athletics", grade: 9 },
    ],
    families: ["computer_data_science"],
    colleges: [COLLEGES.utAustin, COLLEGES.tamu],
    choices: { txEndorsements: ["stem"] },
    ...overrides,
  });
}

/** TX-2: started 9th grade in 2025 (Economics variant); Math Models counts for the FHSP, not the endorsement's 4th math. */
export function tx2Entry2025(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 11,
    schoolYear: 2026,
    cohort: { grade9Entry: { year: 2025, reason: "repeated" } },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "B" },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10, letter: "B" },
      { type: "math.applied.models", grade: 11, status: "in_progress" },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
    ],
    choices: { txEndorsements: ["multidisciplinary"], txAimDla: false },
  });
}

/** TX-3: no Algebra II by the end of 11th: the DLA course route closes; the test route stays open. */
export function tx3NoAlgebra2(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 11,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "C" },
      { type: "sci.bio", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10, letter: "C" },
      { type: "sci.ipc", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.applied.models", grade: 11 },
      { type: "sci.chem", grade: 11 },
    ],
    choices: { txEndorsements: ["multidisciplinary"] },
  });
}

/** TX-4: Arts and Humanities, with the parent's permission to swap the 4th science. */
export function tx4ArtsSwap(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "lang.fr.1", grade: 9 },
      { type: "arts.visual", grade: 9 },
    ],
    families: ["humanities"],
    choices: { txEndorsements: ["arts_humanities"], txArtsHumanitiesScienceSwap: true },
  });
}

/** TX-5: a 10th grader asks to graduate with no endorsement. */
export function tx5DropEndorsement(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
    ],
    choices: { txEndorsements: ["stem"], txFoundationOnly: true },
  });
}

/** P3 (Sam): grade 11, UT Austin engineering, five AP classes this year. */
export function p3Sam(overrides: Partial<Parameters<typeof scenario>[0]> = {}): PlannerInput {
  return scenario({
    state: "TX",
    grade: 11,
    courses: [
      { type: "math.alg1", grade: 8, hsCredit: true, letter: "A" },
      { type: "ela.9", grade: 9, level: "honors" },
      { type: "math.geom", grade: 9, level: "honors", letter: "A" },
      { type: "sci.bio", grade: 9, level: "honors" },
      { type: "ss.world_geo", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "pe.athletics", grade: 9 },
      { type: "ela.10", grade: 10, level: "honors" },
      { type: "math.alg2", grade: 10, level: "honors", letter: "A-" },
      { type: "sci.chem", grade: 10, level: "honors" },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "ss.us_hist", grade: 10, level: "ap" },
      { type: "ela.lang_comp", grade: 11, level: "ap" },
      { type: "math.precalc", grade: 11, level: "honors" },
      { type: "sci.phys", grade: 11, level: "ap" },
      { type: "ss.econ", grade: 11, level: "ap" },
      { type: "cs.prog2", grade: 11, level: "ap" },
      { type: "sci.env", grade: 11, level: "ap" },
    ],
    families: ["engineering"],
    colleges: [COLLEGES.utAustin],
    choices: { txEndorsements: ["stem"] },
    ...overrides,
  });
}

/** P4 (Ana): grade 10, Texas, electrician, training path. */
export function p4Ana(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    path: "training",
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "B-" },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "pe.fitness", grade: 9 },
    ],
    families: ["construction_trades"],
    colleges: [COLLEGES.austinCc],
  });
}

/** TN-1: started 9th grade in 2025, UT Knoxville nursing. */
export function tn1Nursing(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "A" },
      { type: "sci.bio", grade: 9, letter: "A" },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
    ],
    families: ["nursing"],
    colleges: [COLLEGES.utk],
    choices: { tnElectiveFocus: "humanities" },
  });
}

/** TN-1b: a senior with computer science as the 4th math, aiming at UT Knoxville. */
export function tn1bCsAsFourthMath(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 11,
    limits: { classesPerYear: 6 },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "pe.general", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.alg2", grade: 11 },
      { type: "sci.env", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "cs.prog1", grade: 11 },
      { type: "ss.pfl", grade: 11 },
      { type: "ss.econ", grade: 11 },
      { type: "ela.12", grade: 12, status: "planned" },
      { type: "ss.us_gov", grade: 12, status: "planned" },
      { type: "arts.ensemble", grade: 12, status: "planned" },
      { type: "cte.health_principles", grade: 12, status: "planned" },
      { type: "cte.medical_terminology", grade: 12, status: "planned" },
      { type: "cte.nurse_aide", grade: 12, status: "planned" },
      { type: "other.study_support", grade: 12, status: "planned" },
    ],
    colleges: [COLLEGES.utk],
    choices: { tnElectiveFocus: "cte" },
  });
}

/** TN-2: world language waived; UT Chattanooga and UT Martin on the list. */
export function tn2Waiver(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
    ],
    colleges: [COLLEGES.utc, COLLEGES.utm],
    choices: { tnWorldLanguageWaiver: true, tnElectiveFocus: "cte" },
  });
}

/** TN-3: Floral Design as the fine arts credit; UT Martin on the list. */
export function tn3FloralDesign(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 11,
    limits: { classesPerYear: 6 },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "sci.chem", grade: 10 },
      { type: "cte.floral_design", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "cs.prog1", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.alg2", grade: 11 },
      { type: "sci.env", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "pe.general", grade: 11 },
      { type: "cte.agriscience", grade: 11 },
      { type: "ela.12", grade: 12, status: "planned" },
      { type: "math.precalc", grade: 12, status: "planned" },
      { type: "ss.us_gov", grade: 12, status: "planned" },
      { type: "ss.econ", grade: 12, status: "planned" },
      { type: "ss.pfl", grade: 12, status: "planned" },
      { type: "cte.animal_science", grade: 12, status: "planned" },
      { type: "cte.landscape_design", grade: 12, status: "planned" },
    ],
    colleges: [COLLEGES.utm],
    choices: { tnElectiveFocus: "cte" },
  });
}

/** TN-4: Algebra I in 8th counts, and math in three years of high school is still enforced. */
export function tn4AlgebraIn8th(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 12,
    courses: [
      { type: "math.alg1", grade: 8, hsCredit: true },
      { type: "ela.9", grade: 9 },
      { type: "math.geom", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.alg2", grade: 10 },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.general", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "sci.env", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "ss.pfl", grade: 11 },
      { type: "ss.econ", grade: 11 },
      { type: "arts.ensemble", grade: 11 },
      { type: "ela.12", grade: 12 },
      { type: "ss.us_gov", grade: 12 },
      { type: "lang.es.3", grade: 12 },
      { type: "arts.ensemble", grade: 12, id: "band12" },
    ],
    choices: { tnElectiveFocus: "humanities" },
  });
}

/** TN-5: grade 10, no elective focus chosen yet. */
export function tn5NoFocus(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
    ],
  });
}

/** UT-1: class of 2030, Engineering, Secondary Math I in 8th (identified as gifted). */
export function ut1Engineering(): PlannerInput {
  return scenario({
    state: "UT",
    grade: 9,
    courses: [
      { type: "math.ut_sec1", grade: 8, hsCredit: true, letter: "A" },
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec2", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "health.health", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "cs.intro", grade: 9 },
    ],
    families: ["engineering"],
    colleges: [COLLEGES.uofu, COLLEGES.usu],
  });
}

/** UT-2: class of 2028 (3.0 social studies, 5.5 electives). */
export function ut2ClassOf2028(): PlannerInput {
  return scenario({
    state: "UT",
    grade: 11,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.health", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "cs.intro", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.ut_sec2", grade: 10 },
      { type: "sci.bio", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.skills", grade: 10 },
      { type: "lang.es.1", grade: 10 },
      { type: "cte.business_office", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.ut_sec3", grade: 11 },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "arts.ensemble", grade: 11 },
      { type: "lang.es.2", grade: 11 },
    ],
  });
}

/** UT-3: the parent opted out of Secondary Math III. */
export function ut3OptOut(competency = false): PlannerInput {
  return scenario({
    state: "UT",
    grade: 11,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.health", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "cs.intro", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.ut_sec2", grade: 10 },
      { type: "sci.bio", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.skills", grade: 10 },
      { type: "lang.es.1", grade: 10 },
      { type: "cte.business_office", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "arts.ensemble", grade: 11 },
      { type: "lang.es.2", grade: 11 },
      { type: "pe.lifetime", grade: 11 },
    ],
    colleges: [COLLEGES.usu],
    choices: { utMath3OptOut: true, utMathCompetencyMet: competency },
  });
}

/** UT-4: a lecture-only concurrent enrollment biology class. */
export function ut4LectureOnlyBio(): PlannerInput {
  return scenario({
    state: "UT",
    grade: 11,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.ut_sec1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.health", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "cs.intro", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.ut_sec2", grade: 10 },
      { type: "sci.bio", grade: 10, level: "dual_enrollment", lectureOnly: true },
      { type: "arts.visual", grade: 10 },
      { type: "pe.skills", grade: 10 },
      { type: "lang.es.1", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.ut_sec3", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "lang.es.2", grade: 11 },
      { type: "arts.ensemble", grade: 11 },
    ],
  });
}

/** UT-5: calculus with a C in 11th completes math (a student who moved in with Algebra I, then calculus). */
export function ut5CalculusWithC(): PlannerInput {
  return scenario({
    state: "UT",
    grade: 12,
    cohort: { grade9Entry: { year: 2023, reason: "transferred" } },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.earth", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.health", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "cs.intro", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.alg2", grade: 10 },
      { type: "sci.bio", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.skills", grade: 10 },
      { type: "cte.cad", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.calc", grade: 11, level: "ap", letter: "C" },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "arts.ensemble", grade: 11 },
      { type: "pe.lifetime", grade: 11 },
      { type: "ela.12", grade: 12 },
      { type: "ss.us_gov", grade: 12 },
      { type: "ss.pfl", grade: 12 },
      { type: "ss.psych", grade: 12 },
      { type: "math.stats", grade: 12, level: "ap" },
      { type: "sci.anat", grade: 12 },
    ],
  });
}

/** X-6: generic mode, Utah, a senior who has everything: total credits never show Done at the state minimum. */
export function x6UtahTotals(): PlannerInput {
  const courses: Parameters<typeof scenario>[0]["courses"] = [];
  const years = [9, 10, 11, 12] as const;
  const perYear = [
    ["ela.9", "math.ut_sec1", "sci.earth", "ss.world_hist", "arts.visual", "pe.fitness", "health.health"],
    ["ela.10", "math.ut_sec2", "sci.bio", "ss.us_hist", "arts.ensemble", "pe.skills", "cs.intro"],
    ["ela.11", "math.ut_sec3", "sci.chem", "ss.us_gov", "ss.psych", "pe.lifetime", "cte.cad"],
    ["ela.12", "math.precalc", "sci.anat", "ss.pfl", "lang.es.1", "cte.engineering_design", "arts.visual"],
  ] as const;
  years.forEach((grade, i) => perYear[i].forEach((type) => courses.push({ type, grade, status: grade === 12 ? "in_progress" : "completed" })));
  return scenario({ state: "UT", grade: 12, courses });
}

/** X-1: grade 10, Algebra I in 9th, a calculus target: infeasible at one math class a year. */
export function x1CalcInfeasible(opts: { accelerate?: boolean; letter?: "A" | "B-" } = {}): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: opts.letter ?? "A" },
      { type: "sci.bio", grade: 9 },
    ],
    families: ["engineering"],
    choices: { txEndorsements: ["stem"] },
    limits: { accelerateMath: opts.accelerate ?? false },
  });
}

/** X-2: the student's cap is 2, and their own rows make 4 college-level classes in 11th. */
export function x2Cap(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "A" },
      { type: "sci.bio", grade: 9 },
      { type: "ela.lang_comp", grade: 11, level: "ap", status: "planned" },
      { type: "ss.us_hist", grade: 11, level: "ap", status: "planned" },
      { type: "sci.chem", grade: 11, level: "ap", status: "planned" },
      { type: "cs.prog2", grade: 11, level: "ap", status: "planned" },
    ],
    families: ["computer_data_science"],
    colleges: [COLLEGES.utAustin],
    limits: { maxCollegeLevelPerYear: 2 },
    choices: { txEndorsements: ["stem"] },
  });
}

/** X-3: a senior missing a required credit (U.S. Government). */
export function x3SeniorMissingCredit(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 12,
    path: "training",
    cohort: { grade9Entry: { year: 2023, reason: "other" } },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "sci.ipc", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.athletics", grade: 10 },
      { type: "ela.11", grade: 11 },
      { type: "math.applied.models", grade: 11 },
      { type: "sci.chem", grade: 11 },
      { type: "ss.us_hist", grade: 11 },
      { type: "ss.econ", grade: 11 },
      { type: "ela.12", grade: 12 },
      { type: "sci.env", grade: 12 },
    ],
  });
}

/** X-4: two north stars that don't both fit (nursing and engineering). */
export function x4TwoGoals(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 11,
    limits: { classesPerYear: 6 },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "A" },
      { type: "sci.bio", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10, letter: "A" },
      { type: "sci.chem", grade: 10 },
      { type: "lang.es.2", grade: 10 },
      { type: "arts.visual", grade: 10 },
      { type: "pe.general", grade: 10 },
    ],
    families: ["nursing", "engineering"],
    choices: { tnElectiveFocus: "humanities" },
  });
}

function schoolCourse(id: string, c: Partial<CatalogCourse> & Pick<CatalogCourse, "typeId" | "title" | "subject">): CatalogCourse {
  return {
    id,
    level: "regular",
    units: 4,
    grades: null,
    terms: ["full_year"],
    prereqs: [],
    approvals: [],
    cte: false,
    lectureOnly: false,
    delivery: "in_person",
    firstSchoolYear: null,
    everyOtherYear: false,
    ...c,
  };
}

/** A small published school list with a prerequisite loop (X-5), for grades 10-12. */
export function schoolList(opts: { cycle?: boolean } = {}): CatalogView {
  const courses: CatalogCourse[] = [
    schoolCourse("s-eng10", { typeId: "ela.10", title: "English 10", subject: "english", grades: [10] }),
    schoolCourse("s-eng11", { typeId: "ela.11", title: "English 11", subject: "english", grades: [11] }),
    schoolCourse("s-eng12", { typeId: "ela.12", title: "English 12", subject: "english", grades: [12] }),
    schoolCourse("s-geo", { typeId: "math.geom", title: "Geometry", subject: "math" }),
    schoolCourse("s-alg2", { typeId: "math.alg2", title: "Algebra 2", subject: "math" }),
    schoolCourse("s-pre", { typeId: "math.precalc", title: "Pre-Calculus", subject: "math" }),
    schoolCourse("s-chem", {
      typeId: "sci.chem",
      title: "Chemistry",
      subject: "science",
      prereqs: opts.cycle ? [{ anyOf: [{ catalogId: "s-phys" }] }] : [],
    }),
    schoolCourse("s-phys", {
      typeId: "sci.phys",
      title: "Physics",
      subject: "science",
      prereqs: opts.cycle ? [{ anyOf: [{ catalogId: "s-chem" }] }] : [],
    }),
    schoolCourse("s-anat", { typeId: "sci.anat", title: "Anatomy & Physiology", subject: "science", grades: [11, 12] }),
    schoolCourse("s-ush", { typeId: "ss.us_hist", title: "US History", subject: "social_studies" }),
    schoolCourse("s-gov", { typeId: "ss.us_gov", title: "Government", subject: "social_studies", units: 2, terms: ["fall", "spring"], grades: [12] }),
    schoolCourse("s-pfl", { typeId: "ss.pfl", title: "Personal Finance", subject: "social_studies", units: 2, terms: ["fall", "spring"] }),
    schoolCourse("s-span2", { typeId: "lang.es.2", title: "Spanish 2", subject: "world_language" }),
    schoolCourse("s-art", { typeId: "arts.visual", title: "Art 1", subject: "arts" }),
    schoolCourse("s-pe", { typeId: "pe.fitness", title: "Lifetime Fitness", subject: "health_pe", units: 2, terms: ["fall", "spring"] }),
    schoolCourse("s-weld", { typeId: "cte.manufacturing.1", title: "Welding I", subject: "career_technical", cte: true }),
  ];
  return {
    id: "guide-1",
    source: "school_published",
    state: "TX",
    schoolYear: 2026,
    lastYears: false,
    classesPerYear: 7,
    schedule: "traditional",
    localTotalUnits: null,
    confirmedSubjects: "all",
    courses,
  };
}

/** X-5: a school list whose Chemistry and Physics each list the other as a prerequisite. */
export function x5PrereqCycle(): PlannerInput {
  const list = schoolList({ cycle: true });
  return scenario({
    state: "TX",
    grade: 10,
    month: 7,
    schoolYear: 2025,
    catalogs: { 10: list, 11: list, 12: list },
    path: "training",
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "lang.es.1", grade: 9 },
      { type: "ss.world_geo", grade: 9 },
      { type: "pe.fitness", grade: 9 },
      { type: "ela.10", grade: 10 },
      { type: "math.geom", grade: 10 },
      { type: "ss.econ", grade: 10 },
      { type: "arts.visual", grade: 10 },
    ],
  });
}

/** P6: a student in Ohio keeps today's checklist. */
export function p6Ohio(): PlannerInput {
  return scenario({ state: null, homeState: "OH", grade: 10 });
}

/** P1 (Mia): grade 7, Utah, nursing. Middle school view only. */
export function p1Mia(): PlannerInput {
  return scenario({
    state: "UT",
    grade: 7,
    courses: [{ type: "math.ms", grade: 7 }],
    families: ["nursing"],
  });
}

/** P7: moved from Tennessee to Texas in 10th grade. */
export function p7Move(): PlannerInput {
  return scenario({
    state: "TX",
    grade: 10,
    cohort: { grade9Entry: { year: 2025, reason: "transferred" } },
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.int1", grade: 9 },
      { type: "sci.bio", grade: 9 },
      { type: "health.wellness", grade: 9 },
      { type: "ss.world_hist", grade: 9 },
    ],
    choices: { txEndorsements: ["multidisciplinary"] },
  });
}

/** A class failed (F) last year is planned again: "Plans change. Here's what still fits." */
export function failedClass(): PlannerInput {
  return scenario({
    state: "TN",
    grade: 10,
    month: 6,
    schoolYear: 2026,
    courses: [
      { type: "ela.9", grade: 9 },
      { type: "math.alg1", grade: 9, letter: "F" },
      { type: "sci.bio", grade: 9, letter: "W" },
      { type: "ela.10", grade: 10 },
      { type: "math.alg1", grade: 10, letter: "B", id: "retake" },
    ],
    choices: { tnElectiveFocus: "humanities" },
  });
}

export const ALL_SCENARIOS: Record<string, () => PlannerInput> = {
  "TX-1": () => tx1WorkedExample(),
  "TX-2": tx2Entry2025,
  "TX-3": tx3NoAlgebra2,
  "TX-4": tx4ArtsSwap,
  "TX-5": tx5DropEndorsement,
  "P3 Sam": () => p3Sam(),
  "P4 Ana": p4Ana,
  "TN-1": tn1Nursing,
  "TN-1b": tn1bCsAsFourthMath,
  "TN-2": tn2Waiver,
  "TN-3": tn3FloralDesign,
  "TN-4": tn4AlgebraIn8th,
  "TN-5": tn5NoFocus,
  "UT-1": ut1Engineering,
  "UT-2": ut2ClassOf2028,
  "UT-3": () => ut3OptOut(),
  "UT-4": ut4LectureOnlyBio,
  "UT-5": ut5CalculusWithC,
  "X-1": () => x1CalcInfeasible(),
  "X-1 accel": () => x1CalcInfeasible({ accelerate: true }),
  "X-2": x2Cap,
  "X-3": x3SeniorMissingCredit,
  "X-4": x4TwoGoals,
  "X-5": x5PrereqCycle,
  "X-6": x6UtahTotals,
  "P1 Mia": p1Mia,
  "P6 Ohio": p6Ohio,
  "P7 move": p7Move,
  failed: failedClass,
};
