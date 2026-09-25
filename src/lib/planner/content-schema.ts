import { z } from "zod";
import { COURSE_SUBJECTS, LETTER_GRADES } from "@/lib/courses/catalog";
import { PLANNER_STATES, SCHOOL_GRADES } from "./common";
import type { CipRoutingFile, FactsFile, GenericCatalogFile, MajorFamiliesFile } from "./content-types";
import { GAP_OPTION_KINDS } from "./content-types";
import {
  CAPABILITIES,
  COURSE_TYPE_IDS,
  COURSE_TYPE_LEVELS,
  type CourseTypeId,
  CTE_CLUSTERS,
  LANGUAGES,
} from "./course-types";
import { CIP_PREFIX, FAMILY_IDS, MATH_TARGETS } from "./families";
import {
  CONDITION_KINDS,
  COHORT_KEYS,
  CONFIDENCES,
  ISSUER_KINDS,
  OPTION_PREFS,
  PATH_KINDS,
  REQ_AREAS,
  REVIEW_STATUSES,
  type Req,
  RULE_FILE_KINDS,
  RULE_SET_KINDS,
  type RuleFile,
  SOURCE_KINDS,
  STRENGTHS,
  TN_ELECTIVE_FOCUSES,
  TX_ENDORSEMENTS,
} from "./rules";

// ---------------------------------------------------------------------------
// JSON schemas for the planner's content files. Each schema's output type is exactly the
// hand-written type in rules.ts / content-types.ts (content-schema.test.ts pins that), so the
// engine reads parsed content with no casts. Field-level rules live here; rules that need the
// whole file or several files (ids resolve, cohorts don't overlap, 256 alternatives) are in
// validate.ts.
// ---------------------------------------------------------------------------

export const QUOTE_MAX = 300;
export const LABEL_MAX = 120;
export const TEXT_MAX = 600;

const LINE_BREAK = /[\r\n\v\f\u2028\u2029]/;
const MARKUP = /<\/?[a-z][^>]*>|\]\(|\*\*/i;

/** One line of plain text: trimmed, not empty, no line breaks, no HTML or Markdown. */
function plain(max: number) {
  return z
    .string()
    .trim()
    .min(1, "Can't be empty.")
    .max(max, { error: (issue) => `Keep this to ${max} characters or fewer. It has ${String(issue.input).length}.` })
    .refine((s) => !LINE_BREAK.test(s), "No line breaks.")
    .refine((s) => !MARKUP.test(s), "Plain text only: no HTML or Markdown.");
}

const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Ids use lowercase letters, digits, dots, dashes and underscores, like \"tx.fhsp.grad\".");
const SourceKeySchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]*$/, "Source keys look like \"TX-S1\".");
const IsoDate = z.iso.date({ error: "Use a real date written YYYY-MM-DD, like 2026-10-01." });
const Year = z.number().int().min(2000).max(2100);
const Units = z.number().int("Units are quarter credits: a whole number (4 = 1 credit).").positive().max(400);
const Grade = z.literal(SCHOOL_GRADES);
const CiteList = z.array(Id).min(1, "Cite at least one source quote.");

export const CourseTypeIdSchema = z.enum(COURSE_TYPE_IDS as [CourseTypeId, ...CourseTypeId[]], {
  error: (issue) => `Unknown course type ${JSON.stringify(issue.input)}. Use an id from src/lib/planner/course-types.ts.`,
});
const LevelSchema = z.enum(COURSE_TYPE_LEVELS);
const Subject = z.enum(COURSE_SUBJECTS);
const State = z.enum(PLANNER_STATES);
const FamilyIdSchema = z.enum(FAMILY_IDS);

// Header ---------------------------------------------------------------------

const FINGERPRINT = /^[0-9a-f]{16}$/;

export const ReviewSchema = z
  .strictObject({
    status: z.enum(REVIEW_STATUSES),
    reviewedBy: plain(LABEL_MAX).optional(),
    reviewedOn: IsoDate.optional(),
    contentFingerprint: z.string().regex(FINGERPRINT, "16 lowercase letters and digits, as the check gives it.").optional(),
  })
  .superRefine((review, ctx) => {
    if (review.status !== "counselor-reviewed") return;
    if (!review.reviewedBy) ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "Say who reviewed it." });
    if (!review.reviewedOn) ctx.addIssue({ code: "custom", path: ["reviewedOn"], message: "Say when it was reviewed." });
    if (!review.contentFingerprint) {
      ctx.addIssue({ code: "custom", path: ["contentFingerprint"], message: "Record the fingerprint the reviewer saw." });
    }
  });

const SourceSchema = z.strictObject({
  title: plain(200),
  url: z.url({ protocol: /^https$/, error: "Use a full https:// address." }),
  publisher: plain(LABEL_MAX),
  kind: z.enum(SOURCE_KINDS),
  checkedOn: IsoDate,
});

const CitationSchema = z.strictObject({
  id: Id,
  source: SourceKeySchema,
  pinpoint: plain(80).optional(),
  quote: plain(QUOTE_MAX),
});

const header = {
  schemaVersion: z.literal(1),
  id: Id,
  updated: IsoDate,
  verifiedForSchoolYear: Year,
  review: ReviewSchema,
  sources: z.record(SourceKeySchema, SourceSchema),
  citations: z.array(CitationSchema),
};

// Selectors and requirements ------------------------------------------------------

export const SelectorSchema = z
  .strictObject({
    types: z.array(CourseTypeIdSchema).min(1).optional(),
    capabilities: z.array(z.enum(CAPABILITIES)).min(1).optional(),
    subjects: z.array(Subject).min(1).optional(),
    levels: z.array(LevelSchema).min(1).optional(),
    grades: z.array(Grade).min(1).optional(),
    schoolYears: z.strictObject({ from: Year.optional(), to: Year.optional() }).optional(),
    minLetter: z.enum(LETTER_GRADES).optional(),
    cte: z.boolean().optional(),
    lab: z.literal(true).optional(),
    exclude: z.array(CourseTypeIdSchema).min(1).optional(),
  })
  .refine(
    (s) => Object.keys(s).some((k) => k !== "exclude"),
    "A selector needs something to match on (types, capabilities, subjects, levels, grades …); an empty one would match every class.",
  );

const Strength = z.enum(STRENGTHS);

const reqCommon = {
  id: Id,
  label: plain(LABEL_MAX),
  strength: Strength.optional(),
  strengthCite: Id.optional(),
  area: z.enum(REQ_AREAS).optional(),
  note: plain(TEXT_MAX).optional(),
};
const leaf = { ...reqCommon, cite: CiteList };

export const ReqSchema: z.ZodType<Req> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      ...leaf,
      kind: z.literal("credits"),
      units: Units,
      select: z.array(SelectorSchema).min(1),
      shareable: z.boolean().optional(),
      substitutesForOneOf: z.array(Id).min(1).optional(),
      allowSplit: z.boolean().optional(),
      deadlineGrade: Grade.optional(),
    }),
    z.strictObject({ ...leaf, kind: z.literal("count"), n: z.number().int().positive(), select: z.array(SelectorSchema).min(1) }),
    z.strictObject({
      ...leaf,
      kind: z.literal("same_language"),
      levels: z.number().int().min(1).max(4),
      grades: z.array(Grade).min(1).optional(),
      exclude: z.array(z.enum(LANGUAGES)).min(1).optional(),
    }),
    z.strictObject({ ...leaf, kind: z.literal("total_credits"), units: Units, source: z.enum(["state", "school_guide"]) }),
    z.strictObject({ ...leaf, kind: z.literal("remaining_electives"), units: Units }),
    z.strictObject({ ...reqCommon, kind: z.literal("all"), of: z.array(ReqSchema).min(1), cite: CiteList.optional() }),
    z.strictObject({ ...reqCommon, kind: z.literal("any"), of: z.array(ReqSchema).min(2), cite: CiteList.optional() }),
    z.strictObject({
      ...reqCommon,
      kind: z.literal("choose"),
      n: z.number().int().positive(),
      of: z.array(ReqSchema).min(2),
      cite: CiteList.optional(),
    }),
    z.strictObject({ ...reqCommon, kind: z.literal("option"), pref: z.enum(OPTION_PREFS), on: ReqSchema, off: ReqSchema, cite: CiteList }),
  ]),
);

const CheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ id: Id, kind: z.literal("enrolled_years"), subject: Subject, years: z.number().int().min(1).max(6), cite: CiteList }),
  z.strictObject({ id: Id, kind: z.literal("on_schedule_by"), req: Id, grade: Grade, cite: CiteList }),
  z.strictObject({ id: Id, kind: z.literal("senior_year_math"), unlessChoice: z.literal("utMathCompetencyMet"), cite: CiteList }),
  z.strictObject({
    id: Id,
    kind: z.literal("no_endorsement_after"),
    grade: Grade,
    needs: z.literal("parent_written_permission"),
    cite: CiteList,
  }),
  z.strictObject({ id: Id, kind: z.literal("requires_rule_set"), anyOf: z.array(Id).min(1), cite: CiteList }),
]);

const ConditionSchema = z.strictObject({ id: Id, label: plain(LABEL_MAX), kind: z.enum(CONDITION_KINDS), cite: CiteList });

const VariantSchema = z.strictObject({
  id: Id,
  cohort: z.strictObject({ from: Year.optional(), to: Year.optional() }),
  extends: Id.optional(),
  allocation: z.enum(["exclusive", "independent"]),
  requirements: z.array(ReqSchema).min(1),
  checks: z.array(CheckSchema).optional(),
  conditions: z.array(ConditionSchema).optional(),
  warnings: z.array(z.strictObject({ id: Id, text: plain(TEXT_MAX), cite: CiteList })).optional(),
  unverified: z.array(z.strictObject({ id: Id, text: plain(TEXT_MAX) })).optional(),
});

const ChoiceGateSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("txEndorsements"), value: z.enum(TX_ENDORSEMENTS) }),
  z.strictObject({ key: z.literal("tnElectiveFocus"), value: z.enum(TN_ELECTIVE_FOCUSES) }),
  z.strictObject({ key: z.literal("txAimDla"), value: z.boolean() }),
  z.strictObject({ key: z.literal("ctePathway"), value: z.enum(CTE_CLUSTERS) }),
]);

const UnitId = z.number().int().positive();

const GateSchema = z.strictObject({
  choice: ChoiceGateSchema.optional(),
  paths: z.array(z.enum(PATH_KINDS)).min(1).optional(),
  colleges: z.array(UnitId).min(1).optional(),
  families: z.array(FamilyIdSchema).min(1).optional(),
  stateDefault: z.boolean().optional(),
});

const RuleSetSchema = z.strictObject({
  id: Id,
  state: State,
  kind: z.enum(RULE_SET_KINDS),
  title: plain(LABEL_MAX),
  issuer: z.strictObject({ kind: z.enum(ISSUER_KINDS), name: plain(LABEL_MAX) }),
  plainSummary: plain(TEXT_MAX),
  strength: Strength,
  strengthCite: Id,
  confidence: z.enum(CONFIDENCES),
  cohortKey: z.enum(COHORT_KEYS),
  projectedBeyond: Year.optional(),
  recheckBy: IsoDate.optional(),
  appliesWhen: GateSchema,
  variants: z.array(VariantSchema).min(1),
  testRoutes: z.array(z.strictObject({ id: Id, text: plain(TEXT_MAX), cite: CiteList })).optional(),
});

export const RuleFileSchema = z.strictObject({
  ...header,
  state: State,
  kind: z.enum(RULE_FILE_KINDS),
  ruleSets: z.array(RuleSetSchema).min(1),
});

// Other content files ---------------------------------------------------------------

export const GenericCatalogFileSchema = z.strictObject({
  ...header,
  state: State,
  title: plain(LABEL_MAX),
  classesPerYear: z.number().int().min(4).max(10),
  courses: z
    .array(
      z.strictObject({
        typeId: CourseTypeIdSchema,
        levels: z.array(LevelSchema).min(1),
        units: Units.optional(),
        grades: z.array(Grade).min(1).optional(),
        firstSchoolYear: Year.optional(),
        cite: CiteList.optional(),
      }),
    )
    .min(1),
});

export const FactsFileSchema = z.strictObject({
  ...header,
  state: State,
  minUnitsPerYear: Units.optional(),
  options: z.array(
    z.strictObject({
      kind: z.enum(GAP_OPTION_KINDS).exclude(["test_score", "lower_target", "ask_counselor"]),
      programName: plain(LABEL_MAX).optional(),
      grades: z.array(Grade).min(1).optional(),
      types: z.array(CourseTypeIdSchema).min(1).optional(),
      note: plain(TEXT_MAX),
      cite: CiteList,
    }),
  ),
  middleSchoolMath: z.array(z.strictObject({ text: plain(TEXT_MAX), cite: CiteList })),
});

const MathTargetList = z.array(z.enum(MATH_TARGETS)).min(1).max(2);

export const MajorFamiliesFileSchema = z.strictObject({
  ...header,
  families: z.array(
    z.strictObject({
      id: FamilyIdSchema,
      summary: plain(TEXT_MAX),
      path: z.enum([...PATH_KINDS, "both"]),
      math: z.strictObject({
        target: MathTargetList,
        orTarget: MathTargetList.optional(),
        trainingTarget: MathTargetList.optional(),
        note: plain(TEXT_MAX).optional(),
        cite: CiteList,
      }),
      sciences: z.array(CourseTypeIdSchema),
      keyCourses: z.array(CourseTypeIdSchema),
      rigorFirst: z.array(CourseTypeIdSchema).max(3, "Three \"rigor first\" subjects at most."),
      ctePathways: z.array(z.strictObject({ state: State, cluster: z.enum(CTE_CLUSTERS), name: plain(LABEL_MAX), cite: CiteList })),
      gates: z.array(
        z.strictObject({
          id: Id,
          text: plain(TEXT_MAX),
          evidence: z.enum(["A", "B", "C", "D"]),
          colleges: z.array(UnitId).min(1).optional(),
          ruleSetId: Id.optional(),
          cite: CiteList,
        }),
      ),
      cautions: z.array(z.strictObject({ id: Id, text: plain(TEXT_MAX), cite: CiteList })),
    }),
  ),
});

export const CipRoutingFileSchema = z.strictObject({
  ...header,
  rules: z
    .array(
      z.strictObject({
        match: z.array(z.string().regex(CIP_PREFIX, "A CIP prefix looks like \"51\", \"51.38\" or \"51.3801\".")).min(1),
        family: FamilyIdSchema,
        note: plain(TEXT_MAX).optional(),
      }),
    )
    .min(1),
});

// Parsing -------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/** "tx/graduation.json ruleSets.0.variants.1.requirements.2.units: Units are quarter credits …" */
export function formatIssues(error: z.ZodError, label: string): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${label}${path ? ` ${path}` : ""}: ${issue.message}`;
  });
}

function parser<T>(schema: z.ZodType<T>) {
  return (raw: unknown, label: string): ParseResult<T> => {
    const result = schema.safeParse(raw);
    return result.success ? { ok: true, value: result.data } : { ok: false, issues: formatIssues(result.error, label) };
  };
}

export const parseRuleFile = parser<RuleFile>(RuleFileSchema);
export const parseGenericCatalogFile = parser<GenericCatalogFile>(GenericCatalogFileSchema);
export const parseFactsFile = parser<FactsFile>(FactsFileSchema);
export const parseMajorFamiliesFile = parser<MajorFamiliesFile>(MajorFamiliesFileSchema);
export const parseCipRoutingFile = parser<CipRoutingFile>(CipRoutingFileSchema);
