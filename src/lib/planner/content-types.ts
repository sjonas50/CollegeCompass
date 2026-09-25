import type { PlannerState, SchoolGrade, SchoolYear } from "./common";
import type { CourseTypeId, CourseTypeLevel, CteCluster } from "./course-types";
import type { CipRoutingRule, FamilyId, MathTarget } from "./families";
import type { CitationId, ContentHeader, PathKind, RuleSetId } from "./rules";

// ---------------------------------------------------------------------------
// The other reviewed content files the planner reads (design §4.4). Rule files are in rules.ts.
// content-schema.ts mirrors these types exactly.
// ---------------------------------------------------------------------------

/**
 * src/content/course-rules/{ut,tn,tx}/generic-catalog.json: "classes most <State> high schools
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
  cite?: CitationId[];
};

/**
 * The gap-option menu (design §5.8), least extra load first. `ask_counselor` is always offered last.
 */
export const GAP_OPTION_KINDS = [
  "test_score",
  "summer",
  "double_up",
  "state_online",
  "college_credit",
  "credit_by_exam",
  "lower_target",
  "ask_counselor",
] as const;
export type GapOptionKind = (typeof GAP_OPTION_KINDS)[number];

/**
 * src/content/course-rules/{ut,tn,tx}/facts.json: verified facts the options menu and the fill
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
};

export type OptionFact = {
  kind: Exclude<GapOptionKind, "test_score" | "lower_target" | "ask_counselor">;
  /** "Statewide Online Education Program (SOEP)". */
  programName?: string;
  /** Grades the option is open to. */
  grades?: SchoolGrade[];
  /** Only for these subjects' gaps (credit by exam lists specific courses). */
  types?: CourseTypeId[];
  /** The note shown with the option, plain words, no promises ("One summer; may cost money"). */
  note: string;
  cite: CitationId[];
};

/**
 * src/content/major-prep/families.json: one entry per family (all 32), the research's reviewed
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
  /** Published program rules, quoted and scoped. Evidence grades A-D as in the research. */
  gates: {
    id: string;
    text: string;
    evidence: "A" | "B" | "C" | "D";
    colleges?: number[];
    /** The rule set that encodes this gate for the engine, if any. */
    ruleSetId?: RuleSetId;
    cite: CitationId[];
  }[];
  cautions: { id: string; text: string; cite: CitationId[] }[];
};

/** src/content/major-prep/cip-routing.json: ordered, first match wins. */
export type CipRoutingFile = ContentHeader & {
  rules: CipRoutingRule[];
};
