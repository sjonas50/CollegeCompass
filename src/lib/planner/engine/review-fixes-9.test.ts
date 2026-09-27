import { describe, expect, it } from "vitest";
import type { CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolGrade } from "../common";
import { plannerContentFor } from "../content";
import { guessCourseType, guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlannerInput, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import { languageLevelsFilled } from "./allocate";
import { cteReached } from "./fill";
import { plan } from "./index";
import { itemFromFact } from "./model";
import { claims, claimsOnWaiting, extraClaims } from "./testing/claims";
import { planned, requirement, suggestions } from "./testing/helpers";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";

// Regression tests for the counselor's ninth review of the course planner, and the owner's
// structural fix for guessed class kinds ("confirm first", engine/confirm.ts). They run the engine
// on the real Utah, Tennessee and Texas content, with class names typed through the real guesser,
// and compare each typed student with the same student whose kinds are confirmed.

const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const UTC: CollegeTarget = { unitId: 221740, name: "UT Chattanooga", state: "TN", public: true, admissionRate: 0.8, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const USU: CollegeTarget = { unitId: 230728, name: "Utah State University", state: "UT", public: true, admissionRate: 0.93, openAdmission: null };
const WEBER: CollegeTarget = { unitId: 230782, name: "Weber State University", state: "UT", public: true, admissionRate: 1, openAdmission: null };

type Goal = FamilyId;

function input(s: Scenario, goals: Goal[] = []): PlannerInput {
  const i = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) i.targets.families = goals.map((familyId) => ({ familyId, source: "north_star" as FamilyTarget["source"], cip6: null, because: null }));
  return i;
}
const real = (s: Scenario, goals: Goal[] = []): PlannedPath => planned(plan(input(s, goals)));

/** A class the student typed: kind guessed by the real guesser (`confirmed`: the same kind, picked). `as`: a wrong guess, forced. */
type Row = [name: string, subject: CourseSubject, grade: SchoolGrade, extra?: Partial<CourseSpec> & { as?: CourseTypeId }];
function typed(state: PlannerState, rows: Row[], confirmed = false): CourseSpec[] {
  return rows.map(([name, subject, grade, extra]) => {
    const { as, ...rest } = extra ?? {};
    return { type: confirmed ? guessCourseTypeId(name, subject, state) : (as ?? guessCourseTypeId(name, subject, state)), grade, name, assumed: !confirmed, ...rest };
  });
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }> & { grade: number };
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => g.text).join("\n");
const questions = (path: PlannedPath) => path.askCounselor.map((q) => q.text);
const typesAt = (path: PlannedPath, grade: number) => suggestions(path).filter((s) => s.grade === grade).map((s) => s.typeId);

/** A typed student and the same student with every kind confirmed: the typed one never claims more. */
function expectNoClaimFromAGuess(s: Omit<Scenario, "courses">, rows: Row[], goals: Goal[] = [], label = "") {
  const state = s.state!;
  const guessedPath = real({ ...s, courses: typed(state, rows) }, goals);
  const truth = real({ ...s, courses: typed(state, rows, true) }, goals);
  expect(claimsOnWaiting(guessedPath), `${label} claims about requirements waiting on a confirmation`).toEqual([]);
  expect(extraClaims(guessedPath, truth), `${label} claims only the guess makes`).toEqual([]);
  return { guessedPath, truth };
}

// Typed-names-only students ------------------------------------------------------------------------

const TX_ROWS: Row[] = [
  ["English I", "english", 9],
  ["Algebra I", "math", 9],
  ["Biology", "science", 9],
  ["World Geography", "social_studies", 9],
  ["Spanish I", "world_language", 9],
  ["Athletics", "health_pe", 9],
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
  ["Government", "social_studies", 12, { units: 2 }],
  ["Economics", "social_studies", 12, { units: 2 }],
];

const TN_ROWS: Row[] = [
  ["English I", "english", 9],
  ["Algebra I", "math", 9],
  ["Biology", "science", 9],
  ["World History", "social_studies", 9],
  ["Lifetime Wellness", "health_pe", 9],
  ["Spanish I", "world_language", 9],
  ["English II", "english", 10],
  ["Geometry", "math", 10],
  ["Chemistry", "science", 10],
  ["Spanish II", "world_language", 10],
  ["PE", "health_pe", 10, { units: 2 }],
  ["Art", "arts", 10],
  ["English III", "english", 11],
  ["Algebra II/Trigonometry", "math", 11],
  ["Physics", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["Computer Science Foundations", "computer_science", 11],
  ["English IV", "english", 12],
  ["Precalculus", "math", 12],
  ["Economics", "social_studies", 12, { units: 2 }],
  ["Personal Finance", "social_studies", 12, { units: 2 }],
];

const UT_ROWS: Row[] = [
  ["English 9", "english", 9],
  ["Secondary Math I", "math", 9],
  ["Earth Science", "science", 9],
  ["Geography", "social_studies", 9, { units: 2 }],
  ["Fitness for Life", "health_pe", 9, { units: 2 }],
  ["Health", "health_pe", 9, { units: 2 }],
  ["Exploring Computer Science", "computer_science", 9, { units: 2 }],
  ["English 10", "english", 10],
  ["Secondary Math II", "math", 10],
  ["Biology", "science", 10],
  ["World History", "social_studies", 10, { units: 2 }],
  ["Weight Training", "health_pe", 10, { units: 2 }],
  ["Ceramics", "arts", 10],
  ["English 11", "english", 11],
  ["Secondary Math III", "math", 11],
  ["Chemistry", "science", 11],
  ["U.S. History", "social_studies", 11],
  ["Yoga", "health_pe", 11, { units: 2 }],
  ["Welding", "career_technical", 11],
  ["English 12", "english", 12],
  ["Statistics", "math", 12],
  ["American Constitutional Government", "social_studies", 12],
];

/** The rows a student in `grade` has recorded: everything before their grade and this year's. */
const upTo = (rows: Row[], grade: number) => rows.filter(([, , g]) => g <= grade);

describe("Confirm first: a guessed class kind never creates a claim by itself (engine/confirm.ts)", () => {
  const cases: [PlannerState, Row[], Omit<Scenario, "courses" | "state" | "grade">, Goal[]][] = [
    ["TX", TX_ROWS, { colleges: [TAMU] }, ["nursing"]],
    ["TX", TX_ROWS, { choices: { txEndorsements: ["stem"] } }, ["engineering"]],
    ["TN", TN_ROWS, { colleges: [UTK] }, ["engineering"]],
    ["TN", TN_ROWS, { colleges: [UTC] }, ["visual_arts"]],
    ["UT", UT_ROWS, { colleges: [USU] }, ["nursing"]],
    ["UT", UT_ROWS, { path: "training" }, ["manufacturing"]],
  ];
  for (const [state, rows, extra, goals] of cases) {
    for (const grade of [9, 10, 11, 12] as SchoolGrade[]) {
      it(`${state} ${grade}th grader, ${goals.join(", ")}: typed names claim nothing the confirmed kinds wouldn't`, () => {
        const { guessedPath } = expectNoClaimFromAGuess({ state, grade, ...extra }, upTo(rows, grade), goals, `${state} ${grade}`);
        // Every typed row is listed to confirm, and none of their names reaches the output.
        expect(guessedPath.confirm.length).toBe(upTo(rows, grade).length);
      });
    }
  }

  // The structural guarantee: whatever the guesser gets wrong about a class its name still names,
  // the plan claims nothing the right kind wouldn't. Each typed row in turn is guessed as the
  // subject's "Other" class (the guesser placed nothing) and as another kind its subject has (AP
  // Language for "Pre-AP English I", Chemistry for "Biology"). A math rung guessed wrong is the one
  // place a guess still steers the plan (the next rung follows it): the round-9 math misses are
  // pinned on their own below.
  it("any one class guessed wrong (its name still naming the right kind) adds no claim, in Texas, Tennessee and Utah", () => {
    const WRONG: Partial<Record<CourseTypeId, CourseTypeId>> = {
      "ela.9": "ela.lang_comp",
      "ela.10": "ela.11",
      "ela.11": "ela.lit_comp",
      "sci.bio": "sci.chem",
      "sci.chem": "sci.phys",
      "ss.world_geo": "ss.world_hist",
      "ss.us_hist": "ss.us_gov",
      "pe.lifetime": "pe.fitness",
    };
    const personas: [PlannerState, Row[], Omit<Scenario, "courses" | "state" | "grade">, Goal[]][] = [
      ["TX", upTo(TX_ROWS, 11), { colleges: [TAMU] }, ["nursing"]],
      ["TN", upTo(TN_ROWS, 11), { colleges: [UTK] }, ["engineering"]],
      ["UT", upTo(UT_ROWS, 11), { colleges: [USU] }, ["nursing"]],
    ];
    let checked = 0;
    for (const [state, rows, extra, goals] of personas) {
      const truth = real({ state, grade: 11, ...extra, courses: typed(state, rows, true) }, goals);
      rows.forEach(([name, subject], k) => {
        const guess = guessCourseTypeId(name, subject, state);
        const math = getCourseType(guess).ladder?.id === "math";
        for (const wrong of [WRONG[guess], getCourseType(guess).fallback || math ? undefined : guessCourseType(`zzz`, subject, state).typeId]) {
          if (!wrong || wrong === guess) continue;
          const misguessed = rows.map((r, j): Row => (j === k ? [r[0], r[1], r[2], { ...r[3], as: wrong }] : r));
          const path = real({ state, grade: 11, ...extra, courses: typed(state, misguessed) }, goals);
          const label = `${state}: "${name}" guessed as ${wrong}`;
          expect(claimsOnWaiting(path), label).toEqual([]);
          expect(extraClaims(path, truth), label).toEqual([]);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("the round-9 misses, with the old wrong guesses forced: no false \"doesn't fit\", \"needs a plan now\" or \"Required by\"", () => {
    // N32 (Tennessee 11th, civil engineer): "Algebra II/Trigonometry" read as Trigonometry.
    const n32: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["Spanish I", "world_language", 10],
      ["English III", "english", 11],
      ["Algebra II/Trigonometry", "math", 11, { as: "math.trig" }],
      ["Physics", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Spanish II", "world_language", 11],
    ];
    const { guessedPath: tn } = expectNoClaimFromAGuess({ state: "TN", grade: 11 }, n32, ["engineering"], "N32");
    expect(gapLines(tn)).not.toMatch(/Algebra II .*doesn't fit/);
    expect(requirement(tn, "tn.grad", "math.alg2").status).toBe("waiting_confirm");
    expect(requirement(tn, "tn.grad", "math.alg2").modifiers).not.toContain("needs_plan_now");

    // N31 (Texas 11th, accountant, Business and Industry): Pre-AP English I read as AP Language,
    // "Algebra II/Trigonometry" as Trigonometry.
    const n31: Row[] = [
      ["Pre-AP English Language Arts I", "english", 9, { as: "ela.lang_comp" }],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World Geography", "social_studies", 9],
      ["Spanish I", "world_language", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["World History", "social_studies", 10],
      ["Spanish II", "world_language", 10],
      ["English III", "english", 11],
      ["Algebra II/Trigonometry", "math", 11, { as: "math.trig" }],
      ["Physics", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Accounting I", "career_technical", 11],
    ];
    const { guessedPath: tx } = expectNoClaimFromAGuess({ state: "TX", grade: 11, choices: { txEndorsements: ["business_industry"] } }, n31, ["business"], "N31");
    expect(gapLines(tx)).not.toMatch(/English I\b.*doesn't fit|A 4th math credit\. It doesn't fit|Algebra II.*doesn't fit/);
    expect(requirement(tx, "tx.fhsp.grad", "ela.1").status).toBe("waiting_confirm");
    expect(requirement(tx, "tx.dla", "dla.alg2").status).toBe("waiting_confirm");
    // The DLA's "on schedule" check doesn't call Algebra II missing either.
    const onSchedule = tx.audit.find((a) => a.ruleSetId === "tx.dla")!.checks.find((c) => c.checkId === "dla.on-schedule")!;
    expect(onSchedule.status).not.toBe("room_to_add");
    // No second Algebra II for a row that might be it.
    expect(suggestions(tx).map((s) => s.typeId)).not.toContain("math.alg2");
  });

  it("a class name the guesser can't place (\"Math Lab\", Tennessee's \"Geography\") waits: no class is \"Required by\" what it might be", () => {
    const rows: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["Geography", "social_studies", 9],
      ["English II", "english", 10],
      ["Math Lab", "math", 10],
      ["Chemistry", "science", 10],
    ];
    const { guessedPath } = expectNoClaimFromAGuess({ state: "TN", grade: 10, colleges: [UTK] }, rows, ["nursing"], "fallbacks");
    // Whatever math it suggests after "Math Lab", none is "Required by" a rung "Math Lab" might be.
    for (const s of suggestions(guessedPath).filter((x) => /^math\.(alg2|geom|int[23])$/.test(x.typeId))) {
      expect(reasonsOf(s), s.typeId).not.toMatch(/Required by Tennessee: (Geometry|Algebra II)/);
    }
    expect(guessedPath.confirm.find((c) => c.guess === null || getCourseType(c.guess).subject === "social_studies")).toBeDefined();
  });

  it("a typed career class never picks the plan's Texas endorsement or pathway (the route follows confirmed kinds only)", () => {
    const rows: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["Introduction to Welding", "career_technical", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["Welding I", "career_technical", 10],
      ["English III", "english", 11],
    ];
    const guessedPath = real({ state: "TX", grade: 11, courses: typed("TX", rows) });
    const truth = real({ state: "TX", grade: 11, courses: typed("TX", rows, true) });
    const endorsement = (p: PlannedPath) => p.audit.find((a) => a.ruleSetId.startsWith("tx.endorse."))?.ruleSetId ?? null;
    // Confirmed welding classes lead to Business and Industry; typed ones don't choose anything for the student.
    expect(endorsement(truth)).toBe("tx.endorse.business");
    expect(endorsement(guessedPath)).not.toBe("tx.endorse.business");
    expect(allReasons(guessedPath)).not.toMatch(/You're taking manufacturing classes/);
  });

  it("the printed questions always keep one line about the classes still to confirm", () => {
    const path = real({ state: "TX", grade: 11, courses: typed("TX", upTo(TX_ROWS, 11)), choices: { txEndorsements: ["public_services"] } }, ["nursing"]);
    expect(path.askCounselor.length).toBeLessThanOrEqual(8);
    expect(path.askCounselor.at(-1)?.text ?? "").toMatch(/Some of my classes' kinds are guesses: they look like .+\. Do they count that way for graduation\?/);
    const confirmed = real({ state: "TX", grade: 11, courses: typed("TX", upTo(TX_ROWS, 11), true), choices: { txEndorsements: ["public_services"] } }, ["nursing"]);
    expect(questions(confirmed).join("\n")).not.toMatch(/guesses|guess\./);
  });

  it("\"Confirm your classes\" lists the rows a requirement waits on first, with the class the plan took them for", () => {
    const path = real({ state: "UT", grade: 10, courses: typed("UT", upTo(UT_ROWS, 10)) }, ["nursing"]);
    expect(path.confirm[0].decides).toBeGreaterThan(0);
    const decides = path.confirm.map((c) => c.decides > 0);
    expect(decides).toEqual([...decides].sort((a, b) => Number(b) - Number(a)));
    const byName = new Map(input({ state: "UT", grade: 10, courses: typed("UT", upTo(UT_ROWS, 10)) }).courses.map((c) => [c.id, c.name]));
    const weight = path.confirm.find((c) => byName.get(c.courseId) === "Weight Training")!;
    expect(weight.guess).toBe("pe.lifetime");
    expect(JSON.stringify(path.confirm)).not.toMatch(/Weight Training|Ceramics/);
  });
});

// 1. Language levels: skipped levels and placed students --------------------------------------------

describe("Language levels count levels reached, not exact ranks (allocate.ts languageProgress, fill.ts)", () => {
  it("each class fills one level at or below its own", () => {
    const item = (typeId: CourseTypeId, grade: number, firm = true) =>
      itemFromFact({ ...input({ state: "TX", grade: 10, courses: [{ type: typeId, grade: grade as SchoolGrade }] }).courses[0], status: firm ? "completed" : "planned" });
    const count = (types: [CourseTypeId, number][], levels: number) => languageLevelsFilled(types.map(([t, g]) => item(t, g)), levels).length;
    expect(count([["lang.es.1", 9], ["lang.es.3", 10]], 2)).toBe(2);
    expect(count([["lang.es.3", 10]], 2)).toBe(1);
    expect(count([["lang.es.1", 9], ["lang.es.1", 10]], 2)).toBe(1);
    expect(count([["lang.es.2", 9], ["lang.es.3", 10], ["lang.es.4", 11]], 4)).toBe(3);
    expect(count([["lang.es.1", 9], ["lang.es.2", 10], ["lang.es.3", 11], ["lang.es.4", 12]], 4)).toBe(4);
  });

  it("N20 (Texas 10th, nurse): Spanish for Heritage Speakers and Spanish III are two levels: no language gap, kinds typed or confirmed", () => {
    const rows: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World Geography", "social_studies", 9],
      ["Spanish for Heritage Speakers", "world_language", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["World History", "social_studies", 10],
      ["Spanish III", "world_language", 10],
    ];
    for (const confirmed of [false, true]) {
      const path = real({ state: "TX", grade: 10, courses: typed("TX", rows, confirmed) }, ["nursing"]);
      expect(gapLines(path), `confirmed=${confirmed}`).not.toMatch(/language/i);
      expect(allReasons(path), `confirmed=${confirmed}`).not.toMatch(/Two levels of the same language/);
      expect(suggestions(path).map((s) => s.typeId), `confirmed=${confirmed}`).not.toEqual(expect.arrayContaining(["lang.es.1"]));
    }
    const confirmed = real({ state: "TX", grade: 10, courses: typed("TX", rows, true) }, ["nursing"]);
    expect(requirement(confirmed, "tx.fhsp.grad", "lote.same")).toMatchObject({ status: "done", firm: 2 });
  });

  it("X2 (Texas, typed Spanish I and Spanish III) and E9 (Tennessee senior, Spanish for Native Speakers and Spanish III): met", () => {
    const x2 = real({ state: "TX", grade: 11, courses: typed("TX", [["Spanish I", "world_language", 9], ["Spanish III", "world_language", 10]], true) });
    expect(requirement(x2, "tx.fhsp.grad", "lote.same").status).toBe("done");
    const e9 = real({ state: "TN", grade: 12, courses: typed("TN", [["Spanish for Native Speakers", "world_language", 10], ["Spanish III", "world_language", 11]], true) });
    expect(gapLines(e9)).not.toMatch(/same world language/);
    expect(requirement(e9, "tn.grad", "wl.same").status).toBe("done");
  });

  it("X3 (Texas 10th, Spanish III only): the next level is Spanish IV, never Spanish I or II", () => {
    const path = real({ state: "TX", grade: 10, courses: typed("TX", [["English II", "english", 10], ["Spanish III", "world_language", 10]], true) }, ["nursing"]);
    const langs = suggestions(path).filter((s) => s.typeId.startsWith("lang."));
    expect(langs.map((s) => s.typeId)).toEqual(["lang.es.4"]);
    // Texas's list has a regular Spanish IV (TEKS Level IV), not only AP (round 9, problem 13).
    expect(langs[0].level).toBe("regular");
    expect(gapLines(path)).not.toMatch(/Spanish (I|II)\b/);
  });

  it("X5 (Utah 10th, Spanish 3, Utah State): never \"Take Spanish I online\"", () => {
    const path = real({ state: "UT", grade: 10, colleges: [USU], courses: typed("UT", [["English 10", "english", 10], ["Spanish 3", "world_language", 10]], true) }, ["nursing"]);
    expect(gapLines(path) + path.gaps.flatMap((g) => g.options.map((o) => o.text)).join("\n")).not.toMatch(/Spanish (I|II)\b/);
    expect(suggestions(path).map((s) => s.typeId)).not.toEqual(expect.arrayContaining(["lang.es.1", "lang.es.2"]));
  });
});

// 2, 3, 9. The guesser's known misses -----------------------------------------------------------------

describe("The guesser's known misses (course-type-guess.ts)", () => {
  it("Algebra II with trigonometry is Algebra II; Pre-AP English is English; Utah's lifetime PE; a bare Geography in Texas and Utah", () => {
    const cases: [string, CourseSubject, PlannerState, CourseTypeId][] = [
      ["Algebra II/Trigonometry", "math", "TN", "math.alg2"],
      ["Alg 2/Trig", "math", "TX", "math.alg2"],
      ["Algebra 2 Trig Honors", "math", "TX", "math.alg2"],
      ["Trigonometry", "math", "TX", "math.trig"],
      ["Pre-AP English Language Arts I", "english", "TX", "ela.9"],
      ["Pre-AP English II", "english", "TX", "ela.10"],
      ["Pre AP English Language Arts II", "english", "TX", "ela.10"],
      ["AP English Language and Composition", "english", "TX", "ela.lang_comp"],
      ["Weight Training", "health_pe", "UT", "pe.lifetime"],
      ["Weightlifting", "health_pe", "UT", "pe.lifetime"],
      ["Yoga", "health_pe", "UT", "pe.lifetime"],
      ["Walking Fitness", "health_pe", "UT", "pe.lifetime"],
      ["Fitness for Life", "health_pe", "UT", "pe.fitness"],
      ["Weight Training", "health_pe", "TX", "pe.other"],
      ["Geography", "social_studies", "TX", "ss.world_geo"],
      ["Geography", "social_studies", "UT", "ss.world_geo"],
      ["Geography", "social_studies", "TN", "ss.other"],
    ];
    for (const [name, subject, state, expected] of cases) expect(guessCourseTypeId(name, subject, state), `${name} (${state})`).toBe(expected);
  });

  it("says how sure a guess is, and every kind the row might be", () => {
    expect(guessCourseType("Algebra II/Trigonometry", "math", "TN")).toEqual({ typeId: "math.alg2", confident: true, candidates: ["math.alg2"] });
    expect(guessCourseType("Chemistry", "science", "TX")).toMatchObject({ confident: true, candidates: ["sci.chem"] });
    // A catch-all: any PE class.
    const pe = guessCourseType("PE", "health_pe", "UT");
    expect(pe.confident).toBe(false);
    expect(pe.candidates).toEqual(expect.arrayContaining(["pe.general", "pe.fitness", "pe.lifetime", "pe.skills"]));
    // A language without a level might be any level.
    expect(guessCourseType("Spanish for Heritage Speakers", "world_language", "TX")).toEqual({
      typeId: "lang.es.1",
      confident: false,
      candidates: ["lang.es.1", "lang.es.2", "lang.es.3", "lang.es.4"],
    });
    expect(guessCourseType("Spanish I", "world_language", "TX")).toMatchObject({ confident: true });
    // Nothing the guesser knows: any kind in the subject.
    const lab = guessCourseType("Math Lab", "math", "TX");
    expect(lab).toMatchObject({ typeId: "math.other", confident: false });
    expect(lab.candidates.length).toBeGreaterThan(20);
    // A career cluster's catch-all: any level of it.
    expect(guessCourseType("Welding", "career_technical", "TX").candidates).toEqual(expect.arrayContaining(["cte.manufacturing.1", "cte.manufacturing.2", "cte.manufacturing.3"]));
  });

  it("N15 and N33 (Utah): typed Weight Training, Yoga and Geography aren't doubled by \"Required by Utah\" classes", () => {
    const rows: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["Biology", "science", 9],
      ["Geography", "social_studies", 9, { units: 2 }],
      ["Fitness for Life", "health_pe", 9, { units: 2 }],
      ["Weight Training", "health_pe", 10, { units: 2 }],
      ["English 10", "english", 10],
      ["Secondary Math II", "math", 10],
      ["Yoga", "health_pe", 11, { units: 2 }],
      ["English 11", "english", 11],
    ];
    for (const confirmed of [false, true]) {
      const path = real({ state: "UT", grade: 11, courses: typed("UT", rows, confirmed) });
      const types = suggestions(path).map((s) => s.typeId);
      expect(types, `confirmed=${confirmed}`).not.toContain("pe.lifetime");
      expect(types, `confirmed=${confirmed}`).not.toContain("ss.world_geo");
      expect(allReasons(path), `confirmed=${confirmed}`).not.toMatch(/Individualized Lifetime Activities|World geography/);
    }
  });

  it("N19 (Utah 11th, Secondary Math III opt-out, typed \"Math for Everyday Life\"): not planned as Secondary Math III, and no applied class added over it", () => {
    const rows: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["English 10", "english", 10],
      ["Secondary Math II", "math", 10],
      ["English 11", "english", 11],
      ["Math for Everyday Life", "math", 11],
    ];
    const path = real({ state: "UT", grade: 11, path: "training", choices: { utMath3OptOut: true }, courses: typed("UT", rows) }, ["manufacturing"]);
    const warnings = path.plans[0]!.years.flatMap((y) => y.slots.flatMap((s) => (s.kind === "yours" ? s.warnings.map((w) => w.text) : [])));
    expect(warnings.join("\n")).not.toMatch(/Secondary Mathematics III/);
    expect(allReasons(path)).not.toMatch(/A third math credit from the state's applied list/);
    expect(requirement(path, "ut.grad", "math.third.applied").status).toBe("waiting_confirm");
  });
});

// 4. The DLA's test-score route replaces the program, not a class --------------------------------------

describe("The DLA's test-score route is asked about as the program (questions.ts)", () => {
  it("N11 (Texas 10th, musician, the DLA, a 4th math that doesn't fit): \"instead of the DLA's classes\", never a test in place of a 4th math credit", () => {
    const path = real({
      state: "TX",
      grade: 10,
      courses: typed("TX", [["English I", "english", 9], ["Band", "arts", 9], ["Biology", "science", 9], ["English II", "english", 10], ["Algebra I", "math", 10], ["Band", "arts", 10]], true),
    }, ["music"]);
    // The DLA's 4th math doesn't fit, and its only test route is the program's.
    const dla = path.gaps.find((g) => g.demandId === "tx.dla/dla.math4")!;
    expect(dla.options.map((o) => o.kind)).toContain("test_score");
    const text = questions(path).join("\n");
    expect(text).toContain("Should I aim for the test-score route to automatic admission instead of the Distinguished Level of Achievement's classes? Which scores count now?");
    expect(text).not.toMatch(/show (a 4th math credit|Algebra II) with a test score/);
  });

  it("Utah's senior-year math keeps the per-requirement question (its test route shows that one requirement)", () => {
    const path = real({
      state: "UT",
      grade: 12,
      courses: typed("UT", [["English 12", "english", 12], ["Secondary Math I", "math", 9], ["Secondary Math II", "math", 10], ["Secondary Math III", "math", 11]], true),
    });
    const text = questions(path).join("\n");
    if (/test score/.test(text)) expect(text).toMatch(/Should I plan to show college-ready math \(Utah's senior-year math\) with a test score or with a class/);
  });
});

// 5. Computer Science Principles isn't suggested to a student past it -----------------------------------

describe("A key course the student is past isn't suggested (course-types introTo, needs.ts metBy)", () => {
  it("N17 (Texas 11th: CS I, AP CS A, CS III) and E8 (Texas 10th: CS I, AP CS A now): no Computer Science Principles", () => {
    const n17: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Computer Science I", "computer_science", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["AP Computer Science A", "computer_science", 10, { level: "ap" }],
      ["English III", "english", 11],
      ["Algebra II", "math", 11],
      ["Computer Science III", "computer_science", 11],
    ];
    const e8 = n17.filter(([, , g]) => g <= 10);
    for (const [grade, rows] of [[11, n17], [10, e8]] as const) {
      const path = real({ state: "TX", grade, choices: { txEndorsements: ["stem"] }, courses: typed("TX", rows, true) }, ["computer_data_science"]);
      expect(suggestions(path).map((s) => s.typeId), `${grade}th`).not.toContain("cs.principles");
    }
  });
});

// 6. Utah's senior-year math after College Algebra ------------------------------------------------------

describe("Utah's senior-year math after College Algebra (fill.ts seniorMathOrder, course-types calculus prerequisite)", () => {
  const F8: Row[] = [
    ["English 9", "english", 9],
    ["Secondary Math I", "math", 9],
    ["Biology", "science", 9],
    ["Child Development", "career_technical", 9],
    ["English 10", "english", 10],
    ["Secondary Math II", "math", 10],
    ["Chemistry", "science", 10],
    ["Teaching as a Profession 1", "career_technical", 10],
    ["English 11", "english", 11],
    ["Secondary Math III", "math", 11, { term: "fall", units: 2 }],
    ["Math 1050", "math", 11, { level: "dual_enrollment", term: "spring", units: 2 }],
  ];

  it("F8 (Utah 11th, elementary teacher, CE Math 1050 now, competency not recorded): no calculus in 12th; the counselor question instead", () => {
    const path = real({ state: "UT", grade: 11, colleges: [WEBER], courses: typed("UT", F8, true) }, ["education"]);
    expect(typesAt(path, 12)).not.toContain("math.calc");
    expect(gapLines(path)).toMatch(/a C in your concurrent enrollment math class may already show college-ready math\. Ask your counselor; if it doesn't, plan a full year of math in 12th grade\./);
  });

  it("without a college-credit math class, a senior math class after College Algebra is statistics for a goal that doesn't ask for calculus", () => {
    const rows = F8.map(([n, s, g, e]): Row => (n === "Math 1050" ? [n, s, g, { ...e, level: "regular" }] : [n, s, g, e]));
    const path = real({ state: "UT", grade: 11, colleges: [WEBER], courses: typed("UT", rows, true) }, ["education"]);
    const senior = suggestions(path).filter((s) => s.grade === 12 && s.typeId.startsWith("math."));
    expect(senior.map((s) => s.typeId)).not.toContain("math.calc");
  });
});

// 7. Credits that fit only in 12th grade ------------------------------------------------------------

describe("A total that needs classes in 12th grade is a gap that says so (gaps.ts)", () => {
  it("N19 (Utah 11th, welder): 2 credits short of 24 with 12th grade half empty: \"Plan 2 more credits in 12th grade\"", () => {
    const rows: Row[] = [
      ["English 9", "english", 9],
      ["Secondary Math I", "math", 9],
      ["Earth Science", "science", 9],
      ["Geography for Life", "social_studies", 9, { units: 2 }],
      ["Fitness for Life", "health_pe", 9, { units: 2 }],
      ["Health", "health_pe", 9, { units: 2 }],
      ["Exploring Computer Science", "computer_science", 9, { units: 2 }],
      ["Ceramics", "arts", 9],
      ["English 10", "english", 10],
      ["Secondary Math II", "math", 10],
      ["Biology", "science", 10],
      ["World History", "social_studies", 10, { units: 2 }],
      ["Participation Skills", "health_pe", 10, { units: 2 }],
      ["Lifetime Activities", "health_pe", 10, { units: 2 }],
      ["Painting", "arts", 10],
      ["Welding", "career_technical", 10],
      ["English 11", "english", 11],
      ["Secondary Math III", "math", 11],
      ["Chemistry", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Drawing", "arts", 11],
      ["Welding 2", "career_technical", 11],
    ];
    const path = real({ state: "UT", grade: 11, path: "training", limits: { classesPerYear: 7 }, courses: typed("UT", rows, true) }, ["manufacturing"]);
    const gap = path.gaps.find((g) => g.id === "gap:ut.grad/total")!;
    expect(gap).toMatchObject({ kind: "unmet", priority: 0, text: "Room to add: total credits needs 2 more. Plan 2 more credits in 12th grade (your open periods)." });
    expect(gap.reasons.map((r) => r.text).join(" ")).toMatch(/A shorter senior day \(release time or early out\) could leave you short/);
    // 12th grade never gets a "Your choice" slot; the credits it needs show as this gap instead.
    const twelfth = path.plans[0]!.years.find((y) => y.grade === 12)!;
    expect(twelfth.slots.some((s) => s.kind === "your_choice")).toBe(false);
    expect(twelfth.capacity.used).toBeLessThan(twelfth.capacity.classes);
  });

  it("no such gap when the room is before 12th grade, or when only this spring's open periods would hold it", () => {
    const early = real({ state: "UT", grade: 9, courses: typed("UT", [["English 9", "english", 9], ["Secondary Math I", "math", 9]], true) });
    expect(gapLines(early)).not.toMatch(/in 12th grade \(your open periods\)/);
    expect(gapLines(early)).not.toMatch(/Plan 0 more/);
  });
});

// 8. An admission gap in the year in progress ---------------------------------------------------------

describe("A class the year in progress has room for isn't called \"doesn't fit\" (gaps.ts, fill.ts fitsThisYear)", () => {
  it("F3 (Tennessee 12th, graphic designer, UT Chattanooga, no arts class, open periods): ask about adding it this year", () => {
    const rows: Row[] = [
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
      ["PE", "health_pe", 10, { units: 2 }],
      // Tennessee's fine arts credit (a CTE substitute, Policy 3.103), not UT Chattanooga's art unit.
      ["Digital Arts and Design", "career_technical", 10],
      ["English III", "english", 11],
      ["Algebra II", "math", 11],
      ["Physics", "science", 11],
      ["U.S. History", "social_studies", 11],
      ["Computer Science Foundations", "computer_science", 11],
      ["English IV", "english", 12],
      ["Precalculus", "math", 12],
      ["Economics", "social_studies", 12, { units: 2 }],
      ["Personal Finance", "social_studies", 12, { units: 2 }],
    ];
    const path = real({ state: "TN", grade: 12, colleges: [UTC], courses: typed("TN", rows, true) }, ["visual_arts"]);
    const arts = path.gaps.filter((g) => g.demandId?.startsWith("utc.units/"));
    expect(arts.length).toBeGreaterThan(0);
    for (const g of arts) {
      expect(g.text).not.toMatch(/doesn't fit/);
      expect(g.text).toMatch(/This school year has started; ask your counselor whether you can still add it this year \(or this spring\)\./);
    }
  });
});

// 11. A career pathway's next level comes from the ladder ------------------------------------------------

describe("The next pathway level is the one above the student's highest (fill.ts cteReached)", () => {
  it("two level-1 classes lead to level 2, never level 3 without it (F8 Utah education, E4 Tennessee construction)", () => {
    const f8 = input({ state: "UT", grade: 11, courses: typed("UT", [["Child Development", "career_technical", 9], ["Teaching as a Profession 1", "career_technical", 10]], true) });
    expect(cteReached(f8.courses.map(itemFromFact), "education")).toBe(1);
    const e4 = input({ state: "TN", grade: 11, courses: typed("TN", [["Fundamentals of Construction", "career_technical", 9], ["Residential & Commercial Construction I", "career_technical", 10]], true) });
    expect(cteReached(e4.courses.map(itemFromFact), "architecture_construction")).toBe(1);
    const path = real({ state: "TN", grade: 11, path: "training", courses: typed("TN", [["English I", "english", 9], ["Fundamentals of Construction", "career_technical", 9], ["English II", "english", 10], ["Residential & Commercial Construction I", "career_technical", 10]], true) }, ["construction_trades"]);
    const levels = suggestions(path).filter((s) => s.typeId.startsWith("cte.architecture_construction.")).map((s) => [s.grade, getCourseType(s.typeId).ladder!.rank]);
    if (levels.length) expect(levels[0][1]).toBe(2);
    for (const [, rank] of levels) expect(rank).toBeGreaterThan(1);
  });

  it("where names can't tell levels apart (Tennessee's Engineering Design), the years still count", () => {
    const n32 = input({ state: "TN", grade: 11, courses: typed("TN", [["Principles of Engineering and Technology", "career_technical", 9], ["Engineering Design I", "career_technical", 10]], true) });
    expect(cteReached(n32.courses.map(itemFromFact), "engineering")).toBe(2);
  });
});

// 12. An AP or IB focus puts AP U.S. History in 11th ----------------------------------------------------

describe("An AP or IB focus doesn't stack 10th grade (fill.ts upgradeForCollegeOnlyNeeds)", () => {
  it("N38 (Tennessee 9th, chemical engineer, AP/IB focus): AP U.S. History in its usual year when 11th has room", () => {
    const rows: Row[] = [["English I", "english", 9], ["Algebra I", "math", 9], ["Biology", "science", 9], ["World History", "social_studies", 9], ["Spanish I", "world_language", 9], ["Lifetime Wellness", "health_pe", 9]];
    const path = real({ state: "TN", grade: 9, choices: { tnElectiveFocus: "ap_ib" }, courses: typed("TN", rows, true) }, ["engineering"]);
    const apus = suggestions(path).find((s) => s.typeId === "ss.us_hist" && s.level === "ap");
    if (apus) expect(apus.grade).toBe(11);
    const tenthAp = suggestions(path).filter((s) => s.grade === 10 && ["ss.us_hist", "ss.world_hist"].includes(s.typeId) && s.level === "ap");
    expect(tenthAp).toEqual([]);
  });
});

// 13. Texas's list has a regular Spanish IV ------------------------------------------------------------

describe("Texas's generic list offers regular Spanish IV (tx/generic-catalog.json)", () => {
  it("the Arts and Humanities language route isn't presented as AP", () => {
    const rows: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Spanish I", "world_language", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Spanish II", "world_language", 10],
      ["Spanish III", "world_language", 10],
    ];
    const path = real({ state: "TX", grade: 10, choices: { txEndorsements: ["arts_humanities"] }, courses: typed("TX", rows, true) }, ["humanities"]);
    for (const s of suggestions(path).filter((x) => x.typeId === "lang.es.4")) expect(s.level).not.toBe("ap");
    const catalog = plannerContentFor("TX").genericCatalog.courses.find((c) => c.typeId === "lang.es.4")!;
    expect(catalog.levels).toEqual(expect.arrayContaining(["regular", "honors"]));
  });
});

// 14. Counselor question copy ---------------------------------------------------------------------------

describe("Counselor question wording (questions.ts)", () => {
  it("N12 (Utah 10th, moved from Texas with Algebra I): \"Does my Algebra I count\" for one class", () => {
    const path = real({ state: "UT", grade: 10, cohort: {}, courses: typed("UT", [["English 9", "english", 9], ["Algebra I", "math", 9], ["English 10", "english", 10]], true) });
    const text = questions(path).join("\n");
    expect(text).not.toMatch(/Do my Algebra I count/);
    if (/count as .* here\?/.test(text)) expect(text).toMatch(/Does my Algebra I count as .* here\?/);
  });

  it("a question that starts with a college's name starts with a capital letter", () => {
    for (const state of ["TN", "TX", "UT"] as const) {
      const rules = plannerContentFor(state).rules.flatMap((f) => f.ruleSets).filter((rs) => rs.confidence === "conflicting");
      for (const rs of rules) {
        const colleges = rs.appliesWhen.colleges ?? [];
        if (!colleges.length) continue;
        const path = real({ state, grade: 10, colleges: [{ unitId: colleges[0], name: rs.issuer.name, state, public: true, admissionRate: 0.7, openAdmission: null }] });
        for (const q of questions(path)) expect(q.charAt(0), q).toBe(q.charAt(0).toUpperCase());
      }
    }
  });
});

// The claims helper itself -----------------------------------------------------------------------------

describe("the claims the confirm-first tests compare (testing/claims.ts)", () => {
  it("reads doesn't-fit gaps, needs-a-plan-now slots and Required-by reasons, keyed by requirement", () => {
    const path = real({ state: "TX", grade: 12, courses: typed("TX", [["English IV", "english", 12]], true) });
    const all = [...claims(path)];
    expect(all.some((c) => c.startsWith("required:") || c.startsWith("gap:") || c.startsWith("now:"))).toBe(true);
  });
});
