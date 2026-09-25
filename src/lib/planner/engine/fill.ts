import type { CourseSubject, CourseTerm } from "@/db/schema";
import type { SchoolGrade } from "../common";
import {
  courseTypeTitle,
  type CourseTypeId,
  type CourseTypeLevel,
  getCourseType,
  isCollegeLevel,
  type LadderId,
  ladderTypes,
  LANGUAGES,
  type LanguageCode,
} from "../course-types";
import { type DemandPriority, type Reason, suggestionKey } from "../engine-io";
import { MATH_TARGET_DEFS } from "../families";
import { type AltResult, evaluateAlternative, pickAlternative, type PickOptions } from "./allocate";
import { evaluateRuleSet, type RuleSetEval } from "./audit";
import type { CatalogRow } from "./catalog";
import type { Alternative, CLeaf } from "./compile";
import { type Ctx, type FamilyCtx, levelOrder, rowIsOffered, type RuleSetCtx, schoolYearOfGrade } from "./context";
import { reason } from "./explain";
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
} from "./ladder";
import { countsForSequence, type Item, itemFromSuggestion, slotHalves } from "./model";
import { evaluatePrep, familyNeeds, isLadderish, type Need, needsFromEval } from "./needs";
import { matchesAny, wouldMatchIfConfirmed } from "./select";
import { atLeast, nth } from "./util";

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

export type BlockReason = "not_offered" | "doesnt_fit" | "past" | "load" | "guessed" | "dismissed" | "choice" | "equivalent";

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
  };
  chosen: Map<string, number>;
  /** Why each need still unmet after the fill is unmet. */
  unmet: Map<string, BlockReason>;
};

const WEIGHT: Record<number, number> = { 0: 1_000_000, 1: 10_000, 2: 100, 3: 1 };

export function isRepeatable(typeId: CourseTypeId): boolean {
  const t = getCourseType(typeId);
  if (t.fallback) return true;
  // A career pathway's levels go in order (level 1, then 2, then 3): never the same level twice.
  if (t.ladder?.id.startsWith("cte.")) return false;
  if (/^(pe|arts|other|cte|health)\./.test(typeId)) return true;
  return ["ela.journalism", "ela.debate", "ela.speech", "ela.creative_writing"].includes(typeId);
}

function probe(row: CatalogRow, grade: SchoolGrade, schoolYear: number, term?: CourseTerm): Item {
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
  private readonly excluded = new Map<string, Set<string>>();
  private readonly candidateCache = new Map<string, { row: CatalogRow; grade: SchoolGrade }[]>();
  private n = 0;
  private ladderFamilyValue: LadderFamily;
  private ladderSolution: LadderSolution | null = null;
  private ladderProblem: LadderProblem | null = null;
  private fullLadder: LadderSolution | null = null;
  private ladderConstraints: LadderConstraint[] = [];
  private readonly usedKeys = new Map<string, number>();

  constructor(
    readonly ctx: Ctx,
    readonly config: PlanConfig,
  ) {
    this.items = [...ctx.items];
    this.ladderFamilyValue = ladderFamily(ctx.state, ctx.items);
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

  private prefer(): (r: AltResult) => number {
    // Among equally good alternatives, prefer the one whose missing classes other targets also want.
    const wanted = new Set<CourseTypeId>();
    for (const f of this.config.families) for (const t of [...(f.content?.sciences ?? []), ...(f.content?.keyCourses ?? [])]) wanted.add(t);
    return (r) => {
      let score = 0;
      for (const l of r.leaves) {
        if (l.missing <= 0 || (l.leaf.req.kind !== "credits" && l.leaf.req.kind !== "count")) continue;
        if (l.leaf.req.select.some((s) => s.types?.some((t) => wanted.has(t)))) score++;
      }
      return score;
    };
  }

  private pickOptions(rc: RuleSetCtx, baseChoice?: Map<string, Alternative>): PickOptions {
    return {
      prefer: this.prefer(),
      feasible: (r) => r.leaves.every((l) => l.missing === 0 || this.leafFeasible(l.leaf)),
      allowed: this.followsBase(rc, baseChoice),
    };
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
    const want = chosen.leaves.map((l) => l.id).sort().join("|");
    return (alt) => alt.leaves.filter((l) => !l.own).map((l) => l.id).sort().join("|") === want;
  }

  /** A language the student can reach `levels` in: every level already taken or offered in a remaining grade. */
  private languageReachable(levels: number): boolean {
    const own = new Set(
      this.items
        .filter((i) => i.subject === "world_language" && !i.noCredit)
        .map((i) => getCourseType(i.typeId).ladder?.id.slice(5))
        .filter((c): c is string => !!c && c !== "other"),
    );
    const codes = this.ctx.choices.worldLanguage ? [this.ctx.choices.worldLanguage] : own.size ? [...own] : LANGUAGES.filter((c) => c !== "other");
    return codes.some((code) =>
      [1, 2, 3, 4].slice(0, Math.min(4, levels)).every((level) => {
        const typeId = `lang.${code}.${level}` as CourseTypeId;
        if (this.items.some((i) => i.typeId === typeId && !i.noCredit)) return true;
        return this.ctx.planGrades.some((g) => g >= 9 && (this.ctx.catalogs.get(g)!.byType.get(typeId) ?? []).some((r) => rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g))));
      }),
    );
  }

  /** A math requirement needs enough years left to climb to its rung (one a year); a language needs its levels offered. */
  private leafFeasible(leaf: CLeaf): boolean {
    if (leaf.req.kind === "same_language") return this.languageReachable(leaf.req.levels);
    if (leaf.req.kind !== "credits" && leaf.req.kind !== "count") return true;
    const rank = isLadderish(leaf.req.select);
    if (rank === null) return true;
    const by = leaf.req.kind === "credits" && leaf.req.deadlineGrade !== undefined ? leaf.req.deadlineGrade : 12;
    const years = this.ctx.planGrades.filter((g) => g >= 9 && g <= by).length;
    return startRank(this.items, 13) + years >= rank;
  }

  private evaluateChosen(rc: RuleSetCtx): AltResult | null {
    if (!rc.variant || rc.alternatives.length === 0) return null;
    const idx = this.chosen.get(rc.rs.id);
    if (idx === undefined) {
      const excluded = this.excluded.get(rc.rs.id) ?? new Set<string>();
      const opts = this.pickOptions(rc);
      const unexcluded = rc.alternatives.filter((a) => !a.leaves.some((l) => excluded.has(l.id)));
      const followed = opts.allowed ? unexcluded.filter(opts.allowed) : unexcluded;
      const alts = followed.length ? followed : unexcluded;
      if (alts.length === 0) return null;
      const results = alts.map((a) => evaluateAlternative(a, this.items, rc.allocation));
      const best = pickAlternative(results, opts);
      this.chosen.set(rc.rs.id, best.alt.index);
      return best;
    }
    return evaluateAlternative(rc.alternatives.find((a) => a.index === idx)!, this.items, rc.allocation);
  }

  private familyNeedList(): Need[] {
    const out: Need[] = [];
    this.config.families.forEach((f, i) => {
      for (const need of familyNeeds(this.ctx, f)) {
        // Two families: math takes the higher target (the ladder does that); sciences are the union.
        if (i > 0 && need.mathTarget && out.some((n) => n.mathTarget && MATH_TARGET_DEFS[n.mathTarget].rank >= MATH_TARGET_DEFS[need.mathTarget!].rank)) continue;
        out.push(need);
      }
    });
    // CTE pathway: the student's choice, or the first family's pathway on the training path.
    const chosen = this.ctx.choices.ctePathway?.cluster;
    const f = chosen ? undefined : this.config.families[0];
    const familyPathway = this.ctx.input.targets.path === "training" ? f?.content?.ctePathways.find((p) => p.state === this.ctx.state) : undefined;
    const cluster = chosen ?? familyPathway?.cluster;
    if (cluster) {
      for (const level of [1, 2, 3]) {
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
              ? reason("major_prep", `A career pathway in ${cteTitle(cluster).toLowerCase()}, taken in order, so you finish as a completer.`, {
                  claim: "suggestion",
                  familyId: f.target.familyId,
                  citations: familyPathway?.cite ?? [],
                })
              : // The student's own choice is the source.
                reason("choice", `You chose the ${cteTitle(cluster).toLowerCase()} pathway. Its classes go in order, so you finish as a completer.`, {
                  claim: "suggestion",
                  params: { cluster },
                }),
          ],
        });
      }
    }
    return out;
  }

  private checkNeeds(evals: Map<string, AltResult>): Need[] {
    const out: Need[] = [];
    for (const rc of this.config.ruleSets) {
      const alt = evals.get(rc.rs.id);
      if (!alt || !rc.variant) continue;
      for (const check of rc.variant.checks ?? []) {
        if (check.kind === "senior_year_math") {
          if (this.ctx.choices[check.unlessChoice] || this.ctx.input.targets.path === "training") continue;
          const senior = this.items.filter((i) => i.subject === "math" && i.grade === 12 && !i.noCredit).reduce((n, i) => n + i.units, 0);
          if (senior >= 4) continue;
          out.push(this.checkNeed(rc, check.id, "A full year of math in 12th grade", [{ subjects: ["math"], grades: [12] }], 4 - senior, 12, 12, false, check.cite));
        } else if (check.kind === "enrolled_years") {
          const years = new Set(this.items.filter((i) => i.subject === check.subject && i.grade >= 9 && !(i.completed && i.letter === "W")).map((i) => i.grade));
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
      testRoutes: [],
      forWhat: { ruleSetId: rc.rs.id, reqId: id },
      reasons: [reason("requirement", `Required by ${rc.rs.issuer.name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`, { ruleSetId: rc.rs.id, reqId: id, strength: rc.rs.strength, citations: cite })],
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
      if (alt) for (const n of needsFromEval(this.ctx, rc, alt)) add(n);
    }
    for (const need of this.familyNeedList()) {
      const { missing } = evaluatePrep(need, this.items);
      if (missing > 0) add({ ...need, missing });
    }
    for (const n of this.checkNeeds(this.current)) add(n);
    this.needs = [...merged.values()];
  }

  // Years ---------------------------------------------------------------------------------------

  private cap(): number {
    return this.ctx.limits.maxCollegeLevelPerYear;
  }

  /** Can a suggestion go in this year for a need of this priority? */
  private yearAllows(grade: SchoolGrade, priority: DemandPriority): boolean {
    const y = this.years.get(grade);
    if (!y || grade < 9) return false;
    if (y.inProgress) return priority === 0;
    return true;
  }

  private fits(grade: SchoolGrade, row: CatalogRow, priority: DemandPriority, term?: CourseTerm): boolean {
    const y = this.years.get(grade)!;
    const halves = slotHalves(term ?? row.defaultTerm, row.units);
    const reserve = y.reserve && priority >= 2 ? 2 : 0;
    if (y.used + halves + reserve > y.capHalves) return false;
    if (row.collegeLevel && y.college >= this.cap()) return false;
    return true;
  }

  alreadyHas(typeId: CourseTypeId): boolean {
    if (isRepeatable(typeId)) return false;
    return this.items.some((i) => i.typeId === typeId && !i.noCredit);
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

  /** Every prerequisite is met by a class before this grade (or the same grade when printed as concurrent). */
  prereqsMet(row: CatalogRow, grade: SchoolGrade, extra: Item[] = []): boolean {
    return prereqsMetIn([...this.items, ...extra], row, grade, (i) => this.catalogIdOf(i));
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
        if (row.defaultTerm === "summer" || !rowIsOffered(row, grade, sy)) continue;
        if (matchesAny(probe(row, grade, sy), need.selectors)) out.push({ row, grade });
      }
    }
    this.candidateCache.set(need.id, out);
    return out;
  }

  /** Grades a need's classes can go in. Past its deadline, nothing placed now would count. */
  private window(need: Need): [number, number] {
    return [Math.max(need.fromGrade, 9), need.byGrade];
  }

  /** Feasible (row, grade) pairs for a need right now. */
  candidates(need: Need, ignoreCapacity = false): { row: CatalogRow; grade: SchoolGrade }[] {
    const [from, by] = this.window(need);
    const collegeOk = need.selectors.every((s) => s.levels && s.levels.every(isCollegeLevel));
    // Classes only college-level versions meet (an aid rule's "one AP class") are never added for
    // it: rigor is a level choice on classes already planned (design §5.7).
    if (collegeOk) return [];
    const out = this.staticCandidates(need).filter(({ row, grade }) => {
      if (grade < from || grade > by) return false;
      if (!this.yearAllows(grade, need.priority)) return false;
      if (this.alreadyHas(row.typeId) || !this.typeAllowed(row.typeId, grade, row.units)) return false;
      if (this.dismissed(need, row)) return false;
      if (need.distinctGrades && this.items.some((i) => i.grade === grade && i.subject === row.subject)) return false;
      if (!ignoreCapacity && !this.fits(grade, row, need.priority)) return false;
      if (ignoreCapacity && row.collegeLevel && this.years.get(grade)!.college >= this.cap()) return false;
      if (row.collegeLevel && !collegeOk && this.cheaperLevelExists(row, grade)) return false;
      if (!this.prereqsMet(row, grade)) return false;
      if (this.repeatsMathRung(row.typeId, grade)) return false;
      return true;
    });
    // The planner doesn't add AP, IB or college-credit classes to meet an ordinary requirement
    // when a regular or honors class would (college-level only by a rigor level choice).
    return out.some((c) => !c.row.collegeLevel) ? out.filter((c) => !c.row.collegeLevel) : out;
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

  private cheaperLevelExists(row: CatalogRow, grade: SchoolGrade): boolean {
    const cat = this.ctx.catalogs.get(grade)!;
    return (cat.byType.get(row.typeId) ?? []).some((r) => !r.collegeLevel && rowIsOffered(r, grade, schoolYearOfGrade(this.ctx, grade)) && r.defaultTerm !== "summer");
  }

  /** The level the student has been taking in a subject (honors continuity), never college-level. */
  /**
   * Career pathway classes go in order within one cluster (a program of study): the next level of
   * a pathway already in the plan comes first (0), then anything else (1); a level with its
   * previous level missing, or a second pathway's first class, comes last (2).
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

  private preferredLevel(subject: CourseSubject): CourseTypeLevel {
    const last = this.items
      .filter((i) => i.own && i.subject === subject && !i.noCredit)
      .sort((a, b) => b.grade - a.grade)[0];
    return last?.level === "honors" ? "honors" : "regular";
  }

  private score(row: CatalogRow, grade: SchoolGrade): number {
    const item = probe(row, grade, schoolYearOfGrade(this.ctx, grade));
    const groups = new Map<string, number>();
    let total = 0;
    for (const n of this.needs) {
      if (n.missing <= 0 || this.blocked.has(n.id) || n.language) continue;
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

  private gradePreference(row: CatalogRow, grade: SchoolGrade): number[] {
    const y = this.years.get(grade)!;
    const halves = slotHalves(row.defaultTerm, row.units);
    const pairs = halves === 1 && y.used % 2 === 1 ? 0 : 1;
    const keepsReserve = y.reserve && y.used + halves + 2 > y.capHalves ? 1 : 0;
    // A class's usual grades (design §5.7: "P0 single courses in their typical grade windows"), in
    // half-grade steps: Chemistry in 10th or 11th, a 4th science in 11th or 12th.
    const [from, to] = getCourseType(row.typeId).grades;
    const natural = Math.round(Math.abs(grade - (from + to) / 2) * 2);
    // The year in progress is a last resort: its schedule is mostly set.
    return [y.inProgress ? 1 : 0, pairs, natural, keepsReserve, grade];
  }

  private pick(need: Need, cands: { row: CatalogRow; grade: SchoolGrade }[]): { row: CatalogRow; grade: SchoolGrade } {
    const math = need.selectors.some((s) => s.subjects?.includes("math") || s.types?.some((t) => t.startsWith("math.")) || s.capabilities);
    const nextRank = startRank(this.items, 13) + 1;
    const scored = cands.map((c) => {
      const pref = this.preferredLevel(c.row.subject);
      const rank = mathRankOf(c.row.typeId);
      return {
        c,
        keys: [
          -this.score(c.row, c.grade),
          c.row.collegeLevel ? 1 : 0,
          isRepeatable(c.row.typeId) && this.items.some((i) => i.typeId === c.row.typeId && i.subject === c.row.subject) ? 0 : 1,
          this.cteContinuity(c.row.typeId, c.grade),
          c.row.level === pref ? 0 : 1,
          math ? (rank === nextRank ? 0 : rank !== null && rank > nextRank ? 2 : 1) : 0,
          ...this.gradePreference(c.row, c.grade),
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
    // Semester classes: fall if this year's semester slots are even, else spring (pairs them).
    const y = this.years.get(grade);
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

  private ladderConstraintsFromNeeds(): LadderConstraint[] {
    const out: LadderConstraint[] = [];
    for (const n of this.needs) {
      if (n.missing <= 0) continue;
      const rank = isLadderish(n.selectors);
      if (rank === null) continue;
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
    for (const g of grades) {
      const own = this.items.filter((i) => i.own && i.grade === g && i.subject === "math" && countsForSequence(i));
      const ranks = own.map((i) => mathRankOf(i.typeId)).filter((r): r is number => r !== null);
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
    for (const g of grades) for (let r = 1; r <= 6; r++) availability.set(`${g}:${r}`, available(g, r));
    this.ladderProblem = {
      grades,
      start,
      locked,
      available: (g, r) => availability.get(`${g}:${r}`) ?? false,
      constraints,
      moves: { double: false, summer: false },
    };
    const solution = solveLadder({ ...this.ladderProblem, moves: { double: accelerate, summer: accelerate && summerFact && ctx.limits.allowSummer } });
    this.ladderSolution = solution;
    // The full picture including grades 7-8 (deadlines like "Algebra I in 8th").
    if (ctx.firstGrade <= 8) {
      const early = ctx.planGrades;
      this.fullLadder = solveLadder({
        grades: early,
        start: startRank(this.items, early[0]),
        locked: new Map(early.filter((g) => g < 9).flatMap((g) => {
          const ranks = this.items.filter((i) => i.own && i.grade === g).map((i) => mathRankOf(i.typeId)).filter((r): r is number => r !== null);
          return ranks.length ? [[g, Math.max(...ranks)] as [SchoolGrade, number]] : [];
        })),
        available: (g, r) => (g < 9 ? r <= 2 : available(g, r)),
        constraints,
        moves: { double: false, summer: false },
      });
    } else this.fullLadder = solution;
    const target = Math.max(...constraints.map((c) => c.rank));
    for (const step of solution.steps) {
      const binding = solution.slack.find((s) => s.step === step)?.binding ?? null;
      const priority = (binding?.priority ?? minPriority) as DemandPriority;
      const need = this.needs.find((n) => n.id === binding?.id) ?? this.needs.find((n) => constraints.some((c) => c.id === n.id)) ?? null;
      // A level the student said "Not for me" to gives way to another level of the same class.
      const row = step.summer ? this.summerRow(step.rank, step.grade) : this.rowForRung(step.rank, step.grade, priority, (r) => this.dismissed(need, r));
      if (!row || this.dismissed(need, row)) continue;
      // The rung's sources: the requirements and targets that set the ladder's goal.
      const targetNeeds = this.needs.filter((n) => constraints.some((c) => c.id === n.id && c.rank >= step.rank));
      const citations = [...new Set(targetNeeds.flatMap((n) => n.reasons.flatMap((r) => r.citations)))];
      const stepName = courseTypeTitle(row.typeId, ctx.state);
      const why =
        step.rank < target
          ? reason("ladder", `${stepName} in ${nth(step.grade)} keeps ${rungName(this.ladderFamilyValue, target, ctx.state)} by ${nth(Math.max(...constraints.filter((c) => c.rank === target).map((c) => c.byGrade)))} open.`, {
              claim: "suggestion",
              citations,
              params: { rank: step.rank, grade: step.grade },
            })
          : reason("ladder", `${stepName} in ${nth(step.grade)} reaches the math your goals ask for.`, { claim: "suggestion", citations, params: { rank: step.rank, grade: step.grade } });
      this.commit(row, step.summer ? step.grade : step.grade, "ladder", need, priority, [why], step.summer ? "summer" : undefined);
      this.refreshNeeds(this.items[this.items.length - 1]);
    }
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
        const need = it ? this.needs.find((n) => n.missing > 0 && !n.language && n.priority <= 3 && matchesAny(it, n.selectors) && n.selectors.some((s) => s.subjects?.includes("english") || s.types?.some((t) => t.startsWith("ela.")))) : undefined;
        if (!need || !this.yearAllows(grade, need.priority)) continue;
        const row = rows.find((r) => !this.dismissed(need, r) && this.fits(grade, r, need.priority));
        if (!row) continue;
        this.commit(row, grade, "english", need, need.priority);
        this.refreshNeeds(this.items[this.items.length - 1]);
        break;
      }
    }
  }

  private chooseLanguage(levels: number): LanguageCode | null {
    if (this.ctx.choices.worldLanguage) return this.ctx.choices.worldLanguage;
    // The language the student already takes (guesses count for sequencing).
    const own = this.items.filter((i) => i.own && i.subject === "world_language" && !i.noCredit);
    for (const i of own.sort((a, b) => b.grade - a.grade)) {
      const l = getCourseType(i.typeId).ladder;
      if (l?.id.startsWith("lang.") && !l.id.endsWith(".other")) return l.id.slice(5) as LanguageCode;
    }
    for (const code of LANGUAGES) {
      if (code === "other") continue;
      const offered = [1, 2].slice(0, levels).every((lv) => this.ctx.planGrades.some((g) => (this.ctx.catalogs.get(g)!.byType.get(`lang.${code}.${lv}` as CourseTypeId) ?? []).length > 0));
      if (offered) return code;
    }
    return null;
  }

  private placeLanguages(): void {
    for (const need of [...this.needs].filter((n) => n.language && n.missing > 0).sort((a, b) => a.priority - b.priority)) {
      const code = this.chooseLanguage(need.language!.levels);
      if (!code) {
        this.blocked.set(need.id, "not_offered");
        continue;
      }
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
      for (let level = reached + 1; level <= need.language!.levels; level++) {
        const typeId = `lang.${code}.${Math.min(level, 4)}` as CourseTypeId;
        let placed = false;
        for (const grade of this.ctx.planGrades) {
          if (grade < 9 || grade <= lastGrade || grade < need.fromGrade || !this.yearAllows(grade, need.priority)) continue;
          if (this.items.some((i) => i.grade === grade && getCourseType(i.typeId).ladder?.id === ladderId)) continue;
          const cat = this.ctx.catalogs.get(grade)!;
          const pref = this.preferredLevel("world_language");
          const row = (cat.byType.get(typeId) ?? [])
            .filter((r) => rowIsOffered(r, grade, schoolYearOfGrade(this.ctx, grade)) && r.defaultTerm !== "summer" && !this.dismissed(need, r))
            .sort((a, b) => Number(a.collegeLevel) - Number(b.collegeLevel) || Number(a.level !== pref) - Number(b.level !== pref))
            .find((r) => this.fits(grade, r, need.priority));
          if (!row) continue;
          this.commit(row, grade, "language", need, need.priority);
          lastGrade = grade;
          placed = true;
          break;
        }
        if (!placed) {
          const offered = this.ctx.planGrades.some((g) => (this.ctx.catalogs.get(g)!.byType.get(typeId) ?? []).length > 0);
          this.blocked.set(need.id, offered ? "doesnt_fit" : "not_offered");
          if (!offered) this.trySwitch(need);
          break;
        }
      }
      this.refreshNeeds();
    }
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
    if (this.items.some((i) => i.own && wouldMatchIfConfirmed(i, need.selectors))) return "guessed";
    if (this.staticCandidates(need).some(({ row, grade }) => this.repeatsMathRung(row.typeId, grade))) return "equivalent";
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
    const ok = this.placements.every((q) => q === p || q.item.grade <= p.item.grade || q.kind === "english" || this.prereqsMet(q.row, q.item.grade));
    this.items.splice(idx, 0, p.item);
    return ok;
  }

  /** Frees room for a need by moving out lower-priority suggestions (design §5.7 repair). */
  private evictFor(need: Need): boolean {
    const cands = this.candidates(need, true);
    let best: { cand: (typeof cands)[number]; evict: Placement[] } | null = null;
    for (const cand of cands) {
      const y = this.years.get(cand.grade)!;
      const halves = slotHalves(cand.row.defaultTerm, cand.row.units);
      const movable = this.placements
        .filter((p) => p.item.grade === cand.grade && p.kind === "fill" && p.priority > need.priority && p.item.term !== "summer")
        .filter((p) => this.removableWithoutBreaking(p))
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

  private fillNeeds(): void {
    for (let p = 0; p <= 3; p++) {
      for (let guard = 0; guard < 400; guard++) {
        const open = this.needs.filter((n) => n.priority <= p && n.missing > 0 && !this.blocked.has(n.id) && !n.language && !n.id.startsWith("cte:"));
        if (open.length === 0) break;
        const withCands = open.map((n) => ({ n, cands: this.candidates(n) }));
        withCands.sort(
          (a, b) =>
            a.n.priority - b.n.priority ||
            Number(a.n.soft) - Number(b.n.soft) ||
            Math.min(a.cands.length, 1) - Math.min(b.cands.length, 1) ||
            a.n.byGrade - b.n.byGrade ||
            new Set(a.cands.map((c) => c.grade)).size - new Set(b.cands.map((c) => c.grade)).size ||
            (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0),
        );
        const top = withCands[0];
        if (top.cands.length === 0) {
          if (top.n.priority <= 1 && !top.n.soft && this.evictFor(top.n)) continue;
          if (this.trySwitch(top.n)) continue;
          this.blocked.set(top.n.id, this.blockReason(top.n));
          continue;
        }
        const best = this.pick(top.n, top.cands);
        const before = top.n.missing;
        const placed = this.commit(best.row, best.grade, "fill", top.n, top.n.priority);
        this.refreshNeeds(placed.item);
        const after = this.needs.find((n) => n.id === top.n.id)?.missing ?? 0;
        if (after >= before) {
          // The class didn't count after all (another requirement took it): don't keep adding.
          this.uncommit(placed);
          this.refreshNeeds();
          this.blocked.set(top.n.id, "doesnt_fit");
        }
      }
    }
  }

  /**
   * The exact check for required (P0) classes (design §5.7): a bipartite flow of required classes
   * (placed and still missing) into school years. If it places more than the greedy pass did, the
   * required classes are re-placed from the flow solution.
   */
  private p0Exact(): void {
    const missing = this.needs.filter((n) => n.priority === 0 && n.missing > 0 && !n.language && this.blocked.get(n.id) === "doesnt_fit");
    if (missing.length === 0) return;
    const movable = this.placements.filter((p) => p.kind === "fill" && p.priority === 0 && p.item.term !== "summer");
    type Token = { need: Need | null; placement: Placement | null; options: { row: CatalogRow; grade: SchoolGrade }[] };
    const tokens: Token[] = [];
    for (const p of movable) {
      const opts: { row: CatalogRow; grade: SchoolGrade }[] = [];
      for (const g of this.ctx.planGrades) {
        if (g < 9 || !this.yearAllows(g, 0)) continue;
        const row = g === p.item.grade ? p.row : (this.ctx.catalogs.get(g)!.byType.get(p.row.typeId) ?? []).find((r) => r.level === p.row.level && rowIsOffered(r, g, schoolYearOfGrade(this.ctx, g)));
        if (!row) continue;
        const need = p.primary;
        if (need) {
          const [from, by] = this.window(need);
          if (g < from || g > by) continue;
        }
        opts.push({ row, grade: g });
      }
      tokens.push({ need: p.primary, placement: p, options: opts });
    }
    for (const need of missing) {
      const opts = this.candidates(need, true);
      const unit = Math.max(1, ...opts.map((o) => (need.measure === "units" ? o.row.units : 1)));
      const count = Math.ceil(need.missing / unit);
      for (let i = 0; i < count; i++) tokens.push({ need, placement: null, options: opts });
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
    grades.forEach((g, gi) => {
      const y = this.years.get(g)!;
      const lower = this.placements.filter((p) => p.item.grade === g && p.priority > 0 && p.kind === "fill" && p.item.term !== "summer");
      const p0Here = movable.filter((p) => p.item.grade === g);
      const room = y.capHalves - y.used + p0Here.reduce((n, p) => n + slotHalves(p.item.term, p.item.units), 0) + lower.reduce((n, p) => n + slotHalves(p.item.term, p.item.units), 0);
      flow.addEdge(T + gi, sink, Math.max(0, Math.floor(room / 2)), 0);
    });
    const { flow: placedTokens } = flow.run(source, sink);
    if (placedTokens <= movable.length) return;
    // Re-place: take out required and lower-priority fill suggestions, then place from the flow.
    const snapshot = [...this.placements];
    const lower = this.placements.filter((p) => p.kind === "fill" && p.priority > 0 && p.item.term !== "summer");
    for (const p of [...movable, ...lower]) this.uncommit(p);
    const assigned = edgeOf.filter((x) => flow.flowOn(x.e) > 0);
    let ok = true;
    for (const a of assigned.sort((x, y) => grades[x.g] - grades[y.g])) {
      const tok = tokens[a.t];
      const need = tok.need ?? tok.placement?.primary ?? null;
      const grade = grades[a.g];
      const row = tok.options.find(
        (o) => o.grade === grade && !this.alreadyHas(o.row.typeId) && this.typeAllowed(o.row.typeId, grade, o.row.units) && this.fits(grade, o.row, 0) && this.prereqsMet(o.row, grade),
      )?.row;
      if (!row) {
        ok = false;
        break;
      }
      this.commit(row, grade, "fill", need, 0);
    }
    if (!ok) {
      // Put everything back as it was: the greedy placement stands.
      for (const p of [...this.placements]) if (!snapshot.includes(p) && p.kind === "fill") this.uncommit(p);
      for (const p of [...movable, ...lower]) {
        this.items.push(p.item);
        this.placements.push(p);
        const y = this.years.get(p.item.grade)!;
        y.used += slotHalves(p.item.term, p.item.units);
        if (p.row.collegeLevel) y.college++;
      }
    }
    for (const n of missing) this.blocked.delete(n.id);
    this.refreshNeeds();
    for (const n of this.needs) if (n.priority > 0) this.blocked.delete(n.id);
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
      const honors = p.item.level === "regular" ? options.filter((r) => r.level === "honors") : [];
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
   * Requirements only a college-level class meets (an aid rule's "one AP, IB or CE math class"): a
   * level change on a class already planned in grades 10-11, within the cap, and only when the
   * catalog offers that version. Never a new class.
   */
  private upgradeForCollegeOnlyNeeds(): void {
    const cap = this.ctx.limits.maxCollegeLevelPerYear;
    const open = () => this.needs.filter((n) => n.missing > 0 && !n.soft && n.selectors.every((s) => s.levels?.every(isCollegeLevel)));
    for (const need of open()) {
      for (const p of [...this.placements].sort((a, b) => a.item.grade - b.item.grade || a.n - b.n)) {
        const grade = p.item.grade;
        const y = this.years.get(grade)!;
        if (grade < 10 || grade > 11 || y.inProgress || p.item.term === "summer" || isCollegeLevel(p.item.level) || y.college >= cap) continue;
        const forWhat = (p.primary?.forWhat ?? { ruleSetId: "plan", reqId: p.kind }) as Parameters<typeof suggestionKey>[0];
        const row = (this.ctx.catalogs.get(grade)!.byType.get(p.row.typeId) ?? []).find((r) => {
          if (!r.collegeLevel || !rowIsOffered(r, grade, y.schoolYear) || r.units !== p.row.units || r.defaultTerm !== p.row.defaultTerm) return false;
          if (this.ctx.dismissed.has(suggestionKey(forWhat, r.typeId, r.level))) return false;
          const trial = probe(r, grade, y.schoolYear, p.item.term);
          return matchesAny(trial, need.selectors) && (!p.primary || matchesAny(trial, p.primary.selectors)) && this.prereqsMet(r, grade);
        });
        if (!row) continue;
        this.upgrade(
          p,
          row,
          reason("rigor", `The college-level version of this class also counts for ${need.rc?.rs.title ?? need.label}. The regular class is fine too.`, {
            claim: "rule",
            ruleSetId: need.rc?.rs.id ?? null,
            reqId: need.leaf?.id ?? null,
            citations: need.leaf?.cite ?? [],
          }),
        );
        this.refreshNeeds(p.item);
        break;
      }
    }
  }

  private rigorReason(row: CatalogRow): Reason {
    const families = this.config.families.filter(
      (f) => f.content?.rigorFirst.includes(row.typeId) || f.content?.rigorFirst.some((t) => getCourseType(t).ladder?.id === getCourseType(row.typeId).ladder?.id),
    );
    const fam = families[0];
    const subject = getCourseType(row.typeId).subject === "math" ? "Math" : getCourseType(row.typeId).title.replace(/ \(.*\)$/, "");
    return reason(
      "rigor",
      `${fam ? `${subject} matters most for ${fam.title.toLowerCase()}` : "This subject matters for your goals"}, so we suggest the ${row.level === "honors" ? "honors" : "college-level"} version. The regular class is fine too.`,
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

  run(): FillResult {
    this.refreshNeeds();
    this.baselineNeeds = this.needs.map((n) => ({ ...n }));
    this.placeLadder();
    this.placeEnglish();
    if (this.config.cteFirst) {
      this.placeCte();
      this.placeLanguages();
    } else {
      this.placeLanguages();
      this.placeCte();
    }
    this.fillNeeds();
    this.p0Exact();
    this.rigor();
    // Final: every rule set, every alternative.
    const finalChoice = new Map<string, Alternative>();
    const ordered = [...this.config.ruleSets].sort((a, b) => a.bases.length - b.bases.length);
    const byId = new Map<string, RuleSetEval>();
    for (const rc of ordered) {
      const e = evaluateRuleSet(rc, this.items, this.pickOptions(rc, finalChoice));
      if (e.best) finalChoice.set(rc.rs.id, e.best.alt);
      byId.set(rc.rs.id, e);
    }
    const evals = this.config.ruleSets.map((rc) => byId.get(rc.rs.id)!);
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
    for (const n of this.needs) if (n.missing > 0) unmet.set(n.id, this.blocked.get(n.id) ?? this.blockReason(n));
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
      ladder: { family: this.ladderFamilyValue, problem: this.ladderProblem, solution: this.ladderSolution, constraints: this.ladderConstraints, fullSolution: this.fullLadder },
      chosen: this.chosen,
    };
  }
}

/** Classes on a CTE cluster's ladder at a level: the generic level type and named classes there. */
/**
 * Whether `items` meet a row's prerequisites for a class in `grade`: each group by a class before
 * that grade (a summer class sits in the grade it follows), or in the same grade when the list
 * prints it as concurrent, or when the new class is itself taken the summer after that grade. A higher rung on the same ladder also meets it (calculus meets an
 * Algebra II prerequisite). Failed and withdrawn classes don't; a finished class below a printed
 * minimum letter doesn't.
 */
export function prereqsMetIn(items: Item[], row: CatalogRow, grade: SchoolGrade, catalogIdOf: (i: Item) => string | null, summer = false): boolean {
  return row.prereqGroups.every((group) => {
    const ladders = group.types.map((t) => getCourseType(t).ladder);
    const sameLadder = ladders.length > 0 && ladders.every((l) => l && l.id === ladders[0]!.id) ? ladders[0]!.id : null;
    const maxRank = sameLadder ? Math.max(...ladders.map((l) => l!.rank)) : 0;
    return items.some((i) => {
      if (!countsForSequence(i)) return false;
      const sameGrade = i.grade === grade && (group.concurrentOk || (summer && i.term !== "summer"));
      if (!(i.grade < grade || sameGrade)) return false;
      let ok = group.types.includes(i.typeId);
      if (!ok && sameLadder) {
        const l = getCourseType(i.typeId).ladder;
        ok = !!l && l.id === sameLadder && l.rank >= maxRank;
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

function rungTypesForCte(cluster: string, level: number): CourseTypeId[] {
  return ladderTypes(`cte.${cluster}` as LadderId)
    .filter((t) => t.ladder!.rank === level)
    .map((t) => t.id);
}

function cteTitle(cluster: string): string {
  const t = getCourseType(`cte.${cluster}.1` as CourseTypeId).title;
  return t.slice(0, t.indexOf(":"));
}

export function runFill(ctx: Ctx, config: PlanConfig): FillResult {
  return new Filler(ctx, config).run();
}
