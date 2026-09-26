import type { CourseStatus, CourseSubject, CourseTerm } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import type { IsoDate, PlannerState, SchoolGrade, SchoolYear } from "./common";
import type { FactsFile, GapOptionKind, GenericCatalogFile, MajorFamiliesFile, RigorFile } from "./content-types";
import type { CourseTypeSource } from "./course-type-guess";
import type { CourseTypeId, CourseTypeLevel, CteCluster, LanguageCode } from "./course-types";
import type { FamilyId } from "./families";
import type {
  CheckKind,
  CitationId,
  CohortKey,
  Condition,
  Confidence,
  Issuer,
  PathKind,
  ReqArea,
  ReqId,
  ReviewStatus,
  RuleFile,
  RuleSetId,
  RuleSetKind,
  Selector,
  Source,
  SourceKey,
  Strength,
  TnElectiveFocus,
  TxEndorsement,
} from "./rules";

// ---------------------------------------------------------------------------
// The planner engine's contract (design §5.3-5.10): `plan(input: PlannerInput): PathResult`.
//
// - Pure and deterministic: plain JSON in, plain JSON out, no Db, no clock (the date is in the
//   input), no randomness. Same input, byte-identical output. `loadPlannerInput(db, userId)`
//   (built elsewhere) gathers the input.
// - Code decides what counts. The AI never sees this input and never decides anything in it.
// - The student's own classes are locked: the engine suggests around them and flags conflicts,
//   never edits them.
// - Privacy: the output never contains the school's name, id or district. Catalog titles
//   (`title` on catalog rows and suggestions) are the school's local names: fine on the student's
//   own screens, never sent to the AI. AI-facing summaries use `typeId`, `genericTitle` and `level`.
// - Rigor is never scored by counting AP classes; nothing in the output ranks plans by rigor.
// ---------------------------------------------------------------------------

/** Planning limits the owner set for the proof of concept. */
export const DEFAULT_MAX_COLLEGE_LEVEL_PER_YEAR = 3;
/** A soft warning (never a block) at this many college-level classes in a year, whoever placed them. */
export const COLLEGE_LEVEL_SOFT_WARNING_AT = 4;
export const MAX_COLLEGE_LEVEL_PER_YEAR = 6;
export const MAX_PLANS = 2;
export const MAX_GAP_OPTIONS = 3;
export const MAX_FAMILY_TARGETS = 3;
export const CLASSES_PER_YEAR_RANGE = { min: 5, max: 8 } as const;

/** One, two or three items. */
export type UpToThree<T> = [T] | [T, T] | [T, T, T];

// ===========================================================================
// Input
// ===========================================================================

export type PlannerInput = {
  asOf: {
    /** Today, for staleness labels and deadlines. */
    today: IsoDate;
    /** `schoolYearOf(today)`: June and July still belong to the year just ended. */
    schoolYear: SchoolYear;
    /** 1-12. In June and July the plan starts at the next grade. */
    month: number;
  };
  student: {
    /** `currentGrade()`, 7-12. (Graduated students aren't planned.) */
    grade: SchoolGrade;
    cohort: StudentCohort;
  };
  /** UT, TN or TX: full planning. Null: today's checklist, unchanged (mode "no_state"). */
  state: PlannerState | null;
  /** Whatever state the student set, for the "coming later" line; may be outside the three. */
  homeState: string | null;
  /**
   * The class list for each grade still to plan: the school's published list, else the family's
   * own confirmed list, else the state's generic list. A missing grade uses the generic list.
   */
  catalogs: Partial<Record<SchoolGrade, CatalogView>>;
  /** Every class the student recorded, all locked. */
  courses: CourseFact[];
  targets: PlannerTargets;
  prefs: PlannerPrefs;
  /** The student's state's validated content; null when `state` is null. */
  content: PlannerContent | null;
};

/** Reviewed content for one state (validate.ts `contentForState`). */
export type PlannerContent = {
  rules: RuleFile[];
  genericCatalog: GenericCatalogFile;
  facts: FactsFile;
  families: MajorFamiliesFile | null;
  /** Rigor tiers and guardrails (major-prep/rigor.json); optional so older fixtures still type-check. */
  rigor?: RigorFile | null;
};

// Student -----------------------------------------------------------------------

export const COHORT_OVERRIDE_REASONS = ["repeated", "skipped", "transferred", "graduating_early", "other"] as const;
export type CohortOverrideReason = (typeof COHORT_OVERRIDE_REASONS)[number];

/**
 * Which rules apply (cohort.ts derives it). The grade-9 entry year and the graduation year are
 * separate: Texas and Tennessee follow the year the student started 9th grade, while early
 * graduation (Move on When Ready, Texas First) changes only the graduation year.
 */
export type StudentCohort = {
  /** School year the student started (or will start) 9th grade: 2026 = fall 2026. */
  grade9EntryYear: SchoolYear;
  /** Expected graduation year (the spring): the class of 2030. */
  classYear: number;
  /** School year the student started 7th grade (the Texas GPA rule). Follows grade9EntryYear. */
  grade7EntryYear: SchoolYear;
  overrides: { grade9Entry?: CohortOverrideReason; classYear?: CohortOverrideReason };
};

/** A recorded class (`student_courses` row), resolved for planning. Always locked. */
export type CourseFact = {
  /** `student_courses.id`. */
  id: string;
  /** As the student typed it. Display only; through `scrubPii` if it ever reaches the AI. */
  name: string;
  typeId: CourseTypeId;
  typeSource: CourseTypeSource;
  /** A guessed type: matches only `subjects` selectors, never types or capabilities. */
  assumed: boolean;
  level: CourseTypeLevel;
  /**
   * The subject `subjects` selectors match: the type's own subject when the type is confirmed
   * (catalog or student), the row's subject when it's a guess.
   */
  subject: CourseSubject;
  grade: SchoolGrade;
  /** The school year it was (or will be) taken, from the grade and the cohort. */
  schoolYear: SchoolYear;
  term: CourseTerm;
  units: number;
  status: CourseStatus;
  finalGrade: LetterGrade | null;
  highSchoolCredit: boolean;
  /** Taught as CTE: the catalog row's flag, else true only when the type is always CTE. */
  cte: boolean;
  /** From the catalog row (Utah CE science without a lab). */
  lectureOnly: boolean;
  catalogCourseId: string | null;
  origin: "typed" | "school_list" | "planner";
};

// Targets and choices ---------------------------------------------------------------

export type PlannerTargets = {
  path: PathKind;
  /** At most 3, the first planned around; others are "also check". Empty: general college prep. */
  families: FamilyTarget[];
  /** From the college list. With no in-state public college, the state default rule set applies (labeled). */
  colleges: CollegeTarget[];
};

export type FamilyTarget = {
  familyId: FamilyId;
  source: "north_star" | "chosen";
  /** The 6-digit CIP code that routed it, when it came from a north star. */
  cip6: string | null;
  /** The career's title for "Because you picked Registered Nurse" (a career title, never personal). */
  because: string | null;
};

export type CollegeTarget = {
  unitId: number;
  name: string;
  state: string;
  public: boolean;
  /** Scorecard ADM_RATE, 0-1, or null. */
  admissionRate: number | null;
  /** Scorecard OPENADMP; null when unknown. */
  openAdmission: boolean | null;
};

/** `student_plan_prefs.choices`: choices a rule depends on, asked inline only when needed. */
export type PlannerChoices = {
  txEndorsements?: TxEndorsement[];
  /** The DLA as a goal. Defaults to true on the degree path (owner decision): "the course route" to automatic admission. */
  txAimDla?: boolean;
  /** Graduate with no endorsement: only after 10th grade, with the parent's written permission; rules out the DLA. */
  txFoundationOnly?: boolean;
  tnElectiveFocus?: TnElectiveFocus;
  worldLanguage?: LanguageCode;
  ctePathway?: { cluster: CteCluster; name?: string };
  /** Family-chosen waivers and opt-outs (never suggested). */
  utMath3OptOut?: boolean;
  tnWorldLanguageWaiver?: boolean;
  tnFineArtsWaiver?: boolean;
  txArtsHumanitiesScienceSwap?: boolean;
  /** The student recorded meeting Utah's college-ready math competency, so no required senior math. */
  utMathCompetencyMet?: boolean;
};
export type ChoiceKey = keyof PlannerChoices;

export type PlannerLimits = {
  /** 0-6. Never exceeded by a suggestion. Default 3. */
  maxCollegeLevelPerYear: number;
  /** 5-8, or null to use the school's list, then the state's default. */
  classesPerYear: number | null;
  /** Show summer, online and college-credit options (only where the state's facts verify them). */
  allowSummer: boolean;
  allowOnline: boolean;
  allowCollegeCredit: boolean;
  /** Opt in to doubling up or skipping ahead in math; offered only after a B or better. */
  accelerateMath: boolean;
};

export const DEFAULT_LIMITS: PlannerLimits = {
  maxCollegeLevelPerYear: DEFAULT_MAX_COLLEGE_LEVEL_PER_YEAR,
  classesPerYear: null,
  allowSummer: true,
  allowOnline: true,
  allowCollegeCredit: true,
  accelerateMath: false,
};

/** Readable and stable, so a dismissal survives re-planning (see `suggestionKey`). */
export type SuggestionKey = string;

export type PlannerPrefs = {
  choices: PlannerChoices;
  limits: PlannerLimits;
  /** Suggestions the student said "Not for me" to. */
  dismissed: SuggestionKey[];
};

/**
 * The stable key of a suggestion: what it's for (a rule set's requirement, or a major-prep
 * target) plus the course type and level. Stored in `student_plan_prefs.dismissed`.
 */
export function suggestionKey(forWhat: { ruleSetId: RuleSetId; reqId: ReqId } | { prep: FamilyId }, typeId: CourseTypeId, level: CourseTypeLevel): SuggestionKey {
  const what = "prep" in forWhat ? `prep:${forWhat.prep}` : `${forWhat.ruleSetId}/${forWhat.reqId}`;
  return `${what}/${typeId}/${level}`;
}

// Catalogs --------------------------------------------------------------------------

export const APPROVALS = ["teacher_recommendation", "application", "audition_or_tryout", "test_score", "counselor", "committee_placement"] as const;
export type Approval = (typeof APPROVALS)[number];

export type CatalogSource = "school_published" | "school_family" | "generic";

/**
 * A class list the engine plans from: a school's published list, the family's own confirmed
 * list, or the state's generic list. Unmapped rows (typeId null) never satisfy a rule.
 */
export type CatalogView = {
  /** A course guide id, or "generic:TX". */
  id: string;
  source: CatalogSource;
  state: PlannerState;
  /** The list's school year; null for the generic list. */
  schoolYear: SchoolYear | null;
  /** Still using last year's list. */
  lastYears: boolean;
  classesPerYear: number | null;
  schedule: "traditional" | "block_4x4" | "ab_block" | "unknown";
  /** A confirmed "your school's guide says" graduation total, in units. */
  localTotalUnits: number | null;
  /** Subjects the family or staff confirmed; the others fall back to the generic list. */
  confirmedSubjects: CourseSubject[] | "all";
  courses: CatalogCourse[];
};

export type CatalogPrereq = {
  anyOf: ({ catalogId: string } | { typeId: CourseTypeId })[];
  minLetter?: LetterGrade;
  concurrentOk?: boolean;
};

export type CatalogCourse = {
  /** `catalog_courses.id`, or "generic:<typeId>:<level>". */
  id: string;
  typeId: CourseTypeId | null;
  level: CourseTypeLevel;
  subject: CourseSubject;
  /** The title as printed. Display only; never sent to the AI. */
  title: string;
  units: number;
  /** Null when the guide doesn't print grades: the type's usual window applies. */
  grades: SchoolGrade[] | null;
  terms: CourseTerm[];
  prereqs: CatalogPrereq[];
  approvals: Approval[];
  cte: boolean;
  lectureOnly: boolean;
  delivery: "in_person" | "virtual" | "summer" | "interactive_video" | "unknown";
  firstSchoolYear: SchoolYear | null;
  /** Taught only every other year (Texas allows that for required classes). */
  everyOtherYear: boolean;
};

// ===========================================================================
// Output
// ===========================================================================

export type PathResult = NoStatePath | PlannedPath;

/** Outside UT, TN and TX (or no state set): the page keeps today's checklist and course ideas, unchanged. */
export type NoStatePath = {
  mode: "no_state";
  homeState: string | null;
  /** "Full class planning for Ohio is coming later." Null when no state is set. */
  comingLater: string | null;
};

export type PlanMode = "catalog" | "mixed" | "generic";

export type PlannedPath = {
  /** catalog: every remaining grade uses a school list; generic: none do; mixed: some. */
  mode: PlanMode;
  state: PlannerState;
  /** middle_school (grades 7-8): only the math placement card, exploration and a 9th-grade sketch. */
  stage: "middle_school" | "high_school";
  /** Changes whenever anything in the input changes (for "changed because" notes and stored explanations). */
  inputsFingerprint: string;
  notices: {
    /** Always shown: DRAFT_BANNER. */
    draft: string;
    /** Always shown: STANDING_PLAN_NOTE (IEP, 504, English learners). */
    standing: string;
    review: ReviewNotice[];
  };
  builtFrom: BuiltFrom;
  /** The "by when" strip: zero-slack ladder steps and rule deadlines, soonest first. Plan A's; each plan has its own. */
  deadlines: Deadline[];
  /** Choices a rule depends on that the student hasn't made (endorsement, elective focus). */
  decisions: PendingDecision[];
  /** Plan A, and Plan B only when a real decision separates them. Empty for middle school. */
  plans: [] | [PlanOption] | [PlanOption, PlanOption];
  /** Why there are two plans; null with one. */
  planChoice: PlanChoice | null;
  /** Plan A's gaps, audit and questions (each plan in `plans` carries its own). */
  gaps: Gap[];
  audit: RuleSetAudit[];
  demands: Demand[];
  /** 3 to 8 questions for the counselor meeting (print view). */
  askCounselor: CounselorQuestion[];
  middleSchool: MiddleSchoolView | null;
  /** Every citation any reason, line or option refers to, resolved for "Why?". */
  citations: Record<CitationId, ResolvedCitation>;
};

// Reasons ------------------------------------------------------------------------------

/**
 * rule: a published requirement ("Required by Texas"). suggestion: a reviewed College Compass
 * target ("College Compass suggestion"). heuristic: a product guardrail (load warnings).
 */
export type ClaimKind = "rule" | "suggestion" | "heuristic";

export const REASON_KINDS = [
  "requirement",
  "ladder",
  "deadline",
  "major_prep",
  "rigor",
  "load",
  "choice",
  "gap",
  "projected",
  "stale",
  "conflict",
  "state_note",
] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

/** Why something is on the page. Every slot, deadline, gap and audit line carries at least one. */
export type Reason = {
  kind: ReasonKind;
  /** Rendered from reviewed templates at about a grade 7 reading level. */
  text: string;
  claim: ClaimKind;
  /** The strength word shown always comes from the rule's own `strength`. */
  strength: Strength | null;
  ruleSetId: RuleSetId | null;
  reqId: ReqId | null;
  familyId: FamilyId | null;
  /** Source quotes behind it (keys into PlannedPath.citations). */
  citations: CitationId[];
  params: Record<string, string | number>;
};

export type ResolvedCitation = {
  id: CitationId;
  quote: string;
  pinpoint: string | null;
  source: Source & { key: SourceKey };
};

// Provenance -----------------------------------------------------------------------------

export type ReviewNotice = {
  fileId: string;
  status: ReviewStatus;
  /** REVIEW_LABELS: "Not yet reviewed by a school counselor", or the review date. */
  label: string;
  stale: boolean;
  /** "Checked for 2026-27; being re-checked. Ask your counselor." when stale. */
  staleLabel: string | null;
};

export type CatalogRef = {
  source: CatalogSource;
  schoolYear: SchoolYear | null;
  lastYears: boolean;
  /** "2026-27 list, checked by College Compass staff" / "your family's check" / "classes most Texas high schools offer". Never the school's name. */
  label: string;
};

export const RIGOR_TIERS = ["open", "admits_most", "admits_fewer_than_half", "very_selective"] as const;
export type RigorTier = (typeof RIGOR_TIERS)[number];
/** The app's admission-rate cutoffs (src/lib/colleges/describe.ts): an app convention, not an external standard. */
export const RIGOR_CUTOFFS = { admitsMost: 0.5, admitsFewerThanHalf: 0.25 } as const;

export type BuiltFrom = {
  ruleSets: {
    id: RuleSetId;
    title: string;
    fileId: string;
    fingerprint: string;
    review: ReviewStatus;
    reviewedOn: IsoDate | null;
    verifiedForSchoolYear: SchoolYear;
    stale: boolean;
    projected: boolean;
  }[];
  catalogs: { grade: SchoolGrade; catalog: CatalogRef }[];
  families: FamilyTarget[];
  colleges: { unitId: number | null; name: string; stateDefault: boolean }[];
  rigor: { tier: RigorTier; why: string };
};

// By when --------------------------------------------------------------------------------

/** "by the start of 9th", "by the end of 11th", "by December 10 of 12th grade". */
export type ByWhen = { grade: SchoolGrade; point: "start" | "end" } | { grade: SchoolGrade; point: "date"; month: number; day: number };

export type Deadline = {
  id: string;
  kind: "ladder" | "rule" | "decision" | "test";
  by: ByWhen;
  /** "Precalculus by the end of 11th keeps calculus in 12th open." */
  text: string;
  /** School years of slack; the strip shows zero-slack steps. */
  slackYears: number;
  /** A line under it: for a test-score route, what the class route would take ("Or show it with a class: …"). */
  note?: string;
  reasons: Reason[];
};

export type PendingDecision = {
  key: ChoiceKey | "family";
  by: ByWhen | null;
  text: string;
  reasons: Reason[];
};

// Demands -----------------------------------------------------------------------------------

/**
 * P0 state graduation (and a confirmed local total); P1 admission units a target requires,
 * published program gates, the DLA when aimed at; P2 units targets strongly encourage or
 * recommend; P3 major-prep targets and state aid course parts; P4 rigor placement (level
 * choices only); P5 open "Your choice" slots.
 */
export type DemandPriority = 0 | 1 | 2 | 3 | 4 | 5;

export type Demand = {
  id: string;
  priority: DemandPriority;
  select: Selector[];
  units: number;
  window: { fromGrade: SchoolGrade; byGrade: SchoolGrade };
  /** Every requirement this demand serves (merged demands serve several). */
  serves: ({ ruleSetId: RuleSetId; reqId: ReqId } | { familyId: FamilyId })[];
  reasons: Reason[];
};

// Plans ----------------------------------------------------------------------------------

export type PlanChoice = {
  kind: "math_route" | "target_split" | "endorsement" | "language_vs_cte";
  /** What separates the plans, never "better" or "harder". */
  text: string;
  reasons: Reason[];
};

export type PlanOption = {
  id: "A" | "B";
  /** Labeled by what differs: "Plan A: show calculus readiness with a test score." */
  label: string;
  years: PlanYear[];
  /** This plan's own audit, gaps, "by when" and counselor questions (the path's top-level ones are Plan A's). */
  audit: RuleSetAudit[];
  gaps: Gap[];
  deadlines: Deadline[];
  askCounselor: CounselorQuestion[];
};

export type PlanYear = {
  grade: SchoolGrade;
  schoolYear: SchoolYear;
  catalog: CatalogRef;
  slots: PlanSlot[];
  capacity: { classes: number; used: number };
  load: {
    collegeLevel: number;
    cap: number;
    /** At COLLEGE_LEVEL_SOFT_WARNING_AT or more, whoever placed them; shown with the sleep guidance. */
    warning: boolean;
    reasons: Reason[];
  };
};

export type SlotWarning = { kind: "prereq_missing" | "not_offered" | "grade_not_allowed" | "load" | "conflict"; text: string };

export type PlanSlot =
  | {
      kind: "yours";
      courseId: string;
      typeId: CourseTypeId;
      assumed: boolean;
      level: CourseTypeLevel;
      /** The student's own name for it. */
      title: string;
      units: number;
      status: CourseStatus;
      warnings: SlotWarning[];
    }
  | {
      kind: "suggested";
      key: SuggestionKey;
      typeId: CourseTypeId;
      level: CourseTypeLevel;
      /** The school list's title (display only) or, in generic mode, the type's title. */
      title: string;
      /** The type's generic title: what AI-facing summaries use. */
      genericTitle: string;
      catalogCourseId: string | null;
      term: CourseTerm;
      units: number;
      priority: DemandPriority;
      collegeLevel: boolean;
      /** "Needs a plan now": a missing required credit in 12th grade. */
      needsPlanNow: boolean;
      /** "Other choices": other classes at this school that meet the same need. */
      alternatives: { key: SuggestionKey; typeId: CourseTypeId; level: CourseTypeLevel; title: string; catalogCourseId: string | null }[];
      /** Shown, never assumed ("needs a teacher recommendation"). */
      approvals: Approval[];
      reasons: Reason[];
    }
  | { kind: "your_choice" };

// Gaps ------------------------------------------------------------------------------------

export type Gap = {
  id: string;
  kind: "unmet" | "ladder_infeasible" | "doesnt_fit" | "not_offered";
  priority: DemandPriority;
  demandId: string | null;
  /** Plain, never "behind": "Room to add a 3rd lab science." */
  text: string;
  decideBy: ByWhen | null;
  /** At most three, least extra load first; "ask your counselor" is always one of them, last. */
  options: UpToThree<GapOption>;
  reasons: Reason[];
};

export type GapOption = {
  kind: GapOptionKind;
  text: string;
  /** "One summer; may cost money." Never asks about income. */
  note: string;
  /** For a lower target: what it closes ("calculus in your first college year instead"). */
  closes: string | null;
  /** The classes the option would add, if any. */
  adds: { grade: SchoolGrade; typeId: CourseTypeId; level: CourseTypeLevel; term: CourseTerm }[];
  citations: CitationId[];
};

// Audit -----------------------------------------------------------------------------------

export const AUDIT_STATUSES = ["done", "planned", "room_to_add", "ask_counselor", "not_tracked"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_MODIFIERS = ["projected", "sources_disagree", "guessed_type", "stale", "unverified", "needs_plan_now"] as const;
export type AuditModifier = (typeof AUDIT_MODIFIERS)[number];

export type RuleSetAudit = {
  ruleSetId: RuleSetId;
  title: string;
  kind: RuleSetKind;
  issuer: Issuer;
  strength: Strength;
  confidence: Confidence;
  cohort: { key: CohortKey; value: number };
  /** Null when no variant applies (the whole rule set is "Ask your counselor"). */
  variantId: string | null;
  /** Which compiled alternative was picked (most firm-met leaves, then on-track, then fewest missing, then author order). */
  alternativeIndex: number | null;
  projected: boolean;
  stale: boolean;
  review: ReviewStatus;
  /** Summary for the tab: the worst requirement status. */
  status: AuditStatus;
  requirements: RequirementAudit[];
  checks: CheckResult[];
  /** "We don't track this" lines. */
  conditions: (Pick<Condition, "id" | "label" | "kind"> & { citations: CitationId[] })[];
  unverified: { id: string; text: string }[];
  warnings: { id: string; text: string; citations: CitationId[] }[];
  testRoutes: { id: string; text: string; citations: CitationId[] }[];
};

export type CountedRef = { kind: "course"; courseId: string } | { kind: "suggestion"; key: SuggestionKey };

export type RequirementAudit = {
  reqId: ReqId;
  label: string;
  strength: Strength;
  area: ReqArea | null;
  status: AuditStatus;
  modifiers: AuditModifier[];
  /** What's measured: quarter-credit units, courses (count), or language levels. */
  measure: "units" | "courses" | "levels";
  required: number;
  /** Done or in progress. */
  firm: number;
  planned: number;
  missing: number;
  counted: { ref: CountedRef; amount: number; firm: boolean }[];
  reasons: Reason[];
  /** "This counts for your diploma, but UTC may not count it. Ask your counselor." */
  conflicts: AdmissionConflict[];
};

export type CheckResult = {
  checkId: string;
  kind: CheckKind;
  status: "ok" | "room_to_add" | "ask_counselor";
  text: string;
  citations: CitationId[];
};

export type AdmissionConflict = {
  courseRef: CountedRef;
  graduation: { ruleSetId: RuleSetId; reqId: ReqId };
  admission: { ruleSetId: RuleSetId; reqId: ReqId };
  text: string;
};

// Counselor meeting and middle school ----------------------------------------------------------

export type CounselorQuestion = { id: string; text: string; reasons: Reason[] };

export type MiddleSchoolView = {
  /** "Taking Algebra I in 8th leaves room for calculus by 12th …" */
  mathPlacement: { text: string; reasons: Reason[] };
  /** The state's middle-school math note (facts.middleSchoolMath). */
  stateNotes: { text: string; citations: CitationId[] }[];
  /** Exploration ideas (generic types; the school's names only in display). */
  exploration: { typeId: CourseTypeId; title: string }[];
  /** An optional 9th-grade sketch in generic types; no college-level classes, no upgrades. */
  ninthGradeSketch: PlanYear | null;
};
