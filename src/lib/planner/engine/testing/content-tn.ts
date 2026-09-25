import type { FactsFile, GenericCatalogFile } from "../../content-types";
import type { CourseTypeId } from "../../course-types";
import type { Req, RuleFile, Variant } from "../../rules";
import { cites, header } from "./common";

// Tennessee test content, shaped like design Appendix A.2 (Policy 2.103, the computer science
// credit, waivers, UTK's 16 units, UTC and UTM unit requirements). Invented quotes; see ./common.ts.

export const UTK = 221759;
export const UTC = 221740;
export const UTM = 221768;

const COLLEGE_MATH: CourseTypeId[] = [
  "math.alg1",
  "math.geom",
  "math.alg2",
  "math.int1",
  "math.int2",
  "math.int3",
  "math.precalc",
  "math.trig",
  "math.calc",
  "math.calc2",
  "math.stats",
  "math.adv_quant",
  "math.discrete",
];

function gradRequirements(withCs: boolean): Req[] {
  const reqs: Req[] = [
    { id: "english", label: "Four English credits", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"], exclude: ["ela.ms"] }], cite: ["tn-ela"] },
    {
      id: "math",
      label: "Math",
      kind: "all",
      area: "math",
      of: [
        { id: "math.alg1", label: "Algebra I", kind: "credits", units: 4, select: [{ types: ["math.alg1", "math.int1"] }], cite: ["tn-math"] },
        { id: "math.geom", label: "Geometry", kind: "credits", units: 4, select: [{ types: ["math.geom", "math.int2"] }], cite: ["tn-math"] },
        { id: "math.alg2", label: "Algebra II", kind: "credits", units: 4, select: [{ types: ["math.alg2", "math.int3"] }], cite: ["tn-math"] },
        {
          id: "math.fourth",
          label: "A 4th math credit",
          kind: "credits",
          units: 4,
          select: [{ capabilities: ["alg2_or_beyond"] }, { types: ["math.stats", "math.applied.decision", "math.applied.finance", "math.adv_quant", "math.discrete"] }],
          cite: ["tn-math"],
        },
      ],
    },
    {
      id: "science",
      label: "Science",
      kind: "all",
      area: "science",
      of: [
        { id: "sci.bio", label: "Biology", kind: "credits", units: 4, select: [{ types: ["sci.bio"] }], cite: ["tn-sci"] },
        { id: "sci.chem_phys", label: "Chemistry or Physics", kind: "credits", units: 4, select: [{ types: ["sci.chem", "sci.phys"] }], cite: ["tn-sci"] },
        { id: "sci.third", label: "A 3rd lab science", kind: "credits", units: 4, select: [{ capabilities: ["lab_science"] }, { types: ["cte.agriscience", "cte.animal_science"] }], cite: ["tn-sci"] },
      ],
    },
    {
      id: "ss",
      label: "Social studies",
      kind: "all",
      area: "social_studies",
      of: [
        { id: "ss.us_hist", label: "U.S. History and Geography", kind: "credits", units: 4, select: [{ types: ["ss.us_hist"] }], cite: ["tn-ss"] },
        { id: "ss.world", label: "World History and Geography", kind: "credits", units: 4, select: [{ types: ["ss.world_hist", "ss.world_geo"] }], cite: ["tn-ss"] },
        { id: "ss.econ", label: "Economics", kind: "credits", units: 2, select: [{ types: ["ss.econ"] }], cite: ["tn-ss"] },
        { id: "ss.gov", label: "U.S. Government and Civics", kind: "credits", units: 2, select: [{ types: ["ss.us_gov"] }], cite: ["tn-ss"] },
      ],
    },
    { id: "pfl", label: "Personal Finance", kind: "credits", units: 2, area: "financial_literacy", select: [{ types: ["ss.pfl"] }], cite: ["tn-pfl"] },
    { id: "wellness", label: "Lifetime Wellness", kind: "credits", units: 4, area: "health_pe", select: [{ types: ["health.wellness"] }], cite: ["tn-pe"] },
    { id: "pe", label: "Physical education", kind: "credits", units: 2, area: "health_pe", select: [{ types: ["pe.general", "pe.fitness", "pe.skills", "pe.lifetime", "pe.athletics"] }], cite: ["tn-pe"] },
    {
      id: "lang",
      label: "World language",
      kind: "option",
      pref: "tnWorldLanguageWaiver",
      area: "world_language",
      cite: ["tn-waiver"],
      on: {
        id: "lang.waived",
        label: "Classes that expand your elective focus, in place of world language",
        kind: "credits",
        units: 8,
        select: [{ subjects: ["career_technical", "arts", "computer_science"] }],
        cite: ["tn-waiver"],
      },
      off: { id: "lang.same", label: "Two credits of one world language", kind: "same_language", levels: 2, cite: ["tn-lang"] },
    },
    {
      id: "arts",
      label: "Fine arts",
      kind: "option",
      pref: "tnFineArtsWaiver",
      area: "arts",
      cite: ["tn-waiver"],
      on: { id: "arts.waived", label: "A class that expands your elective focus, in place of fine arts", kind: "credits", units: 4, select: [{ subjects: ["career_technical", "computer_science", "english", "social_studies"] }], cite: ["tn-waiver"] },
      off: { id: "arts.credit", label: "One fine arts credit", kind: "credits", units: 4, select: [{ subjects: ["arts"] }, { types: ["cte.floral_design", "cte.design_foundations"] }], cite: ["tn-arts"] },
    },
  ];
  if (withCs) {
    reqs.push({
      id: "cs",
      label: "Computer science",
      kind: "credits",
      units: 4,
      area: "computer_science",
      select: [{ subjects: ["computer_science"], exclude: ["cs.ms"] }],
      substitutesForOneOf: ["math.fourth", "sci.third"],
      cite: ["tn-cs"],
    });
  }
  reqs.push(
    { id: "electives", label: "Elective focus and other electives", kind: "remaining_electives", units: 12, area: "electives", cite: ["tn-focus"] },
    { id: "total", label: "Total credits", kind: "total_credits", units: 88, source: "state", cite: ["tn-total"] },
  );
  return reqs;
}

function gradVariant(withCs: boolean): Variant {
  return {
    id: withCs ? "tn.grad.2024" : "tn.grad.2020",
    cohort: withCs ? { from: 2024 } : { from: 2020, to: 2023 },
    allocation: "exclusive",
    requirements: gradRequirements(withCs),
    checks: [{ id: "math_years", kind: "enrolled_years", subject: "math", years: 3, cite: ["tn-math-years"] }],
    conditions: [
      { id: "act_sat", label: "Take the ACT or SAT", kind: "test_participation", cite: ["tn-cond"] },
      { id: "civics", label: "Pass your district's civics test", kind: "civics_test", cite: ["tn-cond"] },
      { id: "attendance", label: "A satisfactory record of attendance and discipline", kind: "attendance_discipline", cite: ["tn-cond"] },
    ],
  };
}

export function tnGraduation(): RuleFile {
  return {
    ...header("test.tn.graduation", "TN"),
    state: "TN",
    kind: "graduation",
    citations: cites("TN", [
      ["tn-grad", "2.103(4)", "students must earn 22 credits to graduate."],
      ["tn-ela", "2.103(4)(a)", "four English credits."],
      ["tn-math", "2.103(4)(a)", "four math credits: Algebra I, Geometry, Algebra II and a fourth."],
      ["tn-math-years", "2.103(4)(a)", "students enroll in math in at least three years of high school."],
      ["tn-sci", "2.103(4)(a)", "Biology, Chemistry or Physics, and a third lab science."],
      ["tn-ss", "2.103(4)(a)", "U.S. History, World History, Economics and Government."],
      ["tn-pfl", "2.103(4)(a)", "one half credit of Personal Finance."],
      ["tn-pe", "2.103(4)(a)", "Lifetime Wellness and one half credit of physical education."],
      ["tn-lang", "2.103(4)(a)", "two credits of the same world language."],
      ["tn-arts", "2.103(4)(a)", "one fine arts credit."],
      ["tn-waiver", "0520-01-03-.06", "world language and fine arts may be waived with the parent's written agreement."],
      ["tn-cs", "2.103(4)(b)", "a computer science credit may only substitute for one math credit, one science credit, or elective focus."],
      ["tn-focus", "2.103(4)(a)", "three credits of an elective focus."],
      ["tn-total", "2.103(4)", "22 credits in all."],
      ["tn-cond", "2.103(4)(c)", "take the ACT or SAT, pass the civics test, and keep satisfactory attendance and discipline."],
    ]),
    ruleSets: [
      {
        id: "tn.grad",
        state: "TN",
        kind: "state_graduation",
        title: "Tennessee graduation requirements",
        issuer: { kind: "state", name: "Tennessee" },
        plainSummary: "The classes every Tennessee student needs to graduate.",
        strength: "required",
        strengthCite: "tn-grad",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: {},
        variants: [gradVariant(false), gradVariant(true)],
      },
    ],
  };
}

export function tnOptions(): RuleFile {
  const focus = (value: "cte" | "humanities", title: string, subjects: ("career_technical" | "english" | "social_studies" | "world_language" | "arts")[]) => ({
    id: `tn.focus.${value}`,
    state: "TN" as const,
    kind: "graduation_option" as const,
    title,
    issuer: { kind: "state" as const, name: "Tennessee" },
    plainSummary: `An elective focus in ${title.toLowerCase()}.`,
    strength: "required" as const,
    strengthCite: "tn-focus-opt",
    confidence: "verified" as const,
    cohortKey: "grade9_entry_year" as const,
    appliesWhen: { choice: { key: "tnElectiveFocus" as const, value } },
    variants: [
      {
        id: `tn.focus.${value}.all`,
        cohort: {},
        extends: "tn.grad.2024",
        allocation: "exclusive" as const,
        requirements: [{ id: "focus", label: "Three focus credits", kind: "credits" as const, units: 12, select: [{ subjects }], cite: ["tn-focus-opt"] }],
      },
    ],
  });
  return {
    ...header("test.tn.options", "TN"),
    state: "TN",
    kind: "options",
    citations: cites("TN", [["tn-focus-opt", "2.103(4)(a)", "the elective focus is chosen by the end of grade 10."]]),
    ruleSets: [focus("cte", "Career and technical education focus", ["career_technical"]), focus("humanities", "Humanities focus", ["english", "social_studies", "world_language", "arts"])],
  };
}

export function tnAdmissions(): RuleFile {
  return {
    ...header("test.tn.admissions", "TN"),
    state: "TN",
    kind: "admissions",
    citations: cites("TN", [
      ["utk", "first-year", "the 16 core units are not required for admission but strongly encouraged."],
      ["utc", "requirements", "applicants must meet unit requirements."],
      ["utm", "requirements", "applicants must meet unit requirements, including one unit of visual or performing arts."],
      ["utk-nur", "nursing", "chemistry is recommended for nursing applicants."],
    ]),
    ruleSets: [
      {
        id: "utk.core16",
        state: "TN",
        kind: "college_admission",
        title: "UT Knoxville's 16 core units",
        issuer: { kind: "college", name: "UT Knoxville" },
        plainSummary: "The high school units UT Knoxville strongly encourages.",
        strength: "strongly_encouraged",
        strengthCite: "utk",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UTK], stateDefault: true },
        variants: [
          {
            id: "utk.core16.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "utk.ela", label: "Four English units", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"], exclude: ["ela.ms"] }], cite: ["utk"] },
              { id: "utk.math", label: "Four math units", kind: "credits", units: 16, area: "math", select: [{ types: COLLEGE_MATH }], cite: ["utk"] },
              { id: "utk.sci", label: "Three lab science units", kind: "credits", units: 12, area: "science", select: [{ capabilities: ["lab_science"] }], cite: ["utk"] },
              { id: "utk.ss", label: "U.S. History and one more social studies unit", kind: "credits", units: 8, area: "social_studies", select: [{ types: ["ss.us_hist", "ss.world_hist", "ss.world_geo"] }], cite: ["utk"] },
              { id: "utk.lang", label: "Two units of one world language", kind: "same_language", levels: 2, area: "world_language", cite: ["utk"] },
              { id: "utk.arts", label: "One visual or performing arts unit", kind: "credits", units: 4, area: "arts", select: [{ subjects: ["arts"] }], cite: ["utk"] },
            ],
          },
        ],
      },
      {
        id: "utc.units",
        state: "TN",
        kind: "college_admission",
        title: "UT Chattanooga unit requirements",
        issuer: { kind: "college", name: "UT Chattanooga" },
        plainSummary: "The units UT Chattanooga requires.",
        strength: "required",
        strengthCite: "utc",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UTC] },
        variants: [
          {
            id: "utc.units.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "utc.math", label: "Four math units", kind: "credits", units: 16, area: "math", select: [{ types: COLLEGE_MATH }], cite: ["utc"] },
              { id: "utc.sci", label: "Three science units", kind: "credits", units: 12, area: "science", select: [{ types: ["sci.bio", "sci.chem", "sci.phys", "sci.anat", "sci.env", "sci.earth", "sci.bio2", "sci.chem2", "sci.phys2"] }], cite: ["utc"] },
              { id: "utc.lang", label: "Two units of one world language", kind: "same_language", levels: 2, area: "world_language", cite: ["utc"] },
              { id: "utc.arts", label: "One fine arts unit", kind: "credits", units: 4, area: "arts", select: [{ subjects: ["arts"] }], cite: ["utc"] },
            ],
          },
        ],
      },
      {
        id: "utm.units",
        state: "TN",
        kind: "college_admission",
        title: "UT Martin unit requirements",
        issuer: { kind: "college", name: "UT Martin" },
        plainSummary: "The units UT Martin requires.",
        strength: "required",
        strengthCite: "utm",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UTM] },
        variants: [
          {
            id: "utm.units.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "utm.math", label: "Four math units", kind: "credits", units: 16, area: "math", select: [{ types: COLLEGE_MATH }], cite: ["utm"] },
              { id: "utm.lang", label: "Two units of one world language", kind: "same_language", levels: 2, area: "world_language", cite: ["utm"] },
              { id: "utm.arts", label: "One visual or performing arts unit", kind: "credits", units: 4, area: "arts", select: [{ subjects: ["arts"], cte: false }], cite: ["utm"] },
            ],
          },
        ],
      },
      {
        id: "utk.nursing",
        state: "TN",
        kind: "program_admission",
        title: "UT Knoxville nursing",
        issuer: { kind: "program", name: "UT Knoxville Nursing" },
        plainSummary: "What UT Knoxville's nursing program recommends.",
        strength: "recommended",
        strengthCite: "utk-nur",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UTK], families: ["nursing"] },
        variants: [
          {
            id: "utk.nursing.all",
            cohort: {},
            allocation: "independent",
            requirements: [{ id: "nur.chem", label: "Chemistry", kind: "credits", units: 4, area: "science", select: [{ types: ["sci.chem"] }], cite: ["utk-nur"] }],
          },
        ],
      },
    ],
  };
}

export function tnGenericCatalog(): GenericCatalogFile {
  return {
    ...header("test.tn.generic-catalog", "TN"),
    state: "TN",
    title: "Classes most Tennessee high schools offer",
    classesPerYear: 7,
    citations: [],
    courses: [
      { typeId: "ela.9", levels: ["regular", "honors"] },
      { typeId: "ela.10", levels: ["regular", "honors"] },
      { typeId: "ela.11", levels: ["regular", "honors", "dual_enrollment"] },
      { typeId: "ela.12", levels: ["regular", "honors", "dual_enrollment"] },
      { typeId: "ela.lang_comp", levels: ["ap"] },
      { typeId: "math.alg1", levels: ["regular", "honors"] },
      { typeId: "math.geom", levels: ["regular", "honors"] },
      { typeId: "math.alg2", levels: ["regular", "honors"] },
      { typeId: "math.precalc", levels: ["regular", "honors"] },
      { typeId: "math.calc", levels: ["ap"] },
      { typeId: "math.stats", levels: ["regular", "ap", "dual_enrollment"] },
      { typeId: "math.applied.decision", levels: ["regular"] },
      { typeId: "sci.bio", levels: ["regular", "honors"] },
      { typeId: "sci.chem", levels: ["regular", "honors", "ap"] },
      { typeId: "sci.phys", levels: ["regular"] },
      { typeId: "sci.anat", levels: ["regular", "honors", "dual_enrollment"] },
      { typeId: "sci.env", levels: ["regular"] },
      { typeId: "ss.world_hist", levels: ["regular", "honors"] },
      { typeId: "ss.us_hist", levels: ["regular", "ap"] },
      { typeId: "ss.econ", levels: ["regular"] },
      { typeId: "ss.us_gov", levels: ["regular"] },
      { typeId: "ss.pfl", levels: ["regular"] },
      { typeId: "health.wellness", levels: ["regular"] },
      { typeId: "pe.general", levels: ["regular"] },
      { typeId: "lang.es.1", levels: ["regular"] },
      { typeId: "lang.es.2", levels: ["regular"] },
      { typeId: "lang.es.3", levels: ["regular"] },
      { typeId: "arts.visual", levels: ["regular"] },
      { typeId: "arts.ensemble", levels: ["regular"] },
      { typeId: "cs.intro", levels: ["regular"] },
      { typeId: "cs.prog1", levels: ["regular"] },
      { typeId: "cte.floral_design", levels: ["regular"] },
      { typeId: "cte.agriscience", levels: ["regular"] },
      { typeId: "cte.health_principles", levels: ["regular"] },
      { typeId: "cte.medical_terminology", levels: ["regular"] },
    ],
  };
}

export function tnFacts(): FactsFile {
  return {
    ...header("test.tn.facts", "TN"),
    state: "TN",
    citations: cites("TN", [
      ["tn-summer", "2.103", "a first attempt in summer is for accelerated students; end-of-course credit waits for the fall exam."],
      ["tn-dual", "grant", "the dual enrollment grant covers juniors and seniors."],
      ["tn-exam", "2.103", "credit by exam is available for listed courses, up to four credits."],
      ["tn-ms", "2.103", "middle school math credit counts, but math enrollment in three years of high school is still required."],
    ]),
    options: [
      { kind: "summer", note: "One summer; a first try in summer is usually for students moving ahead.", cite: ["tn-summer"] },
      { kind: "college_credit", programName: "Dual Enrollment Grant", grades: [11, 12], note: "State help exists for juniors and seniors.", cite: ["tn-dual"] },
      { kind: "credit_by_exam", types: ["math.alg1", "math.geom", "sci.bio", "ss.us_hist"], note: "An exam instead of the class, for listed courses only.", cite: ["tn-exam"] },
    ],
    middleSchoolMath: [{ text: "In Tennessee, high school math credit earned in middle school counts, but you still take math in at least three years of high school.", cite: ["tn-ms"] }],
  };
}

export function tnContent() {
  return { rules: [tnGraduation(), tnOptions(), tnAdmissions()], genericCatalog: tnGenericCatalog(), facts: tnFacts() };
}
