import type { CourseSubject } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import type { IsoDate, PlannerState, SchoolGrade, SchoolYear } from "./common";
import type { Capability, CourseTypeId, CourseTypeLevel, CteCluster, LanguageCode } from "./course-types";
import type { CipPrefix, FamilyId } from "./families";

// ---------------------------------------------------------------------------
// The rule language (design §5.4): how reviewed content describes graduation rules, college
// admission patterns, program gates, Texas endorsements and the DLA, Tennessee's elective focus,
// and the course parts of state scholarships. The JSON files under src/content/planner/ are
// checked against content-schema.ts, which mirrors these types exactly (a test pins that).
//
// Conventions:
// - Credits are quarter-credit `units` (4 = 1 credit), never decimal credits.
// - Every requirement quotes its source: `cite` lists citation ids from the file's `citations`,
//   and each citation quotes its source word for word (300 characters or fewer).
// - Nothing a source doesn't confirm is evaluated: it goes in `unverified` and shows once as
//   "Ask your counselor". Non-course requirements (tests, forms, attendance) go in `conditions`
//   and show as "We don't track this".
// - The AI never reads these to decide what counts. Code does.
// ---------------------------------------------------------------------------

/**
 * How strongly the issuer asks for it, in the source's own words (`strengthCite` quotes them).
 * - required / strongly_encouraged / recommended: admission and graduation language;
 * - priority: raises priority for aid without being a condition (TEXAS Grant "two of four");
 * - info: shown for context only, never a gap (HOPE's GPA and test thresholds).
 */
export const STRENGTHS = ["required", "strongly_encouraged", "recommended", "priority", "info"] as const;
export type Strength = (typeof STRENGTHS)[number];

/**
 * `local_graduation` is never authored: the engine builds it from a confirmed school guide's printed
 * total ("Your school's guide says 27 credits"). Every other kind lives in a rule file.
 */
export const RULE_SET_KINDS = [
  "state_graduation",
  "graduation_option",
  "local_graduation",
  "college_admission",
  "program_admission",
  "guaranteed_admission",
  "state_aid",
  "college_credit_program",
] as const;
export type RuleSetKind = (typeof RULE_SET_KINDS)[number];

/**
 * Which cohort number picks a variant. Utah graduation keys on the class (graduation year);
 * Texas and Tennessee on the school year the student started 9th grade (2026 = fall 2026); the
 * Texas GPA rule on the year they started 7th grade.
 */
export const COHORT_KEYS = ["class_year", "grade9_entry_year", "grade7_entry_year"] as const;
export type CohortKey = (typeof COHORT_KEYS)[number];

export const CONFIDENCES = ["verified", "conflicting", "unverified"] as const;
/** conflicting: sources disagree (MTSU, Memphis); never shown as Done, always "Ask your counselor". */
export type Confidence = (typeof CONFIDENCES)[number];

/** Who asks for it, for "Required by Texas" / "Strongly encouraged by UT Knoxville". */
export const ISSUER_KINDS = ["state", "college", "program", "aid_agency"] as const;
export type Issuer = { kind: (typeof ISSUER_KINDS)[number]; name: string };

// Ids --------------------------------------------------------------------

/** Permanent, never reused: "tx.fhsp.grad", "utk.core16", "ut.opportunity". */
export type RuleSetId = string;
/** Unique within a variant: "math", "sci.third_lab". */
export type ReqId = string;
/** Unique across all content: "tx-s1-74.12b". */
export type CitationId = string;
/** A key in the file's `sources`: "TX-S1". */
export type SourceKey = string;

// Sources and citations ---------------------------------------------------

export const SOURCE_KINDS = [
  "statute",
  "rule",
  "agency_policy",
  "agency_page",
  "institution_page",
  "catalog",
  "guidance",
  "research",
] as const;

export type Source = {
  title: string;
  /** https only. */
  url: string;
  publisher: string;
  kind: (typeof SOURCE_KINDS)[number];
  checkedOn: IsoDate;
};

export type Citation = {
  id: CitationId;
  source: SourceKey;
  /** Where in the source: "§74.13(e)(2)", "6(11)", "p. 4". */
  pinpoint?: string;
  /** The source's own words, verbatim, 300 characters or fewer. */
  quote: string;
};

// Selecting courses ----------------------------------------------------------

/**
 * Which courses can count. Every field present must match (AND); list fields match any listed
 * value. A requirement's `select` is a list of selectors, and a course counts if it matches any
 * one of them (OR). An empty selector is invalid.
 *
 * Guessed ("assumed") course types never match a selector with `types` or `capabilities`: a class
 * named "Honors Chem" with a guessed type counts toward "3 science credits" but never makes
 * "Chemistry" done.
 */
export type Selector = {
  types?: CourseTypeId[];
  capabilities?: Capability[];
  /** The course's effective subject (see CourseFact.subject in engine-io.ts). */
  subjects?: CourseSubject[];
  levels?: CourseTypeLevel[];
  /** Taken in one of these grades. */
  grades?: SchoolGrade[];
  /** Taken in a school year within this range (Utah Finance CE counts only before 2027-28). */
  schoolYears?: { from?: SchoolYear; to?: SchoolYear };
  /** A finished course counts only with this grade or better (Utah: calculus with a C). */
  minLetter?: LetterGrade;
  /** Taught as career and technical education. */
  cte?: boolean;
  /** Exclude courses the school's list marks lecture-only (Utah CE science needs a lab for graduation). */
  lab?: true;
  exclude?: CourseTypeId[];
  /**
   * A class from another subject the state lets stand in for this requirement for the diploma
   * (Tennessee Policy 3.103: Physics or computer science as the 4th math, a career class or
   * computer science as the 3rd lab science). Colleges may not count it the same way, so a class
   * counts here through this selector only when no plain route is as good (allocate.ts).
   */
  substitute?: true;
};

// Requirements -------------------------------------------------------------

/** Subject areas, used to find same-area requirements for diploma-vs-admission warnings. */
export const REQ_AREAS = [
  "english",
  "math",
  "science",
  "social_studies",
  "world_language",
  "arts",
  "computer_science",
  "career_technical",
  "health_pe",
  "financial_literacy",
  "digital_studies",
  "electives",
] as const;
export type ReqArea = (typeof REQ_AREAS)[number];

/** Family-chosen waivers and opt-outs an `option` requirement switches on. Never suggested by the planner. */
export const OPTION_PREFS = ["utMath3OptOut", "tnWorldLanguageWaiver", "tnFineArtsWaiver", "txArtsHumanitiesScienceSwap"] as const;
export type OptionPref = (typeof OPTION_PREFS)[number];

type ReqCommon = {
  id: ReqId;
  /** Short plain label: "English", "3rd lab science". */
  label: string;
  /** Overrides the rule set's strength for this requirement (UT Austin: 3 math required, 4 recommended). */
  strength?: Strength;
  /** Quote for an overridden strength; required when `strength` is set. */
  strengthCite?: CitationId;
  area?: ReqArea;
  note?: string;
};

type Leaf = ReqCommon & { cite: CitationId[] };

/** At least `units` of matching courses. */
export type CreditsReq = Leaf & {
  kind: "credits";
  units: number;
  select: Selector[];
  /** Counts without using up the course's credit (TX §74.11(n) AP CS A; §74.13(g)). */
  shareable?: boolean;
  /** May stand in for one of these requirements instead (TN computer science credit). */
  substitutesForOneOf?: ReqId[];
  /**
   * Classes of this kind stand in (`substitute` selectors) for only one of `substitutesForOneOf` in
   * all: this credit standing in for one of them, or another such class counted through that
   * requirement's own substitute selector (Tennessee Policy 2.103 I(4)(b)1: computer science
   * substitutes for "one (1) credit in mathematics, or one (1) credit in science").
   */
  substituteOnce?: true;
  /** One full credit may cover two half-credit requirements (TN Policy 3.103). */
  allowSplit?: boolean;
  /** Must be done (or planned) by the end of this grade. */
  deadlineGrade?: SchoolGrade;
  /**
   * Counts only when already finished: the planner never plans toward it or shows it as what to
   * do (Utah: a calculus class with a C finishes the math requirement, but Secondary Math I-III is
   * the route to plan).
   */
  onlyWhenDone?: true;
  /**
   * A counselor question for a class the student has that matches `select` but that this
   * requirement doesn't count as the source states it (Utah: ENGL 1010 counts for level 11 before
   * 2026-27 "or [for students] participating in an approved ENGL 1010 pilot"): asked whenever such
   * a class is on the student's record, since only the counselor knows the exception.
   */
  ask?: {
    select: Selector[];
    question: string;
    cite: CitationId[];
    /**
     * Such a class may meet the requirement, but only the counselor can say (Tennessee Policy
     * 3.103 III note 8: "JROTC III may substitute for one-half (½) credit of U.S. Government and
     * Civics and one-half (½) credit of Personal Finance if the JROTC instructor attends the
     * Personal Finance training"): while the student has `classes` of them (default 1; three
     * JROTC classes make JROTC III), a shortfall is the counselor's call, shown with `text`, never
     * a class to add or "Needs a plan now".
     */
    decides?: { classes?: number; text: string };
  };
};

/** At least `n` matching courses, whatever their credit (UT Opportunity: one AP/IB/CE math). */
export type CountReq = Leaf & { kind: "count"; n: number; select: Selector[] };

/** `levels` levels of one world language (reaching that rank on one language ladder). */
export type SameLanguageReq = Leaf & {
  kind: "same_language";
  levels: number;
  grades?: SchoolGrade[];
  /** Languages that don't count here. */
  exclude?: LanguageCode[];
  /**
   * A different language from the one this requirement counts (Texas Arts and Humanities: "two
   * levels of the same language ... and two levels of a different language", §74.13(f)(4)(C)).
   */
  differentFrom?: ReqId;
};

export type TotalCreditsReq = Leaf & { kind: "total_credits"; units: number; source: "state" | "school_guide" };

/** Whatever credit is left after the variant's other requirements. */
export type RemainingElectivesReq = Leaf & {
  kind: "remaining_electives";
  units: number;
  /**
   * Credits that expand a program a graduation option adds (Tennessee's waived world language and
   * fine arts credits "expand and enhance the elective focus", Policy 2.103 I(16)-(17)): the id of
   * that option's requirement. Where the option joins this rule set, these credits take classes of
   * that requirement's kind beyond the ones it counts; without it, they can't be counted
   * ("Ask your counselor"), never Done.
   */
  expands?: ReqId;
};

export type AllReq = ReqCommon & { kind: "all"; of: Req[]; cite?: CitationId[] };
export type AnyReq = ReqCommon & { kind: "any"; of: Req[]; cite?: CitationId[] };
/** `n` of the listed requirements (UT: 2 of 5 foundation science areas; TEXAS Grant: 2 of 4). */
export type ChooseReq = ReqCommon & { kind: "choose"; n: number; of: Req[]; cite?: CitationId[] };
/** `on` applies when the family chose the waiver or opt-out, `off` otherwise. */
export type OptionReq = ReqCommon & { kind: "option"; pref: OptionPref; on: Req; off: Req; cite: CitationId[] };

export type Req =
  | CreditsReq
  | CountReq
  | SameLanguageReq
  | TotalCreditsReq
  | RemainingElectivesReq
  | AllReq
  | AnyReq
  | ChooseReq
  | OptionReq;

export type ReqKind = Req["kind"];

// Checks, conditions, test routes -----------------------------------------------

/** Evaluated after credits are allocated (design §5.5). */
export type Check =
  /** Enrolled in the subject in at least `years` school years (TN: math in 3 years). */
  | { id: string; kind: "enrolled_years"; subject: CourseSubject; years: number; cite: CitationId[] }
  /**
   * By the end of `grade`, the plan shows requirement `req` (and `with`) done or planned, in any
   * grade: "on schedule" (TX DLA: by the end of 11th, the transcript shows the student "has
   * satisfied or is on schedule to satisfy" it, so Algebra II may still be planned for 12th).
   */
  | { id: string; kind: "on_schedule_by"; req: ReqId; with?: ReqId[]; grade: SchoolGrade; cite: CitationId[] }
  /** A full year of math in 12th grade unless the student records the competency (UT R277-700-9). */
  | { id: string; kind: "senior_year_math"; unlessChoice: "utMathCompetencyMet"; cite: CitationId[] }
  /** No graduation without an endorsement before the end of `grade`, and only with the parent's written permission (TX §74.11(f)). */
  | { id: string; kind: "no_endorsement_after"; grade: SchoolGrade; needs: "parent_written_permission"; cite: CitationId[] }
  /** This rule set only counts as met when one of these is met or planned (the DLA needs an endorsement). */
  | { id: string; kind: "requires_rule_set"; anyOf: RuleSetId[]; cite: CitationId[] }
  /**
   * Requirement `req` counts here only while another rule set's requirements aren't met (TX
   * §74.13(f)(7)(B): an engineering or IT program counts for Business and Industry only "if the
   * mathematics and science requirements for the STEM endorsement are not met"). `unless.groups`:
   * the other rule set's requirement ids, and the condition holds when every id in any one group
   * is met by the student's classes and suggestions.
   */
  | { id: string; kind: "counts_unless"; req: ReqId; unless: { ruleSet: RuleSetId; groups: ReqId[][] }; text: string; cite: CitationId[] };

export type CheckKind = Check["kind"];

export const CONDITION_KINDS = [
  "exam",
  "form",
  "test_participation",
  "civics_test",
  "attendance_discipline",
  "gpa",
  "test_score",
  "class_rank",
  "deadline",
  "portfolio_or_audition",
  "application",
  "other",
] as const;

/** A requirement that isn't a course. Shown as "We don't track this"; never evaluated. */
export type Condition = { id: string; label: string; kind: (typeof CONDITION_KINDS)[number]; cite: CitationId[] };

/**
 * A way to meet the rule set with a test score instead of a course (UT Austin calculus readiness;
 * Utah math competency; the THECB score for Texas automatic admission). Quoted, never converted
 * between tests, never evaluated: offered as the "test-score route" option.
 */
export type TestRoute = {
  id: string;
  text: string;
  cite: CitationId[];
  /**
   * When the score must be in, if the source sets a date ("received by December 10" of 12th grade).
   * Shown on the "by when" strip. Optional: most routes have no date.
   */
  by?: { grade: SchoolGrade; month: number; day: number };
  /**
   * The requirements (or checks) the score stands in for. Without it the route replaces the rule
   * set's whole course route (UT Austin calculus readiness); with it, it's offered only for those
   * (Utah's math competency replaces the senior-year math class, not the CTE credit).
   */
  reqIds?: string[];
};

// Variants and rule sets -------------------------------------------------------

export type Variant = {
  /** Permanent: "tx.fhsp.grad.2026". */
  id: string;
  /** Cohort range, inclusive, in the rule set's cohort key. Open-ended on either side. */
  cohort: { from?: number; to?: number };
  /** Another rule set's variant id whose requirements join this allocation (a TX endorsement joins the FHSP). */
  extends?: string;
  /**
   * exclusive: each unit of a course fills one requirement (graduation; TN Policy 3.103).
   * independent: each requirement is checked on its own, so a course can count toward several
   * (admission patterns).
   */
  allocation: "exclusive" | "independent";
  requirements: Req[];
  checks?: Check[];
  conditions?: Condition[];
  warnings?: { id: string; text: string; cite: CitationId[] }[];
  /** Never evaluated; shown once as "Ask your counselor". */
  unverified?: { id: string; text: string }[];
};

/** Texas endorsements (19 TAC §74.13). */
export const TX_ENDORSEMENTS = ["stem", "business_industry", "public_services", "arts_humanities", "multidisciplinary"] as const;
export type TxEndorsement = (typeof TX_ENDORSEMENTS)[number];

/** Tennessee elective focus areas (Policy 2.103). */
export const TN_ELECTIVE_FOCUSES = [
  "cte",
  "math_science",
  "humanities",
  "fine_arts",
  "ap_ib",
  "cambridge",
  "computer_science",
  "other_local",
] as const;
export type TnElectiveFocus = (typeof TN_ELECTIVE_FOCUSES)[number];

export const PATH_KINDS = ["degree", "training", "undecided"] as const;
/** degree: a 4-year college. training: community college, certificate, apprenticeship. */
export type PathKind = (typeof PATH_KINDS)[number];

/** A student choice a rule set depends on (engine-io.ts PlannerChoices holds the values). */
export type ChoiceGate =
  | { key: "txEndorsements"; value: TxEndorsement }
  | { key: "tnElectiveFocus"; value: TnElectiveFocus }
  | { key: "txAimDla"; value: boolean }
  | { key: "ctePathway"; value: CteCluster };

/**
 * When a rule set applies to a student. Every field present must hold; an empty gate means every
 * student in the state (state graduation, state aid).
 */
export type Gate = {
  choice?: ChoiceGate;
  paths?: PathKind[];
  /** A target college (UNITID) is one of these. */
  colleges?: number[];
  /** A target major family is one of these (program gates, major-specific admission). */
  families?: FamilyId[];
  /**
   * Or a target major's CIP code starts with one of these: a gate that names majors inside a
   * family (UT Austin's calculus readiness for "All majors in the Jackson School of Geosciences",
   * CIP 40.06, while other physical sciences route to the same family).
   */
  cips?: CipPrefix[];
  /**
   * The labeled default target when the college list has no in-state public college ("Texas: the
   * DLA plus what Texas A&M recommends"). Applies even without `colleges` matching.
   */
  stateDefault?: boolean;
};

export type RuleSet = {
  id: RuleSetId;
  state: PlannerState;
  kind: RuleSetKind;
  title: string;
  issuer: Issuer;
  /** Grade 9 reading level; used on /graduation/[state] and in "Why?". */
  plainSummary: string;
  strength: Strength;
  /** The source's own words that set the strength ("not required for admission but strongly encouraged"). */
  strengthCite: CitationId;
  confidence: Confidence;
  cohortKey: CohortKey;
  /** The last cohort the source publishes. Later cohorts use the latest variant, labeled Projected, never Done. */
  projectedBeyond?: number;
  /** Re-check by this date; after it, lines read "being re-checked" and nothing shows Done. */
  recheckBy?: IsoDate;
  appliesWhen: Gate;
  variants: Variant[];
  /** Offered as the test-score route; never evaluated. */
  testRoutes?: TestRoute[];
};

// Review ---------------------------------------------------------------------

export const REVIEW_STATUSES = ["draft", "counselor-reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Like the aid guide. For the proof of concept nothing is gated on review: "draft" content shows
 * to everyone labeled "Not yet reviewed by a school counselor". "counselor-reviewed" needs
 * reviewedBy, reviewedOn and the content fingerprint the reviewer saw.
 */
export type Review = {
  status: ReviewStatus;
  reviewedBy?: string;
  reviewedOn?: IsoDate;
  contentFingerprint?: string;
};

/** Fields every content file carries. */
export type ContentHeader = {
  schemaVersion: 1;
  /** "tx.graduation", "major-prep.families". Unique across content. */
  id: string;
  updated: IsoDate;
  /** Checked for this school year (2026 = 2026-27); stale once it ends (July 31 of the next year). */
  verifiedForSchoolYear: SchoolYear;
  review: Review;
  sources: Record<SourceKey, Source>;
  citations: Citation[];
};

export const RULE_FILE_KINDS = ["graduation", "options", "admissions", "aid"] as const;
export type RuleFileKind = (typeof RULE_FILE_KINDS)[number];

/** Which rule set kinds each file holds. */
export const RULE_FILE_HOLDS: Record<RuleFileKind, readonly RuleSetKind[]> = {
  graduation: ["state_graduation"],
  options: ["graduation_option"],
  admissions: ["college_admission", "program_admission", "guaranteed_admission"],
  aid: ["state_aid", "college_credit_program"],
};

export const INFO_CARD_TESTS = ["required", "optional", "not_required"] as const;

/**
 * Information shown beside rule sets and never evaluated: a college with no course pattern to
 * check (open admission, a GPA cutoff, holistic review), a college's test policy, or a scholarship
 * decided by GPA and test scores rather than classes (Tennessee HOPE). Admissions and aid files
 * only. Anything a source doesn't confirm is `confidence` "unverified" or "conflicting" and reads
 * as "Ask your counselor".
 */
export type InfoCard = {
  /** Unique across all content: "tn.card.etsu". */
  id: string;
  /** "East Tennessee State University", "HOPE Scholarship". */
  title: string;
  /** Plain words, grade 9 reading level. No promises ("you qualify"), no income questions. */
  text: string;
  /** The college the card is about (admissions files). */
  unitId?: number;
  /** A college's admission test policy, as its own page states it (cited). */
  tests?: (typeof INFO_CARD_TESTS)[number];
  confidence: Confidence;
  cite: CitationId[];
};

/** src/content/planner/{ut,tn,tx}/{graduation,options,admissions,aid}.json */
export type RuleFile = ContentHeader & {
  state: PlannerState;
  kind: RuleFileKind;
  /** May be empty when the file only holds information cards (Tennessee aid has no course parts). */
  ruleSets: RuleSet[];
  infoCards?: InfoCard[];
};
