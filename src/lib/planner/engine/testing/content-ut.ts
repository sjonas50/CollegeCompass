import type { FactsFile, GenericCatalogFile } from "../../content-types";
import type { Req, RuleFile, Selector, Variant } from "../../rules";
import { cites, header } from "./common";

// Utah test content, shaped like design Appendix A.1 (R277-700: Secondary Math with the opt-out
// and the calculus alternative, two of five foundation sciences, ACGC from the class of 2029,
// senior math; Utah State's recommended pattern; the Opportunity Scholarship, projected after the
// class of 2027). Invented quotes; see ./common.ts.

export const USU = 230728;
export const UOFU = 230764;

const labOnly = (types: Selector["types"]): Selector => ({ types, lab: true });

function mathReq(): Req {
  return {
    id: "math",
    label: "Math",
    kind: "option",
    pref: "utMath3OptOut",
    area: "math",
    cite: ["ut-math-optout"],
    off: {
      id: "math.core",
      label: "Three math credits",
      kind: "any",
      of: [
        {
          id: "math.sequence",
          label: "Secondary Math I, II and III",
          kind: "all",
          of: [
            { id: "math.sec1", label: "Secondary Math I", kind: "credits", units: 4, select: [{ types: ["math.ut_sec1", "math.int1", "math.alg1"] }], cite: ["ut-math"] },
            { id: "math.sec2", label: "Secondary Math II", kind: "credits", units: 4, select: [{ types: ["math.ut_sec2", "math.int2", "math.geom"] }], cite: ["ut-math"] },
            { id: "math.sec3", label: "Secondary Math III or higher", kind: "credits", units: 4, select: [{ capabilities: ["alg2_or_beyond"] }], cite: ["ut-math"] },
          ],
        },
        { id: "math.calc_c", label: "Calculus with a C or better", kind: "credits", units: 4, select: [{ types: ["math.calc", "math.calc2"], minLetter: "C" }], cite: ["ut-math-calc"] },
      ],
    },
    on: {
      id: "math.optout",
      label: "Secondary Math I and II and an approved 3rd math",
      kind: "all",
      of: [
        { id: "math.oo.sec1", label: "Secondary Math I", kind: "credits", units: 4, select: [{ types: ["math.ut_sec1", "math.int1", "math.alg1"] }], cite: ["ut-math"] },
        { id: "math.oo.sec2", label: "Secondary Math II", kind: "credits", units: 4, select: [{ types: ["math.ut_sec2", "math.int2", "math.geom"] }], cite: ["ut-math"] },
        {
          id: "math.oo.third",
          label: "An approved 3rd math credit",
          kind: "credits",
          units: 4,
          select: [{ capabilities: ["alg2_or_beyond"] }, { types: ["math.applied.finance", "math.applied.decision", "math.applied.business", "math.applied.medical", "math.stats"] }],
          cite: ["ut-math-optout"],
        },
      ],
    },
  };
}

function scienceReq(): Req {
  return {
    id: "science",
    label: "Science",
    kind: "all",
    area: "science",
    of: [
      {
        id: "sci.found",
        label: "Two foundation science areas",
        kind: "choose",
        n: 2,
        of: [
          { id: "sci.f.earth", label: "Earth science", kind: "credits", units: 4, select: [labOnly(["sci.earth"])], cite: ["ut-sci"] },
          { id: "sci.f.bio", label: "Biology", kind: "credits", units: 4, select: [labOnly(["sci.bio", "sci.bio2"])], cite: ["ut-sci"] },
          { id: "sci.f.chem", label: "Chemistry", kind: "credits", units: 4, select: [labOnly(["sci.chem", "sci.chem2"])], cite: ["ut-sci"] },
          { id: "sci.f.phys", label: "Physics", kind: "credits", units: 4, select: [labOnly(["sci.phys", "sci.phys2"])], cite: ["ut-sci"] },
          { id: "sci.f.cs", label: "Computer science", kind: "credits", units: 4, select: [{ types: ["cs.principles", "cs.prog1", "cs.prog2", "cs.advanced"] }], cite: ["ut-sci"] },
        ],
      },
      { id: "sci.more", label: "One more science credit", kind: "credits", units: 4, select: [{ subjects: ["science"], exclude: ["sci.ms"] }], cite: ["ut-sci"] },
    ],
  };
}

function socialStudies(klass: 2027 | 2029): Req {
  const of: Req[] = [
    { id: "ss.us_hist", label: "U.S. History", kind: "credits", units: 4, select: [{ types: ["ss.us_hist"] }], cite: ["ut-ss"] },
    { id: "ss.world", label: "World History or World Geography", kind: "credits", units: 4, select: [{ types: ["ss.world_hist", "ss.world_geo"] }], cite: ["ut-ss"] },
  ];
  if (klass === 2027) {
    of.push({ id: "ss.gov", label: "U.S. Government and Citizenship", kind: "credits", units: 2, select: [{ types: ["ss.us_gov"] }], cite: ["ut-ss"] });
    of.push({ id: "ss.more", label: "More social studies", kind: "credits", units: 2, select: [{ subjects: ["social_studies"], exclude: ["ss.ms"] }], cite: ["ut-ss"] });
  } else {
    of.push({ id: "ss.acgc", label: "American Constitutional Government and Citizenship", kind: "credits", units: 4, select: [{ types: ["ss.ut_acgc"] }], cite: ["ut-acgc"] });
    of.push({ id: "ss.more", label: "More social studies", kind: "credits", units: 2, select: [{ subjects: ["social_studies"], exclude: ["ss.ms", "ss.us_gov"] }], cite: ["ut-ss"] });
  }
  return { id: "ss", label: "Social studies", kind: "all", area: "social_studies", of };
}

function gradVariant(klass: 2027 | 2029): Variant {
  return {
    id: `ut.grad.${klass}`,
    cohort: klass === 2027 ? { from: 2027, to: 2028 } : { from: 2029 },
    allocation: "exclusive",
    requirements: [
      { id: "la", label: "Four language arts credits", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"], exclude: ["ela.ms"] }], cite: ["ut-la"] },
      mathReq(),
      scienceReq(),
      socialStudies(klass),
      { id: "arts", label: "Fine arts", kind: "credits", units: 6, area: "arts", select: [{ subjects: ["arts"] }], cite: ["ut-other"] },
      { id: "health", label: "Health", kind: "credits", units: 2, area: "health_pe", select: [{ types: ["health.health"] }], cite: ["ut-other"] },
      { id: "pe", label: "Physical education", kind: "credits", units: 6, area: "health_pe", select: [{ types: ["pe.general", "pe.fitness", "pe.skills", "pe.lifetime", "pe.athletics"] }], cite: ["ut-other"] },
      { id: "cte", label: "Career and technical education", kind: "credits", units: 4, area: "career_technical", select: [{ cte: true }], cite: ["ut-other"] },
      { id: "digital", label: "Digital studies", kind: "credits", units: 2, area: "digital_studies", select: [{ types: ["cs.intro", "cs.web", "cte.business_office", "cs.principles"] }], cite: ["ut-other"] },
      { id: "finlit", label: "General financial literacy", kind: "credits", units: 2, area: "financial_literacy", select: [{ types: ["ss.pfl"] }], cite: ["ut-other"] },
      { id: "electives", label: "Electives", kind: "remaining_electives", units: klass === 2027 ? 22 : 20, area: "electives", cite: ["ut-total"] },
      { id: "total", label: "Total credits", kind: "total_credits", units: 96, source: "state", cite: ["ut-total"] },
    ],
    checks: [{ id: "senior_math", kind: "senior_year_math", unlessChoice: "utMathCompetencyMet", cite: ["ut-senior"] }],
    warnings: [{ id: "optout", text: "If a parent opts out of Secondary Math III, the state warns it may leave the student unprepared for college math.", cite: ["ut-math-optout"] }],
    unverified: klass === 2029 ? [{ id: "acgc-ap", text: "Which AP or concurrent enrollment classes count toward the new citizenship course." }] : [],
  };
}

export function utGraduation(): RuleFile {
  return {
    ...header("test.ut.graduation", "UT"),
    state: "UT",
    kind: "graduation",
    citations: cites("UT", [
      ["ut-grad", "R277-700-6", "students earn at least 24 credits to graduate."],
      ["ut-la", "6(5)", "four credits of language arts."],
      ["ut-math", "6(6)", "Secondary Mathematics I, II and III."],
      ["ut-math-calc", "6(10)", "calculus with a C or better completes the math requirement."],
      ["ut-math-optout", "6(8)", "a parent may opt out of Secondary Mathematics III in writing."],
      ["ut-sci", "6(11)", "two credits from two of five foundation areas and one more science credit."],
      ["ut-ss", "6(12)", "U.S. History, World History or Geography, and government."],
      ["ut-acgc", "6(12)", "from the class of 2029, American Constitutional Government and Citizenship."],
      ["ut-other", "6(13)-(18)", "fine arts, health, physical education, CTE, digital studies and financial literacy."],
      ["ut-total", "6(22)", "24 credits in all; a district may require more."],
      ["ut-senior", "R277-700-9", "a college-bound student who hasn't shown math competency takes math in the senior year."],
    ]),
    ruleSets: [
      {
        id: "ut.grad",
        state: "UT",
        kind: "state_graduation",
        title: "Utah graduation requirements",
        issuer: { kind: "state", name: "Utah" },
        plainSummary: "The classes every Utah student needs to graduate.",
        strength: "required",
        strengthCite: "ut-grad",
        confidence: "verified",
        cohortKey: "class_year",
        appliesWhen: {},
        variants: [gradVariant(2027), gradVariant(2029)],
      },
    ],
  };
}

export function utAdmissions(): RuleFile {
  return {
    ...header("test.ut.admissions", "UT"),
    state: "UT",
    kind: "admissions",
    citations: cites("UT", [
      ["usu", "admissions", "Utah State recommends four English, four math, three lab sciences and two years of one language."],
      ["uofu-eng", "engineering", "engineering students are expected to be ready for calculus."],
    ]),
    ruleSets: [
      {
        id: "usu.recommended",
        state: "UT",
        kind: "college_admission",
        title: "Utah State recommended courses",
        issuer: { kind: "college", name: "Utah State" },
        plainSummary: "The courses Utah State recommends.",
        strength: "recommended",
        strengthCite: "usu",
        confidence: "verified",
        cohortKey: "class_year",
        appliesWhen: { colleges: [USU], stateDefault: true },
        variants: [
          {
            id: "usu.recommended.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "usu.ela", label: "Four English credits", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"] }], cite: ["usu"] },
              { id: "usu.math", label: "Four math credits", kind: "credits", units: 16, area: "math", select: [{ subjects: ["math"], exclude: ["math.ms"] }], cite: ["usu"] },
              { id: "usu.math.beyond", label: "One math class beyond Math III", kind: "credits", units: 4, area: "math", select: [{ capabilities: ["advanced_math_after_alg2"] }], cite: ["usu"] },
              { id: "usu.sci", label: "Three lab sciences", kind: "credits", units: 12, area: "science", select: [{ capabilities: ["lab_science"], lab: true }], cite: ["usu"] },
              { id: "usu.lang", label: "Two years of one language", kind: "same_language", levels: 2, area: "world_language", cite: ["usu"] },
            ],
          },
        ],
      },
      {
        id: "uofu.engineering",
        state: "UT",
        kind: "program_admission",
        title: "University of Utah engineering",
        issuer: { kind: "program", name: "University of Utah Engineering" },
        plainSummary: "Engineering students are expected to be ready for calculus.",
        strength: "recommended",
        strengthCite: "uofu-eng",
        confidence: "verified",
        cohortKey: "class_year",
        appliesWhen: { colleges: [UOFU], families: ["engineering"] },
        variants: [
          {
            id: "uofu.engineering.all",
            cohort: {},
            allocation: "independent",
            requirements: [{ id: "eng.calc", label: "Calculus", kind: "credits", units: 4, area: "math", select: [{ types: ["math.calc", "math.calc2"] }], cite: ["uofu-eng"] }],
          },
        ],
      },
    ],
  };
}

export function utAid(): RuleFile {
  return {
    ...header("test.ut.aid", "UT"),
    state: "UT",
    kind: "aid",
    citations: cites("UT", [
      ["op", "scholarship", "one AP, IB or concurrent enrollment course in each of math, science and language arts."],
      ["op-gpa", "scholarship", "a 3.3 cumulative GPA and a FAFSA."],
    ]),
    ruleSets: [
      {
        id: "ut.opportunity",
        state: "UT",
        kind: "state_aid",
        title: "Opportunity Scholarship course part",
        issuer: { kind: "aid_agency", name: "the Utah Opportunity Scholarship" },
        plainSummary: "One college-level class in each of math, science and language arts.",
        strength: "required",
        strengthCite: "op",
        confidence: "verified",
        cohortKey: "class_year",
        projectedBeyond: 2027,
        appliesWhen: {},
        variants: [
          {
            id: "ut.opportunity.2026",
            cohort: { from: 2026 },
            allocation: "independent",
            requirements: [
              { id: "op.math", label: "An AP, IB or CE math class", kind: "count", n: 1, select: [{ subjects: ["math"], levels: ["ap", "ib", "dual_enrollment"] }], cite: ["op"] },
              { id: "op.sci", label: "An AP, IB or CE science class", kind: "count", n: 1, select: [{ subjects: ["science"], levels: ["ap", "ib", "dual_enrollment"] }], cite: ["op"] },
              { id: "op.la", label: "An AP, IB or CE language arts class", kind: "count", n: 1, select: [{ subjects: ["english"], levels: ["ap", "ib", "dual_enrollment"] }], cite: ["op"] },
            ],
            conditions: [{ id: "op.gpa", label: "A 3.3 GPA and a FAFSA", kind: "gpa", cite: ["op-gpa"] }],
          },
        ],
      },
    ],
  };
}

export function utGenericCatalog(): GenericCatalogFile {
  return {
    ...header("test.ut.generic-catalog", "UT"),
    state: "UT",
    title: "Classes most Utah high schools offer",
    classesPerYear: 7,
    citations: [],
    courses: [
      { typeId: "ela.9", levels: ["regular", "honors"] },
      { typeId: "ela.10", levels: ["regular", "honors"] },
      { typeId: "ela.11", levels: ["regular", "honors", "dual_enrollment"] },
      { typeId: "ela.12", levels: ["regular", "dual_enrollment"] },
      { typeId: "ela.lang_comp", levels: ["ap", "dual_enrollment"] },
      { typeId: "math.ut_sec1", levels: ["regular", "honors"] },
      { typeId: "math.ut_sec2", levels: ["regular", "honors"] },
      { typeId: "math.ut_sec3", levels: ["regular", "honors"] },
      { typeId: "math.precalc", levels: ["regular"] },
      { typeId: "math.college_alg", levels: ["dual_enrollment"] },
      { typeId: "math.calc", levels: ["ap", "dual_enrollment"] },
      { typeId: "math.stats", levels: ["ap", "dual_enrollment"] },
      { typeId: "math.applied.finance", levels: ["regular"] },
      { typeId: "math.applied.decision", levels: ["regular"] },
      { typeId: "sci.earth", levels: ["regular"] },
      { typeId: "sci.bio", levels: ["regular", "honors", "ap", "dual_enrollment"] },
      { typeId: "sci.chem", levels: ["regular", "honors", "ap", "dual_enrollment"] },
      { typeId: "sci.phys", levels: ["regular", "ap"] },
      { typeId: "sci.anat", levels: ["regular"] },
      { typeId: "ss.world_geo", levels: ["regular", "ap"], units: 4 },
      { typeId: "ss.world_hist", levels: ["regular", "ap"] },
      { typeId: "ss.us_hist", levels: ["regular", "ap", "dual_enrollment"] },
      { typeId: "ss.us_gov", levels: ["regular", "ap"] },
      { typeId: "ss.ut_acgc", levels: ["regular"], firstSchoolYear: 2027 },
      { typeId: "ss.pfl", levels: ["regular"] },
      { typeId: "ss.psych", levels: ["regular", "ap"] },
      { typeId: "lang.es.1", levels: ["regular"] },
      { typeId: "lang.es.2", levels: ["regular"] },
      { typeId: "lang.es.3", levels: ["regular", "dual_enrollment"] },
      { typeId: "arts.visual", levels: ["regular"] },
      { typeId: "arts.ensemble", levels: ["regular"] },
      { typeId: "health.health", levels: ["regular"] },
      { typeId: "pe.fitness", levels: ["regular"] },
      { typeId: "pe.skills", levels: ["regular"] },
      { typeId: "pe.lifetime", levels: ["regular"] },
      { typeId: "cs.intro", levels: ["regular"] },
      { typeId: "cs.web", levels: ["regular"] },
      { typeId: "cs.prog1", levels: ["regular"] },
      { typeId: "cte.business_office", levels: ["regular"] },
      { typeId: "cte.engineering_design", levels: ["regular"] },
      { typeId: "cte.cad", levels: ["regular"] },
      { typeId: "cte.health_principles", levels: ["regular"] },
    ],
  };
}

export function utFacts(): FactsFile {
  return {
    ...header("test.ut.facts", "UT"),
    state: "UT",
    citations: cites("UT", [
      ["ut-soep", "SOEP", "students in grades 6 to 12 may take online courses through the statewide program."],
      ["ut-ce", "CE", "concurrent enrollment is open in grades 9 to 12 with a plan for college and career readiness."],
      ["ut-ms", "6(8)", "math credit before grade 9 only for identified students, dual enrollment, promotion, or passing the test."],
    ]),
    options: [
      { kind: "state_online", programName: "Statewide Online Education Program", grades: [7, 8, 9, 10, 11, 12], note: "A class outside your school; ask how it fits your schedule.", cite: ["ut-soep"] },
      { kind: "college_credit", grades: [9, 10, 11, 12], note: "Utah caps what concurrent enrollment can cost per credit; some students pay less.", cite: ["ut-ce"] },
    ],
    middleSchoolMath: [{ text: "Utah gives high school math credit before 9th grade only in a few cases, such as a student identified as gifted. Ask your school.", cite: ["ut-ms"] }],
  };
}

export function utContent() {
  return { rules: [utGraduation(), utAdmissions(), utAid()], genericCatalog: utGenericCatalog(), facts: utFacts() };
}
