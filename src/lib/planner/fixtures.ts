import { deriveCohort } from "./cohort";
import type { CipRoutingFile, FactsFile, GenericCatalogFile, MajorFamiliesFile, RigorFile } from "./content-types";
import { DEFAULT_LIMITS, type PlannerInput, RIGOR_TIERS } from "./engine-io";
import { FAMILY_IDS } from "./families";
import type { RuleFile, Source } from "./rules";

// Tiny, made-up content for tests. The sources are fixtures (example.org), not real documents,
// and the quotes are invented test strings: never copy these into src/content. Real content
// quotes its sources word for word.

const SOURCES: Record<string, Source> = {
  "FX-1": {
    title: "Fixture rules (test data)",
    url: "https://example.org/fixture-rules",
    publisher: "College Compass tests",
    kind: "rule",
    checkedOn: "2026-09-25",
  },
};

const header = (id: string) => ({
  schemaVersion: 1 as const,
  id,
  updated: "2026-09-25",
  verifiedForSchoolYear: 2026,
  review: { status: "draft" as const },
  sources: SOURCES,
});

/** A small Texas-like graduation file: two cohort variants, nested requirements, a check, a condition. */
export function fixtureGraduationFile(): RuleFile {
  return {
    ...header("fixture.tx.graduation"),
    state: "TX",
    kind: "graduation",
    citations: [
      { id: "fx-grad", source: "FX-1", pinpoint: "(a)", quote: "Fixture: a student must earn these credits to graduate." },
      { id: "fx-math", source: "FX-1", pinpoint: "(b)(2)", quote: "Fixture: three math credits, including Algebra I and Geometry." },
      { id: "fx-sci", source: "FX-1", pinpoint: "(b)(3)", quote: "Fixture: three science credits." },
      { id: "fx-lang", source: "FX-1", pinpoint: "(b)(5)", quote: "Fixture: two levels of one language, or two credits of programming." },
      { id: "fx-total", source: "FX-1", pinpoint: "(a)", quote: "Fixture: at least 22 credits in all." },
      { id: "fx-exam", source: "FX-1", pinpoint: "(c)", quote: "Fixture: pass the end-of-course exams." },
    ],
    ruleSets: [
      {
        id: "fx.tx.grad",
        state: "TX",
        kind: "state_graduation",
        title: "Fixture graduation program",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "What a fixture student needs to graduate.",
        strength: "required",
        strengthCite: "fx-grad",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        projectedBeyond: 2026,
        appliesWhen: {},
        variants: [
          {
            id: "fx.tx.grad.pre2026",
            cohort: { to: 2025 },
            allocation: "exclusive",
            requirements: [
              { id: "sci", label: "Science", kind: "credits", area: "science", units: 12, select: [{ subjects: ["science"] }], cite: ["fx-sci"] },
              { id: "total", label: "Total credits", kind: "total_credits", units: 88, source: "state", cite: ["fx-total"] },
            ],
          },
          {
            id: "fx.tx.grad.2026",
            cohort: { from: 2026 },
            allocation: "exclusive",
            requirements: [
              {
                id: "math",
                label: "Math",
                kind: "all",
                area: "math",
                of: [
                  { id: "math.alg1", label: "Algebra I", kind: "credits", units: 4, select: [{ types: ["math.alg1"] }], cite: ["fx-math"] },
                  { id: "math.geom", label: "Geometry", kind: "credits", units: 4, select: [{ types: ["math.geom"] }], cite: ["fx-math"] },
                  {
                    id: "math.third",
                    label: "A third math",
                    kind: "credits",
                    units: 4,
                    select: [{ capabilities: ["alg2_or_beyond"] }, { types: ["math.applied.models", "math.stats"] }],
                    cite: ["fx-math"],
                  },
                ],
              },
              { id: "sci", label: "Science", kind: "credits", area: "science", units: 12, select: [{ subjects: ["science"] }], cite: ["fx-sci"] },
              {
                id: "lang",
                label: "World language",
                kind: "any",
                area: "world_language",
                of: [
                  { id: "lang.same", label: "Two levels of one language", kind: "same_language", levels: 2, cite: ["fx-lang"] },
                  {
                    id: "lang.cs",
                    label: "Two programming credits",
                    kind: "credits",
                    units: 8,
                    select: [{ types: ["cs.principles", "cs.prog1", "cs.prog2", "cs.advanced"] }],
                    cite: ["fx-lang"],
                  },
                ],
              },
              { id: "total", label: "Total credits", kind: "total_credits", units: 88, source: "state", cite: ["fx-total"] },
            ],
            conditions: [{ id: "eoc", label: "Pass the end-of-course exams", kind: "exam", cite: ["fx-exam"] }],
            unverified: [{ id: "eoc-schedule", text: "When the new exam list takes effect." }],
          },
        ],
      },
    ],
  };
}

/** A DLA-like option that extends the fixture graduation variant and needs an endorsement-like rule set. */
export function fixtureOptionsFile(): RuleFile {
  return {
    ...header("fixture.tx.options"),
    state: "TX",
    kind: "options",
    citations: [
      { id: "fx-dla", source: "FX-1", pinpoint: "(g)", quote: "Fixture: four math credits including Algebra II, and four science credits." },
      { id: "fx-stem", source: "FX-1", pinpoint: "(f)", quote: "Fixture: STEM requires Algebra II, Chemistry and Physics." },
    ],
    ruleSets: [
      {
        id: "fx.tx.stem",
        state: "TX",
        kind: "graduation_option",
        title: "Fixture STEM endorsement",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "A fixture endorsement.",
        strength: "required",
        strengthCite: "fx-stem",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txEndorsements", value: "stem" } },
        variants: [
          {
            id: "fx.tx.stem.all",
            cohort: {},
            extends: "fx.tx.grad.2026",
            allocation: "exclusive",
            requirements: [
              {
                id: "stem.core",
                label: "Algebra II, Chemistry and Physics",
                kind: "all",
                of: [
                  { id: "stem.alg2", label: "Algebra II", kind: "credits", units: 4, select: [{ types: ["math.alg2"] }], cite: ["fx-stem"] },
                  { id: "stem.chem", label: "Chemistry", kind: "credits", units: 4, select: [{ types: ["sci.chem"] }], cite: ["fx-stem"] },
                  { id: "stem.phys", label: "Physics", kind: "credits", units: 4, select: [{ types: ["sci.phys", "sci.phys_eng"] }], cite: ["fx-stem"] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "fx.tx.dla",
        state: "TX",
        kind: "graduation_option",
        title: "Fixture distinguished level",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "A fixture distinguished level.",
        strength: "required",
        strengthCite: "fx-dla",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txAimDla", value: true } },
        variants: [
          {
            id: "fx.tx.dla.all",
            cohort: {},
            extends: "fx.tx.grad.2026",
            allocation: "exclusive",
            requirements: [
              { id: "dla.alg2", label: "Algebra II", kind: "credits", units: 4, select: [{ types: ["math.alg2"] }], deadlineGrade: 11, cite: ["fx-dla"] },
              {
                id: "dla.math4",
                label: "A 4th math",
                kind: "choose",
                n: 1,
                of: [
                  { id: "dla.math4.adv", label: "Advanced math", kind: "credits", units: 4, select: [{ capabilities: ["advanced_math_after_alg2"] }], cite: ["fx-dla"] },
                  { id: "dla.math4.stats", label: "AP Statistics", kind: "credits", units: 4, select: [{ types: ["math.stats"], levels: ["ap"] }], cite: ["fx-dla"] },
                ],
              },
              { id: "dla.sci4", label: "A 4th science", kind: "credits", units: 4, select: [{ capabilities: ["lab_science"] }], cite: ["fx-dla"] },
            ],
            checks: [
              { id: "dla.on_schedule", kind: "on_schedule_by", req: "dla.alg2", grade: 11, cite: ["fx-dla"] },
              { id: "dla.endorsement", kind: "requires_rule_set", anyOf: ["fx.tx.stem"], cite: ["fx-dla"] },
            ],
          },
        ],
        testRoutes: [{ id: "dla.test", text: "Fixture: a qualifying test score instead.", cite: ["fx-dla"] }],
      },
    ],
  };
}

export function fixtureGenericCatalog(): GenericCatalogFile {
  return {
    ...header("fixture.tx.generic-catalog"),
    state: "TX",
    title: "Classes most fixture high schools offer",
    classesPerYear: 7,
    citations: [],
    courses: [
      { typeId: "ela.9", levels: ["regular", "honors"] },
      { typeId: "ela.10", levels: ["regular", "honors"] },
      { typeId: "math.alg1", levels: ["regular"] },
      { typeId: "math.geom", levels: ["regular", "honors"] },
      { typeId: "math.alg2", levels: ["regular", "honors"] },
      { typeId: "math.precalc", levels: ["regular", "ap"] },
      { typeId: "math.calc", levels: ["ap"] },
      { typeId: "sci.bio", levels: ["regular", "honors"] },
      { typeId: "sci.chem", levels: ["regular", "honors"] },
      { typeId: "sci.phys", levels: ["regular", "ap"] },
      { typeId: "ss.world_geo", levels: ["regular"], units: 4 },
      { typeId: "lang.es.1", levels: ["regular"] },
      { typeId: "lang.es.2", levels: ["regular"] },
    ],
  };
}

export function fixtureFacts(): FactsFile {
  return {
    ...header("fixture.tx.facts"),
    state: "TX",
    citations: [
      { id: "fx-summer", source: "FX-1", quote: "Fixture: summer courses may be offered." },
      { id: "fx-ms", source: "FX-1", quote: "Fixture: middle schools offer advanced math." },
    ],
    options: [{ kind: "summer", note: "One summer; may cost money.", cite: ["fx-summer"] }],
    middleSchoolMath: [{ text: "Fixture middle-school math note.", cite: ["fx-ms"] }],
  };
}

/** Minimal entries for all 32 families (the validator requires every one). */
export function fixtureFamiliesFile(): MajorFamiliesFile {
  return {
    ...header("fixture.major-prep.families"),
    citations: [{ id: "fx-prep", source: "FX-1", quote: "Fixture: preparation for this family." }],
    families: FAMILY_IDS.map((id) => ({
      id,
      summary: `Fixture summary for ${id}.`,
      path: "both" as const,
      math: { target: ["ALG2+" as const], cite: ["fx-prep"] },
      sciences: ["sci.bio" as const],
      keyCourses: [],
      rigorFirst: [],
      ctePathways: [],
      gates: [],
      cautions: [],
    })),
  };
}

/** A few of the research's routing rules, in order (first match wins). */
export function fixtureCipRouting(): CipRoutingFile {
  return {
    ...header("fixture.major-prep.cip-routing"),
    citations: [],
    rules: [
      { match: ["51.0904", "51.0810"], family: "public_safety" },
      { match: ["51.38"], family: "nursing" },
      { match: ["51.39", "51.26"], family: "practical_nursing" },
      { match: ["51"], family: "allied_health" },
      { match: ["11.01", "11.04", "11.07", "30.70"], family: "computer_data_science" },
      { match: ["11", "15.12"], family: "it_cybersecurity" },
      { match: ["14"], family: "engineering" },
      { match: ["15"], family: "engineering_tech" },
    ],
  };
}

/** The four rigor tiers (open first), one tier raise and one guardrail. */
export function fixtureRigorFile(): RigorFile {
  return {
    ...header("fixture.major-prep.rigor"),
    citations: [{ id: "fx-rigor", source: "FX-1", quote: "Fixture: selective colleges weigh rigor more." }],
    tiers: RIGOR_TIERS.map((id, i) => ({
      id,
      label: `Fixture ${id}`,
      detection: "Fixture detection.",
      expects: "Fixture expectations.",
      target: "Fixture target.",
      collegeLevelFromGrade: i === 0 ? null : 11,
      rigorFirstSubjects: i === 0 ? 0 : 2,
      cite: ["fx-rigor"],
    })),
    raises: [{ id: "fx-raise", colleges: [228778], families: ["engineering"], text: "Fixture raise.", cite: ["fx-rigor"] }],
    guardrails: [{ id: "fx-guardrail", text: "Fixture guardrail.", cite: ["fx-rigor"] }],
  };
}

/** A Texas 10th grader in 2026-27 with a few classes, generic lists, and the fixture content. */
export function fixturePlannerInput(): PlannerInput {
  const cohort = deriveCohort(10, 2026);
  return {
    asOf: { today: "2026-09-25", schoolYear: 2026, month: 9 },
    student: { grade: 10, cohort },
    state: "TX",
    homeState: "TX",
    catalogs: {},
    courses: [
      {
        id: "c-alg1",
        name: "Algebra 1",
        typeId: "math.alg1",
        typeSource: "guess",
        assumed: true,
        level: "regular",
        subject: "math",
        grade: 9,
        schoolYear: 2025,
        term: "full_year",
        units: 4,
        status: "completed",
        finalGrade: "B+",
        highSchoolCredit: true,
        cte: false,
        lectureOnly: false,
        catalogCourseId: null,
        origin: "typed",
      },
      {
        id: "c-geom",
        name: "Geometry",
        typeId: "math.geom",
        typeSource: "student",
        assumed: false,
        level: "honors",
        subject: "math",
        grade: 10,
        schoolYear: 2026,
        term: "full_year",
        units: 4,
        status: "in_progress",
        finalGrade: null,
        highSchoolCredit: true,
        cte: false,
        lectureOnly: false,
        catalogCourseId: null,
        origin: "typed",
      },
    ],
    targets: {
      path: "degree",
      families: [{ familyId: "nursing", source: "north_star", cip6: "51.3801", because: "Registered Nurse" }],
      colleges: [],
    },
    prefs: { choices: {}, limits: DEFAULT_LIMITS, dismissed: [] },
    content: {
      rules: [fixtureGraduationFile(), fixtureOptionsFile()],
      genericCatalog: fixtureGenericCatalog(),
      facts: fixtureFacts(),
      families: fixtureFamiliesFile(),
    },
  };
}
