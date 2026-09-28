import type { FactsFile, GenericCatalogFile } from "../../content-types";
import type { CourseTypeId } from "../../course-types";
import type { Req, RuleFile, Selector, Variant } from "../../rules";
import { cites, header } from "./common";

// Texas test content, shaped like design Appendix A.3 (FHSP, endorsements, DLA, UT Austin,
// Texas A&M, TEXAS Grant). Invented quotes; see ./common.ts.

export const UT_AUSTIN = 228778;
export const TAMU = 228723;

const LIST_B_MATH: Selector[] = [
  { capabilities: ["alg2_or_beyond"] },
  { types: ["math.stats", "math.adv_quant", "math.alg_reasoning", "math.discrete", "math.applied.engineering", "math.applied.medical"] },
];
const LIST_A_MATH: CourseTypeId[] = ["math.applied.models", "math.applied.technical", "math.applied.finance", "cte.digital_electronics", "cte.accounting2", "cte.robotics2"];
const CS_PROGRAMMING: CourseTypeId[] = ["cs.principles", "cs.prog1", "cs.prog2", "cs.advanced"];

function fhspRequirements(cohort: "2022" | "2026"): Req[] {
  const socialStudies: Req =
    cohort === "2026"
      ? {
          id: "ss",
          label: "Social studies",
          kind: "all",
          area: "social_studies",
          of: [
            { id: "ss.us_hist", label: "U.S. History", kind: "credits", units: 4, select: [{ types: ["ss.us_hist"] }], cite: ["tx-ss-2026"] },
            { id: "ss.us_gov", label: "U.S. Government", kind: "credits", units: 2, select: [{ types: ["ss.us_gov"] }], cite: ["tx-ss-2026"] },
            { id: "ss.pfl", label: "Personal Financial Literacy", kind: "credits", units: 2, select: [{ types: ["ss.pfl", "ss.pfl_econ"] }], cite: ["tx-ss-2026"] },
            { id: "ss.world", label: "World History, World Geography or Economics", kind: "credits", units: 4, select: [{ types: ["ss.world_hist", "ss.world_geo", "ss.econ"] }], cite: ["tx-ss-2026"] },
          ],
        }
      : {
          id: "ss",
          label: "Social studies",
          kind: "all",
          area: "social_studies",
          of: [
            { id: "ss.us_hist", label: "U.S. History", kind: "credits", units: 4, select: [{ types: ["ss.us_hist"] }], cite: ["tx-ss"] },
            { id: "ss.us_gov", label: "U.S. Government", kind: "credits", units: 2, select: [{ types: ["ss.us_gov"] }], cite: ["tx-ss"] },
            { id: "ss.econ", label: "Economics, or Personal Financial Literacy and Economics", kind: "credits", units: 2, select: [{ types: ["ss.econ", "ss.pfl_econ"] }], cite: ["tx-ss"] },
            { id: "ss.world", label: "World History or World Geography", kind: "credits", units: 4, select: [{ types: ["ss.world_hist", "ss.world_geo"] }], cite: ["tx-ss"] },
          ],
        };
  return [
    {
      id: "ela",
      label: "English",
      kind: "all",
      area: "english",
      of: [
        { id: "ela.1", label: "English I", kind: "credits", units: 4, select: [{ types: ["ela.9", "ela.esol"] }], cite: ["tx-ela"] },
        { id: "ela.2", label: "English II", kind: "credits", units: 4, select: [{ types: ["ela.10", "ela.esol", "ela.seminar"] }], cite: ["tx-ela"] },
        { id: "ela.3", label: "English III", kind: "credits", units: 4, select: [{ types: ["ela.11", "ela.lang_comp", "ela.lit_comp"] }], cite: ["tx-ela"] },
        {
          id: "ela.4",
          label: "A 4th English credit",
          kind: "credits",
          units: 4,
          select: [{ types: ["ela.12", "ela.lang_comp", "ela.lit_comp", "ela.creative_writing", "ela.research", "ela.humanities", "ela.college_prep", "ela.professional_comm"] }],
          cite: ["tx-ela"],
        },
      ],
    },
    {
      id: "math",
      label: "Math",
      kind: "all",
      area: "math",
      of: [
        { id: "math.alg1", label: "Algebra I", kind: "credits", units: 4, select: [{ types: ["math.alg1"] }], cite: ["tx-math"] },
        { id: "math.geom", label: "Geometry", kind: "credits", units: 4, select: [{ types: ["math.geom"] }], cite: ["tx-math"] },
        {
          id: "math.third",
          label: "A 3rd math credit (List A or B)",
          kind: "credits",
          units: 4,
          select: [...LIST_B_MATH, { types: LIST_A_MATH }, { types: ["cs.prog2"], levels: ["ap", "ib"] }],
          cite: ["tx-math"],
        },
      ],
    },
    {
      id: "sci",
      label: "Science",
      kind: "all",
      area: "science",
      of: [
        { id: "sci.bio", label: "Biology", kind: "credits", units: 4, select: [{ types: ["sci.bio"] }], cite: ["tx-sci"] },
        { id: "sci.second", label: "IPC, Chemistry or Physics", kind: "credits", units: 4, select: [{ types: ["sci.ipc", "sci.chem", "sci.phys", "sci.phys_eng"] }], cite: ["tx-sci"] },
        { id: "sci.third", label: "A 3rd lab science", kind: "credits", units: 4, select: [{ capabilities: ["lab_science"] }], cite: ["tx-sci"] },
      ],
    },
    socialStudies,
    {
      id: "lote",
      label: "Languages other than English",
      kind: "any",
      area: "world_language",
      of: [
        { id: "lote.lang", label: "Two levels of one language", kind: "same_language", levels: 2, cite: ["tx-lote"] },
        { id: "lote.cs", label: "Two computer programming credits", kind: "credits", units: 8, select: [{ types: CS_PROGRAMMING }], cite: ["tx-lote"] },
      ],
    },
    { id: "pe", label: "Physical education", kind: "credits", units: 4, area: "health_pe", select: [{ subjects: ["health_pe"], exclude: ["health.health", "health.wellness"] }, { types: ["other.jrotc"] }], cite: ["tx-pe"] },
    { id: "arts", label: "Fine arts", kind: "credits", units: 4, area: "arts", select: [{ subjects: ["arts"] }, { types: ["cte.floral_design", "arts.media"] }], cite: ["tx-arts"] },
    { id: "electives", label: "Electives", kind: "remaining_electives", units: 20, area: "electives", cite: ["tx-elec"] },
    { id: "total", label: "Total credits", kind: "total_credits", units: 88, source: "state", cite: ["tx-total"] },
  ];
}

function fhspVariant(cohort: "2022" | "2026"): Variant {
  return {
    id: `tx.fhsp.grad.${cohort}`,
    cohort: cohort === "2026" ? { from: 2026 } : { from: 2022, to: 2025 },
    allocation: "exclusive",
    requirements: fhspRequirements(cohort),
    checks: [{ id: "no_endorsement", kind: "no_endorsement_after", grade: 10, needs: "parent_written_permission", cite: ["tx-noend"] }],
    conditions: [
      { id: "eoc", label: "Pass the end-of-course exams in Algebra I, Biology, English I and U.S. History", kind: "exam", cite: ["tx-eoc"] },
      { id: "fafsa", label: "Submit a FAFSA or TASFA, or an opt-out form", kind: "form", cite: ["tx-fafsa"] },
    ],
    unverified: [{ id: "eoc-schedule", text: "When the new end-of-course exam schedule takes effect." }],
  };
}

const END_MATH4: Req = {
  id: "end.math4",
  label: "A 4th math credit",
  kind: "any",
  area: "math",
  of: [
    { id: "end.math4.listb", label: "A 4th math credit (List B)", kind: "credits", units: 4, select: [...LIST_B_MATH, { types: ["cs.prog2"], levels: ["ap", "ib"] }], cite: ["tx-endorse"] },
    {
      id: "end.math4.csa",
      label: "AP Computer Science A as the 4th math",
      kind: "credits",
      units: 4,
      shareable: true,
      select: [{ types: ["cs.prog2"], levels: ["ap", "ib"] }],
      note: "It can count as both a math and a language credit. Ask how your school records it.",
      cite: ["tx-csa"],
    },
  ],
};
const END_SCI4 = (id: string): Req => ({ id, label: "A 4th science credit", kind: "credits", units: 4, area: "science", select: [{ capabilities: ["lab_science"] }], cite: ["tx-endorse"] });
const END_TOTAL: Req = { id: "end.total", label: "Total credits with an endorsement", kind: "total_credits", units: 104, source: "state", cite: ["tx-endorse"] };

export function txGraduation(): RuleFile {
  return {
    ...header("test.tx.graduation", "TX"),
    state: "TX",
    kind: "graduation",
    citations: cites("TX", [
      ["tx-grad", "§74.12(a)", "a student must earn these credits to graduate under the foundation program."],
      ["tx-ela", "§74.12(b)(1)", "four English credits, including English I, II and III."],
      ["tx-math", "§74.12(b)(2)", "three math credits, Algebra I, Geometry and one more from list A or B."],
      ["tx-sci", "§74.12(b)(3)", "Biology, one of IPC, Chemistry or Physics, and one more lab science."],
      ["tx-ss", "§74.12(b)(4)", "before 2026-27 entry: U.S. History, U.S. Government, Economics and World History or Geography."],
      ["tx-ss-2026", "§74.12(b)(4)", "from 2026-27 entry: U.S. History, U.S. Government, Personal Financial Literacy and one world course."],
      ["tx-lote", "§74.12(b)(5)", "two levels of the same language, or two credits of computer programming."],
      ["tx-pe", "§74.12(b)(6)", "one credit of physical education."],
      ["tx-arts", "§74.12(b)(7)", "one credit of fine arts."],
      ["tx-elec", "§74.12(b)(8)", "five elective credits."],
      ["tx-total", "§74.12(a)", "at least 22 credits in all."],
      ["tx-noend", "§74.11(f)", "no endorsement only after the sophomore year, with counselor advising and written parent permission."],
      ["tx-eoc", "§39.025(a)", "satisfactory performance on the end-of-course exams."],
      ["tx-fafsa", "§28.0256", "a financial aid application or an opt-out form."],
    ]),
    ruleSets: [
      {
        id: "tx.fhsp.grad",
        state: "TX",
        kind: "state_graduation",
        title: "Foundation High School Program",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "The classes every Texas student needs to graduate.",
        strength: "required",
        strengthCite: "tx-grad",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: {},
        variants: [fhspVariant("2022"), fhspVariant("2026")],
      },
    ],
  };
}

export function txOptions(): RuleFile {
  return {
    ...header("test.tx.options", "TX"),
    state: "TX",
    kind: "options",
    citations: cites("TX", [
      ["tx-endorse", "§74.13(e)", "every endorsement adds a 4th math from the restricted list, a 4th science and two electives."],
      ["tx-csa", "§74.11(n)", "AP Computer Science A satisfies one advanced math and one language requirement."],
      ["tx-stem", "§74.13(f)(6)", "STEM requires Algebra II, Chemistry and Physics plus one of options A to D."],
      ["tx-multi", "§74.13(f)(5)", "Multidisciplinary Studies: four advanced courses, or four credits in each core subject."],
      ["tx-ah", "§74.13(f)(4)", "Arts and Humanities: five social studies credits, four levels of one language, or four fine arts credits."],
      ["tx-ah-swap", "§74.13(e)(6)", "with parent permission an Arts and Humanities student may swap the 4th science."],
      ["tx-dla", "§74.11(g)", "the distinguished level needs an endorsement, four math credits including Algebra II, and four science credits."],
      ["tx-dla-schedule", "§51.803(d)", "the transcript shows the distinguished level on schedule by the end of the junior year."],
      ["tx-dla-test", "§51.803(a)", "or a college entrance exam score set by the coordinating board."],
    ]),
    ruleSets: [
      {
        id: "tx.endorse.stem",
        state: "TX",
        kind: "graduation_option",
        title: "STEM endorsement",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "Science, technology, engineering and math.",
        strength: "required",
        strengthCite: "tx-stem",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txEndorsements", value: "stem" } },
        variants: [
          {
            id: "tx.endorse.stem.2022",
            cohort: { from: 2022 },
            extends: "tx.fhsp.grad.2026",
            allocation: "exclusive",
            requirements: [
              END_MATH4,
              END_SCI4("end.sci4"),
              END_TOTAL,
              {
                id: "stem.core",
                label: "Algebra II, Chemistry and Physics",
                kind: "all",
                of: [
                  { id: "stem.alg2", label: "Algebra II", kind: "credits", units: 4, shareable: true, area: "math", select: [{ types: ["math.alg2"] }], cite: ["tx-stem"] },
                  { id: "stem.chem", label: "Chemistry", kind: "credits", units: 4, shareable: true, area: "science", select: [{ types: ["sci.chem"] }], cite: ["tx-stem"] },
                  { id: "stem.phys", label: "Physics", kind: "credits", units: 4, shareable: true, area: "science", select: [{ types: ["sci.phys", "sci.phys_eng"] }], cite: ["tx-stem"] },
                ],
              },
              {
                id: "stem.option",
                label: "One STEM option",
                kind: "any",
                of: [
                  { id: "stem.b", label: "Two more math classes after Algebra II", kind: "credits", units: 8, shareable: true, area: "math", select: [{ capabilities: ["advanced_math_after_alg2"] }], cite: ["tx-stem"] },
                  {
                    id: "stem.c",
                    label: "Two more sciences",
                    kind: "credits",
                    units: 8,
                    shareable: true,
                    area: "science",
                    select: [{ capabilities: ["lab_science"], exclude: ["sci.chem", "sci.phys", "sci.phys_eng"] }],
                    cite: ["tx-stem"],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "tx.endorse.multi",
        state: "TX",
        kind: "graduation_option",
        title: "Multidisciplinary Studies endorsement",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "A mix of advanced classes across subjects.",
        strength: "required",
        strengthCite: "tx-multi",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txEndorsements", value: "multidisciplinary" } },
        variants: [
          {
            id: "tx.endorse.multi.2022",
            cohort: { from: 2022 },
            extends: "tx.fhsp.grad.2026",
            allocation: "exclusive",
            requirements: [
              END_MATH4,
              END_SCI4("end.sci4"),
              END_TOTAL,
              {
                id: "multi.option",
                label: "One Multidisciplinary option",
                kind: "any",
                of: [
                  {
                    id: "multi.core4",
                    label: "Four credits in each core subject",
                    kind: "all",
                    of: [
                      { id: "multi.ela", label: "Four English credits", kind: "credits", units: 16, shareable: true, select: [{ subjects: ["english"] }], cite: ["tx-multi"] },
                      { id: "multi.math", label: "Four math credits", kind: "credits", units: 16, shareable: true, select: [{ subjects: ["math"], exclude: ["math.ms"] }], cite: ["tx-multi"] },
                      { id: "multi.sci", label: "Four science credits", kind: "credits", units: 16, shareable: true, select: [{ subjects: ["science"], exclude: ["sci.ms"] }], cite: ["tx-multi"] },
                      { id: "multi.ss", label: "Four social studies credits", kind: "credits", units: 16, shareable: true, select: [{ subjects: ["social_studies"], exclude: ["ss.ms"] }], cite: ["tx-multi"] },
                    ],
                  },
                  { id: "multi.adv", label: "Four AP, IB or dual credit classes", kind: "count", n: 4, select: [{ levels: ["ap", "ib", "dual_enrollment"] }], cite: ["tx-multi"] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "tx.endorse.ah",
        state: "TX",
        kind: "graduation_option",
        title: "Arts and Humanities endorsement",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "Social studies, languages or fine arts in depth.",
        strength: "required",
        strengthCite: "tx-ah",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txEndorsements", value: "arts_humanities" } },
        variants: [
          {
            id: "tx.endorse.ah.all",
            cohort: {},
            extends: "tx.fhsp.grad.2026",
            allocation: "exclusive",
            requirements: [
              END_MATH4,
              {
                id: "ah.sci4",
                label: "A 4th science credit",
                kind: "option",
                pref: "txArtsHumanitiesScienceSwap",
                cite: ["tx-ah-swap"],
                on: {
                  id: "ah.sci4.swap",
                  label: "A 4th English, social studies, language or fine arts class instead of a 4th science",
                  kind: "credits",
                  units: 4,
                  select: [{ subjects: ["english", "social_studies", "world_language", "arts"] }],
                  cite: ["tx-ah-swap"],
                },
                off: END_SCI4("ah.sci4.lab"),
              },
              END_TOTAL,
              {
                id: "ah.option",
                label: "One Arts and Humanities option",
                kind: "any",
                of: [
                  { id: "ah.ss5", label: "Five social studies credits", kind: "credits", units: 20, shareable: true, select: [{ subjects: ["social_studies"] }], cite: ["tx-ah"] },
                  { id: "ah.lang4", label: "Four levels of one language", kind: "same_language", levels: 4, cite: ["tx-ah"] },
                  { id: "ah.arts4", label: "Four fine arts credits", kind: "credits", units: 16, shareable: true, select: [{ subjects: ["arts"] }], cite: ["tx-ah"] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "tx.dla",
        state: "TX",
        kind: "graduation_option",
        title: "Distinguished Level of Achievement",
        issuer: { kind: "state", name: "Texas" },
        plainSummary: "The course route to automatic admission at Texas public universities.",
        strength: "required",
        strengthCite: "tx-dla",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { choice: { key: "txAimDla", value: true } },
        variants: [
          {
            id: "tx.dla.2022",
            cohort: { from: 2022 },
            extends: "tx.fhsp.grad.2026",
            allocation: "exclusive",
            requirements: [
              { id: "dla.alg2", label: "Algebra II", kind: "credits", units: 4, shareable: true, area: "math", select: [{ types: ["math.alg2"] }], deadlineGrade: 11, cite: ["tx-dla", "tx-dla-schedule"] },
              { id: "dla.math4", label: "A 4th math credit", kind: "credits", units: 4, area: "math", select: [...LIST_B_MATH, { types: ["cs.prog2"], levels: ["ap", "ib"] }], cite: ["tx-dla"] },
              { id: "dla.sci4", label: "A 4th science credit", kind: "credits", units: 4, area: "science", select: [{ capabilities: ["lab_science"] }], cite: ["tx-dla"] },
            ],
            checks: [
              { id: "dla.on_schedule", kind: "on_schedule_by", req: "dla.alg2", grade: 11, cite: ["tx-dla-schedule"] },
              { id: "dla.endorsement", kind: "requires_rule_set", anyOf: ["tx.endorse.stem", "tx.endorse.multi", "tx.endorse.ah"], cite: ["tx-dla"] },
            ],
          },
        ],
        testRoutes: [{ id: "dla.test", text: "Or a college entrance exam score the state coordinating board sets (that rule is changing).", cite: ["tx-dla-test"] }],
      },
    ],
  };
}

export function txAdmissions(): RuleFile {
  return {
    ...header("test.tx.admissions", "TX"),
    state: "TX",
    kind: "admissions",
    citations: cites("TX", [
      ["ut-pre", "prerequisites", "UT Austin requires four English, three math, two science, three social studies and two years of one language."],
      ["ut-rec", "prerequisites", "UT Austin recommends four math and four science."],
      ["ut-cr", "calculus readiness", "calculus readiness: Calculus I with a B or higher, or a qualifying test score, by December 10."],
      ["ut-cr-test", "calculus readiness", "SAT Math 620, ACT Math 26 or CLT Math 26 or higher."],
      ["tamu", "college readiness", "Texas A&M recommends four English, four math, four science and two years of one language."],
    ]),
    ruleSets: [
      {
        id: "utaustin.prereq",
        state: "TX",
        kind: "college_admission",
        title: "UT Austin high school prerequisites",
        issuer: { kind: "college", name: "UT Austin" },
        plainSummary: "The classes UT Austin requires and recommends.",
        strength: "required",
        strengthCite: "ut-pre",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UT_AUSTIN] },
        variants: [
          {
            id: "utaustin.prereq.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "ut.ela", label: "Four English credits", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"] }], cite: ["ut-pre"] },
              { id: "ut.math", label: "Three math credits", kind: "credits", units: 12, area: "math", select: [{ subjects: ["math"], exclude: ["math.ms"] }], cite: ["ut-pre"] },
              {
                id: "ut.math.rec",
                label: "A 4th math credit",
                kind: "credits",
                units: 16,
                strength: "recommended",
                strengthCite: "ut-rec",
                area: "math",
                select: [{ subjects: ["math"], exclude: ["math.ms"] }],
                cite: ["ut-rec"],
              },
              { id: "ut.sci", label: "Two science credits", kind: "credits", units: 8, area: "science", select: [{ subjects: ["science"], exclude: ["sci.ms"] }], cite: ["ut-pre"] },
              { id: "ut.ss", label: "Three social studies credits", kind: "credits", units: 12, area: "social_studies", select: [{ subjects: ["social_studies"], exclude: ["ss.ms"] }], cite: ["ut-pre"] },
              {
                id: "ut.lang",
                label: "Two years of one language",
                kind: "any",
                area: "world_language",
                of: [
                  { id: "ut.lang.same", label: "Two levels of one language", kind: "same_language", levels: 2, cite: ["ut-pre"] },
                  { id: "ut.lang.cs", label: "Two computer science credits", kind: "credits", units: 8, select: [{ subjects: ["computer_science"] }], cite: ["ut-pre"] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "utaustin.calc_ready",
        state: "TX",
        kind: "program_admission",
        title: "UT Austin calculus readiness",
        issuer: { kind: "program", name: "UT Austin" },
        plainSummary: "Engineering, computer science and some science majors need calculus readiness.",
        strength: "required",
        strengthCite: "ut-cr",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [UT_AUSTIN], families: ["engineering", "computer_data_science", "math_physical_sciences", "natural_resources"] },
        variants: [
          {
            id: "utaustin.calc_ready.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "cr.calc", label: "Calculus I with a B or higher", kind: "credits", units: 4, area: "math", deadlineGrade: 11, select: [{ types: ["math.calc", "math.calc2"], minLetter: "B" }], cite: ["ut-cr"] },
            ],
          },
        ],
        testRoutes: [{ id: "cr.test", text: "An SAT Math score of 620, an ACT Math score of 26 or a CLT Math score of 26 or higher, received by December 10 of 12th grade.", cite: ["ut-cr-test"], by: { grade: 12, month: 12, day: 10 } }],
      },
      {
        id: "tamu.recommended",
        state: "TX",
        kind: "college_admission",
        title: "Texas A&M recommended classes",
        issuer: { kind: "college", name: "Texas A&M" },
        plainSummary: "The classes Texas A&M recommends.",
        strength: "recommended",
        strengthCite: "tamu",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: { colleges: [TAMU], stateDefault: true },
        variants: [
          {
            id: "tamu.recommended.all",
            cohort: {},
            allocation: "independent",
            requirements: [
              { id: "tamu.ela", label: "Four English credits", kind: "credits", units: 16, area: "english", select: [{ subjects: ["english"] }], cite: ["tamu"] },
              { id: "tamu.math", label: "Four math credits", kind: "credits", units: 16, area: "math", select: [{ subjects: ["math"], exclude: ["math.ms"] }], cite: ["tamu"] },
              { id: "tamu.sci", label: "Four science credits", kind: "credits", units: 16, area: "science", select: [{ subjects: ["science"], exclude: ["sci.ms"] }], cite: ["tamu"] },
              { id: "tamu.lang", label: "Two years of one language", kind: "same_language", levels: 2, area: "world_language", cite: ["tamu"] },
            ],
          },
        ],
      },
    ],
  };
}

export function txAid(): RuleFile {
  return {
    ...header("test.tx.aid", "TX"),
    state: "TX",
    kind: "aid",
    citations: cites("TX", [
      ["tg", "§56.3041", "the grant gives priority to students who meet two of four measures, one being advanced math after Algebra II."],
      ["tg-tsi", "§56.3041", "college readiness on the state assessment is one of the measures."],
    ]),
    ruleSets: [
      {
        id: "tx.texas_grant",
        state: "TX",
        kind: "state_aid",
        title: "TEXAS Grant priority",
        issuer: { kind: "aid_agency", name: "the TEXAS Grant" },
        plainSummary: "Some classes raise your priority for the TEXAS Grant.",
        strength: "priority",
        strengthCite: "tg",
        confidence: "verified",
        cohortKey: "grade9_entry_year",
        appliesWhen: {},
        variants: [
          {
            id: "tx.texas_grant.all",
            cohort: {},
            allocation: "independent",
            requirements: [{ id: "tg.adv_math", label: "An advanced math class after Algebra II", kind: "credits", units: 4, area: "math", select: [{ capabilities: ["advanced_math_after_alg2"] }], cite: ["tg"] }],
            conditions: [{ id: "tg.tsi", label: "College readiness on the state test", kind: "test_score", cite: ["tg-tsi"] }],
          },
        ],
      },
    ],
  };
}

export function txGenericCatalog(): GenericCatalogFile {
  return {
    ...header("test.tx.generic-catalog", "TX"),
    state: "TX",
    title: "Classes most Texas high schools offer",
    classesPerYear: 7,
    citations: [],
    courses: [
      { typeId: "ela.9", levels: ["regular", "honors"] },
      { typeId: "ela.10", levels: ["regular", "honors"] },
      { typeId: "ela.11", levels: ["regular", "honors"] },
      { typeId: "ela.12", levels: ["regular", "honors"] },
      { typeId: "ela.lang_comp", levels: ["ap"] },
      { typeId: "ela.lit_comp", levels: ["ap"] },
      { typeId: "math.alg1", levels: ["regular", "honors"] },
      { typeId: "math.geom", levels: ["regular", "honors"] },
      { typeId: "math.alg2", levels: ["regular", "honors"] },
      { typeId: "math.precalc", levels: ["regular", "honors"] },
      { typeId: "math.calc", levels: ["ap", "dual_enrollment"] },
      { typeId: "math.stats", levels: ["regular", "ap"] },
      { typeId: "math.applied.models", levels: ["regular"] },
      { typeId: "sci.bio", levels: ["regular", "honors", "ap"] },
      { typeId: "sci.chem", levels: ["regular", "honors", "ap"] },
      { typeId: "sci.phys", levels: ["regular", "ap"] },
      { typeId: "sci.ipc", levels: ["regular"] },
      { typeId: "sci.env", levels: ["regular", "ap"] },
      { typeId: "sci.anat", levels: ["regular"] },
      { typeId: "sci.earth", levels: ["regular"] },
      { typeId: "ss.world_geo", levels: ["regular", "honors", "ap"] },
      { typeId: "ss.world_hist", levels: ["regular", "ap"] },
      { typeId: "ss.us_hist", levels: ["regular", "ap"] },
      { typeId: "ss.us_gov", levels: ["regular", "ap"] },
      { typeId: "ss.econ", levels: ["regular", "ap"] },
      { typeId: "ss.pfl", levels: ["regular"] },
      { typeId: "lang.es.1", levels: ["regular"] },
      { typeId: "lang.es.2", levels: ["regular"] },
      { typeId: "lang.es.3", levels: ["regular", "honors"] },
      { typeId: "lang.es.4", levels: ["regular", "ap"] },
      { typeId: "lang.fr.1", levels: ["regular"] },
      { typeId: "lang.fr.2", levels: ["regular"] },
      { typeId: "cs.prog1", levels: ["regular"] },
      { typeId: "cs.prog2", levels: ["regular", "ap"] },
      { typeId: "cs.principles", levels: ["ap"] },
      { typeId: "arts.visual", levels: ["regular"] },
      { typeId: "arts.ensemble", levels: ["regular"] },
      { typeId: "arts.theatre", levels: ["regular"] },
      { typeId: "pe.fitness", levels: ["regular"] },
      { typeId: "pe.athletics", levels: ["regular"] },
      { typeId: "health.health", levels: ["regular"] },
      { typeId: "cte.health_principles", levels: ["regular"] },
      { typeId: "cte.medical_terminology", levels: ["regular"] },
      { typeId: "cte.health.3", levels: ["regular"] },
      { typeId: "cte.architecture_construction.1", levels: ["regular"] },
      { typeId: "cte.architecture_construction.2", levels: ["regular"] },
      { typeId: "cte.architecture_construction.3", levels: ["regular"] },
      { typeId: "cte.engineering_design", levels: ["regular"] },
      { typeId: "math.applied.technical", levels: ["regular"] },
    ],
  };
}

export function txFacts(): FactsFile {
  return {
    ...header("test.tx.facts", "TX"),
    state: "TX",
    citations: cites("TX", [
      ["tx-summer", "local", "districts may offer summer courses for credit."],
      ["tx-dual", "§4.85", "dual credit eligibility is set by the college; some students may take it free."],
      ["tx-ms", "§28.029", "districts enroll 6th graders in advanced math if they performed in the top 40 percent."],
    ]),
    options: [
      { kind: "summer", note: "One summer; it may cost money.", cite: ["tx-summer"] },
      { kind: "college_credit", grades: [11, 12], note: "The college sets who can take it. It may be free for some students.", cite: ["tx-dual"] },
    ],
    middleSchoolMath: [{ text: "Texas districts place 6th graders who scored in the top 40 percent on the grade 5 math test in advanced math, unless a parent opts out.", cite: ["tx-ms"] }],
  };
}

export function txContent() {
  return { rules: [txGraduation(), txOptions(), txAdmissions(), txAid()], genericCatalog: txGenericCatalog(), facts: txFacts() };
}
