import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db, schema } from "@/db";
import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolGrade } from "../common";
import { plannerContentFor } from "../content";
import { guessCourseTypeId } from "../course-type-guess";
import { type CourseTypeId, getCourseType } from "../course-types";
import type { CollegeTarget, FamilyTarget, PlannedPath, PlannerInput, PlanSlot } from "../engine-io";
import type { FamilyId } from "../families";
import type { Req, RuleFile, Selector } from "../rules";
import { studentPath } from "../service";
import { walkReqs } from "../validate";
import { belowPrecalculus, pastCteLevel } from "./fill";
import { plan } from "./index";
import { solveLadder } from "./ladder";
import { itemFromFact } from "./model";
import { claimsOnWaiting, extraClaims } from "./testing/claims";
import { planned, requirement, ruleSet, suggestions } from "./testing/helpers";
import { auditExactTitles, exactTitleClaims } from "./testing/exact";
import { type CourseSpec, type Scenario, scenario } from "./testing/input";
import { randomInput } from "./testing/random";

// Regression tests for the counselor's eighth review of the course planner (each block names the
// finding it pins). They run the engine on the real Utah, Tennessee and Texas content, with the
// students the reviewer described (T21, H28, H30, H29, H25, H21 ...), typed class names through the
// real guesser, and the typed-versus-confirmed pairs through studentPath too.

const UTK: CollegeTarget = { unitId: 221759, name: "UT Knoxville", state: "TN", public: true, admissionRate: 0.46, openAdmission: null };
const UTC: CollegeTarget = { unitId: 221740, name: "UT Chattanooga", state: "TN", public: true, admissionRate: 0.8, openAdmission: null };
const TAMU: CollegeTarget = { unitId: 228723, name: "Texas A&M", state: "TX", public: true, admissionRate: 0.63, openAdmission: null };
const UT_AUSTIN: CollegeTarget = { unitId: 228778, name: "UT Austin", state: "TX", public: true, admissionRate: 0.29, openAdmission: null };

type Goal = { familyId: FamilyId; because: string | null };

function input(s: Scenario, goals: Goal[] = []): PlannerInput {
  const i = scenario({ ...s, content: plannerContentFor(s.state!) });
  if (goals.length) i.targets.families = goals.map((g) => ({ familyId: g.familyId, source: "north_star" as FamilyTarget["source"], cip6: null, because: g.because }));
  return i;
}

/** A student on the real content, with goals named as the reviewer named them. */
function real(s: Scenario, goals: Goal[] = []): PlannedPath {
  return planned(plan(input(s, goals)));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;
const reasonsOf = (s: Suggested) => s.reasons.map((r) => r.text).join(" / ");
const allReasons = (path: PlannedPath) => suggestions(path).map(reasonsOf).join("\n");
const gapLines = (path: PlannedPath) => path.gaps.map((g) => `${g.text} :: ${g.reasons.map((r) => r.text).join(" / ")}`).join("\n");
const questions = (path: PlannedPath) => path.askCounselor.map((q) => q.text);
const typesAt = (path: PlannedPath, grade: number, id: "A" | "B" = "A") => suggestions(path, id).filter((s) => s.grade === grade).map((s) => s.typeId);
/** What a plan suggests, with each class's reasons: the same for a typed and a confirmed student. */
const signature = (path: PlannedPath) =>
  path.plans.map((p) => `${p.id}: ${suggestions(path, p.id).map((s) => `${s.grade} ${s.typeId} ${s.level} ${s.term} [${reasonsOf(s)}]`).join("\n")}`).join("\n\n");

const NURSE: Goal[] = [{ familyId: "nursing", because: "Registered Nurses" }];
const ENGINEER: Goal[] = [{ familyId: "engineering", because: "Mechanical Engineers" }];
const SOFTWARE: Goal[] = [{ familyId: "computer_data_science", because: "Software Developers" }];
const DESIGNER: Goal[] = [{ familyId: "visual_arts", because: "Graphic Designers" }];
const MECHANIC: Goal[] = [{ familyId: "transportation_maintenance", because: "Automotive Service Technicians and Mechanics" }];

/** A class the student typed, its kind guessed by the real guesser (`confirmed`: the same kind, picked). */
type Row = [name: string, subject: CourseSubject, grade: SchoolGrade, extra?: Partial<CourseSpec>];
const typed = (state: PlannerState, rows: Row[], confirmed = false): CourseSpec[] =>
  rows.map(([name, subject, grade, extra]) => ({ type: guessCourseTypeId(name, subject, state), grade, name, assumed: !confirmed, ...extra }));

function ruleFile(state: PlannerState, id: string): RuleFile {
  return plannerContentFor(state).rules.find((f) => f.id === id)!;
}
/** Every credits requirement with this id in a rule file (all variants). */
function leaves(file: RuleFile, reqId: string): Req[] {
  return file.ruleSets.flatMap((rs) => rs.variants.flatMap((v) => [...walkReqs(v.requirements)])).filter((r) => r.id === reqId && r.kind === "credits");
}
const selectedTypes = (r: Req): CourseTypeId[] => (r.kind === "credits" || r.kind === "count" ? r.select.flatMap((s: Selector) => s.types ?? []) : []);

// 1. The swap hint is checked on the plan ------------------------------------------------------------

describe("The gap's swap hint names a swap only when it works on the plan (gaps.ts swapHint, fill.ts missingWith)", () => {
  it("T21 (Texas 10th, W in Algebra I, retaking it now, nursing, Public Services): Statistics isn't offered in place of Algebra II", () => {
    const path = real(
      {
        state: "TX",
        grade: 10,
        choices: { txEndorsements: ["public_services"] },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "W" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
          { type: "pe.general", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.alg1", grade: 10 },
          { type: "sci.ipc", grade: 10 },
        ],
      },
      NURSE,
    );
    // The 12th-grade math is the student's 3rd: swapping it leaves 3 math credits, and Algebra II is the DLA's.
    expect(gapLines(path)).not.toMatch(/in place of Algebra II/);
    const gap = path.gaps.find((g) => g.id === "gap:tx.endorse.public-services/e.math4")!;
    expect(gap.text).toBe("Room to add: A 4th math credit. It doesn't fit in the years you have left as planned.");
  });

  it("J1 (Texas 11th, UT Austin, STEM): Personal Financial Literacy and Economics isn't offered in place of Economics (both half a credit)", () => {
    const rows: Row[] = [
      ["English I", "english", 9],
      ["Algebra I", "math", 9],
      ["Biology", "science", 9],
      ["World History", "social_studies", 9],
      ["Spanish I", "world_language", 9],
      ["English II", "english", 10],
      ["Geometry", "math", 10],
      ["Chemistry", "science", 10],
      ["Spanish II", "world_language", 10],
      ["English III", "english", 11],
      ["Algebra II", "math", 11],
      ["U.S. History", "social_studies", 11],
    ];
    for (const confirmed of [true, false]) {
      const path = real({ state: "TX", grade: 11, colleges: [UT_AUSTIN], choices: { txEndorsements: ["stem"] }, courses: typed("TX", rows, confirmed) }, SOFTWARE);
      expect(gapLines(path), `confirmed=${confirmed}`).not.toMatch(/in place of Economics/);
    }
  });

  it("H21 (Utah 11th, Secondary Math III opt-out): Secondary Math III is never offered in place of Statistics", () => {
    const path = real(H21_INPUT, DESIGNER);
    // Four years of high school math (the goal's) is still a gap: the swap would leave three years.
    expect(gapLines(path)).toMatch(/Room to add: Four years of high school math\./);
    expect(gapLines(path)).not.toMatch(/in place of/);
  });
});

// 2. Texas: the lab-based career classes on the science lists ------------------------------------------

describe("Texas: Engineering Science, Engineering Design and Problem Solving, Food Science and Advanced Plant and Soil Science count as science (tx/*.json, course-types.ts)", () => {
  const NEW: CourseTypeId[] = ["cte.plant_soil_science", "cte.food_science", "cte.engineering_problem_solving", "cte.engineering_science"];

  it("the content: the 3rd lab science, every 4th science and STEM's science routes list them, quoting 19 TAC §74.12(b)(3)(B)(xx)-(xxi) and §74.13(e)(6)(T)-(U)", () => {
    const grad = ruleFile("TX", "tx.graduation");
    const options = plannerContentFor("TX").rules.filter((f) => f.id !== "tx.graduation");
    const lists = [
      ...leaves(grad, "sci.third"),
      ...options.flatMap((f) => [...leaves(f, "e.science4"), ...leaves(f, "e.science4.lab"), ...leaves(f, "stem.science"), ...leaves(f, "stem.mixed.science"), ...leaves(f, "dla.science4")]),
    ];
    expect(lists.length).toBeGreaterThanOrEqual(18);
    for (const r of lists) for (const t of NEW) expect(selectedTypes(r), `${r.id} ${t}`).toContain(t);
    expect(grad.citations.find((c) => c.id === "tx-74-12-b3b-4")?.quote).toBe("(xx) Engineering Design and Problem Solving; (xxi) Engineering Science;");
    const e6 = options.flatMap((f) => f.citations).find((c) => c.id === "tx-74-13-e6-list-3");
    expect(e6?.quote).toBe("(T) Engineering Design and Problem Solving; (U) Engineering Science;");
    for (const r of leaves(grad, "sci.third")) expect(r.kind === "credits" && r.cite).toContain("tx-74-12-b3b-4");
  });

  it("the course types: career classes in their cluster at their TEA program-of-study level, filed under science too", () => {
    expect(getCourseType("cte.engineering_science").ladder).toEqual({ id: "cte.engineering", rank: 3 });
    expect(getCourseType("cte.engineering_problem_solving").ladder).toEqual({ id: "cte.engineering", rank: 4 });
    expect(getCourseType("cte.food_science").ladder).toEqual({ id: "cte.hospitality", rank: 4 });
    for (const t of NEW) expect(getCourseType(t).altSubjects, t).toContain("science");
  });

  const H28_ROWS: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["World Geography", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["Principles of Applied Engineering", "career_technical", 9],
    ["English II", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["World History", "social_studies", 10],
    ["Spanish II", "world_language", 10],
    ["Engineering Design and Presentation I", "career_technical", 10],
    ["English III", "english", 11],
    ["Algebra II", "math", 11],
    ["Physics", "science", 11],
    ["U.S. History", "social_studies", 11],
    ["Precalculus", "math", 11],
    ["Engineering Design and Presentation II", "career_technical", 11],
    ["English IV", "english", 12],
    ["AP Calculus AB", "math", 12, { level: "ap" }],
    ["Engineering Science", "science", 12],
    ["Engineering Design and Problem Solving", "career_technical", 12],
    ["Government", "social_studies", 12, { units: 2 }],
    ["Economics", "social_studies", 12, { units: 2 }],
  ];

  it.each([
    ["H28 (typed names)", false],
    ["J7 (kinds picked)", true],
  ])("%s: a class-of-2027 STEM senior with 4 sciences gets no Anatomy and Physiology for a 4th science", (_label, confirmed) => {
    const path = real({ state: "TX", grade: 12, colleges: [TAMU], choices: { txEndorsements: ["stem"] }, courses: typed("TX", H28_ROWS, confirmed as boolean) }, ENGINEER);
    expect(typesAt(path, 12)).not.toContain("sci.anat");
    expect(allReasons(path)).not.toMatch(/A 4th science credit/);
    for (const [rs, id] of [["tx.endorse.stem", "e.science4"], ["tx.dla", "dla.science4"]] as const) {
      expect(requirement(path, rs, id).modifiers, `${rs}/${id}`).not.toContain("needs_plan_now");
      if (confirmed) expect(requirement(path, rs, id).missing, `${rs}/${id}`).toBe(0);
    }
  });
});

// 3. Tennessee: Digital Arts & Design I is a fine arts substitute -------------------------------------

describe("Tennessee: Digital Arts & Design I counts for the fine arts credit (tn/graduation.json arts.credit, Policy 3.103 III(3))", () => {
  it("the content: both variants' fine arts credit lists it, citing Policy 3.103's CTE substitutions", () => {
    const grad = ruleFile("TN", "tn.graduation");
    const arts = leaves(grad, "arts.credit");
    expect(arts).toHaveLength(2);
    for (const r of arts) {
      expect(selectedTypes(r)).toContain("cte.digital_arts_design");
      expect(r.kind === "credits" && r.cite).toContain("tn-3103-iii-3");
    }
    expect(grad.citations.find((c) => c.id === "tn-3103-iii-3")?.quote).toMatch(/^CTE Course Substitutions Digital Arts & Design I /);
  });

  const H30_ROWS: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["Lifetime Wellness", "health_pe", 9],
    ["World History", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["English II", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["Spanish II", "world_language", 10],
    ["Digital Arts & Design I", "career_technical", 10],
    ["English III", "english", 11],
    ["Algebra II", "math", 11],
    ["Physical Science", "science", 11],
    ["U.S. History", "social_studies", 11],
    ["Digital Arts & Design II", "career_technical", 11],
  ];

  it.each([
    ["H30 (typed names)", false],
    ["J5 (kinds picked)", true],
  ])("%s: a graphic-design student with Digital Arts & Design I isn't given an art class for Tennessee's fine arts credit", (_label, confirmed) => {
    const path = real({ state: "TN", grade: 11, colleges: [UTC], courses: typed("TN", H30_ROWS, confirmed as boolean) }, DESIGNER);
    expect(allReasons(path)).not.toMatch(/Required by Tennessee: One fine arts credit/);
    if (confirmed) expect(requirement(path, "tn.grad", "arts.credit").missing).toBe(0);
  });
});

// 4. Career pathway levels in order, for every need ----------------------------------------------------

describe("No career pathway level at or below the student's is planned, for any need (fill.ts candidates, pastCteLevel)", () => {
  const ROWS: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["World Geography", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["Principles of Transportation Systems", "career_technical", 9],
    ["English II", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["World History", "social_studies", 10],
    ["Spanish II", "world_language", 10],
    ["Automotive Basics", "career_technical", 10],
    ["English III", "english", 11],
    ["Algebra II", "math", 11],
    ["Physics", "science", 11],
    ["U.S. History", "social_studies", 11],
    ["Automotive Technology I", "career_technical", 11],
  ];
  const s = (courses: CourseSpec[]): Scenario => ({ state: "TX", grade: 11, path: "training", choices: { txEndorsements: ["business_industry"] }, courses });
  const transportation = (path: PlannedPath) => suggestions(path).filter((x) => getCourseType(x.typeId).cteCluster === "transportation");

  it("H29 (typed): Principles of Transportation Systems is level 1, so the program is met and no intro class comes in 12th", () => {
    const path = real(s(typed("TX", ROWS)), MECHANIC);
    expect(transportation(path)).toEqual([]);
    // Met on the plan's route once the guessed kinds are confirmed: the audit asks to confirm them.
    expect(path.gaps.map((g) => g.id)).not.toContain("gap:tx.endorse.business/bi.cte.transportation");
    expect(requirement(path, "tx.endorse.business", "bi.cte.transportation").modifiers).toContain("guessed_type");
  });

  it("J3b (levels 2 and 3 picked, the principles class as Other): no level 1-3 class, and the next level is a question for the counselor", () => {
    const courses = typed("TX", ROWS, true).map((c) =>
      c.name === "Principles of Transportation Systems" ? { ...c, type: "cte.other" as const } : c.name === "Automotive Basics" ? { ...c, type: "cte.transportation.2" as const } : c.name === "Automotive Technology I" ? { ...c, type: "cte.transportation.3" as const } : c,
    );
    const path = real(s(courses), MECHANIC);
    expect(transportation(path)).toEqual([]);
    const gap = path.gaps.find((g) => g.id === "gap:tx.endorse.business/bi.cte.transportation")!;
    expect(gap.text).toMatch(/Ask your counselor about the next class in this pathway\.$/);
    expect(gap.options.map((o) => o.kind)).toEqual(["ask_counselor"]);
    // The endorsement doesn't switch to another program for it: the rest of 12th is planned as usual.
    for (const t of ["ela.12", "ss.us_gov", "arts.visual"] as CourseTypeId[]) expect(typesAt(path, 12), t).toContain(t);
    expect(path.gaps.filter((g) => g.priority === 0 && g.kind === "doesnt_fit" && !g.id.endsWith("/e.electives"))).toEqual([]);
  });

  it("pastCteLevel reads the student's own classes: years in the cluster, or the highest level", () => {
    const facts = scenario({ state: "TX", grade: 11, courses: [{ type: "cte.transportation.2", grade: 10 }, { type: "cte.transportation.3", grade: 11 }] }).courses;
    const items = facts.map(itemFromFact);
    expect(pastCteLevel(items, "cte.transportation.1")).toBe(true);
    expect(pastCteLevel(items, "cte.transportation.3")).toBe(true);
    expect(pastCteLevel(items, "cte.transportation.4")).toBe(false);
    expect(pastCteLevel(items, "cte.health.1")).toBe(false);
  });
});

// 5. A typed class plans exactly like the same class confirmed -----------------------------------------

describe("Typed and confirmed kinds of the same classes give the same plan (model.ts asPlanned, fill.ts)", () => {
  const H25_ROWS: Row[] = [
    ["English 9", "english", 9],
    ["Secondary Math I", "math", 9],
    ["Biology", "science", 9],
    ["Computer Science Principles", "computer_science", 9],
    ["Fitness for Life", "health_pe", 9, { units: 2 }],
    ["Health", "health_pe", 9, { units: 2 }],
    ["Art", "arts", 9],
  ];
  const H17_ROWS: Row[] = [
    ["English I", "english", 9],
    ["Algebra I", "math", 9],
    ["Biology", "science", 9],
    ["World History", "social_studies", 9],
    ["Spanish I", "world_language", 9],
    ["English II", "english", 10],
    ["Geometry", "math", 10],
    ["Chemistry", "science", 10],
    ["Spanish II", "world_language", 10],
    ["English III", "english", 11],
    ["Algebra II", "math", 11],
    ["U.S. History", "social_studies", 11],
  ];

  it("H25/J2 (Utah 9th, Computer Science Principles): Computer Science Principles covers digital studies either way, and no programming class is added for it", () => {
    const s = (confirmed: boolean): Scenario => ({ state: "UT", grade: 9, path: "undecided", courses: typed("UT", H25_ROWS, confirmed) });
    const typedPath = real(s(false));
    expect(signature(typedPath)).toBe(signature(real(s(true))));
    expect(allReasons(typedPath)).not.toMatch(/Required by Utah: Digital studies/);
  });

  it("H17/J1 (Texas 11th, UT Austin, STEM): the same route and the same 12th grade (no third science for STEM)", () => {
    const s = (confirmed: boolean): Scenario => ({ state: "TX", grade: 11, colleges: [UT_AUSTIN], choices: { txEndorsements: ["stem"] }, courses: typed("TX", H17_ROWS, confirmed) });
    const typedPath = real(s(false), SOFTWARE);
    expect(signature(typedPath)).toBe(signature(real(s(true), SOFTWARE)));
    expect(typesAt(typedPath, 12)).not.toContain("sci.forensic");
    expect(typesAt(typedPath, 12)).toContain("math.precalc");
  });

  // Round 9 (confirm first, engine/confirm.ts): a guessed kind may differ from a picked one where
  // the guess can't be trusted, but it never adds a claim the picked kinds wouldn't make.
  it("120 random students: guessing every kind of their classes adds no \"doesn't fit\", \"needs a plan now\" or \"Required by\"", () => {
    let compared = 0;
    for (let k = 0; k < 120; k++) {
      const seed = 1000 + k * 7919;
      const confirmed = randomInput(seed);
      if (!confirmed.state || confirmed.courses.length === 0) continue;
      const guessed = structuredClone(confirmed);
      guessed.courses = guessed.courses.map((c) => (getCourseType(c.typeId).fallback ? c : { ...c, assumed: true, typeSource: "guess" as const }));
      const a = plan(confirmed);
      const b = plan(guessed);
      if (a.mode === "no_state" || b.mode === "no_state") continue;
      expect(extraClaims(b, a), `seed ${seed}`).toEqual([]);
      expect(claimsOnWaiting(b), `seed ${seed}`).toEqual([]);
      // As the app reads their names (exact titles confirmed, the rest guessed): nothing new either.
      expect(exactTitleClaims(guessed), `seed ${seed}, exact titles confirmed`).toEqual([]);
      compared++;
    }
    expect(compared).toBeGreaterThan(80);
  });

  describe("through studentPath", () => {
    let db: Db;
    const NOW = new Date("2026-09-25T15:00:00Z");
    beforeEach(async () => {
      db = await createTestDb();
    });

    async function seed(state: PlannerState, grade: number, rows: Row[], confirmed: boolean): Promise<string> {
      const [household] = await db.insert(schema.households).values({}).returning();
      const [user] = await db
        .insert(schema.users)
        .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: `${2026 - grade - 5}-01-15`, grade, gradeSchoolYear: 2026, homeState: state })
        .returning({ id: schema.users.id });
      for (const [name, subject, g, extra] of rows) {
        const status = g < grade ? "completed" : "in_progress";
        await db.insert(schema.studentCourses).values({
          userId: user.id,
          name,
          subject,
          level: (extra?.level ?? "regular") as CourseLevel,
          gradeLevel: g,
          credits: (extra?.units ?? 4) / 4,
          status,
          finalGrade: status === "completed" ? "A" : null,
          highSchoolCredit: true,
          ...(confirmed ? { courseTypeId: guessCourseTypeId(name, subject, state), courseTypeSource: "student" as const } : {}),
        });
      }
      return user.id;
    }

    it("H25 (typed) and J2 (kinds picked): the same suggestions and reasons", async () => {
      const a = await studentPath(db, await seed("UT", 9, H25_ROWS, false), NOW);
      const b = await studentPath(db, await seed("UT", 9, H25_ROWS, true), NOW);
      if (a.kind !== "planned" || b.kind !== "planned") throw new Error("expected planned paths");
      expect(signature(planned(a.result))).toBe(signature(planned(b.result)));
    });

    it("H17 (typed) and J1 (kinds picked): the same suggestions and reasons", async () => {
      const a = await studentPath(db, await seed("TX", 11, H17_ROWS, false), NOW);
      const b = await studentPath(db, await seed("TX", 11, H17_ROWS, true), NOW);
      if (a.kind !== "planned" || b.kind !== "planned") throw new Error("expected planned paths");
      expect(signature(planned(a.result))).toBe(signature(planned(b.result)));
    });
  });
});

// 6. A junior's credit shortfall the years after this one can't hold -----------------------------------

const H21_INPUT: Scenario = {
  state: "UT",
  grade: 11,
  path: "training",
  choices: { utMath3OptOut: true },
  courses: [
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ss.world_geo", grade: 9, units: 2 },
    { type: "pe.fitness", grade: 9, units: 2 },
    { type: "health.health", grade: 9, units: 2 },
    { type: "cs.intro", grade: 9, units: 2 },
    { type: "arts.visual", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.ut_sec2", grade: 10 },
    { type: "sci.bio", grade: 10 },
    { type: "ss.world_hist", grade: 10, units: 2 },
    { type: "pe.skills", grade: 10, units: 2 },
    { type: "cte.arts_av.1", grade: 10 },
    { type: "ela.11", grade: 11 },
    { type: "ss.us_hist", grade: 11 },
    { type: "cte.arts_av.2", grade: 11 },
    { type: "arts.media", grade: 11 },
    { type: "pe.lifetime", grade: 11, units: 2 },
    { type: "sci.chem", grade: 11 },
  ],
};

describe("A credit shortfall the years after this one can't hold is a gap for any grade (gaps.ts creditRoom)", () => {
  it("H21/J6 (Utah 11th, 3 credits short, 2.5 credits of room in 12th): half a credit has to come from this spring", () => {
    const path = real(H21_INPUT, DESIGNER);
    const gap = path.gaps.find((g) => g.id === "gap:ut.grad/total")!;
    expect(gap.text).toBe("Room to add: total credits needs 3 more, and the years after this one have room for about 2.5. Add 0.5 credits this spring (your open periods); ask your counselor.");
    expect(gap.priority).toBe(0);
    expect(ruleSet(path, "ut.grad").status).toBe("room_to_add");
  });

  it("a year in progress with two or more open periods may not be fully recorded yet: its spring still counts (no gap for a 9th grader who has entered four classes)", () => {
    const path = real({ state: "TX", grade: 9, colleges: [UT_AUSTIN], courses: [{ type: "ela.9", grade: 9 }, { type: "math.alg1", grade: 9 }, { type: "sci.bio", grade: 9 }, { type: "ss.world_geo", grade: 9 }] }, SOFTWARE);
    expect(gapLines(path)).not.toMatch(/this spring \(your open periods\)/);
  });
});

// 7. Required social studies in its usual grades -----------------------------------------------------

describe("Required classes stay in their usual grades (fill.ts gradePreference, roomInUsualGrades, fillNeeds order)", () => {
  it("W5 (Texas 10th, F in Biology, nursing): U.S. History, which has an end-of-course exam, goes in 11th, not senior year", () => {
    const path = real(
      {
        state: "TX",
        grade: 10,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9, letter: "F" },
          { type: "ss.world_geo", grade: 9 },
          { type: "pe.general", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.ipc", grade: 10 },
          { type: "ss.world_hist", grade: 10 },
          { type: "lang.es.2", grade: 10 },
        ],
      },
      NURSE,
    );
    for (const p of path.plans) {
      expect(typesAt(path, 11, p.id), p.label).toContain("ss.us_hist");
      expect(typesAt(path, 12, p.id), p.label).not.toContain("ss.us_hist");
    }
  });

  it("K12 (Tennessee 10th, nursing, Health Science levels 1-2): U.S. History takes 11th next to the pathway's level 3; an elective-type class goes to 12th instead", () => {
    const path = real(
      {
        state: "TN",
        grade: 10,
        limits: { classesPerYear: 7 },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "cte.health.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "cte.health.2", grade: 10 },
        ],
      },
      NURSE,
    );
    expect(typesAt(path, 11)).toContain("ss.us_hist");
    expect(typesAt(path, 11)).toContain("cte.health.3");
    expect(typesAt(path, 12)).not.toContain("ss.us_hist");
  });

  it("T4 (Utah 9th, nursing): World History in 10th, its usual grade, and U.S. History and ACGC in different years", () => {
    const path = real(
      {
        state: "UT",
        grade: 9,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.ut_sec1", grade: 9 },
          { type: "sci.earth", grade: 9 },
          { type: "pe.fitness", grade: 9, units: 2 },
          { type: "health.health", grade: 9, units: 2 },
          { type: "arts.visual", grade: 9 },
          { type: "cs.intro", grade: 9, units: 2 },
        ],
      },
      NURSE,
    );
    expect(typesAt(path, 10)).toContain("ss.world_hist");
    const grade = (t: CourseTypeId) => suggestions(path).find((s) => s.typeId === t)?.grade;
    expect(grade("ss.us_hist")).toBeDefined();
    expect(grade("ss.us_hist")).not.toBe(grade("ss.ut_acgc"));
  });
});

// 8. Utah's ENGL 1010 pilot ----------------------------------------------------------------------

describe("Utah: ENGL 1010 from 2026-27 counts for level 11 only in an approved pilot (ut/graduation.json ela.11 ask, questions.ts)", () => {
  const Z4: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.ut_sec1", grade: 9 },
    { type: "sci.earth", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.ut_sec2", grade: 10 },
    { type: "sci.bio", grade: 10 },
    { type: "ela.lang_comp", grade: 11, level: "dual_enrollment", name: "CE English 1010" },
    { type: "math.ut_sec3", grade: 11 },
    { type: "sci.chem", grade: 11 },
  ];
  const PILOT = "Is my school's ENGL 1010 an approved pilot, so it counts for level 11 English?";

  it("the content: both variants' level 11 carry the note and the question, citing USBE's own words", () => {
    const grad = ruleFile("UT", "ut.graduation");
    const ela11 = leaves(grad, "ela.11");
    expect(ela11).toHaveLength(2);
    for (const r of ela11) {
      if (r.kind !== "credits") throw new Error("ela.11 is a credits requirement");
      expect(r.note).toMatch(/approved ENGL 1010 pilot/);
      expect(r.ask?.question).toBe(PILOT);
      expect(r.ask?.cite).toEqual(["ut-usbe-2627-engl1010"]);
    }
    expect(grad.citations.find((c) => c.id === "ut-usbe-2627-engl1010")?.quote).toMatch(/participating in an approved ENGL 1010 pilot/);
  });

  it.each([
    ["Z4 (kind picked)", Z4],
    ["H10 (typed name)", Z4.map((c) => (c.name === "CE English 1010" ? { ...c, type: guessCourseTypeId("CE English 1010", "english", "UT"), assumed: true } : c))],
  ])("%s: an 11th grader in ENGL 1010 this year is asked about the pilot, and the added level 11 class says why", (_label, courses) => {
    const path = real({ state: "UT", grade: 11, courses }, NURSE);
    expect(questions(path)).toContain(PILOT);
    const english = suggestions(path).find((s) => /Grade 11 language arts/.test(reasonsOf(s)));
    expect(english && reasonsOf(english)).toMatch(/approved ENGL 1010 pilot/);
  });

  it("a senior whose ENGL 1010 was in 2025-26 already counts, so isn't asked", () => {
    const path = real({ state: "UT", grade: 12, courses: [...Z4, { type: "ela.12", grade: 12 }, { type: "math.stats", grade: 12 }] }, NURSE);
    expect(questions(path)).not.toContain(PILOT);
    expect(requirement(path, "ut.grad", "ela.11").missing).toBe(0);
  });
});

// 9. A first art class isn't AP -------------------------------------------------------------------------

describe("A student's first art class stays regular or honors (fill.ts rigor, upgradeForCollegeOnlyNeeds)", () => {
  const TN10: CourseSpec[] = [
    { type: "ela.9", grade: 9 },
    { type: "math.alg1", grade: 9 },
    { type: "sci.bio", grade: 9 },
    { type: "health.wellness", grade: 9 },
    { type: "ss.world_hist", grade: 9 },
    { type: "lang.es.1", grade: 9 },
    { type: "ela.10", grade: 10 },
    { type: "math.geom", grade: 10 },
    { type: "sci.chem", grade: 10 },
    { type: "lang.es.2", grade: 10 },
  ];
  const art = (path: PlannedPath) => suggestions(path).filter((s) => s.typeId === "arts.visual");

  it("H16 (Tennessee 10th, moved from Texas, graphic designer): Visual Art, not AP Art and Design", () => {
    const path = real({ state: "TN", grade: 10, homeState: "TX", colleges: [UTK], courses: TN10 }, DESIGNER);
    expect(art(path).length).toBeGreaterThan(0);
    for (const s of art(path)) expect(s.level).not.toBe("ap");
  });

  it("K11 (AP or IB focus): the focus's credits don't make a first art class AP", () => {
    const path = real({ state: "TN", grade: 10, colleges: [UTK], choices: { tnElectiveFocus: "ap_ib" }, courses: TN10 }, NURSE);
    for (const s of art(path)) expect(s.level).not.toBe("ap");
  });

  it("a student with Art I already may still take the AP version", () => {
    const path = real({ state: "TN", grade: 10, colleges: [UTK], choices: { tnElectiveFocus: "ap_ib" }, courses: [...TN10, { type: "arts.visual", grade: 9 }] }, DESIGNER);
    expect(suggestions(path).some((s) => s.typeId === "arts.visual" && s.level === "ap") || art(path).length === 0).toBe(true);
  });
});

// 10. Doubling up only for a pair the state or list allows -------------------------------------------

describe("Two math classes in a year only for a pair the state or the list allows (ladder.ts doublePairs)", () => {
  it("J12b (Texas 9th, Algebra I now, opted in, UT Austin): Geometry and Algebra II never share a year", () => {
    const path = real(
      {
        state: "TX",
        grade: 9,
        colleges: [UT_AUSTIN],
        limits: { accelerateMath: true },
        courses: [
          { type: "math.ms", grade: 8, letter: "A", hsCredit: false },
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9, letter: "A" },
          { type: "sci.bio", grade: 9 },
          { type: "ss.world_geo", grade: 9 },
        ],
      },
      SOFTWARE,
    );
    for (const p of path.plans) for (const g of [10, 11, 12]) {
      const math = typesAt(path, g, p.id);
      expect(math.includes("math.geom") && math.includes("math.alg2"), `${p.label} ${g}`).toBe(false);
    }
    for (const gap of path.gaps) for (const o of gap.options) if (o.kind === "double_up") expect(o.adds.map((a) => a.typeId)).not.toContain("math.alg2");
  });

  it("solveLadder: with only Algebra I and Geometry allowed (Texas §28.025(b-6)), Geometry and Algebra II aren't doubled", () => {
    const base = {
      grades: [10, 11, 12] as SchoolGrade[],
      start: 1,
      locked: new Map<SchoolGrade, number>(),
      available: () => true,
      constraints: [{ id: "calc", rank: 5, byGrade: 12, hard: false, priority: 3, label: "calculus" }],
      moves: { double: true, summer: false },
    };
    const doubled = (pairs: number[] | undefined) => {
      const sol = solveLadder({ ...base, doublePairs: pairs });
      return sol.steps.filter((s) => sol.steps.filter((t) => t.grade === s.grade).length > 1).map((s) => s.rank);
    };
    expect(doubled([1])).toEqual([]);
    expect(doubled([2])).toEqual([2, 3]);
    expect(doubled(undefined)).toEqual([2, 3]);
  });
});

// 11. Other choices never below precalculus -------------------------------------------------------------

describe("Other choices never offer math below precalculus to a student past it (plan.ts buildYear)", () => {
  it("K14 (Tennessee senior in AP Calculus, math and science focus): no Mathematical Reasoning for Decision Making among any class's Other choices", () => {
    const path = real(
      {
        state: "TN",
        grade: 12,
        colleges: [UTK],
        choices: { tnElectiveFocus: "math_science" },
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "pe.general", grade: 9, units: 2 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "arts.visual", grade: 10 },
          { type: "cs.prog1", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "math.precalc", grade: 11 },
          { type: "ela.12", grade: 12 },
          { type: "math.calc", grade: 12, level: "ap" },
          { type: "ss.us_gov", grade: 12, units: 2 },
          { type: "ss.econ", grade: 12, units: 2 },
        ],
      },
      ENGINEER,
    );
    const alternatives = suggestions(path).flatMap((s) => s.alternatives.map((a) => a.typeId as CourseTypeId));
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.filter(belowPrecalculus)).toEqual([]);
  });
});

// 12. Semester classes in the year in progress go in spring ------------------------------------------

describe("A class added to the year in progress: spring for a semester class, a question for a full-year one (fill.ts termFor, plan.ts)", () => {
  it("H14 (Tennessee senior nurse in September): Personal Finance and the other half credits are spring classes", () => {
    const path = real(
      {
        state: "TN",
        grade: 12,
        courses: [
          { type: "ela.9", grade: 9 },
          { type: "math.alg1", grade: 9 },
          { type: "sci.bio", grade: 9 },
          { type: "health.wellness", grade: 9 },
          { type: "ss.world_hist", grade: 9 },
          { type: "lang.es.1", grade: 9 },
          { type: "cte.health.1", grade: 9 },
          { type: "ela.10", grade: 10 },
          { type: "math.geom", grade: 10 },
          { type: "sci.chem", grade: 10 },
          { type: "lang.es.2", grade: 10 },
          { type: "cte.health.2", grade: 10 },
          { type: "arts.visual", grade: 10 },
          { type: "ela.11", grade: 11 },
          { type: "math.alg2", grade: 11 },
          { type: "ss.us_hist", grade: 11 },
          { type: "sci.anat", grade: 11 },
          { type: "cs.intro", grade: 11 },
          { type: "ela.12", grade: 12 },
          { type: "math.stats", grade: 12 },
          { type: "ss.econ", grade: 12, units: 2 },
        ],
      },
      NURSE,
    );
    const now = suggestions(path).filter((s) => s.grade === 12);
    expect(now.some((s) => s.typeId === "ss.pfl")).toBe(true);
    for (const s of now) {
      if (s.term === "full_year") expect(reasonsOf(s), s.typeId).toMatch(/already started, so ask your counselor whether you can still add this full-year class/);
      else expect(s.term, s.typeId).toBe("spring");
    }
  });
});

// 13. Middle school: the goal's own career cluster first -----------------------------------------------

describe("Middle school exploration: the goal's cluster first where the state lists no pathway for it (plan.ts middleSchool)", () => {
  it("H2 (Tennessee 8th, Registered Nurse, UT Chattanooga): Health Science leads the list", () => {
    const path = real({ state: "TN", grade: 8, colleges: [UTC], courses: [{ type: "ela.ms", grade: 8 }, { type: "math.ms", grade: 8 }] }, NURSE);
    expect(path.middleSchool?.exploration[0]?.typeId).toBe("cte.health.1");
  });
});

// 14. Program-of-study titles ---------------------------------------------------------------------------

describe("Typed program-of-study titles land at their level (course-type-guess.ts)", () => {
  it.each([
    // TEA programs of study (MP-TEA-POS-TDL-*, MP-TEA-POS-ET-*, MP-TEA-POS-ENG-ENGINEERING-FOUNDATIONS).
    ["Principles of Transportation Systems", "career_technical", "TX", "cte.transportation.1"],
    ["Practicum in Transportation Systems", "career_technical", "TX", "cte.transportation.4"],
    ["Principles of Human Services", "career_technical", "TX", "cte.education.1"],
    ["Engineering Science", "science", "TX", "cte.engineering_science"],
    ["Engineering Science", "career_technical", "TX", "cte.engineering_science"],
    ["Engineering Design and Problem Solving", "career_technical", "TX", "cte.engineering_problem_solving"],
    ["Engineering Design and Problem Solving", "science", "TX", "cte.engineering_problem_solving"],
    ["Food Science", "science", "TX", "cte.food_science"],
    ["Advanced Plant and Soil Science", "science", "TX", "cte.plant_soil_science"],
    // Tennessee (Policy 3.205, 3.103).
    ["Diagnostic Medicine", "career_technical", "TN", "cte.health.4"],
    ["Clinical Internship", "career_technical", "TN", "cte.health.4"],
    ["IT Clinical Internship", "career_technical", "TN", "cte.it.4"],
    ["Maintenance and Light Repair I", "career_technical", "TN", "cte.transportation.1"],
    ["Maintenance & Light Repair II", "career_technical", "TN", "cte.transportation.2"],
    ["Fundamentals of Education", "career_technical", "TN", "cte.education.1"],
    ["Digital Arts & Design I", "career_technical", "TN", "cte.digital_arts_design"],
    ["Digital Arts and Design I", "arts", "TN", "cte.digital_arts_design"],
    ["Digital Arts & Design II", "career_technical", "TN", "cte.arts_av.2"],
    ["Digital Arts & Design II", "arts", "TN", "arts.media"],
    // Utah (MP-USBE-CTE).
    ["Certified Nurse Assistant", "career_technical", "UT", "cte.nurse_aide"],
    ["Digital Media 1", "career_technical", "UT", "cte.arts_av.1"],
    ["Digital Media 1", "arts", "UT", "arts.media"],
    ["Cabinetmaking 1", "career_technical", "UT", "cte.architecture_construction.1"],
    // Still what they were.
    ["Automotive Basics", "career_technical", "TX", "cte.transportation.2"],
    ["Automotive Technology I: Maintenance and Light Repair", "career_technical", "TX", "cte.transportation.3"],
    ["Advanced Engineering Design and Presentation", "career_technical", "TX", "cte.engineering.4"],
    // Round 10: Texas's plain "Culinary Arts" is TEA's level 2 (MP-TEA-POS-HT-CULINARY-ARTS), a guess to confirm.
    ["Culinary Arts", "career_technical", "TX", "cte.hospitality.2"],
    ["Medical Therapeutics", "career_technical", "TN", "cte.health.2"],
    ["Art I", "arts", "TN", "arts.visual"],
  ] as const)("%s (%s, %s) → %s", (name, subject, state, expected) => {
    expect(guessCourseTypeId(name, subject, state)).toBe(expected);
  });
});

auditExactTitles(65);
