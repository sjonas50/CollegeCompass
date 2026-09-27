import type { CourseSubject, CourseTerm } from "@/db/schema";
import { type SchoolGrade, UNITS_PER_CREDIT } from "../common";
import {
  courseTypeTitle,
  type CourseTypeId,
  type CourseTypeLevel,
  type CteCluster,
  getCourseType,
  isCollegeLevel,
  type LadderId,
  ladderTypes,
  LANGUAGE_NAMES,
  LANGUAGES,
  type LanguageCode,
} from "../course-types";
import { type DemandPriority, type Reason, suggestionKey } from "../engine-io";
import { MATH_TARGET_DEFS } from "../families";
import { advancedOnly, type AltResult, evaluateAlternative, languageLevelsFilled, leafAccepts, pickAlternative, type PickOptions } from "./allocate";
import { earlyWithoutCredit, evaluateCheck, evaluateRuleSet, type RuleSetEval } from "./audit";
import type { CatalogRow } from "./catalog";
import { type Alternative, type CLeaf, leafSignature } from "./compile";
import { type Ctx, type FamilyCtx, leafPriority, levelOrder, rowIsOffered, type RuleSetCtx, schoolYearOfGrade } from "./context";
import { mightAlreadyBe, waitingForSelectors, waitingKinds } from "./confirm";
import { reason, seniorMathReason } from "./explain";
import { MinCostFlow } from "./flow";
import {
  ladderFamily,
  type LadderConstraint,
  type LadderFamily,
  type LadderProblem,
  type LadderSolution,
  mathRankOf,
  rungName,
  rungTypes,
  solveLadder,
  startRank,
  unresolvedFailedRank,
} from "./ladder";
import { asPlanned, countsForSequence, type Item, itemFromSuggestion, slotHalves } from "./model";
import { evaluatePrep, familyNeeds, isLadderish, type Need, needsFromEval, needUnits, testRoutesFor } from "./needs";
import { matchesAny } from "./select";
import { atLeast, lowerFirstWord, nth } from "./util";

// ---------------------------------------------------------------------------
// Fill, repair and rigor (design §5.7). From the needs, in order: the math ladder, English each
// year, world language as consecutive years of one language, a CTE pathway in order, then P0 to
// P3 into the earliest year with room that respects the list's grades, prerequisites, the load
// cap and the "Your choice" slot. Over-full years move the lowest-priority suggestion; required
// (P0) classes get an exact placement check. Rigor only changes levels, never adds a class.
//
// Invariants: the student's rows are never moved or removed; capacity is never exceeded by a
// suggestion; no suggestion takes a year past the college-level cap; nothing is suggested in
// grades 7-8; no rigor changes in grade 12; acceleration only with an opt-in and a B or better.
// ---------------------------------------------------------------------------

export type PlanConfig = {
  id: "A" | "B";
  ruleSets: RuleSetCtx[];
  /** Families planned around (the rest are "also check"). */
  families: FamilyCtx[];
  /** Allow doubling up and summer math (Plan B "math route" only). */
  accelerate: boolean;
  /** Place a CTE pathway before a third language year (language_vs_cte Plan B). */
  cteFirst: boolean;
};

export type PlacementKind = "ladder" | "english" | "language" | "cte" | "fill";

export type Placement = {
  n: number;
  item: Item;
  row: CatalogRow;
  kind: PlacementKind;
  /** The need it was placed for (the key's "for what"). */
  primary: Need | null;
  priority: DemandPriority;
  baseKey: string;
  key: string;
  extraReasons: Reason[];
  needsPlanNow: boolean;
  /** The level before a rigor change. */
  upgradedFrom: CourseTypeLevel | null;
};

export type BlockReason = "not_offered" | "doesnt_fit" | "past" | "load" | "guessed" | "dismissed" | "choice" | "equivalent" | "ask" | "hs_credit";

export type YearState = {
  grade: SchoolGrade;
  schoolYear: number;
  capHalves: number;
  used: number;
  college: number;
  /** Grades 9-11, future years: keep one class free for "Your choice" (P2 and below can't use it). */
  reserve: boolean;
  inProgress: boolean;
};

export type FillResult = {
  config: PlanConfig;
  items: Item[];
  placements: Placement[];
  years: Map<SchoolGrade, YearState>;
  needs: Need[];
  baselineNeeds: Need[];
  blocked: Map<string, BlockReason>;
  evals: RuleSetEval[];
  ladder: {
    family: LadderFamily;
    problem: LadderProblem | null;
    solution: LadderSolution | null;
    constraints: LadderConstraint[];
    /** Including grades 7-8, for middle school deadlines. */
    fullSolution: LadderSolution | null;
    /** Constraints the solution meets only through a top rung that wasn't placed (never "kept open"). */
    skipped: ReadonlySet<string>;
  };
  chosen: Map<string, number>;
  /** Why each need still unmet after the fill is unmet. */
  unmet: Map<string, BlockReason>;
  /**
   * What each P0-P3 need would still miss, by need id, with one of the plan's classes replaced by
   * another (on each rule set's audit route, with the checks and major-prep targets): the gaps'
   * swap hint names a swap only when this says it works. Without a swap, as planned.
   */
  missingWith: (swap?: { out: Item; in: Item }) => Map<string, { missing: number; priority: DemandPriority }>;
  /** Needs whose only classes on the list are pathway levels the student is past (the next level isn't listed). */
  pastLevelsOnly: (need: Need) => boolean;
  /**
   * A class for this need would fit in the year in progress (room, prerequisites, one math class a
   * year, the load cap), where the planner adds only required credits: its gap asks about adding
   * it now rather than saying it doesn't fit.
   */
  fitsThisYear: (need: Need) => boolean;
};

const WEIGHT: Record<number, number> = { 0: 1_000_000, 1: 10_000, 2: 100, 3: 1 };

/** Route preference: a missing requirement on the goal's career pathway, above any number of overlaps. */
const PATHWAY_WEIGHT = 100;

/** How many of a route's missing requirements name one of these classes. */
function missingNaming(types: ReadonlySet<CourseTypeId>): (r: AltResult) => number {
  return (r) => {
    let score = 0;
    for (const l of r.leaves) {
      if (l.missing <= 0 || (l.leaf.req.kind !== "credits" && l.leaf.req.kind !== "count")) continue;
      if (l.leaf.req.select.some((s) => s.types?.some((t) => types.has(t)))) score++;
    }
    return score;
  };
}

/**
 * A requirement a row the student hasn't confirmed might meet (engine/confirm.ts): no class is
 * added for it, since the row might be that class. Major prep isn't held: its classes are College
 * Compass suggestions, never "Required by", and the plan's guesses already keep them from repeating
 * a class the student probably has.
 */
function held(n: Need): boolean {
  return n.waiting === true && (n.source === "rule" || n.source === "check");
}

/**
 * Concurrent enrollment math classes that meet the college quantitative literacy requirement (Math
 * 1030, 1040, 1050) or come after it: a C in one may show Utah's college-ready math.
 */
const QUANTITATIVE_LITERACY: readonly CourseTypeId[] = ["math.adv_quant", "math.stats", "math.college_alg", "math.trig", "math.precalc", "math.calc", "math.calc2"];

/**
 * The row a held need waits on, as the kind that would meet it, would also count for this need (a
 * typed "U.S. History" read as U.S. Government, as U.S. History, is also part of Tennessee's rest of
 * the social studies credits; "math in three years" next to a held math class). Only the kinds the
 * row might be: a typed math class held for Utah's applied math list says nothing about the
 * computer science classes the same list names.
 */
function overlapsHeld(need: Need, holding: readonly Need[]): boolean {
  for (const h of holding) {
    if (h === need) continue;
    for (const t of h.waitingKinds ?? []) {
      const type = getCourseType(t);
      const kind = itemFromSuggestion({
        n: -1,
        key: "overlap",
        typeId: t,
        level: "regular",
        grade: Math.max(9, Math.min(12, need.byGrade)) as SchoolGrade,
        schoolYear: 0,
        term: "full_year",
        units: type.units,
        cte: type.cte === "always",
        lectureOnly: false,
      });
      if (matchesAny(kind, need.selectors)) return true;
    }
  }
  return false;
}

/** Lab sciences whose AP, IB and college versions normally come after a first year of the class. */
const FIRST_YEAR_SCIENCES: readonly CourseTypeId[] = ["sci.bio", "sci.chem"];

/**
 * Classes whose AP or IB version normally follows a year of the class (Art I and II before AP Art
 * and Design; band, choir or a music class before AP Music Theory): a student's first one stays
 * regular or honors, and an AP or IB focus's credit comes from another class.
 */
const AFTER_A_FIRST_YEAR: readonly CourseTypeId[] = ["arts.visual", "arts.music_theory"];

/** A first-year class of its kind that shouldn't be AP, IB or college-level (see above). */
function firstOfItsKind(items: readonly Item[], p: { item: Item; row: CatalogRow }): boolean {
  if (FIRST_YEAR_SCIENCES.includes(p.row.typeId)) return true;
  if (!AFTER_A_FIRST_YEAR.includes(p.row.typeId)) return false;
  const background = [p.row.typeId, ...getCourseType(p.row.typeId).usuallyAfter];
  return !items.some((i) => i !== p.item && i.grade < p.item.grade && countsForSequence(i) && background.includes(i.typeId));
}

export function isRepeatable(typeId: CourseTypeId): boolean {
  const t = getCourseType(typeId);
  if (t.fallback) return true;
  // A career pathway's levels go in order (level 1, then 2, then 3): never the same level twice.
  if (t.ladder?.id.startsWith("cte.")) return false;
  if (/^(pe|arts|other|cte|health)\./.test(typeId)) return true;
  return ["ela.journalism", "ela.debate", "ela.speech", "ela.creative_writing"].includes(typeId);
}

/** The same class, or classes that teach the same content (course-types `overlaps`). */
export function sameContent(a: CourseTypeId, b: CourseTypeId): boolean {
  return a === b || getCourseType(a).overlaps.includes(b);
}

/**
 * An introductory class the student is already past: they have (or the plan has) a class it
 * introduces in this grade or before (Exploring Computer Science after Coding I or AP Computer
 * Science A). Never suggested.
 */
export function pastIntro(items: readonly Item[], typeId: CourseTypeId, grade: number): boolean {
  const next = getCourseType(typeId).introTo;
  return next.length > 0 && items.some((i) => i.grade <= grade && countsForSequence(i) && next.includes(i.typeId));
}

/**
 * A class the student took and didn't pass (F, W or I), hasn't passed since, and that would count
 * for these requirements: what they'd retake.
 */
export function failedAttempt(items: readonly Item[], sels: Need["selectors"]): Item | null {
  // A guessed kind counts as that kind here, as for a student who picked it (asPlanned).
  return items.find((i) => i.own && i.noCredit && matchesAny({ ...i, assumed: false }, sels) && !items.some((j) => j.typeId === i.typeId && countsForSequence(j))) ?? null;
}

/** An English level (English I-IV) outside its own grade: only as a retake of one the student didn't pass. */
export function lateEnglish(items: readonly Item[], typeId: CourseTypeId, grade: number): boolean {
  const t = getCourseType(typeId);
  if (t.ladder?.id !== "ela" || grade <= t.grades[1]) return false;
  return !items.some((i) => i.own && i.noCredit && i.typeId === typeId);
}

export function probe(row: CatalogRow, grade: SchoolGrade, schoolYear: number, term?: CourseTerm): Item {
  return itemFromSuggestion({
    n: -1,
    key: "probe",
    typeId: row.typeId,
    level: row.level,
    grade,
    schoolYear,
    term: term ?? row.defaultTerm,
    units: row.units,
    cte: row.cte,
    lectureOnly: row.lectureOnly,
  });
}

export class Filler {
  readonly items: Item[];
  readonly placements: Placement[] = [];
  readonly years = new Map<SchoolGrade, YearState>();
  needs: Need[] = [];
  baselineNeeds: Need[] = [];
  readonly blocked = new Map<string, BlockReason>();
  private readonly chosen = new Map<string, number>();
  private readonly current = new Map<string, AltResult>();
  /** Requirements whose routes the plan doesn't take: the reroute's programs and those no class can meet (trySwitch). */
  private readonly excluded = new Map<string, Set<string>>();
  /**
   * Only the reroute's programs (a program that counts only on a condition the plan doesn't meet).
   * The final audit applies these and no others: a requirement trySwitch gave up on (Utah's
   * Secondary Math I for a student past that rung) is still the student's requirement, so its
   * route stays in the audit with its "ask your counselor" line.
   */
  private readonly programExcluded = new Map<string, ReadonlySet<string>>();
  private readonly candidateCache = new Map<string, { row: CatalogRow; grade: SchoolGrade }[]>();
  private n = 0;
  private ladderFamilyValue: LadderFamily;
  private ladderSolution: LadderSolution | null = null;
  private ladderProblem: LadderProblem | null = null;
  private fullLadder: LadderSolution | null = null;
  private ladderConstraints: LadderConstraint[] = [];
  /** Ladder targets whose top rung was left to the fill (a recommendation a regular class meets). */
  private readonly ladderSkipped = new Set<string>();
  private readonly usedKeys = new Map<string, number>();
  /** Needs whose last class counted elsewhere: they wait until other needs have placed theirs. */
  private readonly deferred = new Set<string>();
  /**
   * Needs whose only classes are ones a row the student hasn't confirmed might already be: they wait
   * on the student (never a gap).
   */
  private readonly waitsOnConfirm = new Set<string>();
  /** Needs blocked with no class to place, tried once more after the next placement (and those tried). */
  private readonly retry = new Set<string>();
  private readonly retried = new Set<string>();
  /** The last final evaluation, for the same classes (pruning that took nothing out). */
  private lastFinal: { signature: string; evals: Map<string, RuleSetEval> } | null = null;
  /**
   * The student's own math rungs from another sequence (Utah's Secondary Math in Texas, Algebra I in
   * Utah), by rank, and the needs those classes would meet if they counted as this state's own
   * (each class once, on the rule set's route): whether they do is the counselor's call.
   */
  private readonly foreignRanks: ReadonlySet<number>;
  private readonly equivalentCovered = new Set<string>();

  constructor(
    readonly ctx: Ctx,
    readonly config: PlanConfig,
    /** Requirements (by rule set) whose routes the plan doesn't take (a program that wouldn't count). */
    exclude: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  ) {
    for (const [id, leaves] of exclude) {
      this.excluded.set(id, new Set(leaves));
      this.programExcluded.set(id, new Set(leaves));
    }
    this.items = [...ctx.items];
    this.ladderFamilyValue = ladderFamily(ctx.state, ctx.items);
    this.foreignRanks = new Set(ctx.items.filter((i) => i.own && countsForSequence(i) && localRung(ctx, i) !== null).map((i) => mathRankOf(i.typeId)!));
    for (const grade of ctx.planGrades) {
      const cat = ctx.catalogs.get(grade)!;
      const classes = ctx.limits.classesPerYear ?? cat.view.classesPerYear ?? ctx.defaultClassesPerYear;
      const own = ctx.items.filter((i) => i.grade === grade);
      const inProgress = ctx.inProgressGrade === grade;
      this.years.set(grade, {
        grade,
        schoolYear: schoolYearOfGrade(ctx, grade),
        capHalves: classes * 2,
        used: own.reduce((n, i) => n + slotHalves(i.term, i.units), 0),
        college: own.filter((i) => isCollegeLevel(i.level)).length,
        reserve: grade >= 9 && grade <= 11 && !inProgress,
        inProgress,
      });
    }
  }

  // Needs --------------------------------------------------------------------------------------

  /**
   * How well a route's missing classes fit the student's goals: a missing requirement that names
   * a class the families want (their sciences, key courses, a career pathway's classes).
   */
  private familyFit(): (r: AltResult) => number {
    const wanted = new Set<CourseTypeId>(this.pathwayTypes());
    for (const f of this.config.families) for (const t of [...(f.content?.sciences ?? []), ...(f.content?.keyCourses ?? [])]) wanted.add(t);
    return missingNaming(wanted);
  }

  /**
   * The classes of the career pathway the goals point to (families.json ctePathways for this
   * state), the one the student chose (a Texas endorsement's program of study), or the one they're
   * taking.
   */
  private pathwayTypes(): Set<CourseTypeId> {
    const clusters = this.config.families.flatMap((f) => (f.content?.ctePathways ?? []).filter((p) => p.state === this.ctx.state).map((p) => p.cluster));
    if (this.ctx.choices.ctePathway) clusters.push(this.ctx.choices.ctePathway.cluster);
    const own = ownCtePathway(this.ctx);
    if (own) clusters.push(own);
    const out = new Set<CourseTypeId>();
    for (const c of clusters) for (const t of ladderTypes(`cte.${c}` as LadderId)) out.add(t.id);
    return out;
  }

  /**
   * A route whose missing requirement is a whole subject the goals are about: "four fine arts
   * credits" for a graphic design goal, whose key courses are art. The core subjects every route
   * has (English, math, science, social studies, a language) don't count.
   */
  private subjectFit(): (r: AltResult) => number {
    const subjects = new Set<CourseSubject>();
    for (const f of this.config.families) for (const t of f.content?.keyCourses ?? []) subjects.add(getCourseType(t).subject);
    for (const core of ["english", "math", "science", "social_studies", "world_language"] as const) subjects.delete(core);
    return (r) => {
      let score = 0;
      for (const l of r.leaves) {
        if (l.missing <= 0 || (l.leaf.req.kind !== "credits" && l.leaf.req.kind !== "count")) continue;
        if (l.leaf.req.select.some((s) => !s.types && s.subjects?.some((x) => subjects.has(x)))) score++;
      }
      return score;
    };
  }

  /**
   * Among equally good alternatives, the one whose missing classes other targets also want: the
   * goals (above), and what the other rule sets still ask for (Utah's "one more science credit"
   * as Physics when Utah State recommends Physics too, design §5.6's merged demands).
   */
  private prefer(rc?: RuleSetCtx): (r: AltResult) => number {
    const fit = this.familyFit();
    // The goal's own career pathway outranks classes that only happen to overlap other targets (a
    // Public Services endorsement's education program for a future teacher, not health science
    // because its list also names Anatomy): §74.13(f)(8) accepts any listed program.
    const pathway = missingNaming(this.pathwayTypes());
    const others = new Set<CourseTypeId>();
    for (const [id, alt] of this.current) {
      const other = this.config.ruleSets.find((x) => x.rs.id === id);
      if (!other || !rc || id === rc.rs.id || rc.bases.some((b) => b.rs.id === id) || other.bases.some((b) => b.rs.id === rc.rs.id)) continue;
      for (const l of alt.leaves) {
        if (l.missing <= 0 || (l.leaf.req.kind !== "credits" && l.leaf.req.kind !== "count") || leafPriority(other, l.leaf.strength) === null) continue;
        for (const sel of l.leaf.req.select) for (const t of sel.types ?? []) others.add(t);
      }
    }
    return (r) => {
      let score = fit(r) + PATHWAY_WEIGHT * pathway(r);
      for (const l of r.leaves) {
        if (l.missing <= 0 || (l.leaf.req.kind !== "credits" && l.leaf.req.kind !== "count")) continue;
        if (l.leaf.req.select.some((s) => s.types?.some((t) => others.has(t)))) score++;
      }
      return score;
    };
  }

  private pickOptions(rc: RuleSetCtx, items: Item[], baseChoice?: Map<string, Alternative>): PickOptions {
    const merge = this.prefer(rc);
    const extensions = this.config.ruleSets.filter((r) => r.bases[r.bases.length - 1]?.rs.id === rc.rs.id);
    const cache = new Map<AltResult, number>();
    // A base with extensions (Tennessee's graduation rules under an elective focus): among its
    // equally good routes, the one its extensions can meet best (the computer science credit as
    // the 4th math leaves statistics free for "3 more math or science credits").
    const prefer = extensions.length
      ? (r: AltResult) => {
          let missing = cache.get(r);
          if (missing === undefined) {
            missing = extensions.reduce((sum, ext) => sum + this.extensionMissing(ext, r.alt, items), 0);
            cache.set(r, missing);
          }
          return merge(r) - missing * 1000;
        }
      : merge;
    return {
      prefer,
      // A graduation option's routes (a Texas endorsement's five social studies, four language
      // levels or four fine arts credits) by the goal's subject first.
      fit: rc.rs.kind === "graduation_option" ? this.subjectFit() : undefined,
      feasible: (r) => r.leaves.every((l) => l.missing === 0 || this.leafFeasible(l.leaf)),
      allowed: this.followsBase(rc, baseChoice),
    };
  }

  /** What an extension still misses (in units) on its best route that follows this base route. */
  private extensionMissing(ext: RuleSetCtx, base: Alternative, items: Item[]): number {
    const sig = leafSignature;
    const want = base.leaves.map(sig).sort().join("|");
    const alts = ext.alternatives.filter((a) => a.leaves.filter((l) => !l.own).map(sig).sort().join("|") === want);
    if (alts.length === 0) return 0;
    return pickAlternative(alts.map((a) => evaluateAlternative(a, items, ext.allocation))).missingNamed;
  }

  /**
   * An extension (a Texas endorsement joining the Foundation program) uses the same base
   * alternative the base rule set uses, so the two never disagree about, say, whether the language
   * requirement is met with a language or with programming.
   */
  private followsBase(rc: RuleSetCtx, baseChoice?: Map<string, Alternative>): ((alt: Alternative) => boolean) | undefined {
    const direct = rc.bases[rc.bases.length - 1];
    if (!direct) return undefined;
    const baseRc = this.config.ruleSets.find((r) => r.rs.id === direct.rs.id);
    if (!baseRc) return undefined;
    const chosen = baseChoice?.get(baseRc.rs.id) ?? baseRc.alternatives.find((a) => a.index === this.chosen.get(baseRc.rs.id));
    if (!chosen) return undefined;
    // Leaf ids and what each stands in for: the plain route and a substitution route share ids.
    const sig = leafSignature;
    const want = chosen.leaves.map(sig).sort().join("|");
    return (alt) => alt.leaves.filter((l) => !l.own).map(sig).sort().join("|") === want;
  }

  /**
   * A language the student can reach `levels` in: every level already taken or offered in a
   * remaining grade, and enough years left to take the rest one a year (four levels of a language
   * can't start in 10th).
   */
  private languageReachable(levels: number): boolean {
    const own = new Set(
      this.items
        .filter((i) => i.own && i.subject === "world_language" && !i.noCredit)
        .map((i) => getCourseType(i.typeId).ladder?.id.slice(5))
        .filter((c): c is string => !!c && c !== "other"),
    );
    const codes = this.ctx.choices.worldLanguage ? [this.ctx.choices.worldLanguage] : own.size ? [...own] : LANGUAGES.filter((c) => c !== "other");
    return codes.some((code) => {
      const taken = asPlanned(this.items).filter((i) => i.own && i.creditable && getCourseType(i.typeId).ladder?.id === `lang.${code}`);
      const reached = Math.max(0, ...taken.map((i) => getCourseType(i.typeId).ladder!.rank));
      const missing = levels - languageLevelsFilled(taken, levels).length;
      if (missing <= 0) return true;
      const after = Math.max(0, ...taken.map((i) => i.grade));
      const yearsLeft = this.ctx.planGrades.filter((g) => g >= 9 && g > after).length;
      if (missing > yearsLeft) return false;
      // The next levels up from where the student is (never below it), one a year.
      return nextLanguageRanks(reached, missing).every((level) => {
        const typeId = `lang.${code}.${level}` as CourseTypeId;
        return this.ctx.planGrades.some((g) => g >= 9 && (this.ctx.catalogs.get(g)!.byType.get(typeId) ?? []).some((r) => rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g))));
      });
    });
  }

  /**
   * A math requirement needs enough years left to climb to its rung (one a year) from the student's
   * own classes (never from classes the planner suggested, which would make any rung look
   * reachable); a language needs its levels offered.
   */
  private leafFeasible(leaf: CLeaf): boolean {
    if (leaf.req.kind === "same_language") return this.languageReachable(leaf.req.levels);
    if (leaf.req.kind !== "credits" && leaf.req.kind !== "count") return true;
    const rank = isLadderish(leaf.req.select);
    if (rank === null) return true;
    const by = leaf.req.kind === "credits" && leaf.req.deadlineGrade !== undefined ? leaf.req.deadlineGrade : 12;
    const own = this.items.filter((i) => i.own);
    // A year with the student's own math class is already spoken for.
    const years = this.ctx.planGrades.filter((g) => g >= 9 && g <= by && !own.some((i) => i.grade === g && i.subject === "math" && countsForSequence(i))).length;
    return startRank(own, 13) + years >= rank;
  }

  /**
   * The route each rule set plans toward, and what it still needs, as if the student's guessed
   * class types were confirmed: a typed "Chemistry" with no kind picked is planned around, never
   * added again (the audit flags the guess instead).
   */
  private evaluateChosen(rc: RuleSetCtx): AltResult | null {
    if (!rc.variant || rc.alternatives.length === 0) return null;
    const items = asPlanned(this.items);
    const idx = this.chosen.get(rc.rs.id);
    if (idx === undefined) {
      const excluded = this.excluded.get(rc.rs.id) ?? new Set<string>();
      const opts = this.pickOptions(rc, items);
      const unexcluded = rc.alternatives.filter((a) => !a.leaves.some((l) => excluded.has(l.id)));
      const followed = opts.allowed ? unexcluded.filter(opts.allowed) : unexcluded;
      const alts = followed.length ? followed : unexcluded;
      if (alts.length === 0) return null;
      const results = alts.map((a) => evaluateAlternative(a, items, rc.allocation));
      const best = pickAlternative(results, opts);
      this.chosen.set(rc.rs.id, best.alt.index);
      return best;
    }
    return evaluateAlternative(rc.alternatives.find((a) => a.index === idx)!, items, rc.allocation);
  }

  private familyNeedCache: Need[] | null = null;

  /** Major-prep targets and a career pathway as needs (fixed for a plan: they depend only on the goals). */
  private familyNeedList(): Need[] {
    return (this.familyNeedCache ??= this.buildFamilyNeeds());
  }

  private buildFamilyNeeds(): Need[] {
    const out: Need[] = [];
    this.config.families.forEach((f, i) => {
      for (const need of familyNeeds(this.ctx, f)) {
        // Two families: math takes the higher target (the ladder does that); sciences are the union.
        if (i > 0 && need.mathTarget && out.some((n) => n.mathTarget && MATH_TARGET_DEFS[n.mathTarget].rank >= MATH_TARGET_DEFS[need.mathTarget!].rank)) continue;
        out.push(need);
      }
    });
    // CTE pathway: the student's choice, the pathway their own classes are in, or the first
    // family's pathway on the training path.
    const chosen = this.ctx.choices.ctePathway?.cluster;
    const own = chosen ? null : ownCtePathway(this.ctx);
    const f = chosen || own ? undefined : this.config.families[0];
    const familyPathway = this.ctx.input.targets.path === "training" ? f?.content?.ctePathways.find((p) => p.state === this.ctx.state) : undefined;
    const cluster = chosen ?? own ?? familyPathway?.cluster;
    if (cluster) {
      // Levels go in order (design §5.7): a student who reached a higher level of this ladder (Accounting
      // II, level 3 in business) has the levels below it, and only the levels above it are planned.
      // Levels a name can't tell apart (Tennessee's Engineering Design I and II are one kind of class;
      // Anatomy and Physiology taken as a career class) count one a year: no level at or below the
      // number of years the student has had classes in the cluster is planned.
      const reached = cteReached(this.ctx.items, cluster);
      for (const level of [1, 2, 3]) {
        if (level <= reached) continue;
        const types = rungTypesForCte(cluster, level);
        out.push({
          id: `cte:${cluster}/${level}`,
          priority: 3,
          source: "prep",
          rc: null,
          leaf: null,
          familyId: f?.target.familyId ?? null,
          label: `${cteTitle(cluster)}, level ${level}`,
          selectors: [{ types }],
          measure: "units",
          required: 4,
          missing: 4,
          fromGrade: Math.max(this.ctx.firstGrade, 9),
          byGrade: 12,
          exclusiveGroup: null,
          soft: false,
          language: null,
          distinctGrades: false,
          mathTarget: null,
          testRoutes: [],
          forWhat: f ? { prep: f.target.familyId } : { ruleSetId: "choice", reqId: `cte.${cluster}` },
          reasons: [
            f
              ? reason("major_prep", `A career pathway in ${lowerFirstWord(cteTitle(cluster))}, taken in order, so you finish as a completer.`, {
                  claim: "suggestion",
                  familyId: f.target.familyId,
                  citations: familyPathway?.cite ?? [],
                })
              : own
                ? reason("choice", `You're taking ${lowerFirstWord(cteTitle(cluster))} classes. The next levels, in order, make you a completer.`, {
                    claim: "suggestion",
                    params: { cluster },
                  })
                : // The student's own choice is the source.
                  reason("choice", `You chose the ${lowerFirstWord(cteTitle(cluster))} pathway. Its classes go in order, so you finish as a completer.`, {
                    claim: "suggestion",
                    params: { cluster },
                  }),
          ],
        });
      }
    }
    return out;
  }

  private checkNeeds(evals: Map<string, AltResult>, items: readonly Item[] = this.items): Need[] {
    const out: Need[] = [];
    for (const rc of this.config.ruleSets) {
      const alt = evals.get(rc.rs.id);
      if (!alt || !rc.variant) continue;
      for (const check of rc.variant.checks ?? []) {
        if (check.kind === "senior_year_math") {
          if (this.ctx.choices[check.unlessChoice] || this.ctx.input.targets.path === "training") continue;
          const senior = items.filter((i) => i.subject === "math" && i.grade === 12 && !i.noCredit).reduce((n, i) => n + i.units, 0);
          if (senior >= 4) continue;
          out.push(this.seniorMathNeed(rc, check.id, 4 - senior, check.cite));
        } else if (check.kind === "enrolled_years") {
          const years = new Set(items.filter((i) => i.subject === check.subject && i.grade >= 9 && !(i.completed && i.letter === "W")).map((i) => i.grade));
          const missing = check.years - years.size;
          if (missing <= 0) continue;
          out.push(
            this.checkNeed(rc, check.id, `${check.subject === "math" ? "Math" : check.subject} in more years of high school`, [{ subjects: [check.subject] }], missing * 4, 9, 12, true, check.cite),
          );
        }
      }
    }
    return out;
  }

  /**
   * Utah's senior-year math (R277-700-9(2)): a college-bound student shows college-ready math (a
   * listed test score, or a C in a qualifying concurrent enrollment class) or takes a full year of
   * math in 12th grade. It's conditional, so the words say so; a senior who passed calculus, or
   * who hasn't said whether they met it, is asked rather than given a class to add now.
   */
  private seniorMathNeed(rc: RuleSetCtx, id: string, units: number, cite: string[]): Need {
    const need = this.checkNeed(rc, id, "A full year of math in 12th grade, unless you show college-ready math", [{ subjects: ["math"], grades: [12] }], units, 12, 12, false, cite);
    const route = need.testRoutes[0];
    need.reasons = [
      seniorMathReason(rc, id, cite),
      ...(route ? [reason("state_note", route.text, { ruleSetId: rc.rs.id, reqId: id, citations: route.cite })] : []),
    ];
    const passedCalculus = this.items.some((i) => i.own && i.completed && countsForSequence(i) && (mathRankOf(i.typeId) ?? 0) >= 5);
    const unanswered = this.ctx.choices.utMathCompetencyMet === undefined;
    // A concurrent enrollment math class that meets the college quantitative literacy requirement
    // (Math 1030, 1040, 1050 or higher): a C in it may already show college-ready math
    // (R277-700-9(2)), so it's a question for the counselor, not a class to add, in any grade.
    const ce = this.items.some(
      (i) => i.own && i.subject === "math" && i.level === "dual_enrollment" && countsForSequence(i) && QUANTITATIVE_LITERACY.includes(i.typeId) && atLeast(i.letter, "C") !== false,
    );
    need.seniorMath = { askFirst: ce || (this.ctx.inProgressGrade === 12 && (passedCalculus || unanswered)), ...(ce ? { ce } : {}) };
    return need;
  }

  private checkNeed(rc: RuleSetCtx, id: string, label: string, sels: Need["selectors"], units: number, from: number, by: number, distinct: boolean, cite: string[]): Need {
    return {
      id: `${rc.rs.id}/${id}`,
      priority: rc.rs.kind === "state_graduation" ? 0 : 1,
      source: "check",
      rc,
      leaf: null,
      familyId: null,
      label,
      selectors: sels,
      measure: "units",
      required: units,
      missing: units,
      fromGrade: Math.max(this.ctx.firstGrade, from),
      byGrade: by,
      exclusiveGroup: null,
      soft: false,
      language: null,
      distinctGrades: distinct,
      mathTarget: null,
      testRoutes: testRoutesFor(rc, id),
      forWhat: { ruleSetId: rc.rs.id, reqId: id },
      reasons: [reason("requirement", `Required by ${rc.rs.issuer.name}: ${lowerFirstWord(label)}.`, { ruleSetId: rc.rs.id, reqId: id, strength: rc.rs.strength, citations: cite })],
    };
  }

  /** Rebuilds every need from the current classes (the chosen alternative of each rule set). */
  refreshNeeds(only?: Item): void {
    // Bases before the rule sets that extend them, so extensions can follow the base's choice.
    for (const rc of [...this.config.ruleSets].sort((a, b) => a.bases.length - b.bases.length)) {
      if (only && this.current.has(rc.rs.id)) {
        const alt = this.current.get(rc.rs.id)!;
        const touches = alt.leaves.some((l) => {
          const req = l.leaf.req;
          if (req.kind === "credits" || req.kind === "count") return matchesAny(only, req.select);
          return req.kind === "same_language" && only.subject === "world_language";
        });
        if (!touches) continue;
      }
      const alt = this.evaluateChosen(rc);
      if (alt) this.current.set(rc.rs.id, alt);
      else this.current.delete(rc.rs.id);
    }
    const merged = new Map<string, Need>();
    const add = (need: Need) => {
      const prev = merged.get(need.id);
      if (!prev || need.missing > prev.missing || (need.missing === prev.missing && need.priority < prev.priority)) merged.set(need.id, need);
    };
    for (const rc of this.config.ruleSets) {
      const alt = this.current.get(rc.rs.id);
      if (alt) for (const n of needsFromEval(this.ctx, rc, alt, this.items)) add(n);
    }
    const confirmed = asPlanned(this.items);
    for (const need of this.familyNeedList()) {
      const { missing, counted } = evaluatePrep(need, confirmed);
      if (missing <= 0) continue;
      const rows = waitingForSelectors(need.selectors, new Set(counted.map((i) => i.key)), confirmed);
      add({ ...need, missing, ...(rows.length ? { waiting: true, waitingKinds: waitingKinds(rows, (probe) => matchesAny(probe, need.selectors)) } : {}) });
    }
    for (const n of this.checkNeeds(this.current)) add(n);
    this.needs = [...merged.values()];
    // A requirement or check a class held for a confirmation would also count for (the rest of
    // Tennessee's social studies credits next to a U.S. History that waits, math in three years
    // next to an Algebra I that waits) waits too: no class is added in its place.
    const holding = this.needs.filter((n) => n.missing > 0 && held(n));
    if (holding.length) for (const n of this.needs) if (!n.waiting && n.source !== "prep" && overlapsHeld(n, holding)) n.waiting = true;
    this.findEquivalents();
  }

  /** Everything still missing, weighted by priority (a required credit outweighs any number of extras). */
  private weightedMissing(): number {
    return this.needs.reduce((sum, n) => sum + (n.missing > 0 && n.priority <= 3 ? WEIGHT[n.priority] * needUnits(n) * (n.soft ? 0.5 : 1) : 0), 0);
  }

  // Years ---------------------------------------------------------------------------------------

  private cap(): number {
    return this.ctx.limits.maxCollegeLevelPerYear;
  }

  /** For `fitsThisYear`: the year in progress takes any class. */
  private anyThisYear = false;

  /** Can a suggestion go in this year for a need of this priority? */
  private yearAllows(grade: SchoolGrade, priority: DemandPriority): boolean {
    const y = this.years.get(grade);
    if (!y || grade < 9) return false;
    if (y.inProgress) return priority === 0 || this.anyThisYear;
    return true;
  }

  fitsThisYear(need: Need): boolean {
    const current = this.ctx.inProgressGrade;
    if (current === null) return false;
    this.anyThisYear = true;
    try {
      return this.candidates(need).some((c) => c.grade === current);
    } finally {
      this.anyThisYear = false;
    }
  }

  private fits(grade: SchoolGrade, row: CatalogRow, priority: DemandPriority, term?: CourseTerm): boolean {
    const y = this.years.get(grade)!;
    const halves = slotHalves(term ?? row.defaultTerm, row.units);
    const reserve = y.reserve && priority >= 2 ? 2 : 0;
    if (y.used + halves + reserve > y.capHalves) return false;
    if (row.collegeLevel && y.college >= this.cap()) return false;
    return true;
  }

  /**
   * The student has this class, or one that teaches the same content, on the plan already (taken
   * or suggested): Personal Financial Literacy and Economics after Economics isn't suggested.
   */
  alreadyHas(typeId: CourseTypeId): boolean {
    if (isRepeatable(typeId)) return false;
    return this.items.some((i) => sameContent(i.typeId, typeId) && !i.noCredit);
  }

  /**
   * Whether the planner may suggest this type in this grade: not something the family opted out of
   * (Utah Secondary Math III opt-out: nothing from that rung), and a repeatable class (art, PE) at
   * most once a year as a full-year class or twice as semesters.
   */
  private typeAllowed(typeId: CourseTypeId, grade: SchoolGrade, units: number): boolean {
    if (this.ctx.choices.utMath3OptOut && mathRankOf(typeId) === 3) return false;
    if (!isRepeatable(typeId)) return true;
    const same = this.items.filter((i) => i.grade === grade && i.typeId === typeId && !i.own).length;
    return same < (units >= 4 ? 1 : 2);
  }

  /** The prerequisites would be met if the student's unconfirmed rows were other kinds they might be. */
  private prereqsMetIfConfirmed(row: CatalogRow, grade: SchoolGrade): boolean {
    const extra = this.items.flatMap((i) => (i.own && i.unconfirmed ? i.unconfirmed.filter((t) => t !== i.typeId).map((typeId) => ({ ...i, key: `${i.key}:${typeId}`, typeId, assumed: false })) : []));
    return extra.length > 0 && this.prereqsMet(row, grade, extra);
  }

  /** Every prerequisite is met by a class before this grade (or the same grade when printed as concurrent). */
  prereqsMet(row: CatalogRow, grade: SchoolGrade, extra: Item[] = [], spring = false): boolean {
    return prereqsMetIn([...this.items, ...extra], row, grade, (i) => this.catalogIdOf(i), false, spring);
  }

  private catalogIdOf(i: Item): string | null {
    if (i.own) return this.ctx.input.courses.find((c) => `c:${c.id}` === i.key)?.catalogCourseId ?? null;
    return this.placements.find((p) => p.item.key === i.key)?.row.id ?? null;
  }

  private keyFor(need: Need | null, typeId: CourseTypeId, level: CourseTypeLevel, fallback: { ruleSetId: string; reqId: string } | { prep: string }): string {
    const forWhat = need ? need.forWhat : fallback;
    return suggestionKey(forWhat as Parameters<typeof suggestionKey>[0], typeId, level);
  }

  private dismissed(need: Need | null, row: CatalogRow): boolean {
    if (!need) return false;
    return this.ctx.dismissed.has(this.keyFor(need, row.typeId, row.level, need.forWhat));
  }

  // Candidates ---------------------------------------------------------------------------------------

  private staticCandidates(need: Need): { row: CatalogRow; grade: SchoolGrade }[] {
    const cached = this.candidateCache.get(need.id);
    if (cached) return cached;
    const out: { row: CatalogRow; grade: SchoolGrade }[] = [];
    for (const grade of this.ctx.planGrades) {
      if (grade < 9) continue;
      const cat = this.ctx.catalogs.get(grade)!;
      const sy = schoolYearOfGrade(this.ctx, grade);
      for (const row of cat.rows) {
        if (row.defaultTerm === "summer" || !rowIsOffered(row, grade, sy) || pastCteLevel(this.ctx.items, row.typeId)) continue;
        if (matchesAny(probe(row, grade, sy), need.selectors)) out.push({ row, grade });
      }
    }
    this.candidateCache.set(need.id, out);
    return out;
  }

  /**
   * The list's classes for a need are all career pathway levels at or below where the student is in
   * that cluster: what's missing is the pathway's next level, which the list doesn't show.
   */
  pastLevelsOnly(need: Need): boolean {
    if (this.staticCandidates(need).length > 0) return false;
    let any = false;
    for (const grade of this.ctx.planGrades) {
      if (grade < 9) continue;
      const sy = schoolYearOfGrade(this.ctx, grade);
      for (const row of this.ctx.catalogs.get(grade)!.rows) {
        if (row.defaultTerm === "summer" || !rowIsOffered(row, grade, sy) || !matchesAny(probe(row, grade, sy), need.selectors)) continue;
        if (!pastCteLevel(this.ctx.items, row.typeId)) return false;
        any = true;
      }
    }
    return any;
  }

  /** Grades a need's classes can go in. Past its deadline, nothing placed now would count. */
  private window(need: Need): [number, number] {
    return [Math.max(need.fromGrade, 9), need.byGrade];
  }

  /**
   * Feasible (row, grade) pairs for a need right now. `noReserve`: a lower-priority class may use
   * the "Your choice" slot too.
   */
  candidates(need: Need, ignoreCapacity = false, noReserve = false): { row: CatalogRow; grade: SchoolGrade }[] {
    const [from, by] = this.window(need);
    // Classes only an advanced level meets (an aid rule's "one AP class", "four advanced courses")
    // are never added for it: rigor is a level choice on classes already planned (design §5.7).
    if (advancedOnly(need.selectors)) return [];
    // A requirement the student's own class on the same math rung may meet (Utah's Secondary Math
    // III for Texas's 3rd math): the counselor decides, and no class is added for it.
    if (this.equivalentTaken(need)) return [];
    const senior = need.seniorMath ? this.seniorMathOrder(startRank(this.items, 13)) : null;
    // A retake is the class itself, never its AP or college version (AP Seminar for a failed English 10).
    const retake = failedAttempt(this.items, need.selectors) !== null;
    let waitsOnly = false;
    const out = this.staticCandidates(need).filter(({ row, grade }) => {
      if (senior && senior(row.typeId) === null) return false;
      if (retake && row.collegeLevel) return false;
      if (lateEnglish(this.items, row.typeId, grade)) return false;
      if (grade < from || grade > by) return false;
      if (!this.yearAllows(grade, need.priority)) return false;
      if (this.alreadyHas(row.typeId) || !this.typeAllowed(row.typeId, grade, row.units)) return false;
      if (pastIntro(this.items, row.typeId, grade)) return false;
      // A career pathway level at or below what the student has in its cluster, for any need (an
      // endorsement's program of study too): levels go in order (design §5.7).
      if (pastCteLevel(this.ctx.items, row.typeId)) return false;
      if (this.dismissed(need, row)) return false;
      if (need.distinctGrades && this.items.some((i) => i.grade === grade && i.subject === row.subject)) return false;
      // A class placed for a math requirement (AP Computer Science A as Texas's 4th math credit)
      // is that year's math class too.
      if ((row.subject === "math" || need.leaf?.area === "math") && !this.secondMathAllowed(need, grade)) return false;
      if (!ignoreCapacity && !this.fits(grade, row, noReserve ? Math.min(need.priority, 1) as DemandPriority : need.priority)) return false;
      if (ignoreCapacity && row.collegeLevel && this.years.get(grade)!.college >= this.cap()) return false;
      if (row.collegeLevel && this.cheaperLevelExists(row, grade)) return false;
      if (!this.prereqsMet(row, grade)) {
        // A prerequisite a row the student hasn't confirmed might be (Biology for Anatomy, typed
        // "Biology" read as Chemistry): no class now, but no "doesn't fit" either.
        if (this.prereqsMetIfConfirmed(row, grade)) waitsOnly = true;
        return false;
      }
      if (this.repeatsMathRung(row.typeId, grade)) return false;
      // Never a class a row the student hasn't confirmed might already be (engine/confirm.ts).
      if (!isRepeatable(row.typeId) && mightAlreadyBe(this.items, row.typeId)) {
        waitsOnly = true;
        return false;
      }
      return true;
    });
    if (out.length === 0 && waitsOnly) this.waitsOnConfirm.add(need.id);
    else this.waitsOnConfirm.delete(need.id);
    // Never an applied or college-readiness math class below the student's math (Mathematical
    // Reasoning for Decision Making for a student in AP Calculus), unless nothing else fits.
    const reachedRank = startRank(this.items, 13);
    const atLevel = reachedRank >= 4 ? out.filter((c) => !belowPrecalculus(c.row.typeId)) : out;
    const fitting = atLevel.length ? atLevel : out;
    // Utah's senior-year math for a goal of precalculus or more: the next rung (or the goal's own
    // math) even where only its AP or concurrent enrollment version is offered, before any other
    // regular class.
    const top = senior && this.goalMathRank() >= 4 && fitting.length ? fitting.filter((c) => senior(c.row.typeId) === Math.min(...fitting.map((o) => senior(o.row.typeId)!))) : fitting;
    // The planner doesn't add AP, IB or college-credit classes to meet an ordinary requirement
    // when a regular or honors class would (college-level only by a rigor level choice).
    return top.some((c) => !c.row.collegeLevel) ? top.filter((c) => !c.row.collegeLevel) : top;
  }

  /**
   * A requirement the student's own class from another math sequence would meet if it counted as
   * this state's class on the same rung (Secondary Math III as Texas's Algebra II for "a 3rd math
   * credit"), each class once on the rule set's route: a 4th math credit next to it still needs a
   * class. Whether it counts is the counselor's call (the audit asks: audit.ts equivalentMath).
   */
  equivalentTaken(need: Need): boolean {
    return this.equivalentCovered.has(need.id);
  }

  private findEquivalents(): void {
    this.equivalentCovered.clear();
    if (this.foreignRanks.size === 0) return;
    // Base programs first: a class that stands in for one of the base's requirements (Texas's 3rd
    // math) isn't also taken for an extension's (an endorsement's 4th math).
    const foreign = new Set(this.items.filter((i) => i.own && localRung(this.ctx, i) !== null).map((i) => i.key));
    const used = new Set<string>();
    const covered = new Set<string>();
    for (const rc of [...this.config.ruleSets].sort((a, b) => a.bases.length - b.bases.length)) {
      const alt = this.current.get(rc.rs.id);
      if (!alt) continue;
      const local = asPlanned(this.items.map((i) => (foreign.has(i.key) && !used.has(i.key) ? { ...i, typeId: localRung(this.ctx, i)! } : i)));
      const hypo = evaluateAlternative(alt.alt, local, rc.allocation);
      for (const l of hypo.leaves) {
        if (!l.leaf.own || l.missing > 0) continue;
        const real = alt.leaves.find((r) => r.leaf.id === l.leaf.id);
        if (!real || real.missing <= 0) continue;
        covered.add(`${rc.rs.id}/${l.leaf.id}`);
        for (const c of l.counted) if (foreign.has(c.item.key)) used.add(c.item.key);
      }
    }
    for (const n of this.needs) {
      if (n.missing <= 0 || !n.leaf || !covered.has(n.id)) continue;
      const named = n.selectors.flatMap((s) => s.types ?? []);
      if (named.some((t) => this.foreignRanks.has(mathRankOf(t) ?? 0))) this.equivalentCovered.add(n.id);
    }
  }

  /**
   * Whether the years after the one in progress still have room for every other required (P0-P1)
   * class once this one is placed there, so leaving the current year alone doesn't crowd them out.
   */
  private laterYearsHaveRoom(need: Need): boolean {
    const current = this.ctx.inProgressGrade;
    let free = 0;
    for (const y of this.years.values()) if (current !== null && y.grade > current) free += Math.max(0, y.capHalves - y.used);
    const demand = this.needs
      .filter((n) => n.id !== need.id && n.priority <= 1 && n.missing > 0 && !this.blocked.has(n.id) && !held(n))
      .reduce((sum, n) => sum + Math.ceil(needUnits(n) / 2), 0);
    return free - Math.ceil(needUnits(need) / 2) >= demand;
  }

  /**
   * A career pathway's levels go one a year: when more levels are still needed than there are years
   * after this one, the pathway has to start now (a Texas endorsement's three-course program).
   */
  private sequenceNeedsCurrentYear(need: Need, cands: { row: CatalogRow }[]): boolean {
    if (cands.length === 0 || !cands.every((c) => getCourseType(c.row.typeId).ladder?.id.startsWith("cte."))) return false;
    const current = this.ctx.inProgressGrade;
    const later = this.ctx.planGrades.filter((g) => current !== null && g > current).length;
    return Math.ceil(needUnits(need) / UNITS_PER_CREDIT) > later;
  }

  /** The last finished math class was a B or better (unknown letters don't count). */
  private lastMathBOrBetter(): boolean {
    const last = this.items.filter((i) => i.own && i.subject === "math" && i.completed && i.letter).sort((a, b) => b.grade - a.grade)[0];
    return last ? atLeast(last.letter, "B") === true : false;
  }

  /** A school year already has a math class (the student's or a suggestion). */
  private mathInYear(grade: SchoolGrade): boolean {
    return this.items.some((i) => i.grade === grade && i.subject === "math" && i.term !== "summer" && countsForSequence(i));
  }

  /**
   * One math class a year (design §5.6, §8.4): a second one only with the student's opt-in and a B
   * or better in their last math class, or for a required credit a senior needs now.
   */
  private secondMathAllowed(need: Need, grade: SchoolGrade): boolean {
    if (!this.mathInYear(grade)) return true;
    if (this.ctx.limits.accelerateMath && this.lastMathBOrBetter()) return true;
    return need.priority === 0 && this.ctx.inProgressGrade === 12 && grade === 12;
  }

  /**
   * A math class on a rung the student already has another course for: Algebra I after Integrated
   * Math I, Geometry after Secondary Math II. (Geometry after Algebra II is a real sequence in some
   * states, so only the same rung counts as a repeat.)
   */
  private repeatsMathRung(typeId: CourseTypeId, grade: SchoolGrade): boolean {
    const rank = mathRankOf(typeId);
    if (rank === null || rank < 1 || rank > 3) return false;
    return this.items.some((i) => i.grade < grade && countsForSequence(i) && i.typeId !== typeId && mathRankOf(i.typeId) === rank);
  }

  /**
   * A regular or honors version of the same class the student could take in this grade instead:
   * offered, and its own prerequisites met (Computer Science II needs Computer Science I or CS
   * Principles first, while AP Computer Science A needs only Algebra I).
   */
  private cheaperLevelExists(row: CatalogRow, grade: SchoolGrade): boolean {
    const cat = this.ctx.catalogs.get(grade)!;
    return (cat.byType.get(row.typeId) ?? []).some(
      (r) => !r.collegeLevel && rowIsOffered(r, grade, schoolYearOfGrade(this.ctx, grade)) && r.defaultTerm !== "summer" && this.prereqsMet(r, grade),
    );
  }

  /** A class that usually follows one of a few others (course-types `usuallyAfter`), with none before it. */
  private lacksBackground(typeId: CourseTypeId, grade: SchoolGrade): boolean {
    const after = getCourseType(typeId).usuallyAfter;
    return after.length > 0 && !this.items.some((i) => i.grade < grade && countsForSequence(i) && after.includes(i.typeId));
  }

  /**
   * Career pathway classes go in order within one cluster (a program of study): the next level of
   * a pathway already in the plan comes first (0), then the first level of the goal's own pathway
   * (0.5: Health Science for a nursing goal before an unrelated career class), then anything else
   * (1); a level with its previous level missing, or a second pathway's first class, comes last (2).
   */
  private cteContinuity(typeId: CourseTypeId, grade: SchoolGrade): number {
    const rung = getCourseType(typeId).ladder;
    if (!rung?.id.startsWith("cte.")) return 1;
    const { id: ladder, rank: level } = rung;
    const placed = this.items.flatMap((i) => {
      const r = getCourseType(i.typeId).ladder;
      return r?.id.startsWith("cte.") ? [{ ladder: r.id, level: r.rank, grade: i.grade }] : [];
    });
    if (placed.some((p) => p.ladder === ladder && p.level === level - 1 && p.grade < grade)) return 0;
    const goal = this.config.families.some((f) => (f.content?.ctePathways ?? []).some((p) => p.state === this.ctx.state && `cte.${p.cluster}` === ladder));
    if (level === 1 && goal && !placed.some((p) => p.ladder !== ladder)) return 0.5;
    // Starting a pathway: one the class list offers more levels of can be finished in order.
    if (level === 1 && !placed.some((p) => p.ladder !== ladder)) return 1 + (4 - this.cteLevelsOffered(ladder)) / 10;
    return 2;
  }

  private cteLevelsOffered(ladder: string): number {
    let levels = 0;
    for (let level = 1; level <= 4; level++) {
      const typeId = `${ladder}.${level}` as CourseTypeId;
      if (this.ctx.planGrades.some((g) => (this.ctx.catalogs.get(g)?.byType.get(typeId)?.length ?? 0) > 0)) levels++;
    }
    return levels;
  }

  /** The level the student has been taking in a subject (honors continuity), never college-level. */
  private preferredLevel(subject: CourseSubject): CourseTypeLevel {
    const last = this.items
      .filter((i) => i.own && i.subject === subject && !i.noCredit)
      .sort((a, b) => b.grade - a.grade)[0];
    return last?.level === "honors" ? "honors" : "regular";
  }

  private score(row: CatalogRow, grade: SchoolGrade, requiredOnly = false): number {
    const item = probe(row, grade, schoolYearOfGrade(this.ctx, grade));
    const groups = new Map<string, number>();
    let total = 0;
    for (const n of this.needs) {
      if (n.missing <= 0 || this.blocked.has(n.id) || n.language || held(n) || (requiredOnly && n.priority > 0)) continue;
      const [from, by] = this.window(n);
      if (grade < from || grade > by) continue;
      if (!matchesAny(item, n.selectors)) continue;
      const amount = n.measure === "units" ? Math.min(row.units, n.missing) : Math.min(1, n.missing);
      const value = WEIGHT[n.priority] * amount * (n.soft ? 0.5 : 1);
      if (n.exclusiveGroup) groups.set(n.exclusiveGroup, Math.max(groups.get(n.exclusiveGroup) ?? 0, value));
      else total += value;
    }
    for (const v of groups.values()) total += v;
    return total;
  }

  private gradePreference(row: CatalogRow, grade: SchoolGrade, priority: DemandPriority = 3): number[] {
    const y = this.years.get(grade)!;
    const halves = slotHalves(row.defaultTerm, row.units);
    const pairs = halves === 1 && y.used % 2 === 1 ? 0 : 1;
    const keepsReserve = y.reserve && y.used + halves + 2 > y.capHalves ? 1 : 0;
    // A class's usual grades (design §5.7: "P0 single courses in their typical grade windows"):
    // first whether the grade is in the window, then how close it is to its middle, in half-grade
    // steps (Chemistry in 10th or 11th, a 4th science in 11th or 12th).
    const [from, to] = getCourseType(row.typeId).grades;
    const outside = grade < from ? from - grade : grade > to ? grade - to : 0;
    const natural = Math.round(Math.abs(grade - (from + to) / 2) * 2);
    // Inside the window, spread the core subjects across years: a year that already has a science
    // (math, social studies) class comes after one that doesn't, so junior year isn't stacked while
    // 12th has room.
    const core = row.subject === "science" || row.subject === "math" || row.subject === "social_studies";
    const same = core ? this.items.filter((i) => i.grade === grade && i.subject === row.subject && i.term !== "summer" && countsForSequence(i)).length : 0;
    // A college-level class goes in the year with the fewest (design §5.7: balance the load).
    const load = row.collegeLevel ? y.college : 0;
    // The year in progress is a last resort: its schedule is mostly set. A required (P0-P1) class
    // stays in its usual grades before it pairs with another semester class (a half-credit World
    // History in 10th, not in 12th next to Economics).
    const inProgress = y.inProgress ? 1 : 0;
    return priority <= 1 ? [inProgress, outside, pairs, same, load, natural, keepsReserve, grade] : [inProgress, pairs, outside, same, load, natural, keepsReserve, grade];
  }

  private pick(need: Need, all: { row: CatalogRow; grade: SchoolGrade }[]): { row: CatalogRow; grade: SchoolGrade } {
    // The year in progress only when no later year in the window can hold the class, or the later
    // years are needed for other required classes: its schedule is mostly set.
    const current = this.ctx.inProgressGrade;
    const cands =
      current !== null && this.sequenceNeedsCurrentYear(need, all) && all.some((c) => c.grade === current)
        ? all.filter((c) => c.grade === current)
        : current !== null && all.some((c) => c.grade !== current) && this.laterYearsHaveRoom(need)
          ? all.filter((c) => c.grade !== current)
          : all;
    const math = need.selectors.some((s) => s.subjects?.includes("math") || s.types?.some((t) => t.startsWith("math.")) || s.capabilities?.some((c) => c !== "lab_science"));
    const nextRank = startRank(this.items, 13) + 1;
    const senior = need.seniorMath ? this.seniorMathOrder(nextRank - 1) : null;
    // The next rung of the math ladder only when the need names a rung, or on the way to a 4-year
    // college. A plain "4th math" on the training or undecided path, including a required credit
    // a senior needs now, prefers a class off the ladder (statistics, applied or decision math). On
    // the degree path a senior's required credit is weighed by everything it serves (Algebra II
    // for the 4th math also counts for the DLA and a college).
    const ladderNeed = isLadderish(need.selectors) !== null;
    const degree = this.ctx.input.targets.path === "degree";
    // Classes other open needs name: a class that would cover the same content blocks them
    // (Personal Financial Literacy and Economics for the PFL credit when a business goal also
    // wants Economics: Personal Financial Literacy leaves room for both).
    const named = new Set(this.needs.filter((n) => n.id !== need.id && n.missing > 0 && !this.blocked.has(n.id)).flatMap((n) => n.selectors.flatMap((sel) => sel.types ?? [])));
    const scored = cands.map((c) => {
      const planNow = this.ctx.inProgressGrade === 12 && c.grade === 12 && need.priority === 0;
      const pref = planNow ? "regular" : this.preferredLevel(c.row.subject);
      const rank = mathRankOf(c.row.typeId);
      const rungKey = rank === nextRank ? 0 : rank !== null && rank > nextRank ? 2 : 1;
      const mathKey = !math ? 0 : ladderNeed || degree ? rungKey : rank !== null ? 1 : 0;
      return {
        c,
        keys: [
          // Utah's senior-year math: the next rung or the goal's math first.
          senior?.(c.row.typeId) ?? 0,
          // A senior's required credit this year, off the degree path: only what's required counts.
          -this.score(c.row, c.grade, planNow && !degree),
          getCourseType(c.row.typeId).overlaps.some((t) => named.has(t)) ? 1 : 0,
          c.row.collegeLevel ? 1 : 0,
          isRepeatable(c.row.typeId) && this.items.some((i) => i.typeId === c.row.typeId && i.subject === c.row.subject) ? 0 : 1,
          this.cteContinuity(c.row.typeId, c.grade),
          c.row.level === pref ? 0 : 1,
          mathKey,
          // A class that usually follows another the student doesn't have (music theory without
          // band, choir or a music class) after the ones that don't, before the usual grades.
          this.lacksBackground(c.row.typeId, c.grade) ? 1 : 0,
          ...this.gradePreference(c.row, c.grade, need.priority),
          c.row.order,
          levelOrder(c.row.level),
        ],
      };
    });
    scored.sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
      return a.c.row.id < b.c.row.id ? -1 : a.c.row.id > b.c.row.id ? 1 : 0;
    });
    return scored[0].c;
  }

  /**
   * How well a class fits Utah's senior-year math for a student who has reached rung `reached`:
   * the next rung or the goal's own math target first (0), then any other class past the student's
   * math (1), or null when it doesn't fit at all (a rung they've reached, or college-preparatory
   * math after precalculus or calculus).
   */
  private seniorMathOrder(reached: number): (typeId: CourseTypeId) => number | null {
    const goal = new Set<CourseTypeId>();
    for (const f of this.config.families) {
      for (const t of f.math) {
        const def = MATH_TARGET_DEFS[t];
        if (def.statistics) goal.add("math.stats");
        if (def.rank > reached) for (const id of rungTypes(this.ladderFamilyValue, reached + 1)) goal.add(id);
      }
    }
    // A goal of precalculus or calculus is never met with college-preparatory math.
    const precalcGoal = this.goalMathRank() >= 4;
    const calcGoal = this.goalMathRank() >= 5;
    return (typeId) => {
      const rank = mathRankOf(typeId);
      if (rank !== null && rank >= 1 && rank <= reached) return null;
      if (typeId === "math.college_prep" && (reached >= 4 || precalcGoal)) return null;
      if (goal.has(typeId)) return 0;
      // Past precalculus's rung (Precalculus, College Algebra), calculus is the next rung only for a
      // goal that asks for it: otherwise statistics or a quantitative reasoning class comes first,
      // the least disruption for a full year of senior math.
      if (rank === reached + 1) return rank >= 5 && !calcGoal ? 1 : 0;
      if (reached >= 4 && !calcGoal && (typeId === "math.stats" || typeId === "math.adv_quant")) return 0;
      return 1;
    };
  }

  /** The highest math rung the planned-around goals ask for (0 with no goal). */
  private goalMathRank(): number {
    return Math.max(0, ...this.config.families.flatMap((f) => f.math.map((t) => MATH_TARGET_DEFS[t].rank)));
  }

  /**
   * Frees a slot in one of a class's usual grades by moving a class outside the core subjects (PE,
   * health, the arts, a social studies or career class) to another of its own usual grades.
   * Returns where the class can go then, or null (nothing moved).
   */
  private roomInUsualGrades(need: Need, row: CatalogRow, pathwayLevels = false): { row: CatalogRow; grade: SchoolGrade } | null {
    const [from, to] = getCourseType(row.typeId).grades;
    for (const grade of this.ctx.planGrades) {
      if (grade < Math.max(9, from) || grade > to || grade === this.ctx.inProgressGrade || !this.yearAllows(grade, need.priority)) continue;
      const undo: (() => void)[] = [];
      const here = () => this.candidates(need, false, true).filter((c) => c.grade === grade && !this.misplaced(c.row, c.grade));
      // A full-year class may need two half-credit classes moved.
      while (undo.length < 2 && here().length === 0) {
        const moved = this.moveOut(grade, new Set([grade]), 0, (p) => !["english", "math", "science", "world_language"].includes(p.item.subject), pathwayLevels ? need.priority : null);
        if (!moved) break;
        undo.push(moved);
      }
      const cands = here();
      if (cands.length) return this.pick(need, cands);
      for (const u of undo.reverse()) u();
    }
    return null;
  }

  /** Outside the class's usual grades, or a third lab science in the same year. */
  private misplaced(row: CatalogRow, grade: SchoolGrade): boolean {
    if (outsideUsualGrades(row, grade)) return true;
    if (row.subject !== "science" || !getCourseType(row.typeId).capabilities.includes("lab_science")) return false;
    const sciences = this.items.filter((i) => i.grade === grade && i.term !== "summer" && countsForSequence(i) && getCourseType(i.typeId).capabilities.includes("lab_science"));
    return sciences.length >= 2;
  }

  // Commit ----------------------------------------------------------------------------------------

  commit(row: CatalogRow, grade: SchoolGrade, kind: PlacementKind, need: Need | null, priority: DemandPriority, extra: Reason[] = [], term?: CourseTerm): Placement {
    const y = this.years.get(grade);
    const sy = y?.schoolYear ?? schoolYearOfGrade(this.ctx, grade);
    const useTerm = term ?? this.termFor(row, grade);
    const baseKey = this.keyFor(need, row.typeId, row.level, need?.forWhat ?? { ruleSetId: "plan", reqId: kind });
    const count = (this.usedKeys.get(baseKey) ?? 0) + 1;
    this.usedKeys.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}#${count}`;
    const n = this.n++;
    const item = itemFromSuggestion({
      n,
      key,
      typeId: row.typeId,
      level: row.level,
      grade,
      schoolYear: sy,
      term: useTerm,
      units: row.units,
      cte: row.cte,
      lectureOnly: row.lectureOnly,
    });
    this.items.push(item);
    if (y) {
      y.used += slotHalves(useTerm, row.units);
      if (row.collegeLevel) y.college++;
    }
    const placement: Placement = {
      n,
      item,
      row,
      kind,
      primary: need,
      priority,
      baseKey,
      key,
      extraReasons: extra,
      needsPlanNow: this.ctx.inProgressGrade === 12 && grade === 12 && priority === 0,
      upgradedFrom: null,
    };
    this.placements.push(placement);
    return placement;
  }

  private termFor(row: CatalogRow, grade: SchoolGrade): CourseTerm {
    if (row.defaultTerm === "full_year" || row.defaultTerm === "summer") return row.defaultTerm;
    // The year in progress has started its fall term: a semester class added now is a spring class
    // (as its room is counted: gaps.ts freeUnits).
    const y = this.years.get(grade);
    if (y?.inProgress) return "spring";
    // Semester classes: fall if this year's semester slots are even, else spring (pairs them).
    return y && y.used % 2 === 1 ? "spring" : "fall";
  }

  private uncommit(p: Placement): void {
    const idx = this.placements.indexOf(p);
    if (idx >= 0) this.placements.splice(idx, 1);
    const i = this.items.indexOf(p.item);
    if (i >= 0) this.items.splice(i, 1);
    const y = this.years.get(p.item.grade);
    if (y) {
      y.used -= slotHalves(p.item.term, p.item.units);
      if (p.row.collegeLevel) y.college--;
    }
  }

  // Steps ------------------------------------------------------------------------------------------

  /**
   * Math targets past a rung the family opted out of in writing (Utah Secondary Math III): the
   * ladder can't reach them, so it plans the opt-out's own path instead (Secondary Math II, then
   * the applied class that takes Math III's place), and they show as the family's choice.
   */
  private optedOutRank(rank: number): boolean {
    return !!this.ctx.choices.utMath3OptOut && rank >= 3;
  }

  private ladderConstraintsFromNeeds(): LadderConstraint[] {
    const out: LadderConstraint[] = [];
    for (const n of this.needs) {
      if (n.missing <= 0) continue;
      const rank = isLadderish(n.selectors);
      if (rank === null || this.optedOutRank(rank)) continue;
      out.push({
        id: n.id,
        rank,
        byGrade: n.byGrade,
        hard: n.priority <= 1 && n.testRoutes.length === 0 && !n.soft,
        priority: n.priority,
        label: rungName(this.ladderFamilyValue, rank, this.ctx.state),
      });
    }
    return out;
  }

  /** The best row for a rung in a grade: the student's family of courses, their level, the load cap. */
  rowForRung(rank: number, grade: SchoolGrade, priority: DemandPriority, skip: (row: CatalogRow) => boolean = () => false): CatalogRow | null {
    const cat = this.ctx.catalogs.get(grade);
    if (!cat) return null;
    const sy = schoolYearOfGrade(this.ctx, grade);
    const pref = this.preferredLevel("math");
    for (const typeId of rungTypes(this.ladderFamilyValue, rank)) {
      if (this.alreadyHas(typeId) || !this.typeAllowed(typeId, grade, 4)) continue;
      const rows = (cat.byType.get(typeId) ?? []).filter((r) => rowIsOffered(r, grade, sy) && r.defaultTerm !== "summer");
      if (rows.length === 0) continue;
      const sorted = [...rows].sort(
        (a, b) => Number(a.collegeLevel) - Number(b.collegeLevel) || Number(a.level !== pref) - Number(b.level !== pref) || levelOrder(a.level) - levelOrder(b.level),
      );
      const fit = sorted.find((r) => !skip(r) && this.fits(grade, r, priority));
      if (fit) return fit;
    }
    return null;
  }

  private placeLadder(): void {
    const ctx = this.ctx;
    const constraints = this.ladderConstraintsFromNeeds();
    this.ladderConstraints = constraints;
    if (constraints.length === 0) return;
    const grades = ctx.planGrades.filter((g) => g >= 9);
    const locked = new Map<SchoolGrade, number>();
    // A failed rung with no retake: the student's classes above it count only once it's retaken.
    const failed = unresolvedFailedRank(this.items);
    const deferred = new Map<number, SchoolGrade>();
    for (const i of this.items) {
      const r = mathRankOf(i.typeId);
      if (failed === null || !i.own || r === null || r <= failed || !countsForSequence(i)) continue;
      if (!deferred.has(r) || deferred.get(r)! > i.grade) deferred.set(r, i.grade);
    }
    for (const g of grades) {
      const own = this.items.filter((i) => i.own && i.grade === g && i.subject === "math" && countsForSequence(i));
      const ranks = own.map((i) => mathRankOf(i.typeId)).filter((r): r is number => r !== null && (failed === null || r < failed));
      if (ranks.length) locked.set(g, Math.max(...ranks));
      else if (own.length || (this.years.get(g)?.inProgress && !constraints.some((c) => c.hard && c.priority === 0))) locked.set(g, 0);
    }
    const lastMath = this.items
      .filter((i) => i.own && i.subject === "math" && i.completed && i.letter)
      .sort((a, b) => b.grade - a.grade)[0];
    const bOrBetter = lastMath ? atLeast(lastMath.letter, "B") === true : false;
    const accelerate = this.config.accelerate && ctx.limits.accelerateMath && bOrBetter;
    const summerFact = ctx.facts.options.some((o) => o.kind === "summer");
    const minPriority = Math.min(...constraints.map((c) => c.priority)) as DemandPriority;
    const available = (grade: SchoolGrade, rank: number) => {
      const y = this.years.get(grade);
      if (!y) return false;
      if (y.inProgress && minPriority > 0) return false;
      return this.rowForRung(rank, grade, minPriority) !== null;
    };
    const start = startRank(this.items, grades[0] ?? 13);
    // Availability is fixed now (before the ladder's own placements), so options can re-solve it.
    const availability = new Map<string, boolean>();
    const college = new Map<string, boolean>();
    for (const g of grades) {
      for (let r = 1; r <= 6; r++) {
        availability.set(`${g}:${r}`, available(g, r));
        college.set(`${g}:${r}`, this.collegeRowForRung(r, g) !== null);
      }
    }
    this.ladderProblem = {
      grades,
      start,
      locked,
      available: (g, r) => availability.get(`${g}:${r}`) ?? false,
      collegeAvailable: (g, r) => college.get(`${g}:${r}`) ?? false,
      constraints,
      moves: { double: false, summer: false },
      deferred,
      doublePairs: this.doublePairs(grades),
    };
    // An opted-in Plan B may also take two college-credit math classes in one year, where the
    // state verifies college credit and the list has both rungs' college versions.
    const collegeFact = ctx.facts.options.find((o) => o.kind === "college_credit");
    const collegeGrades = accelerate && ctx.limits.allowCollegeCredit && collegeFact ? (collegeFact.grades ?? grades).filter((g) => g >= 9) : undefined;
    const solution = solveLadder({ ...this.ladderProblem, moves: { double: accelerate, summer: accelerate && summerFact && ctx.limits.allowSummer, college: collegeGrades } });
    this.ladderSolution = solution;
    // The full picture including grades 7-8 (deadlines like "Algebra I in 8th").
    if (ctx.firstGrade <= 8) {
      const early = ctx.planGrades;
      this.fullLadder = solveLadder({
        grades: early,
        start: startRank(this.items, early[0]),
        locked: new Map(early.filter((g) => g < 9).flatMap((g) => {
          const ranks = this.items
            .filter((i) => i.own && i.grade === g && countsForSequence(i))
            .map((i) => mathRankOf(i.typeId))
            .filter((r): r is number => r !== null && (failed === null || r < failed));
          return ranks.length ? [[g, Math.max(...ranks)] as [SchoolGrade, number]] : [];
        })),
        available: (g, r) => (g < 9 ? r <= 2 : available(g, r)),
        constraints,
        moves: { double: false, summer: false },
        deferred,
      });
    } else this.fullLadder = solution;
    const unmetIds = new Set(solution.unmet.map((c) => c.id));
    // The needs as they are before any rung is placed (a placed rung meets some of them).
    const needsBefore = [...this.needs];
    const needOf = (c: LadderConstraint) => needsBefore.find((n) => n.id === c.id);
    // A rung a requirement names, or that the student's goal passes through (calculus goes
    // through precalculus), is placed even when a recommendation is what sets its year.
    const firmlyWanted = (rank: number) => constraints.some((c) => c.rank >= rank && (c.priority <= 1 || needOf(c)?.source === "prep"));
    const lastStep = solution.steps[solution.steps.length - 1];
    const placed: { step: (typeof solution.steps)[number]; placement: Placement }[] = [];
    for (const step of solution.steps) {
      const binding = solution.slack.find((s) => s.step === step)?.binding ?? null;
      const priority = (binding?.priority ?? minPriority) as DemandPriority;
      const need = this.needs.find((n) => n.id === binding?.id) ?? this.needs.find((n) => constraints.some((c) => c.id === n.id)) ?? null;
      // A level the student said "Not for me" to gives way to another level of the same class.
      const row = step.summer
        ? this.summerRow(step.rank, step.grade)
        : step.college
          ? this.collegeRowForRung(step.rank, step.grade)
          : this.rowForRung(step.rank, step.grade, priority, (r) => this.dismissed(need, r));
      if (!row || this.dismissed(need, row)) continue;
      // The top rung for a recommendation only (not a requirement, and not on the way to the
      // student's goal) that only a college-level class reaches here: a regular class that meets
      // it comes from the fill instead (Utah College Prep Math rather than AP Precalculus for "one
      // class beyond Secondary Math III"). The recommendations it was for aren't reached by the
      // ladder then, so no reason or "by when" line says it keeps them open.
      if (
        row.collegeLevel &&
        step === lastStep &&
        need &&
        need.priority >= 2 &&
        need.source !== "prep" &&
        !firmlyWanted(step.rank) &&
        this.candidates(need).some((c) => !c.row.collegeLevel)
      ) {
        for (const c of constraints) if (c.rank >= step.rank && !unmetIds.has(c.id)) this.ladderSkipped.add(c.id);
        continue;
      }
      // Two college-credit classes in one year are a semester each: the lower rung in the fall.
      const term = step.summer ? "summer" : step.college ? (solution.steps.some((o) => o !== step && o.college && o.grade === step.grade && o.rank < step.rank) ? "spring" : "fall") : undefined;
      placed.push({ step, placement: this.commit(row, step.grade, "ladder", need, priority, [], term) });
      this.refreshNeeds(this.items[this.items.length - 1]);
    }
    // Each rung's reason, from the steps actually placed: what the plan reaches is never a target
    // the solution leaves unmet or a rung it didn't place.
    const kept = constraints.filter((c) => !this.ladderSkipped.has(c.id));
    const target = Math.max(0, ...kept.map((c) => c.rank));
    const met = kept.filter((c) => !unmetIds.has(c.id));
    const topStep = Math.max(0, ...placed.map((x) => x.step.rank));
    // A middle schooler whose "by when" strip starts a rung in 8th ("Algebra I in 8th keeps
    // calculus in 12th open"): these high school rungs are the path without that, and say so.
    const early =
      ctx.firstGrade <= 8
        ? (this.fullLadder?.slack.find((e) => e.step.grade <= 8 && !e.step.summer && e.binding !== null && e.binding.rank > e.step.rank && e.latest === e.step.grade)?.step ?? null)
        : null;
    const fallback = early ? `If you don't take ${rungName(this.ladderFamilyValue, early.rank, ctx.state)} in ${nth(early.grade)}: ` : "";
    // Targets past the rung the family opted out of: the top step leads to the applied class that
    // takes that rung's place (never "precalculus would come in college").
    const optedOut = needsBefore.some((n) => n.missing > 0 && this.optedOutRank(isLadderish(n.selectors) ?? 0));
    for (const { step, placement } of placed) {
      // The rung's sources: the requirements and targets that set the ladder's goal.
      const targetNeeds = needsBefore.filter((n) => kept.some((c) => c.id === n.id && c.rank >= step.rank));
      const citations = [...new Set(targetNeeds.flatMap((n) => n.reasons.flatMap((r) => r.citations)))];
      const stepName = courseTypeTitle(placement.row.typeId, ctx.state);
      const above = met.filter((c) => c.rank > step.rank);
      const reached = above.length ? Math.max(...above.map((c) => c.rank)) : null;
      const text =
        reached !== null
          ? `${stepName} in ${nth(step.grade)} keeps ${rungName(this.ladderFamilyValue, reached, ctx.state)} by ${nth(Math.min(...above.filter((c) => c.rank === reached).map((c) => c.byGrade)))} open.`
          : step.rank < target
            ? step.rank >= topStep
              ? `${stepName} in ${nth(step.grade)}: ${rungName(this.ladderFamilyValue, target, ctx.state)} would come in college.`
              : `${stepName} in ${nth(step.grade)} is a step toward ${rungName(this.ladderFamilyValue, target, ctx.state)}.`
            : optedOut
              ? `${stepName} in ${nth(step.grade)} comes before the applied math class that takes the place of ${rungName(this.ladderFamilyValue, 3, ctx.state)}.`
              : `${stepName} in ${nth(step.grade)} reaches the math your goals ask for.`;
      placement.extraReasons.unshift(reason("ladder", `${fallback}${text}`, { claim: "suggestion", citations, params: { rank: step.rank, grade: step.grade } }));
    }
  }

  /**
   * The rungs that may be doubled up with the next (design §5.6: "the catalog or state allows the
   * pair"): a pair the state's facts name (Texas: Algebra I with Geometry, TEC §28.025(b-6)), or a
   * class on the list whose prerequisite one rung down may be taken the same year (a printed
   * concurrency, like Geometry with Algebra 2).
   */
  private doublePairs(grades: readonly SchoolGrade[]): number[] {
    const pairs = new Set<number>();
    for (const o of this.ctx.facts.options) {
      if (o.kind !== "double_up" || !o.types) continue;
      const ranks = o.types.map((t) => mathRankOf(t)).filter((r): r is number => r !== null).sort((a, b) => a - b);
      if (ranks.length === 2 && ranks[1] === ranks[0] + 1) pairs.add(ranks[0]);
    }
    for (const g of grades) {
      for (const row of this.ctx.catalogs.get(g)?.rows ?? []) {
        const rank = mathRankOf(row.typeId);
        if (rank === null || rank < 2 || rank > 3) continue;
        if (row.prereqGroups.some((grp) => grp.concurrentOk && grp.types.some((t) => mathRankOf(t) === rank - 1))) pairs.add(rank - 1);
      }
    }
    return [...pairs].sort((a, b) => a - b);
  }

  /** A college-credit (dual or concurrent enrollment) row for a rung in a grade, for the college move. */
  private collegeRowForRung(rank: number, grade: SchoolGrade): CatalogRow | null {
    const cat = this.ctx.catalogs.get(grade);
    if (!cat) return null;
    const sy = schoolYearOfGrade(this.ctx, grade);
    for (const typeId of rungTypes(this.ladderFamilyValue, rank)) {
      if (this.alreadyHas(typeId)) continue;
      const row = (cat.byType.get(typeId) ?? []).find((r) => r.level === "dual_enrollment" && rowIsOffered(r, grade, sy) && r.defaultTerm !== "summer");
      if (row) return row;
    }
    return null;
  }

  /** A regular-level row for a rung, taken the summer after `grade` (after that year's classes). */
  private summerRow(rank: number, grade: SchoolGrade): CatalogRow | null {
    const cat = this.ctx.catalogs.get(grade);
    if (!cat) return null;
    for (const typeId of rungTypes(this.ladderFamilyValue, rank)) {
      const row = (cat.byType.get(typeId) ?? []).find((r) => !r.collegeLevel && prereqsMetIn(this.items, r, grade, (i) => this.catalogIdOf(i), true));
      if (row) return row;
    }
    return null;
  }

  private placeEnglish(): void {
    const BY_GRADE: Record<number, CourseTypeId[]> = {
      9: ["ela.9", "ela.esol"],
      10: ["ela.10"],
      11: ["ela.11", "ela.lang_comp"],
      12: ["ela.12", "ela.lit_comp", "ela.lang_comp", "ela.college_prep"],
    };
    for (const grade of this.ctx.planGrades) {
      if (grade < 9) continue;
      const y = this.years.get(grade)!;
      if (this.items.some((i) => i.grade === grade && i.subject === "english" && !i.noCredit)) continue;
      const cat = this.ctx.catalogs.get(grade)!;
      const pref = this.preferredLevel("english");
      for (const typeId of BY_GRADE[grade]) {
        if (this.alreadyHas(typeId)) continue;
        const rows = (cat.byType.get(typeId) ?? [])
          .filter((r) => rowIsOffered(r, grade, y.schoolYear) && r.defaultTerm !== "summer")
          .sort((a, b) => Number(a.collegeLevel) - Number(b.collegeLevel) || Number(a.level !== pref) - Number(b.level !== pref) || levelOrder(a.level) - levelOrder(b.level));
        const it = rows[0] ? probe(rows[0], grade, y.schoolYear) : null;
        const need = it
          ? this.needs.find((n) => n.missing > 0 && !n.language && !held(n) && n.priority <= 3 && matchesAny(it, n.selectors) && n.selectors.some((s) => s.subjects?.includes("english") || s.types?.some((t) => t.startsWith("ela."))))
          : undefined;
        if (!need || !this.yearAllows(grade, need.priority)) continue;
        const row = rows.find((r) => !this.dismissed(need, r) && this.fits(grade, r, need.priority));
        if (!row) continue;
        this.commit(row, grade, "english", need, need.priority);
        this.refreshNeeds(this.items[this.items.length - 1]);
        break;
      }
    }
  }

  /**
   * The language to plan a same-language requirement in. `avoid`: the language a requirement for a
   * different language can't use (the one its partner counts).
   */
  private chooseLanguage(levels: number, avoid: LanguageCode | null = null): LanguageCode | null {
    if (this.ctx.choices.worldLanguage && this.ctx.choices.worldLanguage !== avoid) return this.ctx.choices.worldLanguage;
    // The language the student already takes (guesses count for sequencing).
    const own = this.items.filter((i) => i.own && i.subject === "world_language" && !i.noCredit);
    for (const i of own.sort((a, b) => b.grade - a.grade)) {
      const l = getCourseType(i.typeId).ladder;
      if (l?.id.startsWith("lang.") && !l.id.endsWith(".other") && l.id.slice(5) !== avoid) return l.id.slice(5) as LanguageCode;
    }
    for (const code of LANGUAGES) {
      if (code === "other" || code === avoid) continue;
      const offered = [1, 2].slice(0, levels).every((lv) => this.ctx.planGrades.some((g) => (this.ctx.catalogs.get(g)!.byType.get(`lang.${code}.${lv}` as CourseTypeId) ?? []).length > 0));
      if (offered) return code;
    }
    return null;
  }

  private placeLanguages(maxPriority = 3): void {
    for (const need of [...this.needs].filter((n) => n.language && n.missing > 0 && !held(n) && n.priority <= maxPriority).sort((a, b) => a.priority - b.priority)) {
      const code = this.chooseLanguage(need.language!.levels, this.partnerLanguage(need));
      if (!code) {
        this.blocked.set(need.id, "not_offered");
        continue;
      }
      // The years after the one in progress first (its schedule is mostly set).
      let result = this.placeLanguageLevels(need, code, false);
      if (result === "doesnt_fit") {
        // Consecutive years with room: move classes that can go in another year out of the way
        // (a required class that fits just as well in 12th), then try again.
        const moves = this.makeRoomForLanguage(need, code);
        if (moves.length) {
          result = this.placeLanguageLevels(need, code, false);
          if (result !== "placed") for (const undo of moves.reverse()) undo();
        }
      }
      if (result === "doesnt_fit" && this.ctx.inProgressGrade !== null) result = this.placeLanguageLevels(need, code, true);
      // Another route that doesn't need these language years (five social studies credits for Arts
      // and Humanities, programming for Texas's language credits), if the rule has one.
      if (result === "doesnt_fit") this.trySwitch(need);
      this.refreshNeeds();
    }
  }

  /** For a requirement that asks for a different language: the language its partner requirement counts. */
  private partnerLanguage(need: Need): LanguageCode | null {
    const req = need.leaf?.req;
    if (!need.rc || req?.kind !== "same_language" || !req.differentFrom) return null;
    const partner = this.current.get(need.rc.rs.id)?.leaves.find((l) => l.leaf.id === req.differentFrom);
    const first = partner?.counted[0]?.item;
    const ladder = first ? getCourseType(first.typeId).ladder : null;
    return ladder?.id.startsWith("lang.") ? (ladder.id.slice(5) as LanguageCode) : null;
  }

  /** The levels still to take in one language, in consecutive years; a partial sequence is taken back out. */
  private placeLanguageLevels(need: Need, code: LanguageCode, allowCurrent: boolean): "placed" | "doesnt_fit" | "not_offered" {
    const ladderId = `lang.${code}`;
    let reached = 0;
    let lastGrade = 0;
    for (const i of this.items) {
      if (!countsForSequence(i)) continue;
      const l = getCourseType(i.typeId).ladder;
      if (l?.id === ladderId && l.rank > reached) {
        reached = l.rank;
        lastGrade = i.grade;
      }
    }
    const placedNow: Placement[] = [];
    const moves: (() => void)[] = [];
    // The levels still missing (counted on the plan as it is now: another requirement may have
    // placed a level since), each the next one up from the student's highest (Spanish IV after a
    // placed Spanish III, never Spanish I or II).
    const ranks = nextLanguageRanks(reached, this.languageMissing(need, ladderId));
    const usable = (grade: SchoolGrade) => {
      if (grade < 9 || grade <= lastGrade || grade < need.fromGrade || !this.yearAllows(grade, need.priority)) return false;
      // The year in progress only to continue last year's language class (Spanish II right after
      // Spanish I is probably what the student is taking now), unless nothing later fits.
      const continues = this.items.some((i) => i.own && i.grade === grade - 1 && countsForSequence(i) && getCourseType(i.typeId).ladder?.id === ladderId);
      if (!allowCurrent && grade === this.ctx.inProgressGrade && !continues) return false;
      return !this.items.some((i) => i.grade === grade && getCourseType(i.typeId).ladder?.id === ladderId);
    };
    for (const level of ranks) {
      const typeId = `lang.${code}.${level}` as CourseTypeId;
      let placed = false;
      // Consecutive years of one language (design §5.7): the year right after the last level
      // first, moving a class that fits just as well in another year out of it (Visual Art from
      // 11th to 12th, so Spanish II follows Spanish I), and then the "Your choice" slot, before
      // skipping a year.
      const next = (lastGrade + 1) as SchoolGrade;
      let nextRow: CatalogRow | null = null;
      if (lastGrade >= 8 && this.ctx.planGrades.includes(next) && usable(next)) {
        const tried: (() => void)[] = [];
        for (let tries = 0; tries < 2 && !this.languageRow(need, typeId, next, true); tries++) {
          const moved = this.moveOut(next, new Set([next]), need.priority);
          if (!moved) break;
          tried.push(moved);
        }
        nextRow = this.languageRow(need, typeId, next) ?? this.languageRow(need, typeId, next, true);
        if (nextRow) moves.push(...tried);
        else for (const undo of tried.reverse()) undo();
      }
      for (const grade of this.ctx.planGrades) {
        if (!usable(grade)) continue;
        const row = grade === next && nextRow ? nextRow : this.languageRow(need, typeId, grade);
        if (!row) continue;
        // A year without the language before this level: say so, the counselor may find room. Only
        // for a year still ahead (or in progress): a senior can't take it in 10th any more.
        const skipped = lastGrade >= 8 && grade > lastGrade + 1 && this.ctx.planGrades.includes((lastGrade + 1) as SchoolGrade);
        const extra = skipped
          ? [reason("gap", `There's a year without ${LANGUAGE_NAMES[code]} before this class because ${nth(lastGrade + 1)} grade is full. Ask your counselor whether it can come in ${nth(lastGrade + 1)} instead.`, { claim: "suggestion" })]
          : [];
        placedNow.push(this.commit(row, grade, "language", need, need.priority, extra));
        lastGrade = grade;
        placed = true;
        break;
      }
      if (!placed) {
        const offered = this.ctx.planGrades.some((g) => (this.ctx.catalogs.get(g)!.byType.get(typeId) ?? []).length > 0);
        this.blocked.set(need.id, offered ? "doesnt_fit" : "not_offered");
        // One level of a language doesn't meet "two years of one language": take it back out,
        // with the classes moved for it.
        for (const p of placedNow.reverse()) this.uncommit(p);
        for (const undo of moves.reverse()) undo();
        if (!offered) this.trySwitch(need);
        return offered ? "doesnt_fit" : "not_offered";
      }
    }
    this.blocked.delete(need.id);
    return "placed";
  }

  /** Levels of one language a same-language need still misses on the plan as it is now. */
  private languageMissing(need: Need, ladderId: string): number {
    const levels = need.language!.levels;
    const inLanguage = asPlanned(this.items).filter((i) => i.creditable && getCourseType(i.typeId).ladder?.id === ladderId);
    return Math.max(0, levels - languageLevelsFilled(inLanguage, levels).length);
  }

  /** A row for a language level in a grade with room (`noReserve`: the "Your choice" slot may go). */
  private languageRow(need: Need, typeId: CourseTypeId, grade: SchoolGrade, noReserve = false): CatalogRow | null {
    const pref = this.preferredLevel("world_language");
    const priority = noReserve ? (Math.min(need.priority, 1) as DemandPriority) : need.priority;
    return (
      (this.ctx.catalogs.get(grade)!.byType.get(typeId) ?? [])
        .filter((r) => rowIsOffered(r, grade, schoolYearOfGrade(this.ctx, grade)) && r.defaultTerm !== "summer" && !this.dismissed(need, r))
        .sort((a, b) => Number(a.collegeLevel) - Number(b.collegeLevel) || Number(a.level !== pref) - Number(b.level !== pref))
        .find((r) => this.fits(grade, r, priority)) ?? null
    );
  }

  /**
   * Frees one class slot in each of the next consecutive years a language needs by moving suggested
   * classes that fit just as well in another year outside them (same class, inside its need's
   * window, prerequisites kept). Returns the moves as undo steps; none when it can't free them all.
   */
  private makeRoomForLanguage(need: Need, code: LanguageCode): (() => void)[] {
    const ladderId = `lang.${code}`;
    const done = Math.max(0, ...this.items.filter((i) => countsForSequence(i) && getCourseType(i.typeId).ladder?.id === ladderId).map((i) => getCourseType(i.typeId).ladder!.rank));
    const lastGrade = Math.max(0, ...this.items.filter((i) => countsForSequence(i) && getCourseType(i.typeId).ladder?.id === ladderId).map((i) => i.grade));
    const ranks = nextLanguageRanks(done, this.languageMissing(need, ladderId));
    const levels = ranks.length;
    const years = this.ctx.planGrades.filter((g) => g >= 9 && g > lastGrade && g >= need.fromGrade && g !== this.ctx.inProgressGrade && this.yearAllows(g, need.priority));
    for (let i = 0; i + levels <= years.length; i++) {
      const window = years.slice(i, i + levels);
      const undo: (() => void)[] = [];
      let ok = true;
      for (let k = 0; k < window.length && ok; k++) {
        const grade = window[k];
        const typeId = `lang.${code}.${ranks[k]}` as CourseTypeId;
        while (!this.languageRow(need, typeId, grade)) {
          // Out of this year, into a later one (or a year outside the window), never back into a
          // year already cleared for an earlier level.
          const moved = this.moveOut(grade, new Set(window.slice(0, k + 1)), need.priority);
          if (!moved) {
            ok = false;
            break;
          }
          undo.push(moved);
        }
      }
      if (ok) return undo;
      for (const u of undo.reverse()) u();
    }
    return [];
  }

  /**
   * Moves one suggested class out of `grade` to a year outside `avoid` where it fits the same way,
   * for a need of priority `forPriority`. A core class (English, math, science, social studies, a
   * language) moves only to another of its usual grades (Chemistry stays in 10th-11th), and never
   * for a lower-priority need than its own (a required Chemistry stays put for a recommended
   * language); an elective-type class (the arts, PE, a career class) may move anywhere its need
   * allows.
   */
  /**
   * `pathwayFor`: a career pathway level placed for a lower-priority need than this may move too, to
   * a year that keeps its levels in order (a required U.S. History takes 11th, and the pathway's
   * level goes a year later).
   */
  private moveOut(grade: SchoolGrade, avoid: Set<number>, forPriority: DemandPriority, only: (p: Placement) => boolean = () => true, pathwayFor: DemandPriority | null = null): (() => void) | null {
    const core = (p: Placement) => ["english", "math", "science", "social_studies", "world_language"].includes(p.item.subject);
    const kindOk = (p: Placement) => p.kind === "fill" || (pathwayFor !== null && p.kind === "cte" && p.priority > pathwayFor);
    const movable = this.placements
      .filter((p) => p.item.grade === grade && kindOk(p) && (p.priority >= forPriority || !core(p)) && only(p) && p.item.term !== "summer" && p.upgradedFrom === null && this.removableWithoutBreaking(p))
      .sort((a, b) => b.priority - a.priority || b.n - a.n);
    for (const p of movable) {
      const need = p.primary;
      const [from, by] = need ? this.window(need) : [9, 12];
      const [usualFrom, usualTo] = getCourseType(p.row.typeId).grades;
      for (const g of this.ctx.planGrades) {
        // Never into the year in progress: its schedule is mostly set.
        if (avoid.has(g) || g === this.ctx.inProgressGrade || g < Math.max(9, from) || g > by || !this.yearAllows(g, p.priority)) continue;
        if ((core(p) && (g < usualFrom || g > usualTo)) || !this.typeAllowed(p.row.typeId, g, p.row.units)) continue;
        if (p.kind === "cte" && !this.levelOrderKept(p, g)) continue;
        const row = (this.ctx.catalogs.get(g)!.byType.get(p.row.typeId) ?? []).find((r) => r.level === p.row.level && r.units === p.row.units && rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g)) && r.defaultTerm !== "summer");
        if (!row || !this.fits(g, row, p.priority)) continue;
        this.uncommit(p);
        if (!this.prereqsMet(row, g) || (row.subject === "math" && need && !this.secondMathAllowed(need, g))) {
          this.restore(p);
          continue;
        }
        const moved = this.commit(row, g, p.kind, need, p.priority, p.extraReasons);
        return () => {
          this.uncommit(moved);
          this.restore(p);
        };
      }
    }
    return null;
  }


  /** A pathway level moved to `grade` stays after the levels below it and before the ones above, one a year. */
  private levelOrderKept(p: Placement, grade: SchoolGrade): boolean {
    const rung = getCourseType(p.item.typeId).ladder;
    if (!rung) return true;
    return this.items.every((i) => {
      if (i === p.item || !countsForSequence(i)) return true;
      const l = getCourseType(i.typeId).ladder;
      if (l?.id !== rung.id) return true;
      return l.rank < rung.rank ? i.grade < grade : l.rank > rung.rank ? i.grade > grade : i.grade !== grade;
    });
  }

  private placeCte(): void {
    const needs = this.needs.filter((n) => n.id.startsWith("cte:") && n.missing > 0).sort((a, b) => a.id.localeCompare(b.id));
    let lastGrade = 0;
    for (const i of this.items) {
      const cluster = needs[0]?.id.slice(4, needs[0].id.indexOf("/"));
      if (cluster && getCourseType(i.typeId).ladder?.id === `cte.${cluster}` && countsForSequence(i)) lastGrade = Math.max(lastGrade, i.grade);
    }
    for (const need of needs) {
      const cands = this.candidates(need).filter((c) => c.grade > lastGrade);
      if (cands.length === 0) {
        this.blocked.set(need.id, this.staticCandidates(need).length ? "doesnt_fit" : "not_offered");
        break;
      }
      const best = this.pick(need, cands);
      this.commit(best.row, best.grade, "cte", need, need.priority);
      lastGrade = best.grade;
      this.refreshNeeds(this.items[this.items.length - 1]);
    }
  }

  /** A requirement no class can meet: use the next-best alternative without it (for the owner and every rule set that joins it). */
  private trySwitch(need: Need): boolean {
    if (!need.rc || !need.leaf) return false;
    const owner = need.rc;
    const leafId = need.leaf.id;
    const affected = this.config.ruleSets.filter((rc) => rc === owner || rc.bases.some((b) => b.rs.id === owner.rs.id));
    let changed = false;
    for (const rc of affected) {
      const excluded = this.excluded.get(rc.rs.id) ?? new Set<string>();
      if (excluded.has(leafId)) continue;
      excluded.add(leafId);
      this.excluded.set(rc.rs.id, excluded);
      const before = this.chosen.get(rc.rs.id);
      this.chosen.delete(rc.rs.id);
      const alt = this.evaluateChosen(rc);
      if (!alt) {
        if (before !== undefined) this.chosen.set(rc.rs.id, before);
        continue;
      }
      this.current.set(rc.rs.id, alt);
      if (this.chosen.get(rc.rs.id) !== before) changed = true;
    }
    if (changed) this.refreshNeeds();
    return changed;
  }

  blockReason(need: Need): BlockReason {
    if (need.seniorMath?.askFirst) return "ask";
    // The student took the class before 9th grade without high school credit (Algebra I in 8th):
    // whether it counts is the counselor's question, not a class to add again.
    if (earlyWithoutCredit(this.items, need.selectors)) return "hs_credit";
    if (this.equivalentTaken(need) || this.staticCandidates(need).some(({ row, grade }) => this.repeatsMathRung(row.typeId, grade))) return "equivalent";
    if (need.byGrade < this.ctx.firstGrade && need.byGrade < 12) return "past";
    const inWindow = this.staticCandidates(need).filter(({ row, grade }) => grade >= this.window(need)[0] && grade <= this.window(need)[1] && !this.alreadyHas(row.typeId));
    const stat = inWindow.filter(({ row }) => !(this.ctx.choices.utMath3OptOut && mathRankOf(row.typeId) === 3));
    if (inWindow.length > 0 && stat.length === 0) return "choice";
    if (stat.length === 0) return "not_offered";
    const collegeOnly = stat.every((c) => c.row.collegeLevel);
    if (collegeOnly && stat.every((c) => this.years.get(c.grade)!.college >= this.cap())) return "load";
    if (stat.every((c) => this.dismissed(need, c.row))) return "dismissed";
    return "doesnt_fit";
  }

  /** Taking this suggestion out leaves every later suggestion's prerequisites met. */
  private removableWithoutBreaking(p: Placement): boolean {
    const idx = this.items.indexOf(p.item);
    if (idx < 0) return true;
    this.items.splice(idx, 1);
    // Later classes, including a summer class after the same school year and a spring class after a fall one.
    const later = (q: Placement) =>
      q.item.grade > p.item.grade ||
      (q.item.grade === p.item.grade && ((q.item.term === "summer" && p.item.term !== "summer") || (q.item.term === "spring" && p.item.term === "fall")));
    const ok = this.placements.every(
      (q) =>
        q === p ||
        !later(q) ||
        q.kind === "english" ||
        (q.item.term === "summer" ? prereqsMetIn(this.items, q.row, q.item.grade, (i) => this.catalogIdOf(i), true) : this.prereqsMet(q.row, q.item.grade, [], q.item.term === "spring")),
    );
    this.items.splice(idx, 0, p.item);
    return ok;
  }

  /**
   * A suggestion placed for a lower-priority need can also count for a higher one (Precalculus for a
   * college's recommendation is also Utah's senior-year math): taking it out would leave a need of
   * this priority or higher less met.
   */
  private servesUpTo(p: Placement, priority: DemandPriority): boolean {
    const before = new Map(this.needs.filter((n) => n.priority <= priority).map((n) => [n.id, n.missing]));
    const idx = this.items.indexOf(p.item);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    this.refreshNeeds();
    const worse = this.needs.some((n) => n.priority <= priority && n.missing > (before.get(n.id) ?? 0));
    this.items.splice(idx, 0, p.item);
    this.refreshNeeds();
    return worse;
  }

  /**
   * Frees room for a need by moving out lower-priority suggestions (design §5.7 repair). `later`:
   * only in the years after the one in progress.
   */
  private evictFor(need: Need, later = false): boolean {
    const current = this.ctx.inProgressGrade;
    const cands = this.candidates(need, true).filter((c) => !later || (current !== null && c.grade > current));
    let best: { cand: (typeof cands)[number]; evict: Placement[] } | null = null;
    for (const cand of cands) {
      const y = this.years.get(cand.grade)!;
      const halves = slotHalves(cand.row.defaultTerm, cand.row.units);
      // The lowest-priority suggestions first (design §5.7), including a recommended language year,
      // a career pathway level or math class that nothing later builds on; never English.
      const movable = this.placements
        .filter((p) => p.item.grade === cand.grade && p.kind !== "english" && p.priority > need.priority && p.item.term !== "summer")
        .filter((p) => this.removableWithoutBreaking(p) && !this.servesUpTo(p, need.priority))
        .sort((a, b) => b.priority - a.priority || b.n - a.n);
      const evict: Placement[] = [];
      let free = y.capHalves - y.used - (y.reserve && need.priority >= 2 ? 2 : 0);
      for (const p of movable) {
        if (free >= halves) break;
        evict.push(p);
        free += slotHalves(p.item.term, p.item.units);
      }
      if (free < halves) continue;
      if (!best || evict.length < best.evict.length) best = { cand, evict };
    }
    if (!best) return false;
    for (const p of best.evict) this.uncommit(p);
    this.commit(best.cand.row, best.cand.grade, "fill", need, need.priority);
    this.refreshNeeds();
    return true;
  }

  /**
   * A recommended (P2) class with no room: it takes the place of a lower-priority suggestion (a
   * career pathway level, a major-prep class) in a year it can go in, when that leaves every
   * requirement and recommendation at least as met and meets more of this one (design §5.6: P2
   * ranks above P3): a health science pathway's level 3 gives way to the Physics Utah State
   * recommends. The class that gave way goes elsewhere if it can.
   */
  private swapFor(need: Need): boolean {
    const [from, by] = this.window(need);
    const before = new Map(this.needs.map((n) => [n.id, n.missing]));
    const weightBefore = this.weightedMissing();
    const pool = this.placements.filter(
      (p) =>
        p.priority > need.priority &&
        p.kind !== "english" &&
        p.item.term !== "summer" &&
        p.upgradedFrom === null &&
        p.item.grade >= from &&
        p.item.grade <= by &&
        !this.years.get(p.item.grade)?.inProgress &&
        this.removableWithoutBreaking(p),
    );
    let best: { p: Placement; cand: { row: CatalogRow; grade: SchoolGrade }; weight: number } | null = null;
    for (const p of pool) {
      const at = this.takeOut(p);
      this.refreshNeeds();
      const cands = this.candidates(need).filter((c) => c.grade === p.item.grade);
      if (cands.length) {
        const cand = this.pick(need, cands);
        const placed = this.commit(cand.row, cand.grade, "fill", need, need.priority);
        this.refreshNeeds();
        const kept = this.needs.every((n) => n.priority > need.priority || n.missing <= (before.get(n.id) ?? 0));
        const helped = (this.needs.find((n) => n.id === need.id)?.missing ?? 0) < (before.get(need.id) ?? 0);
        const weight = this.weightedMissing();
        if (kept && helped && weight < weightBefore && (!best || weight < best.weight)) best = { p, cand, weight };
        this.uncommit(placed);
        this.usedKeys.set(placed.baseKey, (this.usedKeys.get(placed.baseKey) ?? 1) - 1);
      }
      this.putBack(p, at);
      this.refreshNeeds();
    }
    if (!best) return false;
    this.uncommit(best.p);
    this.commit(best.cand.row, best.cand.grade, "fill", need, need.priority);
    this.refreshNeeds();
    // A career pathway level that gave way may fit a later year.
    if (best.p.primary?.id.startsWith("cte:")) this.placeCte();
    return true;
  }

  /** Takes a placement out, remembering where it was. */
  private takeOut(p: Placement): { item: number; placement: number } {
    const at = { item: this.items.indexOf(p.item), placement: this.placements.indexOf(p) };
    this.uncommit(p);
    return at;
  }

  /** Puts a placement taken out with `takeOut` back exactly where it was. */
  private putBack(p: Placement, at: { item: number; placement: number }): void {
    this.items.splice(at.item, 0, p.item);
    this.placements.splice(at.placement, 0, p);
    const y = this.years.get(p.item.grade);
    if (y) {
      y.used += slotHalves(p.item.term, p.item.units);
      if (p.row.collegeLevel) y.college++;
    }
  }

  private fillNeeds(maxPriority = 3): void {
    for (let p = 0; p <= maxPriority; p++) {
      for (let guard = 0; guard < 400; guard++) {
        for (const n of this.needs) if (n.seniorMath?.askFirst) this.blocked.set(n.id, "ask");
        const open = this.needs.filter((n) => n.priority <= p && n.missing > 0 && !this.blocked.has(n.id) && !n.language && !n.id.startsWith("cte:") && !held(n));
        if (open.length === 0) break;
        const withCands = open.map((n) => ({ n, cands: this.candidates(n) }));
        withCands.sort(
          (a, b) =>
            a.n.priority - b.n.priority ||
            Number(a.n.soft) - Number(b.n.soft) ||
            Number(this.deferred.has(a.n.id)) - Number(this.deferred.has(b.n.id)) ||
            Math.min(a.cands.length, 1) - Math.min(b.cands.length, 1) ||
            a.n.byGrade - b.n.byGrade ||
            new Set(a.cands.map((c) => c.grade)).size - new Set(b.cands.map((c) => c.grade)).size ||
            // Then the fewest years inside the class's usual grades (World History's 9th-10th before
            // U.S. History's 10th-11th before a class that fits 10th-12th), so the core classes with
            // a narrow window get their years first.
            usualYears(a.cands) - usualYears(b.cands) ||
            (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0),
        );
        const top = withCands[0];
        if (top.cands.length === 0 && this.pastLevelsOnly(top.n)) {
          // The next level of the student's own pathway isn't on the list (a Texas endorsement's
          // program after Automotive Basics and Automotive Technology I): the counselor knows the
          // school's sequence. No lower level, and no other program's classes in its place.
          this.blocked.set(top.n.id, "not_offered");
          continue;
        }
        if (top.cands.length === 0 && this.waitsOnConfirm.has(top.n.id)) {
          // Its classes are ones a row the student hasn't confirmed might already be: it waits on
          // the student, and the plan keeps its route (no switch to another way to meet it).
          this.blocked.set(top.n.id, "guessed");
          continue;
        }
        if (top.cands.length === 0) {
          if (top.n.priority <= 1 && !top.n.soft && this.evictFor(top.n)) continue;
          if (top.n.priority === 2 && !top.n.soft && this.swapFor(top.n)) continue;
          if (this.trySwitch(top.n)) continue;
          this.blocked.set(top.n.id, this.blockReason(top.n));
          // A class whose prerequisite a later placement may add (Computer Science II after CS
          // Principles) gets one more try after the next class is placed.
          if (!this.retried.has(top.n.id)) this.retry.add(top.n.id);
          continue;
        }
        let best = this.pick(top.n, top.cands);
        // A required class goes into a year in progress the student has recorded (its schedule is
        // set) only when no later year can take it, even by giving up a recommended or major-prep
        // suggestion there (Chemistry after a W goes in 12th, in place of an optional class).
        if (
          best.grade === this.ctx.inProgressGrade &&
          top.n.priority <= 1 &&
          !top.n.soft &&
          this.items.some((i) => i.own && i.grade === best.grade) &&
          !this.sequenceNeedsCurrentYear(top.n, top.cands) &&
          this.evictFor(top.n, true)
        )
          continue;
        // The "Your choice" slot yields before a recommended class goes outside its usual grades or
        // makes a third lab science in one year (Biology in 12th while 10th has room).
        if (top.n.priority >= 2 && this.misplaced(best.row, best.grade)) {
          const better = this.candidates(top.n, false, true).filter((c) => !this.misplaced(c.row, c.grade));
          if (better.length) best = this.pick(top.n, better);
          else best = this.roomInUsualGrades(top.n, best.row) ?? best;
        } else if (top.n.priority <= 1 && outsideUsualGrades(best.row, best.grade)) {
          // A required class outside its usual grades (U.S. History, which has an end-of-course exam,
          // in senior spring while 11th holds an art class or a career pathway level): an elective-type
          // class in a usual year moves to another of its years first.
          best = this.roomInUsualGrades(top.n, best.row, true) ?? best;
        }
        const before = top.n.missing;
        const weightedBefore = this.weightedMissing();
        const placed = this.commit(best.row, best.grade, "fill", top.n, top.n.priority);
        this.refreshNeeds(placed.item);
        const after = this.needs.find((n) => n.id === top.n.id)?.missing ?? 0;
        if (after < before || this.weightedMissing() < weightedBefore) {
          for (const id of this.retry) {
            this.blocked.delete(id);
            this.retried.add(id);
          }
          this.retry.clear();
        }
        if (after < before) {
          this.deferred.delete(top.n.id);
        } else if (this.weightedMissing() < weightedBefore && !this.deferred.has(top.n.id)) {
          // The class counts for another requirement of the same route instead (Chemistry placed for a
          // 4th science fills "IPC, Chemistry or Physics"): keep it, and let other needs place their
          // own classes before this one tries again.
          this.deferred.add(top.n.id);
        } else {
          // The class didn't count after all: don't keep adding.
          this.uncommit(placed);
          this.refreshNeeds();
          this.blocked.set(top.n.id, "doesnt_fit");
        }
      }
    }
  }

  /**
   * The exact check for required classes (design §5.7): a bipartite flow of required classes
   * (placed and still missing) into school years. If it places more than the greedy pass did, the
   * required classes are re-placed from the flow solution. Run for P0, then for P1 (a college's
   * required units): a P0 class can move into the year in progress to make room for a P1 class
   * that can't go there.
   */
  private exactFit(level: 0 | 1): void {
    const missing = this.needs.filter((n) => n.priority === level && n.missing > 0 && !n.language && this.blocked.get(n.id) === "doesnt_fit");
    if (missing.length === 0) return;
    // Classes that can move freely: nothing else builds on them, and what they build on stays put.
    const candidatesToMove = this.placements.filter((p) => p.kind === "fill" && p.priority <= level && p.item.term !== "summer");
    const fixed = this.items.filter((i) => !candidatesToMove.some((p) => p.item === i));
    const movable = candidatesToMove.filter((p) => this.removableWithoutBreaking(p) && prereqsMetIn(fixed, p.row, 12, (i) => this.catalogIdOf(i)));
    type Token = { need: Need | null; placement: Placement | null; priority: DemandPriority; options: { row: CatalogRow; grade: SchoolGrade }[] };
    const tokens: Token[] = [];
    for (const p of movable) {
      const opts: { row: CatalogRow; grade: SchoolGrade }[] = [];
      for (const g of this.ctx.planGrades) {
        if (g < 9 || !this.yearAllows(g, p.priority)) continue;
        const row = g === p.item.grade ? p.row : (this.ctx.catalogs.get(g)!.byType.get(p.row.typeId) ?? []).find((r) => r.level === p.row.level && rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g)));
        if (!row) continue;
        const need = p.primary;
        if (need) {
          const [from, by] = this.window(need);
          if (g < from || g > by) continue;
        }
        opts.push({ row, grade: g });
      }
      tokens.push({ need: p.primary, placement: p, priority: p.priority, options: opts });
    }
    for (const need of missing) {
      const opts = this.candidates(need, true);
      const unit = Math.max(1, ...opts.map((o) => (need.measure === "units" ? o.row.units : 1)));
      const count = Math.ceil(need.missing / unit);
      for (let i = 0; i < count; i++) tokens.push({ need, placement: null, priority: need.priority, options: opts });
    }
    const grades = this.ctx.planGrades.filter((g) => g >= 9);
    const T = tokens.length;
    const G = grades.length;
    const source = T + G;
    const sink = source + 1;
    const flow = new MinCostFlow(T + G + 2);
    const edgeOf: { t: number; g: number; e: number; row: CatalogRow }[] = [];
    tokens.forEach((tok, t) => {
      flow.addEdge(source, t, 1, 0);
      const seen = new Set<number>();
      for (const o of tok.options) {
        const gi = grades.indexOf(o.grade);
        if (gi < 0 || seen.has(gi)) continue;
        seen.add(gi);
        edgeOf.push({ t, g: gi, e: flow.addEdge(t, T + gi, 1, tok.placement && tok.placement.item.grade === o.grade ? 0 : 1), row: o.row });
      }
    });
    // Lower-priority suggestions the required classes may take the place of (language years, a CTE
    // pathway, lower-priority classes, a math class for a recommendation that nothing later builds
    // on), unless they also count for a requirement at this level; English stays.
    const evictable = (p: Placement) =>
      p.priority > level &&
      p.item.term !== "summer" &&
      (p.kind === "fill" || p.kind === "language" || p.kind === "cte" || (p.kind === "ladder" && this.removableWithoutBreaking(p))) &&
      !this.servesUpTo(p, level);
    const lowerAll = this.placements.filter(evictable);
    grades.forEach((g, gi) => {
      const y = this.years.get(g)!;
      const lower = lowerAll.filter((p) => p.item.grade === g);
      const movedHere = movable.filter((p) => p.item.grade === g);
      const room = y.capHalves - y.used + movedHere.reduce((n, p) => n + slotHalves(p.item.term, p.item.units), 0) + lower.reduce((n, p) => n + slotHalves(p.item.term, p.item.units), 0);
      flow.addEdge(T + gi, sink, Math.max(0, Math.floor(room / 2)), 0);
    });
    const { flow: placedTokens } = flow.run(source, sink);
    if (placedTokens <= movable.length) return;
    // Re-place: take out the required and lower-priority suggestions, then place from the flow.
    const weight = () => this.needs.reduce((sum, n) => sum + (n.missing > 0 && n.priority <= level ? WEIGHT[n.priority] * needUnits(n) : 0), 0);
    const before = weight();
    const snapshot = [...this.placements];
    for (const p of [...movable, ...lowerAll]) this.uncommit(p);
    const assigned = edgeOf.filter((x) => flow.flowOn(x.e) > 0);
    let ok = true;
    // Placed classes first (each must find its place again), then what was missing.
    for (const a of assigned.sort((x, y) => Number(!tokens[x.t].placement) - Number(!tokens[y.t].placement) || grades[x.g] - grades[y.g] || tokens[x.t].priority - tokens[y.t].priority)) {
      const tok = tokens[a.t];
      const need = tok.need ?? tok.placement?.primary ?? null;
      const grade = grades[a.g];
      if (!tok.placement && need) {
        // Two colleges' "4 math units" can be the same class: skip a need that's met by now.
        this.refreshNeeds();
        if ((this.needs.find((n) => n.id === need.id)?.missing ?? 0) <= 0) continue;
      }
      const row = tok.options.find(
        (o) =>
          o.grade === grade &&
          !this.alreadyHas(o.row.typeId) &&
          this.typeAllowed(o.row.typeId, grade, o.row.units) &&
          this.fits(grade, o.row, 0) &&
          this.prereqsMet(o.row, grade) &&
          (o.row.subject !== "math" || !need || this.secondMathAllowed(need, grade)),
      )?.row;
      if (!row) {
        if (!tok.placement) continue;
        ok = false;
        break;
      }
      this.commit(row, grade, "fill", need, tok.priority);
    }
    if (ok) {
      this.refreshNeeds();
      ok = weight() < before;
    }
    if (!ok) {
      // Put everything back as it was: the greedy placement stands.
      for (const p of [...this.placements]) if (!snapshot.includes(p) && p.kind === "fill") this.uncommit(p);
      for (const p of [...movable, ...lowerAll]) this.restore(p);
    }
    for (const n of missing) this.blocked.delete(n.id);
    this.refreshNeeds();
    for (const n of this.needs) if (n.priority > level) this.blocked.delete(n.id);
    // What the required classes displaced (or had to leave out) goes back where there's room, in order.
    if (ok) {
      for (const n of this.needs) if (n.language || n.id.startsWith("cte:")) this.blocked.delete(n.id);
      this.placeLanguages();
      this.placeCte();
    }
    this.fillNeeds();
  }

  /** Rigor (design §5.7): level choices only, in the families' "rigor first" subjects. */
  private rigor(): void {
    const ctx = this.ctx;
    const tier = ctx.tier.tier;
    if (tier === "open" || ctx.input.targets.path === "training") return;
    const firstGrade = tier === "admits_most" ? 11 : 10;
    const rigorFirst = new Set<CourseTypeId>();
    for (const f of this.config.families) for (const t of f.content?.rigorFirst ?? []) if (rigorFirst.size < 3) rigorFirst.add(t);
    if (rigorFirst.size === 0) return;
    const rigorLadders = new Set([...rigorFirst].map((t) => getCourseType(t).ladder?.id).filter((l): l is LadderId => l === "math" || l === "ela"));
    for (const p of [...this.placements].sort((a, b) => a.item.grade - b.item.grade || a.n - b.n)) {
      const grade = p.item.grade;
      if (grade < firstGrade || grade > 11 || p.item.term === "summer") continue;
      const y = this.years.get(grade)!;
      if (y.inProgress) continue;
      const ladder = getCourseType(p.row.typeId).ladder?.id;
      if (!rigorFirst.has(p.row.typeId) && !(ladder && rigorLadders.has(ladder))) continue;
      if (isCollegeLevel(p.item.level)) continue;
      // Mastery first: the last finished class in the subject was a B or better, when known.
      const last = this.items.filter((i) => i.own && i.subject === p.item.subject && i.completed && i.letter).sort((a, b) => b.grade - a.grade)[0];
      if (last && atLeast(last.letter, "B") === false) continue;
      const cat = ctx.catalogs.get(grade)!;
      // Same class, same credit and schedule: a level change never changes the year's load in classes.
      const options = (cat.byType.get(p.row.typeId) ?? []).filter(
        (r) => r.id !== p.row.id && r.units === p.row.units && r.defaultTerm === p.row.defaultTerm && rowIsOffered(r, grade, y.schoolYear),
      );
      const college = options
        .filter((r) => r.collegeLevel && y.college < ctx.limits.maxCollegeLevelPerYear)
        .sort((a, b) => ["ap", "ib", "cambridge", "dual_enrollment"].indexOf(a.level) - ["ap", "ib", "cambridge", "dual_enrollment"].indexOf(b.level));
      // A first-year biology or chemistry class stays at the school's regular or honors level: AP
      // and college chemistry normally follow a year of chemistry (they're sci.chem2 here).
      const honors = p.item.level === "regular" ? options.filter((r) => r.level === "honors") : [];
      if (firstOfItsKind(this.items, p)) college.length = 0;
      const forWhat = (p.primary?.forWhat ?? { ruleSetId: "plan", reqId: p.kind }) as Parameters<typeof suggestionKey>[0];
      // Honors first when the school offers it; college-level only where there's no honors version.
      const target = [...honors, ...college].find((r) => {
        if (this.ctx.dismissed.has(suggestionKey(forWhat, r.typeId, r.level))) return false;
        if (!this.prereqsMet(r, grade)) return false;
        const trial = probe(r, grade, y.schoolYear, p.item.term);
        // Still counts for everything it was placed for.
        return !p.primary || matchesAny(trial, p.primary.selectors);
      });
      if (!target) continue;
      this.upgrade(p, target, this.rigorReason(target));
    }
    this.upgradeForCollegeOnlyNeeds();
  }

  /**
   * Requirements only a college-level class meets (an aid rule's "one AP, IB or CE math class", an
   * AP or IB elective focus's three credits): a level change on a class already planned in grades
   * 10-11, within the cap, and only when the catalog offers that version. Never a new class. The
   * college-level load is spread (design §5.7, Appendix C: balance): each change goes in the year
   * with the fewest college-level classes, and a core class's AP version in its usual grade or
   * later (AP U.S. History in 11th, not 10th).
   */
  private upgradeForCollegeOnlyNeeds(): void {
    const cap = this.ctx.limits.maxCollegeLevelPerYear;
    const open = () => this.needs.filter((n) => n.missing > 0 && !n.soft && advancedOnly(n.selectors));
    for (const first of open()) {
      for (let guard = 0; guard < 40; guard++) {
        const need = this.needs.find((n) => n.id === first.id);
        if (!need || need.missing <= 0) break;
        const options: { p: Placement; row: CatalogRow; move?: { grade: SchoolGrade; regular: CatalogRow }; keys: number[] }[] = [];
        for (const p of this.placements) {
          const grade = p.item.grade;
          const y = this.years.get(grade)!;
          if (grade < 10 || grade > 11 || y.inProgress || p.item.term === "summer" || p.item.level !== "regular") continue;
          if (firstOfItsKind(this.items, p)) continue;
          // Mastery first: the last finished class in the subject was a B or better, when known.
          const last = this.items.filter((i) => i.own && i.subject === p.item.subject && i.completed && i.letter).sort((a, b) => b.grade - a.grade)[0];
          if (last && atLeast(last.letter, "B") === false) continue;
          const forWhat = (p.primary?.forWhat ?? { ruleSetId: "plan", reqId: p.kind }) as Parameters<typeof suggestionKey>[0];
          // Honors where it counts, before any college-level version (within the load cap).
          const row = (this.ctx.catalogs.get(grade)!.byType.get(p.row.typeId) ?? [])
            .filter((r) => r.level !== "regular" && (!r.collegeLevel || y.college < cap))
            .sort((a, b) => Number(a.collegeLevel) - Number(b.collegeLevel) || levelOrder(a.level) - levelOrder(b.level))
            .find((r) => {
              if (!rowIsOffered(r, grade, y.schoolYear) || r.units !== p.row.units || r.defaultTerm !== p.row.defaultTerm) return false;
              if (this.ctx.dismissed.has(suggestionKey(forWhat, r.typeId, r.level))) return false;
              const trial = probe(r, grade, y.schoolYear, p.item.term);
              return matchesAny(trial, need.selectors) && (!p.primary || matchesAny(trial, p.primary.selectors)) && this.prereqsMet(r, grade);
            });
          if (!row) continue;
          const t = getCourseType(p.row.typeId);
          const core = ["english", "math", "science", "social_studies"].includes(t.subject);
          const early = row.collegeLevel && core && grade < Math.min(11, t.grades[1]) ? 1 : 0;
          // A core class's AP version before its usual grade (AP U.S. History in 10th) moves to a
          // later year inside its usual grades when one has room (design §5.7: balance the load).
          const later = early ? this.laterUsualYear(p, row) : null;
          if (later) options.push({ p, row: later.row, move: { grade: later.grade, regular: later.regular }, keys: [Number(later.row.collegeLevel), this.years.get(later.grade)!.college, 0, later.grade, p.n] });
          else options.push({ p, row, keys: [Number(row.collegeLevel), row.collegeLevel ? y.college : 0, early, grade, p.n] });
        }
        if (options.length === 0) break;
        options.sort((a, b) => {
          for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
          return 0;
        });
        const { row, move } = options[0];
        let p = options[0].p;
        if (move) {
          this.uncommit(p);
          p = this.commit(move.regular, move.grade, p.kind, p.primary, p.priority, p.extraReasons);
        }
        this.upgrade(
          p,
          row,
          reason("rigor", `The ${row.collegeLevel ? "college-level" : "honors"} version of this class also counts for ${need.rc?.rs.title ?? need.label}. The regular class is fine too.`, {
            claim: "rule",
            ruleSetId: need.rc?.rs.id ?? null,
            reqId: need.leaf?.id ?? null,
            citations: need.leaf?.cite ?? [],
          }),
        );
        this.refreshNeeds(p.item);
      }
    }
  }

  /**
   * A later year inside a class's usual grades (and its need's window) where its college-level
   * version fits: offered there, room for it, under the load cap, its prerequisites met. Null when
   * none (the class stays and is upgraded where it is).
   */
  private laterUsualYear(p: Placement, row: CatalogRow): { grade: SchoolGrade; row: CatalogRow; regular: CatalogRow } | null {
    const [, usualTo] = getCourseType(p.row.typeId).grades;
    const [, by] = p.primary ? this.window(p.primary) : [9, 12];
    if (p.upgradedFrom !== null || !this.removableWithoutBreaking(p)) return null;
    for (const g of this.ctx.planGrades) {
      if (g <= p.item.grade || g > Math.min(usualTo, by, 11)) continue;
      const y = this.years.get(g);
      if (!y || y.inProgress || y.college >= this.cap()) continue;
      const sy = y.schoolYear;
      const rows = this.ctx.catalogs.get(g)!.byType.get(row.typeId) ?? [];
      const target = rows.find((r) => r.level === row.level && r.units === row.units && r.defaultTerm === row.defaultTerm && rowIsOffered(r, g, sy));
      const regular = rows.find((r) => r.level === p.row.level && r.units === p.row.units && r.defaultTerm === p.row.defaultTerm && rowIsOffered(r, g, sy));
      if (!target || !regular || !this.fits(g, target, p.priority) || !this.typeAllowed(target.typeId, g, target.units)) continue;
      const at = this.takeOut(p);
      const ok = this.prereqsMet(target, g);
      this.putBack(p, at);
      if (ok) return { grade: g, row: target, regular };
    }
    return null;
  }

  private rigorReason(row: CatalogRow): Reason {
    const families = this.config.families.filter(
      (f) => f.content?.rigorFirst.includes(row.typeId) || f.content?.rigorFirst.some((t) => getCourseType(t).ladder?.id === getCourseType(row.typeId).ladder?.id),
    );
    const fam = families[0];
    const subject = getCourseType(row.typeId).subject === "math" ? "Math" : getCourseType(row.typeId).title.replace(/ \(.*\)$/, "");
    return reason(
      "rigor",
      `${fam ? `${subject} is one of the subjects that matter most for ${lowerFirstWord(fam.title)}` : "This subject matters for your goals"}, so we suggest the ${row.level === "honors" ? "honors" : "college-level"} version. The regular class is fine too.`,
      { claim: "suggestion", familyId: fam?.target.familyId ?? null, citations: fam?.content?.math.cite ?? [] },
    );
  }

  private upgrade(p: Placement, row: CatalogRow, why: Reason): void {
    const y = this.years.get(p.item.grade)!;
    if (p.row.collegeLevel) y.college--;
    if (row.collegeLevel) y.college++;
    const from = p.item.level;
    const item: Item = { ...p.item, level: row.level, typeId: row.typeId, units: row.units };
    const idx = this.items.indexOf(p.item);
    this.items[idx] = item;
    p.item = item;
    p.row = row;
    p.upgradedFrom = from;
    p.extraReasons.push(why);
    // The key follows the level so a dismissal of this exact suggestion sticks.
    const forWhat = p.primary?.forWhat ?? { ruleSetId: "plan", reqId: p.kind };
    p.baseKey = suggestionKey(forWhat as Parameters<typeof suggestionKey>[0], row.typeId, row.level);
    p.key = p.baseKey;
    item.ref = { kind: "suggestion", key: p.key };
  }

  // Pruning -------------------------------------------------------------------------------------

  /** `allowed`, without routes through a rerouted program's requirement (unless that leaves none). */
  private notExcluded(rc: RuleSetCtx, allowed: ((alt: Alternative) => boolean) | undefined): ((alt: Alternative) => boolean) | undefined {
    const excluded = this.programExcluded.get(rc.rs.id);
    if (!excluded?.size) return allowed;
    const both = (alt: Alternative) => (!allowed || allowed(alt)) && !alt.leaves.some((l) => excluded.has(l.id));
    const left = rc.alternatives.filter(both);
    // Never narrow the audit to routes that count only a finished class (Utah's "calculus with a
    // C or better") when another route is open: the pick would have to report one of them.
    const whenDone = (alt: Alternative) => alt.leaves.some((l) => l.req.kind === "credits" && l.req.onlyWhenDone);
    if (left.length === 0 || (left.every(whenDone) && rc.alternatives.some((a) => (!allowed || allowed(a)) && !whenDone(a)))) return allowed;
    return both;
  }

  /**
   * One pass over the rule sets (bases first, extensions following them), with an optional last
   * tie-break. With `previous`, a rule set whose earlier result can't change (no tie-break to apply,
   * and its base kept its route) is reused.
   */
  private evalPass(items: Item[], unique?: (rc: RuleSetCtx, r: AltResult) => number, previous?: Map<string, RuleSetEval>): Map<string, RuleSetEval> {
    const finalChoice = new Map<string, Alternative>();
    const byId = new Map<string, RuleSetEval>();
    const changed = new Set<string>();
    for (const rc of [...this.config.ruleSets].sort((a, b) => a.bases.length - b.bases.length)) {
      const prev = previous?.get(rc.rs.id);
      const reuse =
        prev && unique && rc.alternatives.length > 1 && prev.best && unique(rc, evaluateAlternative(prev.best.alt, asPlanned(items), rc.allocation)) === 0 && !rc.bases.some((b) => changed.has(b.rs.id));
      const reuseSingle = prev && rc.alternatives.length <= 1;
      let e: RuleSetEval;
      if (prev && (reuse || reuseSingle)) e = prev;
      else {
        const base = this.pickOptions(rc, asPlanned(items), finalChoice);
        // A route the plan was told not to take (a program that wouldn't count) isn't the audit's either.
        const opts = { ...base, allowed: this.notExcluded(rc, base.allowed) };
        const prefer = opts.prefer!;
        e = evaluateRuleSet(rc, items, unique ? { ...opts, prefer: (r) => prefer(r) * 1000 - unique(rc, r) } : opts, asPlanned(items));
        if (prev && e.best?.alt.index !== prev.best?.alt.index) changed.add(rc.rs.id);
      }
      if (e.best) finalChoice.set(rc.rs.id, e.best.alt);
      byId.set(rc.rs.id, e);
    }
    return byId;
  }

  /**
   * Every rule set evaluated as the final audit does. Among routes that are equally met, the one
   * that leans least on suggestions nothing else needs wins (STEM's "one more math and one more
   * science" over "two more sciences" when the math class is already there for the DLA), so the
   * pruning step can take out the class the other route would have needed.
   */
  private finalEvals(items: Item[]): Map<string, RuleSetEval> {
    const signature = items.map((i) => `${i.key}:${i.typeId}:${i.level}:${i.grade}:${i.units}`).join("|");
    if (this.lastFinal?.signature === signature) return this.lastFinal.evals;
    const evals = this.computeFinalEvals(items);
    this.lastFinal = { signature, evals };
    return evals;
  }

  private computeFinalEvals(items: Item[]): Map<string, RuleSetEval> {
    const first = this.evalPass(items);
    const counters = new Map<string, Set<string>>();
    const count = (key: string, by: string) => counters.set(key, (counters.get(key) ?? new Set<string>()).add(by));
    // Which rule sets count each suggestion, on the routes as planned (the student's guessed kinds
    // taken as confirmed, exactly as for a student who picked them).
    const planned = asPlanned(items);
    for (const [id, e] of first) {
      const route = e.best ? evaluateAlternative(e.best.alt, planned, e.rc.allocation) : null;
      for (const l of route?.leaves ?? []) {
        if (l.leaf.req.kind === "total_credits" || l.leaf.req.kind === "remaining_electives") continue;
        for (const c of l.counted) if (!c.item.own) count(c.item.key, id);
      }
    }
    for (const need of this.familyNeedList()) for (const i of evaluatePrep(need, asPlanned(items)).counted) if (!i.own) count(i.key, need.id);
    const unique = (rc: RuleSetCtx, r: AltResult) => {
      let units = 0;
      const seen = new Set<string>();
      for (const l of r.leaves) {
        if (l.leaf.req.kind === "total_credits" || l.leaf.req.kind === "remaining_electives") continue;
        for (const c of l.counted) {
          if (c.item.own || seen.has(c.item.key)) continue;
          seen.add(c.item.key);
          const others = [...(counters.get(c.item.key) ?? [])].filter((id) => id !== rc.rs.id && !rc.bases.some((b) => b.rs.id === id));
          if (others.length === 0) units += c.item.units;
        }
      }
      return units;
    };
    // Only rule sets whose route leans on a class nothing else counts can change.
    return this.evalPass(items, unique, first);
  }

  /** What's still missing for every P0-P3 need (requirements, checks, major prep), by need id. */
  private missingByNeed(alts: Map<string, AltResult>, items: readonly Item[] = this.items): Map<string, number> {
    return new Map([...this.shortfalls(alts, items)].map(([id, v]) => [id, v.missing]));
  }

  /** What's still missing for every P0-P3 need, with its priority (the highest when two share an id). */
  private shortfalls(alts: Map<string, AltResult>, items: readonly Item[]): Map<string, { missing: number; priority: DemandPriority }> {
    const out = new Map<string, { missing: number; priority: DemandPriority }>();
    const add = (n: Need) => {
      if (n.priority > 3) return;
      const prev = out.get(n.id);
      out.set(n.id, { missing: Math.max(prev?.missing ?? 0, n.missing), priority: Math.min(prev?.priority ?? 3, n.priority) as DemandPriority });
    };
    for (const rc of this.config.ruleSets) {
      const alt = alts.get(rc.rs.id);
      if (alt) for (const n of needsFromEval(this.ctx, rc, alt)) add(n);
    }
    const confirmed = asPlanned(items);
    for (const need of this.familyNeedList()) {
      const { missing } = evaluatePrep(need, confirmed);
      if (missing > 0) add({ ...need, missing });
    }
    for (const n of this.checkNeeds(alts, items)) add(n);
    return out;
  }

  /** FillResult.missingWith: every rule set on its audit route, with one class swapped for another. */
  private missingWith(swap?: { out: Item; in: Item }): Map<string, { missing: number; priority: DemandPriority }> {
    const items = swap ? this.items.map((i) => (i === swap.out ? swap.in : i)) : this.items;
    const planned = asPlanned(items);
    const alts = new Map<string, AltResult>();
    for (const rc of this.config.ruleSets) {
      const idx = this.chosen.get(rc.rs.id);
      const alt = idx === undefined ? undefined : rc.alternatives.find((a) => a.index === idx);
      if (alt) alts.set(rc.rs.id, evaluateAlternative(alt, planned, rc.allocation));
    }
    return this.shortfalls(alts, items);
  }

  /**
   * Takes out suggestions nothing needs any more (lowest priority first): a class placed for one
   * route of a requirement that ended up met another way (programming for a language requirement
   * the student's Spanish meets), or a 5th science where 4 meet everything. A suggestion stays when
   * taking it out would leave any P0-P3 need less met on the audit's route, or break a later
   * class's prerequisite.
   */
  private prune(): void {
    // What each need still misses with the student's guessed types taken as confirmed (as the
    // fill planned): a suggestion that only stands in for a guessed class is taken out.
    let alts = new Map<string, AltResult>();
    const byRs = new Map(this.config.ruleSets.map((rc) => [rc.rs.id, rc]));
    for (const [id, e] of this.finalEvals(this.items)) if (e.best) alts.set(id, evaluateAlternative(e.best.alt, asPlanned(this.items), byRs.get(id)!.allocation));
    let before = this.missingByNeed(alts);
    const order = [...this.placements].sort((a, b) => b.priority - a.priority || b.item.grade - a.item.grade || b.n - a.n);
    for (const p of order) {
      // English each year stays: a class that also counts for the 4th English credit never takes its place.
      if (p.kind === "english" || !this.placements.includes(p) || !this.removableWithoutBreaking(p)) continue;
      const item = p.item;
      // Quick keep: a requirement or target that counts this class and couldn't be met without it,
      // even with every other matching class.
      if (this.plainlyNeeded(item, alts)) continue;
      this.uncommit(p);
      const trial = new Map(alts);
      const confirmed = asPlanned(this.items);
      for (const rc of this.config.ruleSets) {
        const alt = alts.get(rc.rs.id);
        if (alt && alt.leaves.some((l) => leafTouches(l.leaf, item))) trial.set(rc.rs.id, evaluateAlternative(alt.alt, confirmed, rc.allocation));
      }
      const after = this.missingByNeed(trial);
      if ([...after].some(([id, missing]) => missing > (before.get(id) ?? 0))) this.restore(p);
      else {
        alts = trial;
        before = after;
      }
    }
  }

  /**
   * A class some requirement (on the audit's route) or major-prep target counts, and that can't be
   * met without it: every other class that could count adds up to less than it needs. A cheap
   * test before the full re-evaluation; when it's false the full check decides.
   */
  private plainlyNeeded(item: Item, alts: Map<string, AltResult>): boolean {
    const others = asPlanned(this.items).filter((i) => i !== item && i.creditable);
    for (const alt of alts.values()) {
      for (const l of alt.leaves) {
        if (l.missing > 0 || !l.counted.some((c) => c.item === item)) continue;
        const req = l.leaf.req;
        if (req.kind === "credits") {
          const rest = others.filter((i) => leafAccepts(l.leaf, i)).reduce((n, i) => n + i.units, 0);
          if (rest < l.required) return true;
        } else if (req.kind === "count") {
          if (others.filter((i) => matchesAny(i, req.select)).length < l.required) return true;
        }
      }
    }
    for (const need of this.familyNeedList()) {
      if (!matchesAny(item, need.selectors)) continue;
      const rest = others.filter((i) => matchesAny(i, need.selectors)).reduce((n, i) => n + (need.measure === "units" ? i.units : 1), 0);
      if (rest < need.required) return true;
    }
    return false;
  }

  /**
   * A required (P0-P1) class that ended up outside its usual grades, when a year inside them has
   * room by the end (pruning, or a class that moved, freed it): it moves back in (U.S. History from
   * senior year to 11th, where a "Your choice" slot is left). Never into the year in progress.
   */
  private pullIntoUsualGrades(): void {
    for (const p of [...this.placements].sort((a, b) => a.n - b.n)) {
      if (p.kind !== "fill" || p.priority > 1 || p.item.term === "summer" || p.upgradedFrom !== null || !outsideUsualGrades(p.row, p.item.grade)) continue;
      if (!this.placements.includes(p) || !this.removableWithoutBreaking(p)) continue;
      const need = p.primary;
      const [from, by] = need ? this.window(need) : [9, 12];
      const [usualFrom, usualTo] = getCourseType(p.row.typeId).grades;
      for (const g of this.ctx.planGrades) {
        if (g < Math.max(9, from, usualFrom) || g > Math.min(by, usualTo) || g === this.ctx.inProgressGrade || !this.yearAllows(g, p.priority)) continue;
        const row = (this.ctx.catalogs.get(g)!.byType.get(p.row.typeId) ?? []).find(
          (r) => r.level === p.row.level && r.units === p.row.units && rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g)) && r.defaultTerm !== "summer",
        );
        if (!row || !this.fits(g, row, p.priority) || !this.typeAllowed(row.typeId, g, row.units)) continue;
        this.uncommit(p);
        if (!this.prereqsMet(row, g) || (row.subject === "math" && need && !this.secondMathAllowed(need, g))) {
          this.restore(p);
          continue;
        }
        this.commit(row, g, p.kind, need, p.priority, p.extraReasons);
        break;
      }
    }
  }

  /** Needs blocked for lack of room that now have a place: unblocked and filled again. */
  private retryFreedRoom(): boolean {
    const stuck = this.needs.filter((n) => n.missing > 0 && this.blocked.get(n.id) === "doesnt_fit" && !n.language && !n.id.startsWith("cte:") && !held(n));
    const ready = stuck.filter((n) => this.candidates(n).length > 0);
    if (ready.length === 0) return false;
    for (const n of ready) this.blocked.delete(n.id);
    const before = this.placements.length;
    this.fillNeeds();
    return this.placements.length !== before;
  }

  /** Puts an uncommitted placement back exactly as it was. */
  private restore(p: Placement): void {
    this.items.push(p.item);
    this.placements.push(p);
    const y = this.years.get(p.item.grade);
    if (y) {
      y.used += slotHalves(p.item.term, p.item.units);
      if (p.row.collegeLevel) y.college++;
    }
  }

  run(): FillResult {
    this.refreshNeeds();
    // Every rule set has a route now: each picks again, knowing what the others still ask for.
    this.chosen.clear();
    this.refreshNeeds();
    this.baselineNeeds = this.needs.map((n) => ({ ...n }));
    this.placeLadder();
    this.placeEnglish();
    // Required language years (they need consecutive years) and a career pathway (levels in order),
    // then required classes, then recommended language years, then the rest (design §5.7).
    if (this.config.cteFirst) {
      this.placeCte();
      this.placeLanguages(1);
    } else {
      this.placeLanguages(1);
      this.placeCte();
    }
    this.fillNeeds(1);
    this.placeLanguages();
    this.fillNeeds();
    this.exactFit(0);
    this.exactFit(1);
    this.rigor();
    this.prune();
    this.pullIntoUsualGrades();
    // Room a pruned suggestion left (a class placed for a route the plan gave up on): a class
    // blocked earlier for lack of room gets another try, so "doesn't fit" is never said of a year
    // that has room.
    if (this.retryFreedRoom()) {
      this.prune();
      this.pullIntoUsualGrades();
    }
    // Final: every rule set, every alternative.
    const byId = this.finalEvals(this.items);
    const evals = this.config.ruleSets.map((rc) => byId.get(rc.rs.id)!);
    // What's still needed follows the audit's choice of route for each rule set.
    for (const e of evals) if (e.best) this.chosen.set(e.rc.rs.id, e.best.alt.index);
    this.refreshNeeds();
    // Keys must be unique in the plan.
    const seen = new Map<string, number>();
    for (const p of this.placements) {
      const count = (seen.get(p.baseKey) ?? 0) + 1;
      seen.set(p.baseKey, count);
      p.key = count === 1 ? p.baseKey : `${p.baseKey}#${count}`;
      p.item.ref = { kind: "suggestion", key: p.key };
    }
    const unmet = new Map<string, BlockReason>();
    // A need a row the student hasn't confirmed might meet is waiting on them, never a gap. So is
    // any need a class held for a confirmation would have counted for (the Algebra I held while a
    // guessed row might be past it would also be one of "four math units").
    const holding = this.needs.filter((n) => n.missing > 0 && held(n));
    for (const n of this.needs) {
      if (n.missing <= 0) continue;
      const waits = n.waiting || n.guessedPast || overlapsHeld(n, holding) || (this.waitsOnConfirm.has(n.id) && this.candidates(n).length === 0);
      unmet.set(n.id, waits ? "guessed" : (this.blocked.get(n.id) ?? this.blockReason(n)));
    }
    return {
      config: this.config,
      unmet,
      items: this.items,
      placements: this.placements,
      years: this.years,
      needs: this.needs,
      baselineNeeds: this.baselineNeeds,
      blocked: this.blocked,
      evals,
      ladder: { family: this.ladderFamilyValue, problem: this.ladderProblem, solution: this.ladderSolution, constraints: this.ladderConstraints, fullSolution: this.fullLadder, skipped: this.ladderSkipped },
      chosen: this.chosen,
      missingWith: (swap) => this.missingWith(swap),
      pastLevelsOnly: (need) => this.pastLevelsOnly(need),
      fitsThisYear: (need) => this.fitsThisYear(need),
    };
  }
}

/**
 * Whether `items` meet a row's prerequisites for a class in `grade`: each group by a class before
 * that grade (a summer class sits in the grade it follows), or in the same grade when the list
 * prints it as concurrent, or when the new class is itself taken the summer after that grade. A
 * higher rung on the same ladder also meets it (calculus meets an Algebra II prerequisite), unless
 * the student failed or withdrew from a rung at or below the one named and hasn't passed it since
 * (an F in Algebra I followed by Geometry doesn't meet Algebra II's Algebra I prerequisite). Failed
 * and withdrawn classes don't count; a finished class below a printed minimum letter doesn't.
 */
export function prereqsMetIn(items: Item[], row: CatalogRow, grade: SchoolGrade, catalogIdOf: (i: Item) => string | null, summer = false, spring = false): boolean {
  return row.prereqGroups.every((group) => {
    const ladders = group.types.map((t) => getCourseType(t).ladder);
    const sameLadder = ladders.length > 0 && ladders.every((l) => l && l.id === ladders[0]!.id) ? ladders[0]!.id : null;
    const maxRank = sameLadder ? Math.max(...ladders.map((l) => l!.rank)) : 0;
    // A fall class comes before a spring class of the same year (a college semester of
    // precalculus, then Calculus I).
    const before = (i: Item) => i.grade < grade || (i.grade === grade && (group.concurrentOk || (summer && i.term !== "summer") || (spring && i.term === "fall")));
    // A career pathway's earlier levels, counted one a year when the names don't tell them apart
    // (two years of Engineering Design meet a level-3 class's level-2 prerequisite). Classes whose
    // level is known (two level-1 classes) are only the level they are.
    if (sameLadder?.startsWith("cte.")) {
      const earlier = items.filter((i) => countsForSequence(i) && before(i));
      const cluster = sameLadder.slice(4);
      if (earlier.some((i) => levelUnknown(i, cluster)) && cteYears(earlier, cluster) >= maxRank) return true;
    }
    // A rung at or below the named one that was failed and not passed since blocks higher rungs standing in.
    const gapBelow = sameLadder !== null && ladderGapAtOrBelow(items.filter(before), sameLadder, maxRank);
    return items.some((i) => {
      if (!countsForSequence(i)) return false;
      if (!before(i)) return false;
      let ok = group.types.includes(i.typeId);
      if (!ok && sameLadder && !gapBelow) {
        const l = getCourseType(i.typeId).ladder;
        // College Algebra sits on precalculus's rung but never stands in for precalculus or
        // trigonometry: calculus after it needs one of them first (Utah's Math 1060).
        ok = !!l && l.id === sameLadder && (l.rank > maxRank || (l.rank === maxRank && i.typeId !== "math.college_alg"));
      }
      if (!ok && group.catalogIds.length) {
        const id = catalogIdOf(i);
        ok = id !== null && group.catalogIds.includes(id);
      }
      if (!ok) return false;
      if (group.minLetter && i.completed && i.letter && atLeast(i.letter, group.minLetter) === false) return false;
      return true;
    });
  });
}

/**
 * The language levels to plan for `missing` more levels, from the student's highest level `reached`:
 * each the next one up, and "IV or higher" (level 4) again past it (AP Spanish after Spanish IV).
 */
export function nextLanguageRanks(reached: number, missing: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= missing; k++) out.push(Math.min(4, reached + k));
  return out;
}

/** Distinct grades among these candidates that are inside their class's usual grades. */
function usualYears(cands: readonly { row: CatalogRow; grade: SchoolGrade }[]): number {
  return new Set(cands.filter((c) => !outsideUsualGrades(c.row, c.grade)).map((c) => c.grade)).size;
}

/** A grade outside the class's usual grades (the course type's window). */
function outsideUsualGrades(row: CatalogRow, grade: SchoolGrade): boolean {
  const [from, to] = getCourseType(row.typeId).grades;
  return grade < from || grade > to;
}

/** Whether a class could count toward a requirement (ignoring its deadline); totals and electives don't count here. */
function leafTouches(leaf: CLeaf, item: Item): boolean {
  const req = leaf.req;
  if (req.kind === "credits" || req.kind === "count") return matchesAny(item, req.select);
  return req.kind === "same_language" && item.subject === "world_language";
}

/**
 * This state's class on the same math rung as a student's class from another sequence (Algebra II
 * for Secondary Math III in Texas or Tennessee, Secondary Math I for Algebra I in Utah), or null
 * when the class is already the state's own (or not a rung I-III).
 */
function localRung(ctx: Ctx, item: Item): CourseTypeId | null {
  const rank = mathRankOf(item.typeId);
  if (rank === null || rank < 1 || rank > 3) return null;
  const local = rungTypes(ctx.state === "UT" ? "ut" : "traditional", rank)[0];
  if (local === item.typeId || (ctx.state === "TN" && item.typeId.startsWith("math.int"))) return null;
  return local;
}

/**
 * Math classes that come before precalculus in rigor, off the ladder: applied math, algebraic
 * reasoning, college-readiness math and quantitative reasoning. Never suggested to a student who
 * has reached precalculus or beyond.
 */
export function belowPrecalculus(typeId: CourseTypeId): boolean {
  return typeId.startsWith("math.applied.") || typeId === "math.alg_reasoning" || typeId === "math.college_prep" || typeId === "math.adv_quant";
}

/** A rung at or below `maxRank` on a ladder with a failed or withdrawn attempt and no attempt that counts. */
export function ladderGapAtOrBelow(items: Item[], ladder: string, maxRank: number): boolean {
  const passed = new Set<number>();
  const failed = new Set<number>();
  for (const i of items) {
    const l = getCourseType(i.typeId).ladder;
    if (!l || l.id !== ladder || l.rank > maxRank || l.rank < 1) continue;
    (countsForSequence(i) ? passed : failed).add(l.rank);
  }
  return [...failed].some((r) => !passed.has(r));
}

/**
 * The career pathway the student's own classes are in, when they haven't picked one: the cluster
 * where they have two levels, or on the training path any level (Transportation 1 and 2 make a
 * Transportation pathway). The most recent one wins. Only classes whose kind the student confirmed:
 * a guessed kind never sets the plan's pathway (confirm first, engine/confirm.ts).
 */
export function ownCtePathway(ctx: Ctx): CteCluster | null {
  const levels = new Map<CteCluster, { count: number; grade: number }>();
  for (const i of ctx.items) {
    const l = getCourseType(i.typeId).ladder;
    if (!i.own || i.unconfirmed || i.noCredit || !l?.id.startsWith("cte.")) continue;
    const cluster = l.id.slice(4) as CteCluster;
    const prev = levels.get(cluster) ?? { count: 0, grade: 0 };
    levels.set(cluster, { count: prev.count + 1, grade: Math.max(prev.grade, i.grade) });
  }
  const min = ctx.input.targets.path === "training" ? 1 : 2;
  const best = [...levels.entries()].filter(([, v]) => v.count >= min).sort((a, b) => b[1].count - a[1].count || b[1].grade - a[1].grade || (a[0] < b[0] ? -1 : 1))[0];
  return best?.[0] ?? null;
}

/**
 * School years (9th-12th) with a class in a career cluster that can be built on: one on the
 * cluster's ladder, or a career class of that cluster off it (Anatomy and Physiology as a health
 * science class). Two classes in one year count once.
 */
export function cteYears(items: readonly Item[], cluster: string): number {
  const grades = new Set<number>();
  for (const i of items) {
    if (i.grade < 9 || !countsForSequence(i)) continue;
    const t = getCourseType(i.typeId);
    if (t.ladder?.id === `cte.${cluster}` || (i.cte && t.cteCluster === cluster)) grades.add(i.grade);
  }
  return grades.size;
}

/** A cluster's generic level types (`cte.health.2`): the level is known. */
const CTE_LEVEL_TYPE = /^cte\.[a-z_]+\.[1-4]$/;

/**
 * A class in a career cluster whose level its name can't tell (Tennessee's Engineering Design I and
 * II are one named type; Anatomy and Physiology taken as a career class is off the ladder).
 */
function levelUnknown(i: Item, cluster: string): boolean {
  const t = getCourseType(i.typeId);
  if (t.ladder?.id === `cte.${cluster}`) return !CTE_LEVEL_TYPE.test(i.typeId);
  return i.cte && t.cteCluster === cluster;
}

/**
 * How far the student has come in a career cluster: the highest level they've taken (two level-1
 * classes are level 1, so the next is level 2). Only where some class's level is unknown do the
 * years they've had classes there count too, one level a year. Only the student's own classes.
 */
export function cteReached(items: readonly Item[], cluster: string): number {
  const taken = items.filter((i) => i.own && countsForSequence(i));
  const known = Math.max(0, ...taken.map((i) => getCourseType(i.typeId).ladder).map((l) => (l?.id === `cte.${cluster}` ? l.rank : 0)));
  return taken.some((i) => levelUnknown(i, cluster)) ? Math.max(known, cteYears(taken, cluster)) : known;
}

/**
 * A career pathway level at or below where the student is in its cluster (Principles of
 * Transportation Systems after Automotive Basics and Automotive Technology I): never planned.
 */
export function pastCteLevel(items: readonly Item[], typeId: CourseTypeId): boolean {
  const l = getCourseType(typeId).ladder;
  return !!l && l.id.startsWith("cte.") && l.rank <= cteReached(items, l.id.slice(4));
}

/** Classes on a CTE cluster's ladder at a level: the generic level type and named classes there. */
function rungTypesForCte(cluster: string, level: number): CourseTypeId[] {
  return ladderTypes(`cte.${cluster}` as LadderId)
    .filter((t) => t.ladder!.rank === level)
    .map((t) => t.id);
}


function cteTitle(cluster: string): string {
  const t = getCourseType(`cte.${cluster}.1` as CourseTypeId).title;
  return t.slice(0, t.indexOf(":"));
}

/**
 * `reroute`: a program that counts only on a condition the plan doesn't meet (an engineering
 * program for Business and Industry when the plan meets STEM's math and science too, 19 TAC
 * §74.13(f)(7)(B)) isn't a way to earn the endorsement the student named: plan another of its
 * programs instead, when one fits as well. The two-plan endorsement choice turns it off: there,
 * such an endorsement isn't offered at all.
 */
export function runFill(ctx: Ctx, config: PlanConfig, reroute = true): FillResult {
  const first = new Filler(ctx, config).run();
  const conditional = reroute ? conditionalPrograms(ctx, first) : new Map<string, Set<string>>();
  if (conditional.size === 0) return first;
  const second = new Filler(ctx, config, conditional).run();
  return requiredUnmet(second) <= requiredUnmet(first) && conditionalPrograms(ctx, second).size === 0 ? second : first;
}

/** Program requirements on the plan's routes whose "counts unless" check ends at "ask your counselor". */
function conditionalPrograms(ctx: Ctx, fill: FillResult): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of fill.evals) {
    if (!e.best) continue;
    for (const check of e.rc.variant?.checks ?? []) {
      if (check.kind !== "counts_unless") continue;
      const result = evaluateCheck(ctx, e.rc, check, e.best.leaves, fill.items, () => null);
      if (result?.status !== "ask_counselor") continue;
      out.set(e.rc.rs.id, new Set([...(out.get(e.rc.rs.id) ?? []), check.req]));
    }
  }
  return out;
}

/** Units of required (P0-P1) needs still unmet. */
function requiredUnmet(fill: FillResult): number {
  return fill.needs.filter((n) => n.priority <= 1 && !n.soft && n.missing > 0).reduce((s, n) => s + needUnits(n), 0);
}
