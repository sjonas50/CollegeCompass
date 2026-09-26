import type { PlannerState, SchoolGrade } from "../common";
import { cohortValue } from "../cohort";
import type { FactsFile, GenericCatalogFile, MajorFamilyContent } from "../content-types";
import type { CourseTypeLevel } from "../course-types";
import {
  type CollegeTarget,
  type DemandPriority,
  type FamilyTarget,
  type PlannerChoices,
  type PlannerContent,
  type PlannerInput,
  type PlannerLimits,
  RIGOR_CUTOFFS,
  type RigorTier,
  RIGOR_TIERS,
  type StudentCohort,
} from "../engine-io";
import { type FamilyId, type MathTarget, getFamily } from "../families";
import { contentFingerprint, isStale } from "../review";
import type { Citation, ContentHeader, Gate, RuleFile, RuleSet, Source, SourceKey, Strength, Variant } from "../rules";
import type { Allocation } from "./allocate";
import { type CatalogRow, genericCatalogView, genericTitleFor, resolveCatalog, type ResolvedCatalog } from "./catalog";
import { type Alternative, compileVariant } from "./compile";
import { itemFromFact, type Item } from "./model";
import { gradeRange } from "./util";

// ---------------------------------------------------------------------------
// Context (design §5.3): which grades are planned, which class list each uses, which rule sets
// apply (gates, cohort variants, projected, stale), the major families, and the rigor tier.
// ---------------------------------------------------------------------------

export type RuleSetCtx = {
  rs: RuleSet;
  file: RuleFile;
  cohort: { key: RuleSet["cohortKey"]; value: number };
  variant: Variant | null;
  bases: { variant: Variant; rs: RuleSet }[];
  projected: boolean;
  stale: boolean;
  alternatives: Alternative[];
  allocation: Allocation;
  /** Applies through the labeled state default (no in-state public college on the list). */
  viaStateDefault: boolean;
  /** The DLA default target (owner decision), not a choice the student made. */
  viaDlaDefault: boolean;
};

export type FamilyCtx = {
  target: FamilyTarget;
  content: MajorFamilyContent | null;
  title: string;
  /** The math target for this student's path. */
  math: MathTarget[];
};

export type Ctx = {
  input: PlannerInput;
  state: PlannerState;
  content: PlannerContent;
  facts: FactsFile;
  generic: GenericCatalogFile;
  choices: PlannerChoices;
  limits: PlannerLimits;
  cohort: StudentCohort;
  grade: SchoolGrade;
  /** First grade the plan covers: the current grade during the school year, the next in June-July. */
  firstGrade: number;
  /** The school year in progress, if the plan includes it. */
  inProgressGrade: SchoolGrade | null;
  /** Grades with a plan year (firstGrade..12), never before 7. */
  planGrades: SchoolGrade[];
  catalogs: Map<SchoolGrade, ResolvedCatalog>;
  ruleSets: RuleSetCtx[];
  /** Every rule set in the state's content, by id, whether it applies or not. */
  allRuleSets: Map<string, { rs: RuleSet; file: RuleFile }>;
  families: FamilyCtx[];
  tier: { tier: RigorTier; why: string };
  items: Item[];
  dismissed: Set<string>;
  citations: Map<string, { citation: Citation; source: Source; key: SourceKey }>;
  fingerprints: Map<string, string>;
  /** Classes-per-year the state's list suggests when neither the student nor the school says. */
  defaultClassesPerYear: number;
  /**
   * The Texas endorsement this plan uses was picked by the planner (the student hasn't named one
   * and the two-plan choice doesn't apply): the audit says so instead of "You're planning with an
   * endorsement".
   */
  endorsementDefault?: string;
};

const FINGERPRINTS = new WeakMap<object, string>();

export function cachedFingerprint(file: ContentHeader): string {
  let fp = FINGERPRINTS.get(file);
  if (!fp) {
    fp = contentFingerprint(file);
    FINGERPRINTS.set(file, fp);
  }
  return fp;
}

/** The DLA defaults to true on the degree path (owner decision), and is ruled out by graduating without an endorsement. */
export function effectiveChoices(input: PlannerInput): { choices: PlannerChoices; dlaDefault: boolean } {
  const c = input.prefs.choices;
  const dlaDefault = input.state === "TX" && c.txAimDla === undefined && input.targets.path === "degree" && !c.txFoundationOnly;
  const txAimDla = c.txFoundationOnly ? false : (c.txAimDla ?? input.targets.path === "degree");
  return { choices: { ...c, txAimDla }, dlaDefault };
}

function inRange(value: number, range: Variant["cohort"]) {
  return (range.from === undefined || value >= range.from) && (range.to === undefined || value <= range.to);
}

/** The variant for a cohort; past `projectedBeyond`, the latest variant (labeled Projected). */
export function variantFor(rs: RuleSet, value: number): { variant: Variant | null; projected: boolean } {
  const projected = rs.projectedBeyond !== undefined && value > rs.projectedBeyond;
  const direct = rs.variants.find((v) => inRange(value, v.cohort));
  if (direct) return { variant: direct, projected };
  if (projected) {
    const latest = [...rs.variants].sort((a, b) => (b.cohort.from ?? -Infinity) - (a.cohort.from ?? -Infinity))[0];
    return { variant: latest ?? null, projected: true };
  }
  return { variant: null, projected: false };
}

function inStatePublic(colleges: CollegeTarget[], state: PlannerState): boolean {
  return colleges.some((c) => c.public && c.state === state);
}

/**
 * A target the gate names: its family, or its major's CIP code under one of the prefixes (a gate
 * that names majors inside a family: UT Austin's geosciences, CIP 40.06, among the physical sciences).
 */
function aimsAt(target: FamilyTarget, families: readonly FamilyId[] | undefined, cips: readonly string[] | undefined): boolean {
  if (families?.includes(target.familyId)) return true;
  const cip = target.cip6;
  return !!cip && !!cips?.some((prefix) => cip === prefix || cip.startsWith(`${prefix}${prefix.length === 2 ? "." : ""}`));
}

function gateApplies(gate: Gate, input: PlannerInput, choices: PlannerChoices, state: PlannerState): { applies: boolean; viaDefault: boolean } {
  const targets = input.targets;
  if (gate.paths && !gate.paths.includes(targets.path)) return { applies: false, viaDefault: false };
  if ((gate.families || gate.cips) && !targets.families.some((f) => aimsAt(f, gate.families, gate.cips))) return { applies: false, viaDefault: false };
  if (gate.choice) {
    const g = gate.choice;
    let ok: boolean;
    switch (g.key) {
      case "txEndorsements":
        ok = (choices.txEndorsements ?? []).includes(g.value) && !choices.txFoundationOnly;
        break;
      case "tnElectiveFocus":
        ok = choices.tnElectiveFocus === g.value;
        break;
      case "txAimDla":
        ok = (choices.txAimDla ?? false) === g.value;
        break;
      case "ctePathway":
        ok = choices.ctePathway?.cluster === g.value;
        break;
    }
    if (!ok) return { applies: false, viaDefault: false };
  }
  if (gate.colleges) {
    const listed = targets.colleges.some((c) => gate.colleges!.includes(c.unitId));
    if (listed) return { applies: true, viaDefault: false };
    // The labeled default target: only with no in-state public college on the list, and not on the training path.
    if (gate.stateDefault && !inStatePublic(targets.colleges, state) && targets.path !== "training") return { applies: true, viaDefault: true };
    return { applies: false, viaDefault: false };
  }
  if (gate.stateDefault) {
    const ok = !inStatePublic(targets.colleges, state) && targets.path !== "training";
    return { applies: ok, viaDefault: ok };
  }
  return { applies: true, viaDefault: false };
}

/**
 * `extends` names a variant of another rule set. The student gets that rule set's variant for their
 * own cohort (a Texas endorsement joins whichever Foundation variant applies to the student).
 */
function resolveBases(variant: Variant, all: Map<string, { rs: RuleSet; variant: Variant }>, cohort: StudentCohort, depth = 0): { variant: Variant; rs: RuleSet }[] {
  if (!variant.extends || depth > 4) return [];
  const named = all.get(variant.extends);
  if (!named) return [];
  const own = variantFor(named.rs, cohortValue(cohort, named.rs.cohortKey)).variant ?? named.variant;
  return [...resolveBases(own, all, cohort, depth + 1), { variant: own, rs: named.rs }];
}

/**
 * A published program gate that raises the rigor tier one step (major-prep/rigor.json `raises`): a
 * college on the list and a family the student is aiming at. Without that file (older fixtures),
 * a verified, required program rule set that applies does. Projected rules and recommendations
 * (a university's "encouraged" note, a list of minimum courses) never raise it.
 */
function programRaise(input: PlannerInput, ruleSets: RuleSetCtx[]): string | null {
  const rigor = input.content?.rigor;
  const colleges = new Set(input.targets.colleges.map((c) => c.unitId));
  if (rigor) {
    const raise = rigor.raises.find((r) => r.colleges.some((c) => colleges.has(c)) && input.targets.families.some((f) => aimsAt(f, r.families, r.cips)));
    return raise ? raise.text : null;
  }
  const gate = ruleSets.find((r) => r.rs.kind === "program_admission" && r.rs.strength === "required" && r.rs.confidence === "verified" && !r.projected);
  return gate ? `${gate.rs.issuer.name} has its own course requirements for a program you're aiming for.` : null;
}

function rigorTier(input: PlannerInput, raise: string | null): { tier: RigorTier; why: string } {
  const { path, colleges } = input.targets;
  if (path === "training") return { tier: "open", why: "You're planning for a certificate, apprenticeship or career training." };
  let tier: RigorTier;
  let why: string;
  if (colleges.length === 0) {
    tier = "admits_most";
    why = "No colleges on your list yet, so we plan a full college-prep core.";
  } else {
    const rates = colleges.map((c) => (c.openAdmission ? null : c.admissionRate));
    const known = rates.filter((r): r is number => r !== null);
    if (known.length === 0) {
      tier = "open";
      why = "The colleges on your list admit everyone who applies, or don't report an admission rate.";
    } else {
      const lowest = Math.min(...known);
      tier = lowest < RIGOR_CUTOFFS.admitsFewerThanHalf ? "very_selective" : lowest < RIGOR_CUTOFFS.admitsMost ? "admits_fewer_than_half" : "admits_most";
      const name = colleges.find((c) => !c.openAdmission && c.admissionRate === lowest)?.name ?? "a college on your list";
      why = `${name} is the most selective college on your list.`;
    }
  }
  if (raise && tier !== "very_selective") {
    tier = RIGOR_TIERS[RIGOR_TIERS.indexOf(tier) + 1];
    why += ` ${raise} So we plan one step higher.`;
  }
  return { tier, why };
}

function citationIndex(files: ContentHeader[]): Ctx["citations"] {
  const map: Ctx["citations"] = new Map();
  for (const file of files) {
    for (const c of file.citations) {
      const source = file.sources[c.source];
      if (source && !map.has(c.id)) map.set(c.id, { citation: c, source, key: c.source });
    }
  }
  return map;
}

export function familyMath(content: MajorFamilyContent | null, path: PlannerInput["targets"]["path"]): MathTarget[] {
  if (!content) return [];
  if (path === "training" && content.math.trainingTarget) return content.math.trainingTarget;
  return content.math.target;
}

export function buildContext(input: PlannerInput & { state: PlannerState; content: PlannerContent }): Ctx {
  const { choices, dlaDefault } = effectiveChoices(input);
  const content = input.content;
  const state = input.state;
  const grade = input.student.grade;
  const summer = input.asOf.month === 6 || input.asOf.month === 7;
  const firstGrade = summer ? grade + 1 : grade;
  const planGrades = gradeRange(firstGrade, 12);
  const genericView = genericCatalogView(content.genericCatalog);
  const genericTitle = genericTitleFor(content.genericCatalog, state);
  const catalogs = new Map<SchoolGrade, ResolvedCatalog>();
  const genericResolved = resolveCatalog(genericView, genericView, genericTitle);
  for (const g of gradeRange(Math.min(firstGrade, 9), 12)) {
    const view = input.catalogs[g];
    catalogs.set(g, view && view.state === state ? resolveCatalog(view, genericView, genericTitle) : genericResolved);
  }

  const variants = new Map<string, { rs: RuleSet; variant: Variant }>();
  const allRuleSets = new Map<string, { rs: RuleSet; file: RuleFile }>();
  for (const file of content.rules) {
    for (const rs of file.ruleSets) {
      allRuleSets.set(rs.id, { rs, file });
      for (const v of rs.variants) variants.set(v.id, { rs, variant: v });
    }
  }

  const cohort = input.student.cohort;
  const ruleSets: RuleSetCtx[] = [];
  for (const file of content.rules) {
    for (const rs of file.ruleSets) {
      if (rs.state !== state) continue;
      const gate = gateApplies(rs.appliesWhen, input, choices, state);
      if (!gate.applies) continue;
      const value = cohortValue(cohort, rs.cohortKey);
      const { variant, projected } = variantFor(rs, value);
      const bases = variant ? resolveBases(variant, variants, cohort) : [];
      const alternatives = variant
        ? compileVariant(
            variant,
            { strength: rs.strength, strengthCite: rs.strengthCite },
            bases.map((b) => ({ variant: b.variant, rs: { strength: b.rs.strength, strengthCite: b.rs.strengthCite } })),
            choices,
          )
        : [];
      ruleSets.push({
        rs,
        file,
        cohort: { key: rs.cohortKey, value },
        variant,
        bases,
        projected,
        stale: isStale(input.asOf.today, file.verifiedForSchoolYear, rs.recheckBy),
        alternatives,
        allocation: variant?.allocation ?? "exclusive",
        viaStateDefault: gate.viaDefault,
        viaDlaDefault: dlaDefault && rs.appliesWhen.choice?.key === "txAimDla",
      });
    }
  }
  // A confirmed "your school's guide says" total becomes its own requirement (design §3.1).
  const local = localGraduation(input, state, catalogs, planGrades);
  if (local) ruleSets.unshift(local);

  const families: FamilyCtx[] = input.targets.families.map((target) => {
    const fc = content.families?.families.find((f) => f.id === target.familyId) ?? null;
    return { target, content: fc, title: getFamily(target.familyId).title, math: familyMath(fc, input.targets.path) };
  });

  const raise = programRaise(input, ruleSets);
  const files: ContentHeader[] = [...content.rules, content.genericCatalog, content.facts, ...(content.families ? [content.families] : [])];
  const fingerprints = new Map<string, string>(files.map((f) => [f.id, cachedFingerprint(f)]));
  const items = input.courses.map(itemFromFact);

  return {
    input,
    state,
    content,
    facts: content.facts,
    generic: content.genericCatalog,
    choices,
    limits: input.prefs.limits,
    cohort,
    grade,
    firstGrade,
    inProgressGrade: summer ? null : grade,
    planGrades,
    catalogs,
    ruleSets,
    allRuleSets,
    families,
    tier: rigorTier(input, raise),
    items,
    dismissed: new Set(input.prefs.dismissed),
    citations: citationIndex(files),
    fingerprints,
    defaultClassesPerYear: content.genericCatalog.classesPerYear,
  };
}

/** Rule set for a confirmed local graduation total (never authored; built from the school's list). */
function localGraduation(input: PlannerInput, state: PlannerState, catalogs: Map<SchoolGrade, ResolvedCatalog>, planGrades: SchoolGrade[]): RuleSetCtx | null {
  const totals = planGrades.map((g) => catalogs.get(g)?.view.localTotalUnits ?? null).filter((t): t is number => t !== null);
  if (totals.length === 0) return null;
  const units = Math.max(...totals);
  const rs: RuleSet = {
    id: `local.${state.toLowerCase()}.total`,
    state,
    kind: "local_graduation",
    title: "Your school's graduation total",
    issuer: { kind: "state", name: "your school's guide" },
    plainSummary: "Your school's course guide lists the total credits it asks for.",
    strength: "required",
    strengthCite: "",
    confidence: "verified",
    cohortKey: "class_year",
    appliesWhen: {},
    variants: [
      {
        id: `local.${state.toLowerCase()}.total.v`,
        cohort: {},
        allocation: "exclusive",
        requirements: [{ id: "total", label: "Total credits your school's guide lists", kind: "total_credits", units, source: "school_guide", cite: [] }],
      },
    ],
  };
  const file: RuleFile = {
    schemaVersion: 1,
    id: "local-guide",
    updated: input.asOf.today,
    verifiedForSchoolYear: input.asOf.schoolYear,
    review: { status: "draft" },
    sources: {},
    citations: [],
    state,
    kind: "graduation",
    ruleSets: [rs],
  };
  return {
    rs,
    file,
    cohort: { key: "class_year", value: input.student.cohort.classYear },
    variant: rs.variants[0],
    bases: [],
    projected: false,
    stale: false,
    alternatives: compileVariant(rs.variants[0], { strength: "required", strengthCite: "" }, [], {}),
    allocation: "exclusive",
    viaStateDefault: false,
    viaDlaDefault: false,
  };
}

/** Priority of a requirement's demand (design §5.6), or null when it never becomes a demand. */
export function leafPriority(rc: RuleSetCtx, strength: Strength): DemandPriority | null {
  // "info" is context only; "priority" (TEXAS Grant) is shown as information, never pushed.
  if (strength === "info" || strength === "priority") return null;
  // An aid rule not yet published for this class can't be planned toward (design UT-1: "never on track").
  if (rc.rs.kind === "state_aid" && rc.projected) return null;
  let p: DemandPriority | null;
  switch (rc.rs.kind) {
    case "state_graduation":
    case "local_graduation":
      p = strength === "required" ? 0 : 2;
      break;
    case "graduation_option": {
      const key = rc.rs.appliesWhen.choice?.key;
      const base: DemandPriority = key === "txAimDla" ? 1 : key === "ctePathway" ? 3 : 0;
      p = strength === "required" ? base : 2;
      break;
    }
    case "college_admission":
    case "program_admission":
    case "guaranteed_admission":
      p = strength === "required" ? 1 : 2;
      break;
    case "state_aid":
      p = 3;
      break;
    default:
      p = null;
  }
  if (p !== null && rc.rs.confidence !== "verified" && p < 2) p = 2;
  return p;
}

export function rowIsOffered(row: CatalogRow, grade: SchoolGrade, schoolYear: number): boolean {
  if (!row.gradesAllowed.includes(grade)) return false;
  if (row.firstSchoolYear !== null && schoolYear < row.firstSchoolYear) return false;
  return true;
}

export function schoolYearOfGrade(ctx: Pick<Ctx, "cohort">, grade: number): number {
  return ctx.cohort.grade9EntryYear + (grade - 9);
}

export function levelOrder(level: CourseTypeLevel): number {
  return ["regular", "honors", "ap", "ib", "cambridge", "dual_enrollment"].indexOf(level);
}
