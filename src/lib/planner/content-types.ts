import type { PlannerState, SchoolGrade, SchoolYear } from "./common";
import type { CourseTypeId, CourseTypeLevel, CteCluster } from "./course-types";
import type { CipRoutingRule, FamilyId, MathTarget } from "./families";
import type { RigorTier } from "./engine-io";
import type { CitationId, ContentHeader, PathKind, RuleSetId, TxEndorsement } from "./rules";

// ---------------------------------------------------------------------------
// The other reviewed content files the planner reads (design §4.4). Rule files are in rules.ts.
// content-schema.ts mirrors these types exactly.
// ---------------------------------------------------------------------------

/**
 * src/content/planner/{ut,tn,tx}/generic-catalog.json: "classes most <State> high schools
 * offer", used for any grade (or subject) with no confirmed school list. Seeded from the state's
 * own lists: USBE's criteria list [UT S3], Policy 3.205 [TN S6b], §74.3(b)(2) [TX S2].
 */
export type GenericCatalogFile = ContentHeader & {
  state: PlannerState;
  /** "Classes most Texas high schools offer". */
  title: string;
  /** Classes a student usually takes in a year here (reviewed). */
  classesPerYear: number;
  courses: GenericCatalogCourse[];
};

export type GenericCatalogCourse = {
  typeId: CourseTypeId;
  /** Levels commonly offered in this state; each becomes one catalog row. */
  levels: CourseTypeLevel[];
  /** Overrides the type's default credit (Utah World Geography is 0.5 = 2 units). */
  units?: number;
  /** Overrides the type's usual grade window. */
  grades?: SchoolGrade[];
  /** First school year the class exists (Utah ACGC: 2027). */
  firstSchoolYear?: SchoolYear;
  /**
   * Prerequisites the state sets on top of the type's own, each group met by any one type (Utah:
   * the applied math classes that take Secondary Math III's place come after Secondary Math II).
   */
  prereqs?: CourseTypeId[][];
  cite?: CitationId[];
};

/**
 * The gap-option menu (design §5.8), least extra load first. `ask_counselor` is always offered last.
 */
export const GAP_OPTION_KINDS = [
  "test_score",
  "summer",
  // For a class the student took and didn't pass (Tennessee Policy 2.103 VI).
  "credit_recovery",
  "double_up",
  "state_online",
  "college_credit",
  "credit_by_exam",
  "lower_target",
  "ask_counselor",
] as const;
export type GapOptionKind = (typeof GAP_OPTION_KINDS)[number];

/**
 * src/content/planner/{ut,tn,tx}/facts.json: verified facts the options menu and the fill
 * step depend on. An option kind with no entry here is never offered in that state (except
 * test_score, which comes from a rule set's testRoutes, and lower_target and ask_counselor,
 * which need no facts).
 */
export type FactsFile = ContentHeader & {
  state: PlannerState;
  /** Minimum classes (or credits) a full-time student takes a year, if the state sets one (TN: 5 credits). */
  minUnitsPerYear?: number;
  options: OptionFact[];
  /** Middle-school math notes shown on the grade 7-8 placement card. */
  middleSchoolMath: { text: string; cite: CitationId[] }[];
  /**
   * What the state calls things families will see ("concurrent enrollment (CE)" in Utah, "dual
   * credit" in Texas), and words that mean something else there (Utah's "dual enrollment").
   * The level labels in course-types.ts (STATE_LEVEL_LABELS) must agree (a content test pins it).
   */
  terms?: StateTerm[];
};

export type StateTerm = {
  id: string;
  /** "Concurrent enrollment (CE)". */
  term: string;
  /** Plain explanation, grade 9 reading level. */
  meaning: string;
  cite: CitationId[];
};

export type OptionFact = {
  kind: Exclude<GapOptionKind, "test_score" | "lower_target" | "ask_counselor">;
  /** "Statewide Online Education Program (SOEP)". */
  programName?: string;
  /** Grades the option is open to. */
  grades?: SchoolGrade[];
  /** Only for these subjects' gaps (credit by exam lists specific courses). */
  types?: CourseTypeId[];
  /**
   * A first attempt this way is only for students on an accelerated path (Tennessee's summer
   * courses, Policy 2.103 I(20)): offered only to a student who opted into acceleration, and
   * otherwise only to retake a class they didn't pass.
   */
  firstAttemptAccelerated?: true;
  /** The note shown with the option, plain words, no promises ("One summer; may cost money"). */
  note: string;
  cite: CitationId[];
};

/**
 * src/content/planner/major-prep/families.json: one entry per family (all 32), the research's reviewed
 * targets. Three kinds of claim render differently: published gates ("UT Austin requires"),
 * reviewed targets ("College Compass suggests"), and product heuristics (load warnings).
 */
export type MajorFamiliesFile = ContentHeader & {
  families: MajorFamilyContent[];
};

export type MajorFamilyContent = {
  id: FamilyId;
  summary: string;
  path: PathKind | "both";
  math: {
    /** One code, or two that together form the target (["PRECALC", "STATS"]). */
    target: MathTarget[];
    /** An equally good alternative ("CALC, or PRECALC + STATS"). */
    orTarget?: MathTarget[];
    /** A lower target for the training path (associate programs: ALG2+). */
    trainingTarget?: MathTarget[];
    note?: string;
    cite: CitationId[];
  };
  /** Key sciences, most important first. */
  sciences: CourseTypeId[];
  /** Other key courses (programming, psychology, drawing). */
  keyCourses: CourseTypeId[];
  /** Where honors, AP, IB or college credit should go first; 3 at most. */
  rigorFirst: CourseTypeId[];
  ctePathways: { state: PlannerState; cluster: CteCluster; name: string; cite: CitationId[] }[];
  /**
   * The Texas endorsement this goal usually fits, where the rule itself names it (STEM programs of
   * study; nursing science counts for Public Services unless STEM's math and science are met). Plans
   * only prefer it; the student picks. Other families follow their Texas pathway's cluster.
   */
  txEndorsement?: { value: TxEndorsement; cite: CitationId[] };
  /** Published program rules, quoted and scoped. Evidence grades A-D as in the research. */
  gates: {
    id: string;
    text: string;
    evidence: "A" | "B" | "C" | "D";
    colleges?: number[];
    /** The rule set that encodes this gate for the engine, if any. */
    ruleSetId?: RuleSetId;
    /**
     * About college credit (dual or concurrent enrollment hours, UT Knoxville nursing's 45-hour
     * note): a counselor question once the plan has a college-credit class, for its colleges only.
     */
    collegeCredit?: true;
    cite: CitationId[];
  }[];
  /** `collegeCredit`: as for gates (a counselor question once the plan has a college-credit class). */
  cautions: { id: string; text: string; collegeCredit?: true; cite: CitationId[] }[];
};

/** src/content/planner/major-prep/cip-routing.json: ordered, first match wins. */
export type CipRoutingFile = ContentHeader & {
  rules: CipRoutingRule[];
};

/**
 * src/content/planner/major-prep/rigor.json: rigor guidance by how selective the student's target
 * colleges are (design §5.3, Appendix C). The tier comes from the most selective target college's
 * admission rate using the app's cutoffs (RIGOR_CUTOFFS); the tier only shapes *level* choices
 * (honors, AP, IB, college credit) in the family's "rigor first" subjects. It never adds a class,
 * never counts AP classes, and never goes past the student's own load cap.
 */
export type RigorFile = ContentHeader & {
  /** Exactly one per RIGOR_TIERS entry, in that order. */
  tiers: RigorTierContent[];
  /** Published program gates that raise the tier one step for a college and family. */
  raises: RigorRaise[];
  /** Product guardrails (heuristics drawn from the evidence, not published rules). */
  guardrails: { id: string; text: string; cite: CitationId[] }[];
};

export type RigorTierContent = {
  id: RigorTier;
  /** "Admits most". */
  label: string;
  /** How the tier is detected, in plain words. */
  detection: string;
  /** What colleges in the tier expect, from their own pages (cited). */
  expects: string;
  /** What the planner aims for: a College Compass suggestion, not a published rule. */
  target: string;
  /** The earliest grade the planner may suggest a college-level version of a "rigor first" class; null = never. */
  collegeLevelFromGrade: SchoolGrade | null;
  /** How many of the family's "rigor first" subjects (at most 3) get a level suggestion. */
  rigorFirstSubjects: number;
  cite: CitationId[];
};

export type RigorRaise = {
  id: string;
  colleges: number[];
  families: FamilyId[];
  /** Or a target major's CIP code starts with one of these (a gate that names majors, not a whole family). */
  cips?: string[];
  /** "UT Austin requires calculus readiness for these majors." */
  text: string;
  cite: CitationId[];
};
