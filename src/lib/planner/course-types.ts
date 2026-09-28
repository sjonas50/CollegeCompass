import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState } from "./common";

// ---------------------------------------------------------------------------
// The course-type vocabulary (design §5.2): stable, generic ids for kinds of high school classes.
//
// Rules, catalogs, major prep and the engine all talk about classes through these ids, never
// through local course names. A class a student records, a row on a school's course list and a
// class the planner suggests all resolve to one id plus a level:
//
//   "Honors Algebra 2" at a Texas school  -> { type: "math.alg2", level: "honors" }
//   "AP Calculus AB"                      -> { type: "math.calc", level: "ap" }
//   "Secondary Math III" in Utah          -> { type: "math.ut_sec3", level: "regular" }
//
// Ids are permanent, like roadmap milestone ids: rule content, stored `course_type_id` columns and
// dismissed-suggestion keys refer to them. Rename a title freely; never rename or reuse an id. To
// retire one, keep it and stop mapping new classes to it.
//
// What each entry says:
// - title, subject (one of the app's 10), and `altSubjects` where students often file it elsewhere
//   (Anatomy under CTE, Accounting under math);
// - levels: the rigor levels the class is offered at (regular, honors, AP, IB, Cambridge,
//   college credit), and `cte`: whether it is a career and technical education class;
// - units: default credit in quarter-credit units (4 = 1 credit), grades: the usual grade window;
// - prereqs: prerequisite edges, each satisfied by any one listed type (AND of OR-groups);
// - ladder and rank for sequences solved exactly (math, English, each world language, each CTE
//   cluster), capabilities for cross-state concepts rules match on, and state display names.
//
// Rules match types or capabilities, never names, so Secondary Math III, Integrated Math III and
// Algebra II count as equivalent only where a rule lists them (or the `alg2_or_beyond` capability).
// Pure data plus lookups, so client components can import it.
// ---------------------------------------------------------------------------

/** Levels a class can be taught at. Honors is not college-level; the other four are. */
export const COURSE_TYPE_LEVELS = ["regular", "honors", "ap", "ib", "cambridge", "dual_enrollment"] as const;
export type CourseTypeLevel = (typeof COURSE_TYPE_LEVELS)[number];

/** AP, IB, Cambridge and college credit: what the per-year load cap counts. */
export const COLLEGE_LEVELS: readonly CourseTypeLevel[] = ["ap", "ib", "cambridge", "dual_enrollment"];

export function isCollegeLevel(level: CourseTypeLevel): boolean {
  return COLLEGE_LEVELS.includes(level);
}

/**
 * The stored `student_courses.level` to a planner level. A Record, so adding `cambridge` to
 * `CourseLevel` (design §4.3) fails to compile here until it's mapped.
 */
export const COURSE_LEVEL_TO_TYPE_LEVEL: Record<CourseLevel, CourseTypeLevel> = {
  regular: "regular",
  honors: "honors",
  ap: "ap",
  ib: "ib",
  dual_enrollment: "dual_enrollment",
};

export const TYPE_LEVEL_LABELS: Record<CourseTypeLevel, string> = {
  regular: "Regular",
  honors: "Honors",
  ap: "AP",
  ib: "IB",
  cambridge: "Cambridge",
  dual_enrollment: "College credit",
};

/**
 * What each state calls college credit earned in high school. Utah's "dual enrollment" means
 * something else (part-time public school enrollment), so Utah must say CE [UT key point 3].
 */
export const STATE_LEVEL_LABELS: Record<PlannerState, Partial<Record<CourseTypeLevel, string>>> = {
  UT: { dual_enrollment: "Concurrent enrollment (CE)" },
  TN: { dual_enrollment: "Dual enrollment" },
  TX: { dual_enrollment: "Dual credit" },
};

/** The label for a level in a state ("Concurrent enrollment (CE)" in Utah, "Dual credit" in Texas). */
export function levelLabel(level: CourseTypeLevel, state: PlannerState | null): string {
  return (state && STATE_LEVEL_LABELS[state][level]) ?? TYPE_LEVEL_LABELS[level];
}

/**
 * - always: a career and technical education class (earns CTE credit, belongs to a cluster);
 * - sometimes: some states or schools teach it through CTE (Anatomy and Physiology, Financial
 *   Math); the catalog row's `cte` flag decides;
 * - never: an academic class.
 */
export type CteMode = "always" | "sometimes" | "never";

/** Career clusters (the 14 Texas uses; Utah and Tennessee pathways map onto them). */
export const CTE_CLUSTERS = [
  "ag",
  "architecture_construction",
  "arts_av",
  "business",
  "education",
  "energy",
  "engineering",
  "health",
  "hospitality",
  "human_services",
  "it",
  "law",
  "manufacturing",
  "transportation",
] as const;
export type CteCluster = (typeof CTE_CLUSTERS)[number];

export const CTE_CLUSTER_TITLES: Record<CteCluster, string> = {
  ag: "Agriculture, food and natural resources",
  architecture_construction: "Architecture and construction",
  arts_av: "Arts, A/V technology and communications",
  business: "Business, marketing and finance",
  education: "Education and training",
  energy: "Energy",
  engineering: "Engineering and STEM",
  health: "Health science",
  hospitality: "Hospitality, tourism and culinary arts",
  human_services: "Human services",
  it: "Information technology",
  law: "Law, public safety and security",
  manufacturing: "Manufacturing",
  transportation: "Transportation, distribution and logistics",
};

/** CTE levels: 1 introduction or principles, 2 concentrator, 3 advanced, 4 practicum or capstone. */
export const CTE_LEVELS = [1, 2, 3, 4] as const;
export type CteLevel = (typeof CTE_LEVELS)[number];

/** World languages with their own ladder. ISO 639-1 codes, plus ASL and "another language". */
export const LANGUAGES = ["es", "fr", "de", "la", "zh", "ja", "ru", "ar", "it", "ko", "pt", "asl", "other"] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  es: "Spanish",
  fr: "French",
  de: "German",
  la: "Latin",
  zh: "Chinese",
  ja: "Japanese",
  ru: "Russian",
  ar: "Arabic",
  it: "Italian",
  ko: "Korean",
  pt: "Portuguese",
  asl: "American Sign Language",
  other: "Another language",
};

/** Language levels 1-4; level 4 means "IV or higher", including AP and IB language courses. */
export const LANGUAGE_LEVELS = [1, 2, 3, 4] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/**
 * Cross-state concepts rules can match on instead of listing types.
 * - alg2_or_beyond: Algebra II, Integrated or Secondary Math III, or a math class that comes after
 *   them (the old ALGEBRA_2_OR_BEYOND name pattern, as a type property).
 * - advanced_math_after_alg2: a math class that needs Algebra II (or Math III) first: TEXAS Grant
 *   "advanced math course after Algebra II", Texas STEM option (B) [TX S15 §56.3041; TX S1 §74.13(f)(6)].
 *   Statistics isn't marked: only some statistics classes need Algebra II, so rules name
 *   `math.stats` with the AP or college-credit level where it counts.
 * - lab_science: a laboratory science. CTE classes that some states accept as a lab science
 *   (Tennessee's Agriscience, Veterinary Science) aren't marked; state rules list them by type.
 */
export const CAPABILITIES = ["alg2_or_beyond", "advanced_math_after_alg2", "lab_science"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Sequences the engine solves exactly (design §5.6). */
export type LadderId = "math" | "ela" | `lang.${LanguageCode}` | `cte.${CteCluster}`;

// ---------------------------------------------------------------------------
// The table. `units` defaults to 4 (1 credit), `levels` to ["regular"], `cte` to "never".
// Prerequisites are the usual minimum; a school's list (or the state's generic list) may add
// stricter ones for a level (AP Statistics after Algebra II) on its own rows.
// ---------------------------------------------------------------------------

type Def = {
  title: string;
  subject: CourseSubject;
  grades: readonly [number, number];
  units?: number;
  levels?: readonly CourseTypeLevel[];
  cte?: CteMode;
  cluster?: CteCluster;
  prereqs?: readonly (readonly string[])[];
  /** Extra prerequisites for the AP, IB, Cambridge and college-credit levels (AP Statistics after Algebra II). */
  collegePrereqs?: readonly (readonly string[])[];
  /**
   * Extra prerequisites for every level but AP and IB, whose own frameworks set theirs: a second
   * programming class (Coding II, Computer Science II, Computer Programming 2) comes after the
   * first, while AP Computer Science A needs only Algebra I.
   */
  sequencePrereqs?: readonly (readonly string[])[];
  ladder?: readonly [LadderId, number];
  caps?: readonly Capability[];
  alt?: readonly CourseSubject[];
  stateTitles?: Partial<Record<PlannerState, string>>;
  fallback?: true;
  note?: string;
  /** Classes that teach the same content (listed on one side; the relation goes both ways). */
  overlaps?: readonly string[];
  /**
   * A soft order, not a prerequisite: the class usually follows one of these, so the planner
   * doesn't pick it first for a student without one (a student's own row never gets a warning).
   */
  usuallyAfter?: readonly string[];
  /**
   * An introductory class for these: the planner never suggests it once the student has one of
   * them (Exploring Computer Science after Coding I or AP Computer Science A).
   */
  introTo?: readonly string[];
};

const ALL_LEVELS = COURSE_TYPE_LEVELS;
const CORE_LEVELS = ["regular", "honors"] as const;
const FULL = ["regular", "honors", "ap", "ib", "cambridge", "dual_enrollment"] as const;

// Math equivalence groups by ladder rank: a prerequisite of "rank 1" is met by any of these.
const RANK1 = ["math.alg1", "math.int1", "math.ut_sec1"];
const RANK2 = ["math.geom", "math.int2", "math.ut_sec2"];
const RANK3 = ["math.alg2", "math.int3", "math.ut_sec3"];
/** Calculus's prerequisite: precalculus or trigonometry (College Algebra, on the same rung, isn't one). */
const PRECALCULUS = ["math.precalc", "math.trig"];
const AFTER_ALG2 = ["alg2_or_beyond", "advanced_math_after_alg2"] as const;

const CORE = {
  // English --------------------------------------------------------------
  "ela.ms": { title: "Middle school English (ELA 7 or 8)", subject: "english", grades: [7, 8], levels: CORE_LEVELS },
  "ela.9": {
    title: "English I (9th grade English)",
    subject: "english",
    grades: [9, 9],
    levels: CORE_LEVELS,
    ladder: ["ela", 1],
    stateTitles: { UT: "English Language Arts 9", TN: "English I", TX: "English I" },
  },
  "ela.10": {
    title: "English II (10th grade English)",
    subject: "english",
    grades: [10, 10],
    levels: CORE_LEVELS,
    prereqs: [["ela.9", "ela.esol"]],
    ladder: ["ela", 2],
    stateTitles: { UT: "English Language Arts 10", TN: "English II", TX: "English II" },
  },
  "ela.11": {
    title: "English III (11th grade English)",
    subject: "english",
    grades: [11, 11],
    levels: ["regular", "honors", "ib", "cambridge", "dual_enrollment"],
    prereqs: [["ela.10", "ela.seminar"]],
    ladder: ["ela", 3],
    stateTitles: { UT: "English 11", TN: "English III", TX: "English III" },
  },
  "ela.12": {
    title: "English IV (12th grade English)",
    subject: "english",
    grades: [12, 12],
    levels: ["regular", "honors", "ib", "cambridge", "dual_enrollment"],
    prereqs: [["ela.11", "ela.lang_comp", "ela.lit_comp"]],
    ladder: ["ela", 4],
    stateTitles: { UT: "English 12", TN: "English IV", TX: "English IV" },
    note: "A dual-credit English IV maps here at the college-credit level; a stand-alone college composition class maps to ela.lang_comp.",
  },
  "ela.lang_comp": {
    title: "Rhetoric and composition (AP English Language)",
    subject: "english",
    grades: [11, 12],
    levels: ["ap", "cambridge", "dual_enrollment"],
    prereqs: [["ela.10", "ela.seminar"]],
    ladder: ["ela", 3],
  },
  "ela.lit_comp": {
    title: "Literature and composition (AP English Literature)",
    subject: "english",
    grades: [11, 12],
    levels: ["ap", "cambridge", "dual_enrollment"],
    prereqs: [["ela.10", "ela.seminar"]],
    ladder: ["ela", 3],
  },
  "ela.seminar": {
    title: "Seminar (AP Seminar)",
    subject: "english",
    grades: [10, 11],
    levels: ["ap"],
    prereqs: [["ela.9", "ela.esol"]],
    ladder: ["ela", 2],
  },
  "ela.research": {
    title: "Research writing (AP Research, research and technical writing)",
    subject: "english",
    grades: [11, 12],
    levels: ["regular", "ap"],
    prereqs: [["ela.10", "ela.seminar"]],
  },
  "ela.esol": { title: "English for speakers of other languages (ESOL)", subject: "english", grades: [9, 10] },
  "ela.creative_writing": {
    title: "Creative writing",
    subject: "english",
    grades: [9, 12],
    levels: ["regular", "honors", "dual_enrollment"],
  },
  "ela.journalism": { title: "Journalism, newspaper or yearbook", subject: "english", grades: [9, 12] },
  "ela.speech": {
    title: "Speech or communication (public speaking)",
    subject: "english",
    grades: [9, 12],
    units: 2,
    levels: ["regular", "dual_enrollment"],
  },
  "ela.debate": { title: "Debate", subject: "english", grades: [9, 12] },
  "ela.humanities": {
    title: "Humanities or literature elective (literary genres, mythology)",
    subject: "english",
    grades: [10, 12],
    levels: ["regular", "honors", "ib", "dual_enrollment"],
  },
  "ela.professional_comm": {
    title: "Business, professional or technical communication",
    subject: "english",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "sometimes",
    cluster: "business",
  },
  "ela.college_prep": { title: "College-preparatory English (college readiness)", subject: "english", grades: [12, 12] },
  "ela.other": { title: "Other English class", subject: "english", grades: [7, 12], levels: ALL_LEVELS, fallback: true },

  // Math -----------------------------------------------------------------
  "math.ms": {
    title: "Middle school math (Math 7, Math 8 or pre-algebra)",
    subject: "math",
    grades: [7, 8],
    levels: CORE_LEVELS,
    ladder: ["math", 0],
  },
  "math.alg1": {
    title: "Algebra I",
    subject: "math",
    grades: [8, 9],
    levels: CORE_LEVELS,
    ladder: ["math", 1],
    stateTitles: { TN: "Algebra I", TX: "Algebra I" },
  },
  "math.int1": {
    title: "Integrated Math I",
    subject: "math",
    grades: [8, 9],
    levels: CORE_LEVELS,
    ladder: ["math", 1],
    stateTitles: { TN: "Integrated Math I" },
  },
  "math.ut_sec1": {
    title: "Secondary Math I",
    subject: "math",
    grades: [8, 9],
    levels: CORE_LEVELS,
    ladder: ["math", 1],
    stateTitles: { UT: "Secondary Mathematics I" },
    note: "Utah's integrated course. The \"Extended\" (IE) version maps to the honors level; USBE doesn't define \"Extended\", so ask the counselor [UT flag 10].",
  },
  "math.geom": {
    title: "Geometry",
    subject: "math",
    grades: [9, 10],
    levels: CORE_LEVELS,
    prereqs: [RANK1],
    ladder: ["math", 2],
  },
  "math.int2": {
    title: "Integrated Math II",
    subject: "math",
    grades: [9, 10],
    levels: CORE_LEVELS,
    prereqs: [RANK1],
    ladder: ["math", 2],
    stateTitles: { TN: "Integrated Math II" },
  },
  "math.ut_sec2": {
    title: "Secondary Math II",
    subject: "math",
    grades: [9, 10],
    levels: CORE_LEVELS,
    prereqs: [RANK1],
    ladder: ["math", 2],
    stateTitles: { UT: "Secondary Mathematics II" },
  },
  "math.alg2": {
    title: "Algebra II",
    subject: "math",
    grades: [10, 11],
    levels: CORE_LEVELS,
    prereqs: [RANK1],
    ladder: ["math", 3],
    caps: ["alg2_or_beyond"],
    note: "Texas lists Algebra I as the only prerequisite, so Geometry may come before or after.",
  },
  "math.int3": {
    title: "Integrated Math III",
    subject: "math",
    grades: [10, 11],
    levels: CORE_LEVELS,
    prereqs: [RANK2],
    ladder: ["math", 3],
    caps: ["alg2_or_beyond"],
    stateTitles: { TN: "Integrated Math III" },
  },
  "math.ut_sec3": {
    title: "Secondary Math III",
    subject: "math",
    grades: [10, 11],
    levels: CORE_LEVELS,
    prereqs: [RANK2],
    ladder: ["math", 3],
    caps: ["alg2_or_beyond"],
    stateTitles: { UT: "Secondary Mathematics III" },
  },
  "math.precalc": {
    title: "Precalculus",
    subject: "math",
    grades: [11, 12],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    prereqs: [RANK3, RANK2],
    ladder: ["math", 4],
    caps: AFTER_ALG2,
  },
  "math.trig": {
    title: "Trigonometry",
    subject: "math",
    grades: [11, 12],
    levels: ["regular", "honors", "dual_enrollment"],
    prereqs: [RANK3, RANK2],
    ladder: ["math", 4],
    caps: AFTER_ALG2,
    note: "Utah's CE Math 1060 maps here.",
  },
  "math.college_alg": {
    title: "College algebra (for example, Math 1050)",
    subject: "math",
    grades: [11, 12],
    levels: ["dual_enrollment"],
    prereqs: [RANK3],
    ladder: ["math", 4],
    caps: AFTER_ALG2,
    note: "Utah CE math needs Secondary Math I-III with a C average [UT S43].",
  },
  "math.calc": {
    title: "Calculus",
    subject: "math",
    grades: [11, 12],
    levels: FULL,
    // After precalculus or trigonometry (Utah's Math 1060). College Algebra (Math 1050) alone,
    // though on the same rung, doesn't prepare a student for calculus (engine/fill.ts prereqsMetIn).
    prereqs: [PRECALCULUS],
    ladder: ["math", 5],
    caps: AFTER_ALG2,
    note: "AP Calculus AB or BC, IB Math HL, college Calculus I, or a school's introductory calculus.",
  },
  "math.calc2": {
    title: "Calculus II or beyond (for example, BC after AB, multivariable)",
    subject: "math",
    grades: [12, 12],
    levels: ["regular", "ap", "ib", "dual_enrollment"],
    prereqs: [["math.calc"]],
    ladder: ["math", 6],
    caps: AFTER_ALG2,
  },
  "math.stats": {
    title: "Statistics",
    subject: "math",
    grades: [10, 12],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    cte: "sometimes",
    cluster: "business",
    prereqs: [RANK1],
    // The College Board expects a second-year algebra course before AP Statistics.
    collegePrereqs: [RANK3],
    note: "Texas \"Statistics and Business Decision Making\" (CTE) maps here too. AP, IB and college-credit statistics come after Algebra II.",
  },
  "math.adv_quant": {
    title: "Advanced quantitative reasoning",
    subject: "math",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    prereqs: [RANK3],
    caps: AFTER_ALG2,
    note: "Utah CE Math 1030 (quantitative reasoning) maps here at the college-credit level.",
  },
  "math.alg_reasoning": { title: "Algebraic reasoning", subject: "math", grades: [10, 12], prereqs: [RANK1] },
  "math.discrete": {
    title: "Discrete math",
    subject: "math",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    prereqs: [RANK3],
    caps: AFTER_ALG2,
  },
  "math.college_prep": {
    title: "College-preparatory math (college readiness)",
    subject: "math",
    grades: [12, 12],
    levels: ["regular", "dual_enrollment"],
    prereqs: [RANK3],
    caps: AFTER_ALG2,
    note: "Utah College Prep Math, and Utah CE Math 1010 at the college-credit level, map here.",
  },
  "math.applied.models": {
    title: "Mathematical models with applications",
    subject: "math",
    grades: [10, 11],
    prereqs: [RANK1],
    stateTitles: { TX: "Mathematical Models with Applications" },
  },
  "math.applied.finance": {
    title: "Financial math (math of personal finance)",
    subject: "math",
    grades: [10, 12],
    cte: "sometimes",
    cluster: "business",
    prereqs: [RANK1],
    alt: ["career_technical"],
    stateTitles: { UT: "Mathematics of Personal Finance", TX: "Financial Mathematics" },
    note: "Not the same as a personal financial literacy class (ss.pfl): Utah says Mathematics of Personal Finance doesn't meet its financial literacy requirement [UT S3].",
  },
  "math.applied.decision": {
    title: "Mathematical reasoning and decision making",
    subject: "math",
    grades: [11, 12],
    prereqs: [RANK2],
    stateTitles: { UT: "Mathematical Decision Making for Life", TN: "Mathematical Reasoning for Decision Making" },
  },
  "math.applied.technical": {
    title: "Applied math for technical careers (shop or trade math)",
    subject: "math",
    grades: [10, 12],
    cte: "sometimes",
    cluster: "manufacturing",
    prereqs: [RANK1],
    alt: ["career_technical"],
    stateTitles: { TX: "Applied Mathematics for Technical Professionals" },
    note: "Texas \"Mathematical Applications in Agriculture, Food, and Natural Resources\" maps here too.",
  },
  "math.applied.business": {
    title: "Business math (small business math)",
    subject: "math",
    grades: [10, 12],
    units: 2,
    cte: "sometimes",
    cluster: "business",
    prereqs: [RANK1],
    alt: ["career_technical"],
    stateTitles: { UT: "Small Business Math" },
  },
  "math.applied.medical": {
    title: "Math for medical careers (medical math)",
    subject: "math",
    grades: [10, 12],
    units: 2,
    cte: "sometimes",
    cluster: "health",
    prereqs: [RANK1],
    alt: ["career_technical"],
    stateTitles: { UT: "Medical Math", TX: "Mathematics for Medical Professionals" },
  },
  "math.applied.engineering": {
    title: "Engineering mathematics",
    subject: "math",
    grades: [11, 12],
    cte: "always",
    cluster: "engineering",
    prereqs: [RANK3],
    caps: AFTER_ALG2,
    alt: ["career_technical"],
  },
  "math.other": { title: "Other math class", subject: "math", grades: [7, 12], levels: ALL_LEVELS, fallback: true },

  // Science --------------------------------------------------------------
  "sci.ms": {
    title: "Middle school science (Integrated Science 7 or 8)",
    subject: "science",
    grades: [7, 8],
    levels: CORE_LEVELS,
  },
  "sci.bio": {
    title: "Biology",
    subject: "science",
    grades: [9, 10],
    levels: FULL,
    caps: ["lab_science"],
    stateTitles: { TN: "Biology I" },
    note: "An AP or IB Biology class taken as the student's first biology maps here; after Biology, to sci.bio2.",
  },
  "sci.bio2": {
    title: "Advanced biology (Biology II, or AP or IB Biology after Biology)",
    subject: "science",
    grades: [11, 12],
    levels: FULL,
    prereqs: [["sci.bio"]],
    caps: ["lab_science"],
  },
  "sci.chem": {
    title: "Chemistry",
    subject: "science",
    grades: [10, 11],
    levels: FULL,
    prereqs: [RANK1],
    caps: ["lab_science"],
    stateTitles: { TN: "Chemistry I" },
  },
  "sci.chem2": {
    title: "Advanced chemistry (Chemistry II, or AP or IB Chemistry after Chemistry)",
    subject: "science",
    grades: [11, 12],
    levels: FULL,
    prereqs: [["sci.chem"]],
    caps: ["lab_science"],
  },
  "sci.phys": {
    title: "Physics",
    subject: "science",
    grades: [11, 12],
    levels: FULL,
    prereqs: [RANK1],
    caps: ["lab_science"],
    stateTitles: { TN: "Physics I" },
    note: "AP Physics 1 maps here.",
  },
  "sci.phys2": {
    title: "Advanced physics (Physics II, AP Physics 2 or AP Physics C)",
    subject: "science",
    grades: [12, 12],
    levels: FULL,
    prereqs: [["sci.phys", "sci.phys_eng"]],
    caps: ["lab_science"],
  },
  "sci.phys_eng": {
    title: "Physics for engineering",
    subject: "science",
    grades: [10, 12],
    cte: "always",
    cluster: "engineering",
    prereqs: [RANK1],
    caps: ["lab_science"],
    alt: ["career_technical"],
    stateTitles: { TX: "Physics for Engineering" },
    note: "Texas: Physics and Physics for Engineering can't both count [TX S1 §74.12].",
  },
  "sci.ipc": {
    title: "Physical science (integrated physics and chemistry)",
    subject: "science",
    grades: [9, 10],
    levels: CORE_LEVELS,
    caps: ["lab_science"],
    stateTitles: { TX: "Integrated Physics and Chemistry", TN: "Physical Science" },
    note: "Tennessee's Physical World Concepts maps here too.",
  },
  "sci.earth": {
    title: "Earth and space science (geology)",
    subject: "science",
    grades: [9, 12],
    levels: ["regular", "honors", "dual_enrollment"],
    caps: ["lab_science"],
    stateTitles: { UT: "Earth and Space Science", TN: "Earth and Space Science", TX: "Earth and Space Science" },
  },
  "sci.env": {
    title: "Environmental science or ecology",
    subject: "science",
    grades: [10, 12],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    caps: ["lab_science"],
    stateTitles: { TX: "Environmental Systems" },
  },
  "sci.anat": {
    title: "Anatomy and physiology",
    subject: "science",
    grades: [11, 12],
    levels: ["regular", "honors", "dual_enrollment"],
    cte: "sometimes",
    cluster: "health",
    prereqs: [["sci.bio"]],
    caps: ["lab_science"],
    alt: ["career_technical"],
    note: "Texas Pathophysiology maps here too.",
  },
  "sci.astronomy": {
    title: "Astronomy",
    subject: "science",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    caps: ["lab_science"],
  },
  "sci.aquatic": { title: "Aquatic or marine science", subject: "science", grades: [9, 12], caps: ["lab_science"] },
  "sci.forensic": {
    title: "Forensic science",
    subject: "science",
    grades: [11, 12],
    cte: "sometimes",
    cluster: "law",
    prereqs: [["sci.bio"]],
    caps: ["lab_science"],
    alt: ["career_technical"],
  },
  "sci.biotech": {
    title: "Biotechnology",
    subject: "science",
    grades: [10, 12],
    cte: "always",
    cluster: "health",
    prereqs: [["sci.bio"]],
    caps: ["lab_science"],
    alt: ["career_technical"],
    note: "Tennessee BioSTEM maps here too.",
  },
  "sci.microbio": {
    title: "Microbiology",
    subject: "science",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "sometimes",
    cluster: "health",
    prereqs: [["sci.bio"]],
    caps: ["lab_science"],
    alt: ["career_technical"],
  },
  "sci.research": {
    title: "Scientific research and design",
    subject: "science",
    grades: [10, 12],
    caps: ["lab_science"],
  },
  "sci.other": { title: "Other science class", subject: "science", grades: [7, 12], levels: ALL_LEVELS, fallback: true },

  // Social studies -------------------------------------------------------
  "ss.ms": {
    title: "Middle school social studies (state or U.S. history)",
    subject: "social_studies",
    grades: [7, 8],
    levels: CORE_LEVELS,
  },
  "ss.us_hist": {
    title: "U.S. history",
    subject: "social_studies",
    grades: [10, 11],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    stateTitles: { UT: "U.S. History", TN: "U.S. History and Geography", TX: "U.S. History Since 1877" },
  },
  "ss.world_hist": {
    title: "World or European history",
    subject: "social_studies",
    grades: [9, 10],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    stateTitles: { UT: "World History", TN: "World History and Geography", TX: "World History Studies" },
  },
  "ss.world_geo": {
    title: "World or human geography",
    subject: "social_studies",
    grades: [9, 10],
    levels: ["regular", "honors", "ap", "dual_enrollment"],
    stateTitles: { UT: "World Geography", TX: "World Geography Studies" },
  },
  "ss.us_gov": {
    title: "U.S. government",
    subject: "social_studies",
    grades: [12, 12],
    units: 2,
    levels: ["regular", "honors", "ap", "dual_enrollment"],
    stateTitles: { UT: "U.S. Government and Citizenship", TN: "U.S. Government and Civics", TX: "U.S. Government" },
  },
  "ss.ut_acgc": {
    title: "American Constitutional Government and Citizenship",
    subject: "social_studies",
    grades: [10, 12],
    stateTitles: { UT: "American Constitutional Government and Citizenship (ACGC)" },
    note: "Utah, class of 2029 on; first offered 2027-28, and earlier U.S. Government credit can't count toward it [UT S4].",
  },
  "ss.econ": {
    title: "Economics",
    subject: "social_studies",
    grades: [11, 12],
    units: 2,
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
  },
  "ss.pfl": {
    title: "Personal financial literacy",
    subject: "social_studies",
    grades: [10, 12],
    units: 2,
    levels: ["regular", "dual_enrollment"],
    alt: ["other", "career_technical"],
    stateTitles: { UT: "General Financial Literacy", TN: "Personal Finance", TX: "Personal Financial Literacy" },
  },
  "ss.pfl_econ": {
    title: "Personal financial literacy and economics",
    subject: "social_studies",
    grades: [11, 12],
    units: 2,
    stateTitles: { TX: "Personal Financial Literacy and Economics" },
    // One half-credit class that covers both (Texas lists it as the alternative to either one).
    overlaps: ["ss.econ", "ss.pfl"],
  },
  "ss.psych": {
    title: "Psychology",
    subject: "social_studies",
    grades: [10, 12],
    units: 2,
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
  },
  "ss.soc": {
    title: "Sociology",
    subject: "social_studies",
    grades: [10, 12],
    units: 2,
    levels: ["regular", "dual_enrollment"],
  },
  "ss.other": {
    title: "Other social studies class",
    subject: "social_studies",
    grades: [7, 12],
    levels: ALL_LEVELS,
    fallback: true,
  },

  // Arts -----------------------------------------------------------------
  "arts.ms": { title: "Middle school arts (art, music, theater or dance)", subject: "arts", grades: [7, 8] },
  "arts.visual": {
    title: "Visual art (drawing, painting, ceramics, sculpture)",
    subject: "arts",
    grades: [9, 12],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
  },
  "arts.art_history": {
    title: "Art history",
    subject: "arts",
    grades: [10, 12],
    levels: ["regular", "ap", "dual_enrollment"],
  },
  "arts.ensemble": {
    title: "Band, choir or orchestra",
    subject: "arts",
    grades: [9, 12],
    levels: ["regular", "honors", "ib"],
  },
  // Its own kind because Texas lets districts count it toward PE (19 TAC §74.12(b)(6)(D)) and
  // Tennessee lets schools count its physical activity for PE (Policy 2.103 I(15)): a concert band
  // or choir never does. It's a fine arts class too, but one credit counts for one requirement.
  "arts.marching": {
    title: "Marching band or drill team",
    subject: "arts",
    grades: [9, 12],
    units: 2,
    alt: ["health_pe"],
  },
  "arts.music_theory": {
    title: "Music theory",
    subject: "arts",
    grades: [10, 12],
    levels: ["regular", "ap", "ib", "dual_enrollment"],
    // It assumes the student reads music: after band, choir, orchestra or a music class.
    usuallyAfter: ["arts.ensemble", "arts.music", "arts.ms"],
  },
  "arts.music": {
    title: "Music (guitar, piano, music history or appreciation)",
    subject: "arts",
    grades: [9, 12],
    levels: ["regular", "dual_enrollment"],
  },
  "arts.theatre": {
    title: "Theater (acting, musical theater, technical theater)",
    subject: "arts",
    grades: [9, 12],
    levels: ["regular", "honors", "ib"],
  },
  "arts.dance": { title: "Dance", subject: "arts", grades: [9, 12], levels: CORE_LEVELS },
  "arts.media": {
    title: "Media arts (digital art, animation, film, photography)",
    subject: "arts",
    grades: [9, 12],
    levels: ["regular", "ap", "ib"],
    cte: "sometimes",
    cluster: "arts_av",
    alt: ["career_technical"],
  },
  "arts.other": { title: "Other arts class", subject: "arts", grades: [7, 12], levels: ALL_LEVELS, fallback: true },

  // Computer science -----------------------------------------------------
  "cs.ms": {
    title: "Middle school computing (digital literacy, creative coding)",
    subject: "computer_science",
    grades: [7, 8],
  },
  "cs.intro": {
    title: "Introduction to computer science (Exploring Computer Science)",
    subject: "computer_science",
    grades: [9, 10],
    stateTitles: { UT: "Exploring Computer Science", TN: "Computer Science Foundations" },
    introTo: ["cs.principles", "cs.prog1", "cs.prog2", "cs.advanced", "cs.data_science", "cs.cyber"],
  },
  "cs.principles": {
    title: "Computer Science Principles",
    subject: "computer_science",
    grades: [9, 12],
    levels: ["regular", "honors", "ap", "dual_enrollment"],
    // A way into programming (cs.prog2's sequencePrereqs): never suggested after it or beyond.
    introTo: ["cs.prog2", "cs.advanced"],
  },
  "cs.prog1": {
    title: "Computer programming 1 (Computer Science I, Coding I)",
    subject: "computer_science",
    grades: [9, 12],
    levels: ["regular", "honors", "ib", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    alt: ["career_technical"],
    stateTitles: { UT: "Computer Programming 1", TN: "Coding I", TX: "Computer Science I" },
    note: "IB Computer Science SL maps here at the IB level.",
  },
  "cs.prog2": {
    title: "Computer programming 2 or AP Computer Science A",
    subject: "computer_science",
    grades: [10, 12],
    levels: ["regular", "honors", "ap", "ib", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    prereqs: [RANK1],
    // TEA's Programming and Software Development program of study: "Computer Science II …
    // Prerequisites: Algebra I and Computer Science I or AP Computer Science Principles" (TEA statewide program of study, checked 2026-09-25).
    sequencePrereqs: [["cs.prog1", "cs.principles"]],
    alt: ["career_technical"],
    stateTitles: { UT: "Computer Programming 2", TN: "Coding II", TX: "Computer Science II" },
    note: "AP Computer Science A maps here at the AP level and IB Computer Science HL at the IB level; Texas counts those two as a math and a language credit [TX S1 §74.11(n)].",
  },
  "cs.advanced": {
    title: "Advanced computer science (Computer Science III, data structures)",
    subject: "computer_science",
    grades: [11, 12],
    levels: ["regular", "honors", "ib", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    prereqs: [["cs.prog2"]],
    alt: ["career_technical"],
    stateTitles: { UT: "Computer Science Advanced", TX: "Computer Science III" },
  },
  "cs.data_science": {
    title: "Data science",
    subject: "computer_science",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    prereqs: [RANK1],
    alt: ["math", "career_technical"],
  },
  "cs.cyber": {
    title: "Cybersecurity",
    subject: "computer_science",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    alt: ["career_technical"],
  },
  "cs.web": {
    title: "Web development or web design",
    subject: "computer_science",
    grades: [9, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "sometimes",
    cluster: "it",
    alt: ["career_technical"],
    stateTitles: { UT: "Web Development 1" },
  },
  "cs.other": {
    title: "Other computer science class",
    subject: "computer_science",
    grades: [7, 12],
    levels: ALL_LEVELS,
    fallback: true,
  },

  // Health and PE --------------------------------------------------------
  "health.health": { title: "Health", subject: "health_pe", grades: [7, 12], units: 2, stateTitles: { UT: "Health II" } },
  "health.wellness": {
    title: "Lifetime wellness",
    subject: "health_pe",
    grades: [9, 10],
    stateTitles: { TN: "Lifetime Wellness" },
  },
  "pe.general": { title: "Physical education", subject: "health_pe", grades: [7, 12], units: 2 },
  "pe.fitness": {
    title: "Fitness for life (lifetime fitness)",
    subject: "health_pe",
    grades: [9, 12],
    units: 2,
    stateTitles: { UT: "Fitness for Life" },
  },
  "pe.skills": {
    title: "Sports skills (participation skills)",
    subject: "health_pe",
    grades: [9, 12],
    units: 2,
    stateTitles: { UT: "Participation Skills and Techniques" },
  },
  "pe.lifetime": {
    title: "Lifetime activities (lifetime recreation)",
    subject: "health_pe",
    grades: [9, 12],
    units: 2,
    stateTitles: { UT: "Individualized Lifetime Activities" },
  },
  "pe.athletics": { title: "School athletics (a sports season)", subject: "health_pe", grades: [9, 12], units: 2 },
  "pe.other": { title: "Other health or PE class", subject: "health_pe", grades: [7, 12], units: 2, fallback: true },

  // Other ----------------------------------------------------------------
  "other.jrotc": { title: "JROTC", subject: "other", grades: [9, 12] },
  "other.driver_ed": { title: "Driver education", subject: "other", grades: [9, 12], units: 2 },
  "other.study_support": { title: "Study skills, AVID or advisory", subject: "other", grades: [7, 12] },
  "other.other": { title: "Other class", subject: "other", grades: [7, 12], levels: ALL_LEVELS, fallback: true },

  // Career and technical education: named classes rules or major prep refer to. Each sits on its
  // cluster's ladder next to the generated cte.<cluster>.<level> types below.
  "cte.ms": {
    title: "Middle school career exploration (College and Career Awareness)",
    subject: "career_technical",
    grades: [7, 8],
    cte: "always",
  },
  "cte.accounting": {
    title: "Accounting I",
    subject: "career_technical",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "business",
    ladder: ["cte.business", 2],
    alt: ["math"],
    note: "A first accounting class (Texas and Utah Accounting I). Texas counts only Accounting II (cte.accounting2) as a 3rd math credit [TX S1 §74.12(b)(2)(A)]; Utah's applied math list has both [UT S3].",
  },
  "cte.accounting2": {
    title: "Accounting II",
    subject: "career_technical",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "business",
    prereqs: [["cte.accounting"]],
    ladder: ["cte.business", 3],
    alt: ["math"],
  },
  "cte.business_office": {
    title: "Business office and digital applications",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "business",
    ladder: ["cte.business", 1],
    alt: ["computer_science"],
    stateTitles: { UT: "Digital Business Applications" },
  },
  "cte.floral_design": {
    title: "Floral design",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "ag",
    ladder: ["cte.ag", 2],
    alt: ["arts"],
  },
  "cte.landscape_design": {
    title: "Landscaping and turf science",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "ag",
    ladder: ["cte.ag", 2],
  },
  "cte.digital_arts_design": {
    title: "Digital arts and design I",
    subject: "career_technical",
    grades: [9, 11],
    cte: "always",
    cluster: "arts_av",
    ladder: ["cte.arts_av", 1],
    alt: ["arts"],
    stateTitles: { TN: "Digital Arts & Design I" },
    note: "The first class of Tennessee's Digital Arts & Design program (Policy 3.205 17.8); Policy 3.103 lists it first among the CTE substitutions for fine arts [TN S3 III(3)]. Digital Arts & Design II and III map to the cluster's levels 2 and 3.",
  },
  "cte.design_foundations": {
    title: "Fashion or interior design",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "arts_av",
    ladder: ["cte.arts_av", 1],
    alt: ["arts"],
  },
  "cte.agriscience": {
    title: "Agriscience (principles of agriculture)",
    subject: "career_technical",
    grades: [9, 10],
    cte: "always",
    cluster: "ag",
    ladder: ["cte.ag", 1],
    alt: ["science"],
    stateTitles: { TN: "Agriscience" },
  },
  "cte.animal_science": {
    title: "Animal or veterinary science",
    subject: "career_technical",
    grades: [10, 12],
    cte: "always",
    cluster: "ag",
    ladder: ["cte.ag", 3],
    alt: ["science"],
  },
  "cte.engineering_design": {
    title: "Engineering design (principles of engineering)",
    subject: "career_technical",
    grades: [9, 11],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 1],
    alt: ["science"],
  },
  "cte.cad": {
    title: "Computer-aided design and drafting (CAD)",
    subject: "career_technical",
    grades: [9, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 2],
    alt: ["arts", "computer_science"],
  },
  "cte.robotics": {
    title: "Robotics I",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 2],
    alt: ["computer_science"],
    note: "A first robotics class. Texas counts only Robotics II (cte.robotics2) as a 3rd math credit [TX S1 §74.12(b)(2)(A)]; Utah's applied science list has Robotics 1 and 2 [UT S3].",
  },
  "cte.robotics2": {
    title: "Robotics II",
    subject: "career_technical",
    grades: [10, 12],
    cte: "always",
    cluster: "engineering",
    prereqs: [["cte.robotics"]],
    ladder: ["cte.engineering", 3],
    alt: ["computer_science", "math"],
  },
  "cte.digital_electronics": {
    title: "Digital electronics",
    subject: "career_technical",
    grades: [10, 12],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 3],
    alt: ["math"],
  },
  // Texas lists these career classes among the lab-based courses for the 3rd science credit and an
  // endorsement's 4th ("(x) Advanced Plant and Soil Science", "(xiv) Food Science", "(xx)
  // Engineering Design and Problem Solving; (xxi) Engineering Science", 19 TAC §74.12(b)(3)(B);
  // the same as (J), (N), (T) and (U) in §74.13(e)(6)). Like Tennessee's Agriscience, they aren't
  // marked `lab_science`: state rules list them by type. Levels from TEA's programs of study
  // (Engineering Foundations: Engineering Science level 3, Engineering Design and Problem Solving
  // level 4; Culinary Arts: Food Science level 4).
  "cte.engineering_science": {
    title: "Engineering science",
    subject: "career_technical",
    grades: [10, 12],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 3],
    alt: ["science"],
    stateTitles: { TX: "Engineering Science" },
  },
  "cte.engineering_problem_solving": {
    title: "Engineering design and problem solving",
    subject: "career_technical",
    grades: [11, 12],
    cte: "always",
    cluster: "engineering",
    ladder: ["cte.engineering", 4],
    alt: ["science"],
    stateTitles: { TX: "Engineering Design and Problem Solving" },
  },
  "cte.food_science": {
    title: "Food science",
    subject: "career_technical",
    grades: [11, 12],
    cte: "always",
    cluster: "hospitality",
    ladder: ["cte.hospitality", 4],
    alt: ["science"],
    stateTitles: { TX: "Food Science" },
  },
  "cte.plant_soil_science": {
    title: "Advanced plant and soil science",
    subject: "career_technical",
    grades: [10, 12],
    cte: "always",
    cluster: "ag",
    alt: ["science"],
    stateTitles: { TX: "Advanced Plant and Soil Science" },
  },
  "cte.biomed": {
    title: "Biomedical science (principles of biomedical science, human body systems)",
    subject: "career_technical",
    grades: [9, 12],
    cte: "always",
    cluster: "health",
    ladder: ["cte.health", 1],
    alt: ["science"],
  },
  "cte.health_principles": {
    title: "Principles of health science",
    subject: "career_technical",
    grades: [9, 10],
    cte: "always",
    cluster: "health",
    ladder: ["cte.health", 1],
  },
  "cte.medical_terminology": {
    title: "Medical terminology",
    subject: "career_technical",
    grades: [10, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "health",
    ladder: ["cte.health", 2],
  },
  "cte.nurse_aide": {
    title: "Nurse aide or patient care (CNA)",
    subject: "career_technical",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "health",
    ladder: ["cte.health", 3],
    note: "Age minimums for nurse aides vary by state and weren't verified; never state them [MP §6.4].",
  },
  "cte.emt": {
    title: "Emergency medical technician (EMT)",
    subject: "career_technical",
    grades: [11, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    cluster: "law",
    ladder: ["cte.law", 3],
    note: "EMT age minimums weren't verified; never state them [MP §6.4].",
  },
  "cte.other": {
    title: "Other career and technical class",
    subject: "career_technical",
    grades: [7, 12],
    levels: ["regular", "dual_enrollment"],
    cte: "always",
    fallback: true,
  },
} satisfies Record<string, Def>;

export type CoreCourseTypeId = keyof typeof CORE;
export type LanguageCourseTypeId = `lang.${LanguageCode}.${LanguageLevel}`;
export type CteLevelCourseTypeId = `cte.${CteCluster}.${CteLevel}`;
export type CourseTypeId = CoreCourseTypeId | LanguageCourseTypeId | CteLevelCourseTypeId;

const ROMAN = ["I", "II", "III", "IV"] as const;
const LANGUAGE_GRADES: Record<LanguageLevel, readonly [number, number]> = { 1: [8, 10], 2: [9, 11], 3: [10, 12], 4: [11, 12] };
const LANGUAGE_TYPE_LEVELS: Record<LanguageLevel, readonly CourseTypeLevel[]> = {
  1: ["regular", "honors", "dual_enrollment"],
  2: ["regular", "honors", "dual_enrollment"],
  3: ["regular", "honors", "ib", "dual_enrollment"],
  4: ["regular", "honors", "ap", "ib", "dual_enrollment"],
};

function languageDefs(): [LanguageCourseTypeId, Def][] {
  return LANGUAGES.flatMap((code) =>
    LANGUAGE_LEVELS.map((level): [LanguageCourseTypeId, Def] => [
      `lang.${code}.${level}`,
      {
        title: `${LANGUAGE_NAMES[code]} ${ROMAN[level - 1]}${level === 4 ? " or higher" : ""}`,
        subject: "world_language",
        grades: LANGUAGE_GRADES[level],
        levels: LANGUAGE_TYPE_LEVELS[level],
        prereqs: level > 1 ? [[`lang.${code}.${level - 1}`]] : [],
        ladder: [`lang.${code}`, level],
        ...(level === 4 ? { note: "AP and IB language courses map to level 4." } : {}),
      },
    ]),
  );
}

const CTE_LEVEL_NAMES: Record<CteLevel, string> = {
  1: "level 1 (introduction or principles)",
  2: "level 2",
  3: "level 3 (advanced)",
  4: "level 4 (practicum or capstone)",
};
const CTE_LEVEL_GRADES: Record<CteLevel, readonly [number, number]> = { 1: [9, 10], 2: [10, 11], 3: [11, 12], 4: [12, 12] };

function cteLevelDefs(): [CteLevelCourseTypeId, Def][] {
  return CTE_CLUSTERS.flatMap((cluster) =>
    CTE_LEVELS.map((level): [CteLevelCourseTypeId, Def] => [
      `cte.${cluster}.${level}`,
      {
        title: `${CTE_CLUSTER_TITLES[cluster]}: ${CTE_LEVEL_NAMES[level]}`,
        subject: "career_technical",
        grades: CTE_LEVEL_GRADES[level],
        levels: ["regular", "dual_enrollment"],
        cte: "always",
        cluster,
        ladder: [`cte.${cluster}`, level],
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// The finished vocabulary
// ---------------------------------------------------------------------------

/** One prerequisite: met by finishing (or, for placement, having planned earlier) any one of these. */
export type Prereq = { anyOf: readonly CourseTypeId[] };

export type CourseType = {
  id: CourseTypeId;
  /** Generic title, safe to show anywhere and to send to the AI (never a school's local name). */
  title: string;
  subject: CourseSubject;
  /** Subjects students often file it under instead; used for guesses and the type picker. */
  altSubjects: readonly CourseSubject[];
  levels: readonly CourseTypeLevel[];
  cte: CteMode;
  /** Set for every type with cte "always" or "sometimes", except the two catch-alls (cte.ms, cte.other). */
  cteCluster: CteCluster | null;
  /** Default credit in quarter-credit units (4 = 1 credit). A catalog row's own credit wins. */
  units: number;
  /** The usual grade window [from, to]. A catalog row's printed grades win. */
  grades: readonly [number, number];
  /** Every prerequisite must be met; each is met by any one of its types. */
  prereqs: readonly Prereq[];
  /** More prerequisites for the college-level versions (AP, IB, Cambridge, college credit). */
  collegePrereqs: readonly Prereq[];
  /** More prerequisites for every level but AP and IB (a second programming class after the first). */
  sequencePrereqs: readonly Prereq[];
  ladder: { id: LadderId; rank: number } | null;
  capabilities: readonly Capability[];
  /** The state's own name for the class, where it differs ("Secondary Mathematics III"). */
  stateTitles: Partial<Record<PlannerState, string>>;
  /** The "Other … class" type for its subject: what an unrecognized class guesses to. */
  fallback: boolean;
  /** Mapping guidance for people and the extraction review. */
  note: string | null;
  /** Classes that teach the same content: a student with one isn't suggested another. */
  overlaps: readonly CourseTypeId[];
  /** Usually taken after one of these (a soft order the planner prefers, never a prerequisite). */
  usuallyAfter: readonly CourseTypeId[];
  /** An introduction to these: never suggested after one of them. */
  introTo: readonly CourseTypeId[];
};

function build(): Map<CourseTypeId, CourseType> {
  const entries = [...(Object.entries(CORE) as [CoreCourseTypeId, Def][]), ...languageDefs(), ...cteLevelDefs()];
  const ids = new Set<string>(entries.map(([id]) => id));
  const problems: string[] = [];
  const types = new Map<CourseTypeId, CourseType>();
  for (const [id, def] of entries) {
    for (const group of [...(def.prereqs ?? []), ...(def.collegePrereqs ?? []), ...(def.sequencePrereqs ?? [])]) {
      for (const p of group) if (!ids.has(p)) problems.push(`${id}: unknown prerequisite ${p}`);
    }
    for (const o of def.overlaps ?? []) if (!ids.has(o)) problems.push(`${id}: unknown overlapping type ${o}`);
    for (const a of def.usuallyAfter ?? []) if (!ids.has(a)) problems.push(`${id}: unknown usually-after type ${a}`);
    for (const a of def.introTo ?? []) if (!ids.has(a)) problems.push(`${id}: unknown type ${a} it introduces`);
    types.set(id, {
      id,
      title: def.title,
      subject: def.subject,
      altSubjects: def.alt ?? [],
      levels: def.levels ?? ["regular"],
      cte: def.cte ?? "never",
      cteCluster: def.cluster ?? null,
      units: def.units ?? 4,
      grades: def.grades,
      prereqs: (def.prereqs ?? []).map((group) => ({ anyOf: group as readonly CourseTypeId[] })),
      collegePrereqs: (def.collegePrereqs ?? []).map((group) => ({ anyOf: group as readonly CourseTypeId[] })),
      sequencePrereqs: (def.sequencePrereqs ?? []).map((group) => ({ anyOf: group as readonly CourseTypeId[] })),
      ladder: def.ladder ? { id: def.ladder[0], rank: def.ladder[1] } : null,
      capabilities: def.caps ?? [],
      stateTitles: def.stateTitles ?? {},
      fallback: def.fallback ?? false,
      note: def.note ?? null,
      overlaps: (def.overlaps ?? []) as readonly CourseTypeId[],
      usuallyAfter: (def.usuallyAfter ?? []) as readonly CourseTypeId[],
      introTo: (def.introTo ?? []) as readonly CourseTypeId[],
    });
  }
  if (ids.size !== entries.length) problems.push("duplicate course type id");
  if (problems.length) throw new Error(`Course type vocabulary is inconsistent:\n${problems.join("\n")}`);
  // Overlaps go both ways (Personal Financial Literacy and Economics overlaps Economics, and back).
  for (const type of types.values()) {
    for (const o of type.overlaps) {
      const other = types.get(o)!;
      if (!other.overlaps.includes(type.id)) other.overlaps = [...other.overlaps, type.id];
    }
  }
  // CTE prerequisites follow the ladder: a level-n class needs any level n-1 class in its cluster.
  for (const type of types.values()) {
    if (!type.ladder?.id.startsWith("cte.") || type.ladder.rank <= 1) continue;
    const below = [...types.values()].filter((t) => t.ladder?.id === type.ladder!.id && t.ladder.rank === type.ladder!.rank - 1);
    type.prereqs = [{ anyOf: below.map((t) => t.id) }];
  }
  return types;
}

const TYPES = build();

/** Every course type id, in vocabulary order (subjects together, levels ascending). */
export const COURSE_TYPE_IDS: readonly CourseTypeId[] = [...TYPES.keys()];

export function isCourseTypeId(id: unknown): id is CourseTypeId {
  return typeof id === "string" && TYPES.has(id as CourseTypeId);
}

/** The type for an id. Throws on an unknown id (validate input with `isCourseTypeId` first). */
export function getCourseType(id: CourseTypeId): CourseType {
  const type = TYPES.get(id);
  if (!type) throw new Error(`Unknown course type ${id}`);
  return type;
}

export function allCourseTypes(): readonly CourseType[] {
  return [...TYPES.values()];
}

/** The title to show in a state ("Secondary Mathematics III" in Utah), else the generic title. */
export function courseTypeTitle(id: CourseTypeId, state: PlannerState | null): string {
  const type = getCourseType(id);
  return (state && type.stateTitles[state]) ?? type.title;
}

/** Types a student might mean under a subject: the subject's own types, then those filed there too. */
export function courseTypesForSubject(subject: CourseSubject): readonly CourseType[] {
  const all = allCourseTypes();
  return [...all.filter((t) => t.subject === subject), ...all.filter((t) => t.altSubjects.includes(subject))];
}

/** What an unrecognized class in each subject guesses to. */
export const SUBJECT_FALLBACK_TYPE: Record<CourseSubject, CourseTypeId> = {
  english: "ela.other",
  math: "math.other",
  science: "sci.other",
  social_studies: "ss.other",
  world_language: "lang.other.1",
  arts: "arts.other",
  computer_science: "cs.other",
  career_technical: "cte.other",
  health_pe: "pe.other",
  other: "other.other",
};

/** Every ladder that has at least one type. */
export function ladderIds(): readonly LadderId[] {
  return [...new Set(allCourseTypes().flatMap((t) => (t.ladder ? [t.ladder.id] : [])))];
}

/** A ladder's types by rank, lowest first. */
export function ladderTypes(ladder: LadderId): readonly CourseType[] {
  return allCourseTypes()
    .filter((t) => t.ladder?.id === ladder)
    .sort((a, b) => a.ladder!.rank - b.ladder!.rank);
}

export function hasCapability(id: CourseTypeId, capability: Capability): boolean {
  return getCourseType(id).capabilities.includes(capability);
}
