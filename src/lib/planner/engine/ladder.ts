import type { PlannerState, SchoolGrade } from "../common";
import { courseTypeTitle, type CourseTypeId, getCourseType } from "../course-types";
import type { Item } from "./model";
import { countsForSequence } from "./model";

// ---------------------------------------------------------------------------
// The math ladder, solved exactly (design §5.6). Ranks: 1 Algebra I / Integrated I / Secondary I,
// 2 Geometry / II, 3 Algebra II / III, 4 precalculus, 5 calculus, 6 beyond. A dynamic program
// over (school year, highest rank) finds the least-cost schedule that meets the rank targets
// ("rank 5 by the end of 12th"), respecting the student's own math rows (locked) and what each
// grade's class list offers. Plan A moves at most one rung a year; doubling up and summer are
// only for the options menu and an opted-in Plan B. From the schedule come earliest, latest and
// slack; zero-slack steps become "by when" deadlines.
// ---------------------------------------------------------------------------

export const MAX_RANK = 6;

export type LadderFamily = "ut" | "integrated" | "traditional";

const RUNG: Record<LadderFamily, Record<1 | 2 | 3, CourseTypeId[]>> = {
  ut: { 1: ["math.ut_sec1", "math.int1", "math.alg1"], 2: ["math.ut_sec2", "math.int2", "math.geom"], 3: ["math.ut_sec3", "math.int3", "math.alg2"] },
  integrated: { 1: ["math.int1", "math.alg1", "math.ut_sec1"], 2: ["math.int2", "math.geom", "math.ut_sec2"], 3: ["math.int3", "math.alg2", "math.ut_sec3"] },
  traditional: { 1: ["math.alg1", "math.int1", "math.ut_sec1"], 2: ["math.geom", "math.int2", "math.ut_sec2"], 3: ["math.alg2", "math.int3", "math.ut_sec3"] },
};
const UPPER: Record<number, CourseTypeId[]> = {
  4: ["math.precalc", "math.college_alg", "math.trig"],
  5: ["math.calc"],
  6: ["math.calc2"],
};

export function mathRankOf(typeId: CourseTypeId): number | null {
  const ladder = getCourseType(typeId).ladder;
  return ladder && ladder.id === "math" ? ladder.rank : null;
}

/** Which family of courses the student's math follows (Utah secondary, integrated, or Algebra/Geometry). */
export function ladderFamily(state: PlannerState, items: Item[]): LadderFamily {
  const types = items.filter((i) => i.subject === "math").map((i) => i.typeId);
  if (types.some((t) => t.startsWith("math.ut_sec"))) return "ut";
  if (types.some((t) => t.startsWith("math.int"))) return "integrated";
  if (types.some((t) => t === "math.alg1" || t === "math.geom" || t === "math.alg2")) return "traditional";
  return state === "UT" ? "ut" : "traditional";
}

/** Course types for a rung, preferred first. */
export function rungTypes(family: LadderFamily, rank: number): CourseTypeId[] {
  if (rank >= 1 && rank <= 3) return RUNG[family][rank as 1 | 2 | 3];
  return UPPER[rank] ?? [];
}

/** "calculus", "precalculus", "Secondary Mathematics III". */
export function rungName(family: LadderFamily, rank: number, state: PlannerState): string {
  if (rank === 5) return "calculus";
  if (rank === 4) return "precalculus";
  if (rank === 6) return "math beyond calculus";
  const type = rungTypes(family, rank)[0];
  return type ? courseTypeTitle(type, state) : "math";
}

/**
 * The lowest math rung the student failed or withdrew from (F, W or I) with no other attempt at
 * that rung that can be built on (a retake, or another class on the same rung), counting only
 * classes before `beforeGrade`. Null when there's none.
 */
export function unresolvedFailedRank(items: Item[], beforeGrade = 13): number | null {
  const passed = new Set<number>();
  const failed = new Set<number>();
  for (const i of items) {
    if (i.grade >= beforeGrade) continue;
    const r = mathRankOf(i.typeId);
    if (r === null || r < 1) continue;
    if (countsForSequence(i)) passed.add(r);
    else failed.add(r);
  }
  const open = [...failed].filter((r) => !passed.has(r));
  return open.length ? Math.min(...open) : null;
}

/**
 * Highest rung reached by classes that can be built on (not failed or withdrawn), before
 * `beforeGrade`. A failed rung with no retake caps it: a class above that rung doesn't count
 * until the failed one is passed (an F in Algebra I and Geometry now starts from before Algebra I).
 */
export function startRank(items: Item[], beforeGrade: number): number {
  const failed = unresolvedFailedRank(items, beforeGrade);
  let rank = 0;
  for (const i of items) {
    if (i.grade >= beforeGrade || !countsForSequence(i)) continue;
    const r = mathRankOf(i.typeId);
    if (r !== null && r > rank && (failed === null || r < failed)) rank = r;
  }
  return rank;
}

export type LadderConstraint = {
  id: string;
  rank: number;
  byGrade: number;
  /** Required (P0/P1 without a test route): missing it costs far more than a soft target. */
  hard: boolean;
  priority: number;
  /** "calculus", "the Distinguished Level of Achievement". */
  label: string;
};

/**
 * double: two rungs in one school year (Algebra I with Geometry, Geometry with Algebra II);
 * summer: a rung the summer after a grade; college: two college rungs in one year through college
 * credit (a semester of precalculus or college algebra, then Calculus I), in the listed grades.
 */
export type LadderMoves = { double: boolean; summer: boolean; college?: readonly SchoolGrade[] };

export type LadderProblem = {
  grades: SchoolGrade[];
  start: number;
  /** Rank of the student's own math row in a grade, if any (locked: no suggestion that year). */
  locked: Map<SchoolGrade, number>;
  /** A rung can be scheduled in a grade (offered, and the load cap allows it). */
  available: (grade: SchoolGrade, rank: number) => boolean;
  /** A college-credit version of a rung is offered in a grade (for the college move). */
  collegeAvailable?: (grade: SchoolGrade, rank: number) => boolean;
  constraints: LadderConstraint[];
  moves: LadderMoves;
  /**
   * The student's own classes on rungs above a failed one, by rank: the grade they're in. They
   * count once the rung below them is reached (a Geometry class counts after the Algebra I retake).
   */
  deferred?: Map<number, SchoolGrade>;
  /**
   * Rungs that may be doubled up with the one after them, where the state or the class list allows
   * the pair (design §5.6): 1 for Texas's Algebra I with Geometry (TEC §28.025(b-6)), 2 for a list
   * that prints Algebra 2 as taken with Geometry. Omitted: any pair up to Algebra II.
   */
  doublePairs?: readonly number[];
};

export type LadderStep = { grade: SchoolGrade; rank: number; summer: boolean; college?: true };

export type LadderSolution = {
  steps: LadderStep[];
  rankAfter: Map<SchoolGrade, number>;
  cost: number;
  unmet: LadderConstraint[];
  /** For each scheduled rung: the latest grade it could come, and the constraint that sets it. */
  slack: { step: LadderStep; latest: number; binding: LadderConstraint | null }[];
};

const HARD = 100_000;
const SOFT = 1_000;
const IDLE = 1;
/** Climbing past every target isn't the ladder's job (a 4th-year class comes from the needs). */
const BEYOND = 2;
const SUMMER_COST = 3;
/** The highest rung that can be doubled up with the one below it. */
const MAX_DOUBLE_RANK = 3;
const DOUBLE_COST = 4;
/** College credit math starts at precalculus or college algebra (design §5.6: dual costs 3). */
const MIN_COLLEGE_RANK = 4;
const COLLEGE_COST = 3;

/** `year` is the rank at the end of the school year; `next` adds a summer class after it. */
type Choice = { year: number; next: number; steps: LadderStep[]; cost: number };

function choices(p: LadderProblem, grade: SchoolGrade, rank: number): Choice[] {
  const locked = p.locked.get(grade);
  const out: Choice[] = [];
  if (locked !== undefined) {
    const year = Math.max(rank, locked);
    out.push({ year, next: year, steps: [], cost: 0 });
  } else {
    const up1 = rank < MAX_RANK && p.available(grade, rank + 1);
    if (up1) out.push({ year: rank + 1, next: rank + 1, steps: [{ grade, rank: rank + 1, summer: false }], cost: 0 });
    out.push({ year: rank, next: rank, steps: [], cost: 0 });
    // Two rungs in one year only where they can run side by side and the state or the list allows
    // the pair: Algebra I with Geometry (Texas §28.025(b-6)), or a printed concurrency. Precalculus
    // and calculus build on each other.
    const pairAllowed = !p.doublePairs || p.doublePairs.includes(rank + 1);
    if (p.moves.double && up1 && rank + 2 <= MAX_DOUBLE_RANK && pairAllowed && p.available(grade, rank + 2)) {
      out.push({ year: rank + 2, next: rank + 2, steps: [{ grade, rank: rank + 1, summer: false }, { grade, rank: rank + 2, summer: false }], cost: DOUBLE_COST });
    }
    // Two college math classes in one year (a semester each), from precalculus up, where the state
    // offers college credit in that grade.
    if (
      p.moves.college?.includes(grade) &&
      rank + 1 >= MIN_COLLEGE_RANK &&
      rank + 2 <= MAX_RANK &&
      (p.collegeAvailable?.(grade, rank + 1) ?? true) &&
      (p.collegeAvailable?.(grade, rank + 2) ?? true)
    ) {
      out.push({
        year: rank + 2,
        next: rank + 2,
        steps: [
          { grade, rank: rank + 1, summer: false, college: true },
          { grade, rank: rank + 2, summer: false, college: true },
        ],
        cost: COLLEGE_COST,
      });
    }
  }
  // A summer class after this grade (never after 12th): it counts toward the next grade.
  if (p.moves.summer && grade < 12) {
    const base = [...out];
    for (const c of base) {
      const nextGrade = (grade + 1) as SchoolGrade;
      if (c.year < MAX_RANK && p.available(nextGrade, c.year + 1)) {
        out.push({ year: c.year, next: c.year + 1, steps: [...c.steps, { grade, rank: c.year + 1, summer: true }], cost: c.cost + SUMMER_COST });
      }
    }
  }
  return out;
}

/** The least-cost schedule. Deterministic: at equal cost, the earlier climb wins. */
export function solveLadder(p: LadderProblem): LadderSolution {
  const target = Math.max(p.start, ...p.constraints.map((c) => c.rank));
  type Cell = { cost: number; steps: LadderStep[]; trail: number[] };
  let layer = new Map<number, Cell>([[p.start, { cost: 0, steps: [], trail: [] }]]);
  // A deferred class of the student's counts once the rung below it is reached, in its grade or later.
  const lift = (rank: number, grade: number) => {
    let r = rank;
    while (p.deferred?.has(r + 1) && p.deferred.get(r + 1)! <= grade) r++;
    return r;
  };
  for (const grade of p.grades) {
    const next = new Map<number, Cell>();
    for (const rank of [...layer.keys()].sort((a, b) => a - b)) {
      const cell = layer.get(rank)!;
      for (const raw of choices(p, grade, rank)) {
        const c = p.deferred?.size ? { ...raw, year: lift(raw.year, grade), next: lift(raw.next, grade) } : raw;
        let cost = cell.cost + c.cost + (c.next === rank && rank < target ? IDLE : 0) + Math.max(0, c.next - Math.max(rank, target)) * BEYOND;
        // Checked at the end of the school year: a summer class after it is too late for this grade.
        for (const k of p.constraints) if (k.byGrade === grade && c.year < k.rank) cost += k.hard ? HARD : SOFT * (4 - Math.min(3, k.priority));
        const prev = next.get(c.next);
        // The trail keeps the rank at the end of each school year (before any summer class).
        if (!prev || cost < prev.cost) next.set(c.next, { cost, steps: [...cell.steps, ...c.steps], trail: [...cell.trail, c.year] });
      }
    }
    layer = next;
  }
  let best: Cell | null = null;
  let bestRank = p.start;
  for (const rank of [...layer.keys()].sort((a, b) => b - a)) {
    const cell = layer.get(rank)!;
    if (!best || cell.cost < best.cost) {
      best = cell;
      bestRank = rank;
    }
  }
  const cell = best ?? { cost: 0, steps: [], trail: [] };
  const rankAfter = new Map<SchoolGrade, number>();
  p.grades.forEach((g, i) => rankAfter.set(g, cell.trail[i] ?? bestRank));
  const rankBy = (grade: number) => {
    let r = p.start;
    for (const g of p.grades) if (g <= grade) r = rankAfter.get(g) ?? r;
    return r;
  };
  const unmet = p.constraints.filter((k) => k.byGrade >= (p.grades[0] ?? 13) && rankBy(k.byGrade) < k.rank);
  const met = p.constraints.filter((k) => !unmet.includes(k));
  const slack = cell.steps.map((step) => {
    let latest = 13;
    let binding: LadderConstraint | null = null;
    for (const k of met) {
      if (k.rank < step.rank) continue;
      const l = k.byGrade - (k.rank - step.rank);
      if (l < latest) {
        latest = l;
        binding = k;
      }
    }
    return { step, latest, binding };
  });
  return { steps: cell.steps, rankAfter, cost: cell.cost, unmet, slack };
}
