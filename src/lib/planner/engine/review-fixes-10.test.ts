import { describe, expect, it } from "vitest";
import type { CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolGrade } from "../common";
import { plannerContentFor } from "../content";
import { combinedHalves, guessCourseType, guessCourseTypeId } from "../course-type-guess";
import type { CourseTypeId } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlannerInput, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import { languageLevelsFilled } from "./allocate";
import { pastLanguageLevel } from "./fill";
import { plan } from "./index";
import { itemFromFact } from "./model";
import { claims, claimsOnWaiting, extraClaims } from "./testing/claims";
import { auditExactTitles, exactTitleClaims } from "./testing/exact";
import { planned, requirement, suggestions } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's tenth review of the course planner (the confirm-first
// planner). They run the engine on the real Utah, Tennessee and Texas content with class names
// typed through the real guesser, and compare three versions of each student: typed (kinds
// guessed), one-tap (the guess confirmed as it is) and the truth (the right kinds, confirmed).

const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };

function input(s: Scenario, goals: FamilyId[] = []): PlannerInput {
  const i = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) i.targets.families = goals.map((familyId) => ({ familyId, source: "north_star" as FamilyTarget["source"], cip6: null, because: null }));
  return i;
}
const real = (s: Scenario, goals: FamilyId[] = []): PlannedPath => planned(plan(input(s, goals)));

/** A typed class: its name, subject and grade, and (`as`) its real kind when the guess isn't it. */
type Row = [name: string, subject: CourseSubject, grade: SchoolGrade, extra?: Partial<CourseSpec> & { as?: CourseTypeId }];
type Mode = "typed" | "one-tap" | "truth";
/** typed: kinds guessed; one-tap: each guess confirmed as it is; truth: the right kinds, confirmed. */
function rows(state: PlannerState, list: Row[], mode: Mode): CourseSpec[] {
  return list.map(([name, subject, grade, extra]) => {
    const { as, ...rest } = extra ?? {};
    const guess = guessCourseTypeId(name, subject, state);
    return { type: mode === "truth" ? (as ?? guess) : guess, grade, name, assumed: mode === "typed", ...rest };
  });
}
const student = (s: Omit<Scenario, "courses">, list: Row[], mode: Mode, goals: FamilyId[] = []) => real({ ...s, courses: rows(s.state!, list, mode) }, goals);

type Suggested = Extract<PlanSlot, { kind: "suggested" }> & { grade: number };
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => g.text).join("\n");
const typesOf = (path: PlannedPath) => suggestions(path).map((s) => s.typeId);
const nowLines = (path: PlannedPath) => suggestions(path).filter((s) => s.needsPlanNow).map(reasonsOf).join("\n");

/** The typed student claims nothing the truth doesn't, and nothing about a requirement that waits. */
function expectNoClaimFromAGuess(s: Omit<Scenario, "courses">, list: Row[], goals: FamilyId[] = [], label = "") {
  const typed = student(s, list, "typed", goals);
  const truth = student(s, list, "truth", goals);
  expect(claimsOnWaiting(typed), `${label} claims about requirements waiting on a confirmation`).toEqual([]);
  expect(extraClaims(typed, truth), `${label} claims only the guess makes`).toEqual([]);
  // As the app reads the names (exact titles confirmed, the rest guessed): nothing new either.
  expect(exactTitleClaims(input({ ...s, courses: rows(s.state!, list, "typed") }, goals), truth), `${label} claims an exact title makes`).toEqual([]);
  return { typed, truth };
}

const up = (list: Row[], grade: number) => list.filter(([, , g]) => g <= grade);

// Texas and Tennessee students with a full record; each test swaps in its own classes.
const TX_BASE: Row[] = [
  ["English I", "english", 9],
  ["Algebra I", "math", 9],
  ["Biology", "science", 9],
  ["World Geography", "social_studies", 9],
  ["Spanish I", "world_language", 9],
  ["English II", "english", 10],
  ["Geometry", "math", 10],
  ["Chemistry", "science", 10],
  ["World History", "social_studies", 10],
  ["Spanish II", "world_language", 10],
  ["Art I", "arts", 10],
  ["English III", "english", 11],
  ["Algebra II", "math", 11],
  ["Physics", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["Principles of Health Science", "career_technical", 11],
  ["English IV", "english", 12],
  ["Precalculus", "math", 12],
];
const TX_GOV_ECON: Row[] = [
  ["Government", "social_studies", 12, { units: 2 }],
  ["Economics", "social_studies", 12, { units: 2 }],
];
const TN_BASE: Row[] = [
  ["English I", "english", 9],
  ["Algebra I", "math", 9],
  ["Biology", "science", 9],
  ["World History", "social_studies", 9],
  ["Spanish I", "world_language", 9],
  ["Lifetime Wellness", "health_pe", 9],
  ["English II", "english", 10],
  ["Geometry", "math", 10],
  ["Chemistry", "science", 10],
  ["Spanish II", "world_language", 10],
  ["PE", "health_pe", 10, { units: 2, as: "pe.general" }],
  ["Art", "arts", 10, { as: "arts.visual" }],
  ["English III", "english", 11],
  ["Algebra II", "math", 11],
  ["Physics", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["English IV", "english", 12],
];

// 1. "Wellness" titles -------------------------------------------------------------------------------

describe("Texas's PE titles and other \"… wellness\" classes (course-type-guess.ts)", () => {
  it("reads Texas's three PE courses as PE, sure; Tennessee's Lifetime Wellness is sure only in Tennessee; any other wellness title is a guess to confirm", () => {
    // 19 TAC §74.12(b)(6)(A): "(i) Lifetime Fitness and Wellness Pursuits; (ii) Lifetime Recreation
    // and Outdoor Pursuits; and (iii) Skill-Based Lifetime Activities."
    expect(guessCourseType("Lifetime Fitness and Wellness Pursuits", "health_pe", "TX")).toEqual({ typeId: "pe.fitness", confident: true, candidates: ["pe.fitness"] });
    expect(guessCourseType("Lifetime Fitness & Wellness Pursuits", "health_pe", "TX")).toMatchObject({ typeId: "pe.fitness", confident: true });
    expect(guessCourseType("Lifetime Recreation and Outdoor Pursuits", "health_pe", "TX")).toMatchObject({ typeId: "pe.lifetime", confident: true });
    expect(guessCourseType("Skill-Based Lifetime Activities", "health_pe", "TX")).toMatchObject({ typeId: "pe.skills", confident: true });
    expect(guessCourseType("Lifetime Wellness", "health_pe", "TN")).toEqual({ typeId: "health.wellness", confident: true, candidates: ["health.wellness"] });
    for (const [name, state] of [["Health & Wellness", "UT"], ["Health and Wellness", "TX"], ["Lifetime Wellness", "TX"], ["Wellness", "TN"], ["Fitness and Wellness", "UT"]] as const) {
      const g = guessCourseType(name, "health_pe", state);
      expect(g.confident, `${name} (${state})`).toBe(false);
      expect(g.candidates, `${name} (${state})`).toEqual(expect.arrayContaining(["health.health", "pe.fitness", "health.wellness"]));
    }
    expect(guessCourseTypeId("Health & Wellness", "health_pe", "UT")).toBe("health.health");
  });

  // P01: Texas senior whose only PE is "Lifetime Fitness and Wellness Pursuits" (1 credit) in 9th.
  const P01: Row[] = [...TX_BASE, ...TX_GOV_ECON, ["Lifetime Fitness and Wellness Pursuits", "health_pe", 9, { units: 4 }]];

  it("P01 (Texas 12th): no \"Needs a plan now\" PE class, typed, one-tap or confirmed", () => {
    for (const mode of ["typed", "one-tap", "truth"] as const) {
      const path = student({ state: "TX", grade: 12 }, P01, mode);
      expect(typesOf(path).filter((t) => t.startsWith("pe.")), mode).toEqual([]);
      expect(allReasons(path), mode).not.toMatch(/Required by Texas: Physical education/);
      expect(requirement(path, "tx.fhsp.grad", "pe").status, mode).toBe(mode === "typed" ? "waiting_confirm" : "done");
    }
    expectNoClaimFromAGuess({ state: "TX", grade: 12 }, P01, [], "P01");
  });

  it("T03 (Texas 9th): no PE class \"Required by Texas\" added in a later year", () => {
    const t03 = up(P01, 9);
    for (const mode of ["typed", "one-tap"] as const) {
      const path = student({ state: "TX", grade: 9 }, t03, mode);
      expect(allReasons(path), mode).not.toMatch(/Required by Texas: Physical education/);
    }
  });

  it("P02 (Utah 12th, \"Health & Wellness\"): never \"Needs a plan now: Health\" from the guess; the one-tap guess is Health", () => {
    const P02: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["Biology", "science", 9],
      ["Health & Wellness", "health_pe", 9, { units: 2, as: "health.health" }],
      ["English 12", "english", 12],
    ];
    const { typed } = expectNoClaimFromAGuess({ state: "UT", grade: 12 }, P02, [], "P02");
    expect(nowLines(typed)).not.toMatch(/Required by Utah: Health/);
    expect(requirement(typed, "ut.grad", "health").status).toBe("waiting_confirm");
    const oneTap = student({ state: "UT", grade: 12 }, P02, "one-tap");
    expect(requirement(oneTap, "ut.grad", "health").status).toBe("done");
  });
});

// 2. Two classes in one name ---------------------------------------------------------------------------

describe("A name that joins two classes (\"Gov/Econ\") is a guess to confirm, and can be split (course-type-guess.ts combined)", () => {
  it("reads both kinds and never calls the guess sure; one class's own name isn't two", () => {
    expect(guessCourseType("Gov/Econ", "social_studies", "TX")).toEqual({
      typeId: "ss.us_gov",
      confident: false,
      candidates: ["ss.us_gov", "ss.econ"],
      combined: { parts: ["ss.us_gov", "ss.econ"], names: ["Gov", "Econ"] },
    });
    expect(guessCourseType("Economics/Personal Finance", "social_studies", "TN").combined).toEqual({ parts: ["ss.econ", "ss.pfl"], names: ["Economics", "Personal Finance"] });
    expect(guessCourseType("US Government and Economics", "social_studies", "TN")).toMatchObject({ confident: false, candidates: ["ss.us_gov", "ss.econ"] });
    expect(guessCourseType("Health/PE", "health_pe", "UT").combined?.parts).toEqual(["health.health", "pe.general"]);
    // One class each (a single name spans the "and", or both sides name the same kind).
    for (const [name, subject, state, typeId] of [
      ["Personal Financial Literacy and Economics", "social_studies", "TX", "ss.pfl_econ"],
      ["Integrated Physics and Chemistry", "science", "TX", "sci.ipc"],
      ["Anatomy and Physiology", "science", "TX", "sci.anat"],
      ["U.S. History and Geography", "social_studies", "UT", "ss.us_hist"],
      ["World History and Geography", "social_studies", "TX", "ss.world_hist"],
      ["Research and Technical Writing", "english", "TX", "ela.research"],
      ["Engineering Design & Problem Solving", "career_technical", "TX", "cte.engineering_problem_solving"],
      ["Algebra II/Trigonometry", "math", "TN", "math.alg2"],
    ] as const) {
      expect(guessCourseType(name, subject, state), name).toMatchObject({ typeId, confident: true });
      expect(guessCourseType(name, subject, state).combined, name).toBeUndefined();
    }
  });

  it("offers two half-credit classes only for half-credit kinds on a full-credit row", () => {
    expect(combinedHalves("Gov/Econ", "social_studies", 4, "TX")?.parts).toEqual(["ss.us_gov", "ss.econ"]);
    expect(combinedHalves("Gov/Econ", "social_studies", 2, "TX")).toBeNull();
    expect(combinedHalves("Speech and Debate", "english", 4, "TX")).toBeNull();
    expect(combinedHalves("Biology", "science", 4, "TX")).toBeNull();
  });

  const T04: Row[] = [...TX_BASE, ["Gov/Econ", "social_studies", 12, { units: 4 }]];
  const T23: Row[] = [...TN_BASE, ["Precalculus", "math", 12], ["U.S. Government", "social_studies", 12, { units: 2 }], ["Economics/Personal Finance", "social_studies", 12, { units: 4 }]];
  const P03: Row[] = [...TN_BASE, ["Precalculus", "math", 12], ["Personal Finance", "social_studies", 12, { units: 2 }], ["US Government/Economics", "social_studies", 12, { units: 4 }]];

  it("T04 (Texas 12th, \"Gov/Econ\"), T23 (Tennessee 12th, \"Economics/Personal Finance\"), P03 (Tennessee 12th, \"US Government/Economics\"): nothing \"Needs a plan now\" for either half", () => {
    for (const [label, state, list, halves] of [
      ["T04", "TX", T04, ["ss.us_gov", "ss.econ"]],
      ["T23", "TN", T23, ["ss.econ", "ss.pfl"]],
      ["P03", "TN", P03, ["ss.us_gov", "ss.econ"]],
    ] as const) {
      const typed = student({ state, grade: 12 }, list, "typed");
      expect(nowLines(typed), label).not.toMatch(/Economics|Personal Finance|Government/);
      expect(typesOf(typed), label).not.toEqual(expect.arrayContaining([halves[1]]));
      expect(claimsOnWaiting(typed), label).toEqual([]);
      // "Confirm your classes" offers the row as two half-credit classes.
      const row = input({ state, grade: 12, courses: rows(state, list, "typed") }).courses.find((c) => /[/]|\band\b/.test(c.name))!;
      expect(typed.confirm.find((c) => c.courseId === row.id)?.halves, label).toEqual(halves);
    }
  });

  it("split into its two half-credit classes, the row meets both requirements", () => {
    const split = (list: Row[], name: string, parts: readonly [CourseTypeId, CourseTypeId]): Row[] => [
      ...list.filter(([n]) => n !== name),
      [name.split("/")[0], "social_studies", 12, { units: 2, term: "fall", as: parts[0] }],
      [name.split("/")[1], "social_studies", 12, { units: 2, term: "spring", as: parts[1] }],
    ];
    const t04 = student({ state: "TX", grade: 12 }, split(T04, "Gov/Econ", ["ss.us_gov", "ss.econ"]), "truth");
    expect(requirement(t04, "tx.fhsp.grad", "ss.us_gov").status).toBe("done");
    expect(requirement(t04, "tx.fhsp.grad", "ss.econ").status).toBe("done");
    const t23 = student({ state: "TN", grade: 12 }, split(T23, "Economics/Personal Finance", ["ss.econ", "ss.pfl"]), "truth");
    expect(requirement(t23, "tn.grad", "ss.econ").status).toBe("done");
    expect(requirement(t23, "tn.grad", "pf").status).toBe("done");
    expect(nowLines(t23)).not.toMatch(/Economics|Personal Finance/);
  });
});

// 3. The student's own language, even one the vocabulary doesn't name ----------------------------------

describe("The next level of the student's own language, even \"another language\" (fill.ts chooseLanguage, catalog.ts withOwnLanguages)", () => {
  const withLanguage = (name: string, grade: SchoolGrade, as?: CourseTypeId): Row[] =>
    TX_BASE.filter(([n]) => !n.startsWith("Spanish")).concat([[name, "world_language", grade, as ? { as } : {}], ["Athletics", "health_pe", 9]]);

  it("P04 (Texas 10th, Vietnamese I confirmed as another language) and P05 (typed): Vietnamese II is planned, with no language gap", () => {
    const list = up(withLanguage("Vietnamese I", 9, "lang.other.1"), 10);
    for (const mode of ["truth", "typed"] as const) {
      const path = student({ state: "TX", grade: 10 }, list, mode);
      const next = suggestions(path).filter((s) => s.typeId.startsWith("lang."));
      expect(next.map((s) => s.typeId), mode).toEqual(["lang.other.2"]);
      expect(next[0].title, mode).toBe("Your language, level II");
      expect(reasonsOf(next[0]), mode).toMatch(/The next level of the language you take\. Ask your counselor whether your school offers it\./);
      expect(gapLines(path), mode).not.toMatch(/language/i);
    }
  });

  it("Q02 (Texas 12th, Vietnamese I in 11th) and T08 (\"Français I\", typed and one-tap): one more level of their language, never two computer programming credits", () => {
    const cases: [string, Row[], Mode][] = [
      ["Q02", withLanguage("Vietnamese I", 11, "lang.other.1"), "truth"],
      ["Q02 typed", withLanguage("Vietnamese I", 11, "lang.other.1"), "typed"],
      ["Q02 one-tap", withLanguage("Vietnamese I", 11, "lang.other.1"), "one-tap"],
      ["T08", withLanguage("Français I", 11), "typed"],
      ["T08 one-tap", withLanguage("Français I", 11), "one-tap"],
    ];
    for (const [label, list, mode] of cases) {
      const path = student({ state: "TX", grade: 12 }, [...list, ...TX_GOV_ECON], mode);
      expect(typesOf(path).filter((t) => t.startsWith("cs.")), label).toEqual([]);
      expect(allReasons(path), label).not.toMatch(/computer programming/i);
      const lang = suggestions(path).filter((s) => s.typeId.startsWith("lang."));
      expect(lang.map((s) => s.typeId), label).toEqual([label.startsWith("T08") ? "lang.fr.2" : "lang.other.2"]);
      if (mode !== "typed") expect(reasonsOf(lang[0]), label).toMatch(/Required by Texas: Two levels of the same language/);
    }
    // "Français" is French.
    expect(guessCourseType("Français I", "world_language", "TX")).toMatchObject({ typeId: "lang.fr.1", confident: true });
  });

  it("the generic list gains only the student's own languages' levels", () => {
    const path = student({ state: "TX", grade: 9 }, [["English I", "english", 9]], "truth");
    expect(JSON.stringify(path.plans)).not.toMatch(/lang\.other/);
  });
});

// 4. Tennessee JROTC ------------------------------------------------------------------------------------

describe("Tennessee JROTC substitutions (Policy 3.103 III(4), III(6), note 8)", () => {
  const jrotc: Row[] = [
    ["JROTC I", "other", 9],
    ["JROTC II", "other", 10],
    ["JROTC III", "other", 11],
  ];
  const T24: Row[] = [...TN_BASE.filter(([n]) => n !== "Lifetime Wellness" && n !== "PE"), ...jrotc, ["Precalculus", "math", 12], ["Economics", "social_studies", 12, { units: 2 }]];

  it("T24c (Tennessee 12th, class of 2027, JROTC I-III confirmed): wellness and PE met; Personal Finance and Government are questions for the counselor, never \"Needs a plan now\"", () => {
    const path = student({ state: "TN", grade: 12 }, T24, "truth");
    expect(requirement(path, "tn.grad", "wellness").status).toBe("done");
    expect(requirement(path, "tn.grad", "pe").status).toBe("done");
    for (const id of ["pf", "ss.gov"]) {
      const r = requirement(path, "tn.grad", id);
      expect(r.status, id).toBe("ask_counselor");
      expect(r.modifiers, id).not.toContain("needs_plan_now");
      expect(r.reasons.map((x) => x.text).join(" "), id).toMatch(/Your JROTC III may count for this/);
    }
    expect(nowLines(path)).toBe("");
    expect(typesOf(path)).not.toEqual(expect.arrayContaining(["health.wellness"]));
    expect(typesOf(path).filter((t) => t === "ss.pfl" || t === "ss.us_gov" || t.startsWith("pe."))).toEqual([]);
    const pf = path.gaps.find((g) => g.demandId === "tn.grad/pf")!;
    expect(pf.text).toBe("Personal Finance: your JROTC III may count for this if your JROTC instructor took the Personal Finance training. Ask your counselor.");
    expect(pf.options.map((o) => o.kind)).toEqual(["ask_counselor"]);
    expect(path.askCounselor.map((q) => q.text)).toEqual(
      expect.arrayContaining(["Does my JROTC III count for Personal Finance? It can when my JROTC instructor took the Personal Finance training.", "Does my JROTC III count for U.S. Government and Civics?"]),
    );
    // Typed, it claims nothing the confirmed classes don't.
    expectNoClaimFromAGuess({ state: "TN", grade: 12 }, T24, [], "T24");
  });

  it("the 2024 variant (11th grader, JROTC III this year) too; with only JROTC I, PE and Personal Finance are still to plan", () => {
    const path = student({ state: "TN", grade: 11 }, up(T24, 11), "truth");
    expect(requirement(path, "tn.grad", "wellness").status).toBe("done");
    expect(requirement(path, "tn.grad", "pe").status).toBe("done");
    expect(requirement(path, "tn.grad", "pf").status).toBe("ask_counselor");
    const one = student({ state: "TN", grade: 12 }, T24.filter(([n]) => n !== "JROTC II" && n !== "JROTC III"), "truth");
    expect(requirement(one, "tn.grad", "wellness").status).toBe("done");
    expect(requirement(one, "tn.grad", "pf").reasons.map((x) => x.text).join(" ")).not.toMatch(/JROTC III/);
    expect(nowLines(one)).toMatch(/Required by Tennessee: Personal Finance/);
  });
});

// 5. Language levels: the student's own classes first ---------------------------------------------------

describe("A student's own language levels come first (allocate.ts languageLevelsFilled, fill.ts pastLanguageLevel)", () => {
  it("counts finished and in-progress classes before planned ones", () => {
    const item = (typeId: CourseTypeId, grade: number, firm: boolean) =>
      itemFromFact({ ...input({ state: "TN", grade: 11, courses: [{ type: typeId, grade: grade as SchoolGrade }] }).courses[0], status: firm ? "completed" : "planned", id: `x${grade}` });
    const filled = languageLevelsFilled([item("lang.es.2", 9, true), item("lang.es.3", 12, false), item("lang.es.4", 11, true)], 2);
    expect(filled.map((i) => i.typeId)).toEqual(["lang.es.2", "lang.es.4"]);
    // Still the most levels: a planned class fills a level the student's own classes can't.
    expect(languageLevelsFilled([item("lang.es.1", 9, true), item("lang.es.1", 10, true), item("lang.es.2", 11, false)], 2).map((i) => i.typeId)).toEqual(["lang.es.1", "lang.es.2"]);
  });

  it("never plans a level at or below the student's highest (\"IV or higher\" can come again)", () => {
    const items = input({ state: "TN", grade: 11, courses: [{ type: "lang.es.4", grade: 11 }] }).courses.map(itemFromFact);
    expect(pastLanguageLevel(items, "lang.es.3")).toBe(true);
    expect(pastLanguageLevel(items, "lang.es.4")).toBe(false);
    expect(pastLanguageLevel(items, "lang.fr.1")).toBe(false);
    const three = input({ state: "TN", grade: 11, courses: [{ type: "lang.es.3", grade: 10 }] }).courses.map(itemFromFact);
    expect(pastLanguageLevel(three, "lang.es.3")).toBe(true);
  });

  it("T25 (Tennessee 11th, Spanish for Native Speakers as Spanish II, Spanish IV now, humanities focus, UT Knoxville): no Spanish III, and the language requirement is met", () => {
    const T25: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World History", "social_studies", 9],
      ["Spanish for Native Speakers", "world_language", 9, { as: "lang.es.2" }],
      ["Lifetime Wellness", "health_pe", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["PE", "health_pe", 10, { units: 2, as: "pe.general" }],
      ["Art", "arts", 10, { as: "arts.visual" }],
      ["English III", "english", 11],
      ["Algebra II", "math", 11],
      ["Physics", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Spanish IV", "world_language", 11],
    ];
    for (const mode of ["truth", "one-tap"] as const) {
      const path = student({ state: "TN", grade: 11, colleges: [UTK], choices: { tnElectiveFocus: "humanities" } }, T25, mode, ["humanities"]);
      expect(typesOf(path).filter((t) => /^lang\.es\.[123]$/.test(t)), mode).toEqual([]);
      expect(allReasons(path), mode).not.toMatch(/Two credits of the same world language/);
      expect(requirement(path, "tn.grad", "wl.same"), mode).toMatchObject({ status: "done", firm: 2 });
    }
  });
});

// 6. A class a substitution makes unnecessary isn't "Required by" ---------------------------------------

describe("\"Required by\" only when no substitution route meets the rule without the class (plan.ts neededLeaves)", () => {
  const C30: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["World History", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["Lifetime Wellness", "health_pe", 9],
    ["English II", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["Spanish II", "world_language", 10],
    ["Band", "arts", 10],
    ["English III", "english", 11],
    ["Algebra II", "math", 11],
    ["Physics", "science", 11],
    ["U.S. History", "social_studies", 11],
    ["Band", "arts", 11],
  ];

  it("C30 (Tennessee 11th, class of 2028, music goal) and Q01 (no goal): Precalculus next to Computer Science Principles isn't \"Required by Tennessee: A 4th math credit\"", () => {
    for (const goals of [["music"], []] as FamilyId[][]) {
      const path = student({ state: "TN", grade: 11 }, C30, "truth", goals);
      const cs = suggestions(path).find((s) => s.typeId.startsWith("cs."));
      expect(cs && reasonsOf(cs), goals.join()).toMatch(/Required by Tennessee: Computer science/);
      const precalc = suggestions(path).find((s) => s.typeId === "math.precalc")!;
      expect(reasonsOf(precalc), goals.join()).not.toMatch(/Required by Tennessee: A 4th math credit/);
      // What placed it says so instead (UT Knoxville, the state's labeled default, or the music goal).
      expect(reasonsOf(precalc), goals.join()).toMatch(/Strongly encouraged by UT Knoxville: 4 math/);
    }
  });
});

// 7. Pre-AP isn't AP -----------------------------------------------------------------------------------

describe("A language class's level comes from its numeral first (course-type-guess.ts)", () => {
  it("Pre-AP Spanish II is Spanish II; AP decides the level only without a numeral", () => {
    expect(guessCourseType("Pre-AP Spanish II", "world_language", "TX")).toEqual({ typeId: "lang.es.2", confident: true, candidates: ["lang.es.2"] });
    expect(guessCourseType("Spanish I Pre-AP", "world_language", "TX")).toMatchObject({ typeId: "lang.es.1", confident: true });
    expect(guessCourseType("Spanish II Pre-AP", "world_language", "TX")).toMatchObject({ typeId: "lang.es.2", confident: true });
    expect(guessCourseType("AP Spanish Language", "world_language", "TX")).toMatchObject({ typeId: "lang.es.4", confident: true });
    expect(guessCourseType("Pre-AP Spanish", "world_language", "TX")).toMatchObject({ typeId: "lang.es.1", confident: false });
  });

  it("T10 (Texas 9th, placed in Pre-AP Spanish II) and T03 (Spanish I Pre-AP): the next level is the one up, never Spanish IV", () => {
    for (const [name, next] of [["Pre-AP Spanish II", "lang.es.3"], ["Spanish I Pre-AP", "lang.es.2"]] as const) {
      const list: Row[] = [["English I", "english", 9], ["Algebra I", "math", 9], [name, "world_language", 9]];
      for (const mode of ["typed", "one-tap"] as const) {
        const path = student({ state: "TX", grade: 9 }, list, mode, ["nursing"]);
        const lang = suggestions(path).filter((s) => s.typeId.startsWith("lang."));
        expect(lang.map((x) => x.typeId), `${name} ${mode}`).toEqual([next]);
        expect(allReasons(path), `${name} ${mode}`).not.toMatch(/Spanish IV/);
      }
    }
  });
});

// 8. Marching band, drill team and cheer count for Texas PE like athletics and JROTC -------------------

describe("Marching band and drill team count toward PE by district policy (19 TAC §74.12(b)(6)(D))", () => {
  it("the guesser reads them as their own kind", () => {
    expect(guessCourseType("Marching Band", "arts", "TX")).toMatchObject({ typeId: "arts.marching", confident: true });
    expect(guessCourseType("Drill Team", "health_pe", "TX")).toMatchObject({ typeId: "arts.marching", confident: true });
    expect(guessCourseTypeId("Band", "arts", "TX")).toBe("arts.ensemble");
  });

  it("P10 (Texas 12th, marching band every fall, no PE class): PE is met, never \"Needs a plan now\"", () => {
    const band = ([9, 10, 11, 12] as const).map((g): Row => ["Marching Band", "arts", g, { units: 2, term: "fall" }]);
    const P10: Row[] = [...TX_BASE.filter(([n]) => n !== "Art I"), ...TX_GOV_ECON, ...band];
    const path = student({ state: "TX", grade: 12 }, P10, "truth");
    expect(requirement(path, "tx.fhsp.grad", "pe").status).toBe("done");
    expect(requirement(path, "tx.fhsp.grad", "arts").status).toBe("done");
    expect(nowLines(path)).not.toMatch(/Physical education/);
    expect(typesOf(path).filter((t) => t.startsWith("pe."))).toEqual([]);
    expectNoClaimFromAGuess({ state: "TX", grade: 12 }, P10, [], "P10");
  });
});

// 9 and 10. A partner program or a credit total waiting on a confirmation waits too ----------------------

describe("Checks and credit totals wait while requirements wait on a confirmation (audit.ts, gaps.ts)", () => {
  const T61: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["World Geography", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["Athletics", "health_pe", 9],
    ["Principles of Business, Marketing, and Finance", "career_technical", 9],
  ];
  const s = { state: "TX" as const, grade: 9 as const, choices: { txEndorsements: ["business_industry" as const] } };

  it("T61 (Texas 9th, typed, Business and Industry): the DLA's endorsement and the TEXAS Grant's Foundation program wait, never \"Room to add\"", () => {
    const typed = student(s, T61, "typed", ["business"]);
    const truth = student(s, T61, "truth", ["business"]);
    const check = (p: PlannedPath, rs: string, id: string) => p.audit.find((a) => a.ruleSetId === rs)!.checks.find((c) => c.checkId === id)!;
    expect(check(truth, "tx.dla", "dla.endorsement").status).toBe("ok");
    expect(check(truth, "tx.texas-grant.priority", "fhsp").status).toBe("ok");
    for (const [rs, id] of [["tx.dla", "dla.endorsement"], ["tx.texas-grant.priority", "fhsp"]]) {
      const c = check(typed, rs, id);
      expect(c.status, id).toBe("waiting_confirm");
      expect(c.text, id).toMatch(/waiting on you to confirm a class/);
    }
  });

  it("T61 typed and P01 (Texas 12th, typed): no credit-total gap a guess made; the totals wait", () => {
    const typed = student(s, T61, "typed", ["business"]);
    expect(typed.gaps.filter((g) => /credits in all|total credits/.test(g.text))).toEqual([]);
    expect(requirement(typed, "tx.endorse.business", "e.electives").status).toBe("waiting_confirm");
    const P01: Row[] = [...TX_BASE, ...TX_GOV_ECON, ["Lifetime Fitness and Wellness Pursuits", "health_pe", 9, { units: 4 }]];
    const senior = student({ state: "TX", grade: 12 }, P01.filter(([n]) => n !== "Principles of Health Science"), "typed");
    expect(senior.gaps.filter((g) => /total credits/.test(g.text))).toEqual([]);
    const total = requirement(senior, "tx.fhsp.grad", "total");
    expect(total.status).toBe("waiting_confirm");
    expect(total.modifiers).not.toContain("needs_plan_now");
    // Confirmed, the same senior's shortfall is a gap.
    const truth = student({ state: "TX", grade: 12 }, P01.filter(([n]) => n !== "Principles of Health Science"), "truth");
    expect(truth.gaps.some((g) => g.id === "gap:tx.fhsp.grad/total")).toBe(true);
  });

  it("T43 (Utah 10th, typed): no total-credit gap from a guess", () => {
    const T43: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["Earth Science", "science", 9],
      ["Geography", "social_studies", 9, { units: 2 }],
      ["Fitness for Life", "health_pe", 9, { units: 2 }],
      ["Health", "health_pe", 9, { units: 2 }],
      ["English 10", "english", 10],
      ["Secondary Math II", "math", 10],
      ["Biology", "science", 10],
    ];
    const { typed } = expectNoClaimFromAGuess({ state: "UT", grade: 10 }, T43, [], "T43");
    expect(typed.gaps.filter((g) => /total credits/.test(g.text))).toEqual([]);
  });
});

// 11. A math class after Algebra II the planner can't name ----------------------------------------------

describe("A math class after Algebra II may be the 4th math: the counselor's call (audit.ts counselorDecides)", () => {
  const P09: Row[] = [
    ...TN_BASE,
    ["Finite Math", "math", 12],
    ["Economics", "social_studies", 12, { units: 2 }],
    ["Personal Finance", "social_studies", 12, { units: 2 }],
    ["U.S. Government", "social_studies", 12, { units: 2 }],
  ];

  it("P09 (Tennessee 12th, Finite Math confirmed as another math class): \"ask your counselor\", never \"Needs a plan now: Precalculus\"", () => {
    const path = student({ state: "TN", grade: 12 }, P09, "truth");
    const r = requirement(path, "tn.grad", "math.fourth");
    expect(r.status).toBe("ask_counselor");
    expect(r.modifiers).not.toContain("needs_plan_now");
    expect(typesOf(path).filter((t) => t.startsWith("math."))).toEqual([]);
    expect(nowLines(path)).not.toMatch(/4th math/);
    const gap = path.gaps.find((g) => g.demandId === "tn.grad/math.fourth")!;
    expect(gap.text).toBe("A 4th math credit: you have a math class after Algebra II that may count for this. Ask your counselor whether it does.");
    expect(path.askCounselor.map((q) => q.text)).toContain("Does my math class after Algebra II count as a 4th math credit?");
    expectNoClaimFromAGuess({ state: "TN", grade: 12 }, P09, [], "P09");
  });

  it("T65 (\"Algebra III\" after Algebra II) is another math class, not Algebra I", () => {
    expect(guessCourseTypeId("Algebra III", "math", "TN")).toBe("math.other");
    const path = student({ state: "TN", grade: 12 }, P09.map((r): Row => (r[0] === "Finite Math" ? ["Algebra III", "math", 12] : r)), "typed");
    expect(nowLines(path)).not.toMatch(/4th math|Precalculus/);
    expect(claims(path).has("now:tn.grad/math.fourth")).toBe(false);
  });

  it("a math class before Algebra II, or a named one, doesn't make it a question", () => {
    const before = student({ state: "TN", grade: 12 }, P09.map((r): Row => (r[0] === "Finite Math" ? ["Finite Math", "math", 10] : r)), "truth");
    expect(requirement(before, "tn.grad", "math.fourth").status).not.toBe("ask_counselor");
  });
});

// 13. Program-of-study titles with "&" ------------------------------------------------------------------

describe("Program-of-study titles with \"&\" and Texas's level-2 names (course-type-guess.ts)", () => {
  it.each([
    ["Engineering Design & Presentation I", "TX", "cte.engineering.2", true],
    ["Engineering Design & Presentation II", "TX", "cte.engineering.3", true],
    ["Advanced Engineering Design & Presentation", "TX", "cte.engineering.4", true],
    ["Introduction to Culinary Arts", "TX", "cte.hospitality.1", true],
    ["Culinary Arts", "TX", "cte.hospitality.2", false],
    ["Advanced Culinary Arts", "TX", "cte.hospitality.3", true],
    ["Practicum in Culinary Arts", "TX", "cte.hospitality.4", true],
    ["Child Development", "TX", "cte.education.2", false],
    ["Child Guidance", "TX", "cte.education.3", true],
    ["Practicum in Early Learning", "TX", "cte.education.4", true],
    // Utah's Child Development is an introductory class; Culinary Arts elsewhere keeps level 1 first.
    ["Child Development", "UT", "cte.education.1", false],
    ["Culinary Arts", "UT", "cte.hospitality.1", false],
  ] as const)("%s (%s) → %s", (name, state, typeId, confident) => {
    expect(guessCourseType(name, "career_technical", state)).toMatchObject({ typeId, confident });
  });

  it("T07 (Texas 11th, typed \"Engineering Design & Presentation I\"): the one-tap guess is level 2", () => {
    const list: Row[] = [["English I", "english", 9], ["Principles of Applied Engineering", "career_technical", 9], ["Engineering Design & Presentation I", "career_technical", 10], ["English III", "english", 11]];
    const path = student({ state: "TX", grade: 11 }, list, "typed", ["engineering"]);
    const id = input({ state: "TX", grade: 11, courses: rows("TX", list, "typed") }).courses.find((c) => c.name.startsWith("Engineering Design"))!.id;
    expect(path.confirm.find((c) => c.courseId === id)?.guess).toBe("cte.engineering.2");
  });
});

auditExactTitles(31);
