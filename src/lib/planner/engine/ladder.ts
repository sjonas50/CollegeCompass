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

/** Highest rung reached by classes that can be built on (not failed or withdrawn), before `beforeGrade`. */
export function startRank(items: Item[], beforeGrade: number): number {
  let rank = 0;
  for (const i of items) {
    if (i.grade >= beforeGrade || !countsForSequence(i)) continue;
    const r = mathRankOf(i.typeId);
    if (r !== null && r > rank) rank = r;
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

export type LadderMoves = { double: boolean; summer: boolean };

export type LadderProblem = {
  grades: SchoolGrade[];
  start: number;
  /** Rank of the student's own math row in a grade, if any (locked: no suggestion that year). */
  locked: Map<SchoolGrade, number>;
  /** A rung can be scheduled in a grade (offered, and the load cap allows it). */
  available: (grade: SchoolGrade, rank: number) => boolean;
  constraints: LadderConstraint[];
  moves: LadderMoves;
};

export type LadderStep = { grade: SchoolGrade; rank: number; summer: boolean };

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
    // Two rungs in one year only where they can run side by side: Algebra I with Geometry (Texas
    // §28.025(b-6)) or Geometry with Algebra II. Precalculus and calculus build on each other.
    if (p.moves.double && up1 && rank + 2 <= MAX_DOUBLE_RANK && p.available(grade, rank + 2)) {
      out.push({ year: rank + 2, next: rank + 2, steps: [{ grade, rank: rank + 1, summer: false }, { grade, rank: rank + 2, summer: false }], cost: DOUBLE_COST });
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
  for (const grade of p.grades) {
    const next = new Map<number, Cell>();
    for (const rank of [...layer.keys()].sort((a, b) => a - b)) {
      const cell = layer.get(rank)!;
      for (const c of choices(p, grade, rank)) {
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
