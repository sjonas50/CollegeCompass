import { getCourseType, LANGUAGES, type LanguageCode } from "../course-types";
import type { Selector } from "../rules";
import type { Alternative, CLeaf } from "./compile";
import { MinCostFlow } from "./flow";
import type { Item } from "./model";
import { matchesAny, selectorSpecificity, wouldMatchIfConfirmed } from "./select";
import { UNITS_PER_CREDIT } from "../common";

// ---------------------------------------------------------------------------
// Allocation (design §5.5): which recorded and suggested classes count toward which requirement
// of one compiled alternative, in quarter-credit units.
//
// - exclusive: a min-cost max-flow from classes (capacity = their units) to requirements
//   (capacity = the units they need). Firm classes (finished or in progress) cost 1 per unit,
//   planned ones 10, plus 0-5 for how broad the requirement is, so specific requirements are
//   filled first and broad ones ("electives") take the leftovers. A class goes to one
//   requirement plus electives, unless every requirement it's split across allows splitting
//   (Tennessee Policy 3.103). Same-language requirements take their language classes first.
// - shareable requirements, counts and total credits never use up a class's credit.
// - independent: every requirement is checked on its own (admission patterns).
// ---------------------------------------------------------------------------

export type Allocation = "exclusive" | "independent";

export type LeafResult = {
  leaf: CLeaf;
  required: number;
  firm: number;
  planned: number;
  missing: number;
  counted: { item: Item; amount: number }[];
  /** A class with a guessed type is involved: counted by subject, or would count once confirmed. */
  guessed: boolean;
};

export type AltResult = {
  alt: Alternative;
  leaves: LeafResult[];
  firmMet: number;
  onTrack: number;
  /** Unmet requirements only college-level classes can meet (an AP-only option is never preferred). */
  collegeOnlyUnmet: number;
  /** Missing, in units (a course or a language level counts as a credit). */
  missingUnits: number;
};

const ELECTIVE_COST = 5;
const MAX_SPLIT_REPAIRS = 24;

function selectOf(leaf: CLeaf): Selector[] | null {
  return leaf.req.kind === "credits" || leaf.req.kind === "count" ? leaf.req.select : null;
}

/** A class counts toward a requirement: it matches, and it comes by the requirement's deadline grade. */
export function leafAccepts(leaf: CLeaf, item: Item): boolean {
  const req = leaf.req;
  // A summer class comes after the grade it follows: it counts toward the next grade's deadline.
  const grade = item.term === "summer" ? item.grade + 1 : item.grade;
  if (req.kind === "credits" && req.deadlineGrade !== undefined && grade > req.deadlineGrade) return false;
  const sels = selectOf(leaf);
  return sels ? matchesAny(item, sels) : true;
}

function isFlowLeaf(leaf: CLeaf): boolean {
  return (leaf.req.kind === "credits" && !leaf.req.shareable) || leaf.req.kind === "remaining_electives";
}

function itemOrder(a: Item, b: Item): number {
  return a.grade - b.grade || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function result(leaf: CLeaf, counted: { item: Item; amount: number }[], guessed: boolean): LeafResult {
  const required = leaf.required;
  let firm = 0;
  let planned = 0;
  for (const c of counted) {
    if (c.item.firm) firm += c.amount;
    else planned += c.amount;
  }
  firm = Math.min(firm, required);
  planned = Math.min(planned, required - firm);
  return { leaf, required, firm, planned, missing: required - firm - planned, counted, guessed };
}

/** Greedy for one requirement on its own: firm classes first, then planned, earliest grade first. */
function takeGreedy(items: Item[], need: number, perItem: (item: Item) => number): { item: Item; amount: number }[] {
  const sorted = [...items].sort((a, b) => Number(b.firm) - Number(a.firm) || itemOrder(a, b));
  const out: { item: Item; amount: number }[] = [];
  let left = need;
  for (const item of sorted) {
    if (left <= 0) break;
    const amount = Math.min(perItem(item), left);
    if (amount <= 0) continue;
    out.push({ item, amount });
    left -= amount;
  }
  return out.sort((a, b) => itemOrder(a.item, b.item));
}

function guessedFor(items: Item[], sels: readonly Selector[], counted: { item: Item }[], missing: boolean): boolean {
  if (counted.some((c) => c.item.assumed)) return true;
  return missing && items.some((i) => i.creditable && wouldMatchIfConfirmed(i, sels));
}

// Same language ------------------------------------------------------------------------

function languageOf(item: Item): { code: LanguageCode; rank: number } | null {
  if (item.assumed) return null;
  const ladder = getCourseType(item.typeId).ladder;
  if (!ladder || !ladder.id.startsWith("lang.")) return null;
  return { code: ladder.id.slice(5) as LanguageCode, rank: ladder.rank };
}

/** The language that gets furthest toward `levels`, and the classes that make up its levels. */
export function languageProgress(items: Item[], leaf: CLeaf): { code: LanguageCode | null; counted: { item: Item; amount: number }[] } {
  if (leaf.req.kind !== "same_language") return { code: null, counted: [] };
  const req = leaf.req;
  const byCode = new Map<LanguageCode, Item[]>();
  for (const item of items) {
    if (!item.creditable) continue;
    const lang = languageOf(item);
    if (!lang || req.exclude?.includes(lang.code)) continue;
    if (req.grades && !req.grades.includes(item.grade)) continue;
    byCode.set(lang.code, [...(byCode.get(lang.code) ?? []), item]);
  }
  let best: { code: LanguageCode; firm: number; all: number } | null = null;
  for (const code of LANGUAGES) {
    const list = byCode.get(code);
    if (!list) continue;
    const firm = Math.min(req.levels, Math.max(0, ...list.filter((i) => i.firm).map((i) => languageOf(i)!.rank)));
    const all = Math.min(req.levels, Math.max(...list.map((i) => languageOf(i)!.rank)));
    if (!best || firm > best.firm || (firm === best.firm && all > best.all)) best = { code, firm, all };
  }
  if (!best) return { code: null, counted: [] };
  const list = byCode.get(best.code)!;
  const counted: { item: Item; amount: number }[] = [];
  let reached = 0;
  for (let level = 1; level <= best.all; level++) {
    const atLevel = list
      .filter((i) => languageOf(i)!.rank === level)
      .sort((a, b) => Number(b.firm) - Number(a.firm) || itemOrder(a, b))[0];
    if (!atLevel) continue;
    counted.push({ item: atLevel, amount: level - reached });
    reached = level;
  }
  return { code: best.code, counted };
}

function languageResult(items: Item[], leaf: CLeaf): LeafResult {
  const { counted } = languageProgress(items, leaf);
  // Levels reached: firm counts only up to the highest firm level.
  const firmLevel = Math.max(0, ...counted.filter((c) => c.item.firm).map((c) => languageOf(c.item)!.rank));
  const allLevel = Math.max(0, ...counted.map((c) => languageOf(c.item)!.rank));
  const required = leaf.required;
  const firm = Math.min(firmLevel, required);
  const planned = Math.min(allLevel, required) - firm;
  const missing = required - firm - planned;
  const guessed = missing > 0 && items.some((i) => i.creditable && i.assumed && i.subject === "world_language");
  return { leaf, required, firm, planned, missing, counted, guessed };
}

// Flow ------------------------------------------------------------------------------------

type FlowSolution = { flow: number; cost: number; assign: Map<number, Map<number, number>> };

function solveFlow(pool: { item: Item; units: number }[], leaves: { leaf: CLeaf; cap: number }[], allowed: (i: number, l: number) => boolean): FlowSolution {
  const P = pool.length;
  const L = leaves.length;
  const source = P + L;
  const sink = source + 1;
  const g = new MinCostFlow(P + L + 2);
  const edges: { i: number; l: number; e: number }[] = [];
  pool.forEach((p, i) => g.addEdge(source, i, p.units, 0));
  leaves.forEach((l, j) => g.addEdge(P + j, sink, l.cap, 0));
  const spec = leaves.map(({ leaf }) => (leaf.req.kind === "remaining_electives" ? ELECTIVE_COST : selectorSpecificity(selectOf(leaf) ?? [])));
  pool.forEach((p, i) => {
    leaves.forEach(({ leaf, cap }, j) => {
      if (cap <= 0 || !allowed(i, j)) return;
      if (!leafAccepts(leaf, p.item)) return;
      const cost = (p.item.firm ? 1 : 10) + spec[j];
      edges.push({ i, l: j, e: g.addEdge(i, P + j, p.units, cost) });
    });
  });
  const { flow, cost } = g.run(source, sink);
  const assign = new Map<number, Map<number, number>>();
  for (const { i, l, e } of edges) {
    const f = g.flowOn(e);
    if (f <= 0) continue;
    if (!assign.has(i)) assign.set(i, new Map());
    assign.get(i)!.set(l, f);
  }
  return { flow, cost, assign };
}

/** A class split across two requirements (other than electives) that don't both allow it. */
function firstSplit(sol: FlowSolution, leaves: { leaf: CLeaf }[]): { i: number; ls: number[] } | null {
  for (const [i, byLeaf] of [...sol.assign.entries()].sort((a, b) => a[0] - b[0])) {
    const specific = [...byLeaf.keys()].filter((l) => leaves[l].leaf.req.kind !== "remaining_electives").sort((a, b) => a - b);
    if (specific.length < 2) continue;
    const allSplit = specific.every((l) => {
      const req = leaves[l].leaf.req;
      return req.kind === "credits" && req.allowSplit === true;
    });
    if (!allSplit) return { i, ls: specific };
  }
  return null;
}

function better(a: FlowSolution, b: FlowSolution): boolean {
  return a.flow > b.flow || (a.flow === b.flow && a.cost < b.cost);
}

function solveNoSplit(pool: { item: Item; units: number }[], leaves: { leaf: CLeaf; cap: number }[]): FlowSolution {
  let solves = 0;
  const search = (restrict: Map<number, number>): FlowSolution => {
    solves++;
    const sol = solveFlow(pool, leaves, (i, l) => {
      const only = restrict.get(i);
      return only === undefined || only === l || leaves[l].leaf.req.kind === "remaining_electives";
    });
    const split = firstSplit(sol, leaves);
    if (!split || solves >= MAX_SPLIT_REPAIRS) return sol;
    let best: FlowSolution | null = null;
    for (const l of split.ls) {
      if (solves >= MAX_SPLIT_REPAIRS) break;
      const next = new Map(restrict);
      next.set(split.i, l);
      const candidate = search(next);
      if (!best || better(candidate, best)) best = candidate;
    }
    return best ?? sol;
  };
  return search(new Map());
}

// Alternatives -----------------------------------------------------------------------------

export function evaluateAlternative(alt: Alternative, items: Item[], allocation: Allocation): AltResult {
  const creditable = items.filter((i) => i.creditable).sort(itemOrder);
  const results = new Map<CLeaf, LeafResult>();

  if (allocation === "exclusive") {
    const remaining = new Map<string, number>(creditable.map((i) => [i.key, i.units]));
    // Same-language requirements take their language classes first.
    // Several same-language requirements in one allocation describe one language sequence (Texas
    // §74.13(g): an endorsement's language levels also count for the foundation's), so they share
    // their language classes; those classes count toward nothing else.
    const languageUsed = new Set<string>();
    for (const leaf of alt.leaves) {
      if (leaf.req.kind !== "same_language") continue;
      const available = creditable.filter((i) => (remaining.get(i.key) ?? 0) > 0 || languageUsed.has(i.key));
      const r = languageResult(available, leaf);
      for (const c of r.counted) {
        remaining.set(c.item.key, 0);
        languageUsed.add(c.item.key);
      }
      results.set(leaf, r);
    }
    const flowLeaves = alt.leaves.filter(isFlowLeaf);
    const reduce = new Map<string, number>();
    for (const leaf of alt.leaves) if (leaf.subFor) reduce.set(leaf.subFor, (reduce.get(leaf.subFor) ?? 0) + leaf.required);
    const withCap = flowLeaves.map((leaf) => ({ leaf, cap: Math.max(0, leaf.required - (leaf.subFor === null ? (reduce.get(leaf.id) ?? 0) : 0)) }));
    const pool = creditable.filter((i) => (remaining.get(i.key) ?? 0) > 0).map((item) => ({ item, units: remaining.get(item.key)! }));
    const sol = solveNoSplit(pool, withCap);
    const countedBy = new Map<number, { item: Item; amount: number }[]>();
    for (const [i, byLeaf] of sol.assign) {
      for (const [l, amount] of byLeaf) countedBy.set(l, [...(countedBy.get(l) ?? []), { item: pool[i].item, amount }]);
    }
    withCap.forEach(({ leaf }, l) => {
      const counted = (countedBy.get(l) ?? []).sort((a, b) => itemOrder(a.item, b.item));
      const sels = selectOf(leaf);
      results.set(leaf, result(leaf, counted, sels ? guessedFor(items, sels, counted, counted.reduce((n, c) => n + c.amount, 0) < leaf.required) : false));
    });
  } else {
    for (const leaf of alt.leaves) {
      if (leaf.req.kind === "same_language") results.set(leaf, languageResult(creditable, leaf));
      else if (leaf.req.kind === "credits") {
        const sels = leaf.req.select;
        const counted = takeGreedy(creditable.filter((i) => leafAccepts(leaf, i)), leaf.required, (i) => i.units);
        results.set(leaf, result(leaf, counted, guessedFor(items, sels, counted, counted.reduce((n, c) => n + c.amount, 0) < leaf.required)));
      }
    }
    for (const leaf of alt.leaves) {
      if (leaf.req.kind !== "remaining_electives") continue;
      const used = new Set([...results.values()].flatMap((r) => r.counted.map((c) => c.item.key)));
      const counted = takeGreedy(creditable.filter((i) => !used.has(i.key)), leaf.required, (i) => i.units);
      results.set(leaf, result(leaf, counted, false));
    }
  }

  // Requirements that never use up credit.
  for (const leaf of alt.leaves) {
    if (results.has(leaf)) continue;
    const req = leaf.req;
    if (req.kind === "credits") {
      const counted = takeGreedy(creditable.filter((i) => leafAccepts(leaf, i)), leaf.required, (i) => i.units);
      results.set(leaf, result(leaf, counted, guessedFor(items, req.select, counted, counted.reduce((n, c) => n + c.amount, 0) < leaf.required)));
    } else if (req.kind === "count") {
      const counted = takeGreedy(creditable.filter((i) => matchesAny(i, req.select)), leaf.required, () => 1);
      results.set(leaf, result(leaf, counted, guessedFor(items, req.select, counted, counted.length < leaf.required)));
    } else if (req.kind === "total_credits") {
      const counted = creditable.map((item) => ({ item, amount: item.units }));
      results.set(leaf, result(leaf, counted, false));
    } else if (req.kind === "same_language") {
      results.set(leaf, languageResult(creditable, leaf));
    } else {
      results.set(leaf, result(leaf, [], false));
    }
  }

  // Substitutions: the substituting classes count toward their target too (Tennessee CS credit).
  for (const leaf of alt.leaves) {
    if (!leaf.subFor) continue;
    const sub = results.get(leaf)!;
    const targetLeaf = alt.leaves.find((l) => l.id === leaf.subFor);
    if (!targetLeaf) continue;
    const target = results.get(targetLeaf)!;
    const counted = [...target.counted, ...sub.counted].sort((a, b) => itemOrder(a.item, b.item));
    results.set(targetLeaf, result(targetLeaf, counted, target.guessed || sub.guessed));
  }

  const leaves = alt.leaves.map((l) => results.get(l)!);
  let firmMet = 0;
  let onTrack = 0;
  let missingUnits = 0;
  let collegeOnlyUnmet = 0;
  for (const r of leaves) {
    if (r.missing === 0 && r.planned === 0) firmMet++;
    if (r.missing === 0) onTrack++;
    if (r.missing > 0 && requiresCollegeLevel(r.leaf)) collegeOnlyUnmet++;
    missingUnits += r.leaf.measure === "units" ? r.missing : r.missing * UNITS_PER_CREDIT;
  }
  return { alt, leaves, firmMet, onTrack, collegeOnlyUnmet, missingUnits };
}

/** Only AP, IB, Cambridge or college-credit classes can meet it. */
export function requiresCollegeLevel(leaf: CLeaf): boolean {
  const sels = selectOf(leaf);
  return !!sels && sels.length > 0 && sels.every((s) => s.levels !== undefined && s.levels.every((l) => l === "ap" || l === "ib" || l === "cambridge" || l === "dual_enrollment"));
}

/**
 * The alternative to report and plan toward (design §5.5, adapted): one whose unmet requirements
 * can still be met; then the fewest unmet requirements only college-level classes could meet
 * (rigor is never the default route); then most requirements done and most on track (counted as
 * the fewest still open, so alternatives of different sizes compare fairly); then the fewest
 * missing units; then `prefer`; then author order.
 */
export type PickOptions = {
  /** Only these alternatives are considered (an extension follows its base's choice). */
  allowed?: (alt: Alternative) => boolean;
  /** Every unmet requirement can still be met in the grades left (a calculus-only route from no math can't). */
  feasible?: (r: AltResult) => boolean;
  /** Higher first: merge potential with other targets. */
  prefer?: (r: AltResult) => number;
};

export function pickAlternative(results: AltResult[], opts: PickOptions = {}): AltResult {
  // Open requirements (not done; not on track) rather than done ones, so an alternative with more,
  // smaller requirements doesn't win just by having more of them ("calculus with a C" is one
  // requirement that completes Utah math; the three-course sequence is three).
  const open = (x: AltResult) => x.leaves.length - x.firmMet;
  const offTrack = (x: AltResult) => x.leaves.length - x.onTrack;
  const feasible = results.map((r) => (opts.feasible ? opts.feasible(r) : true));
  let bestIndex = 0;
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    const best = results[bestIndex];
    const d =
      Number(feasible[i]) - Number(feasible[bestIndex]) ||
      best.collegeOnlyUnmet - r.collegeOnlyUnmet ||
      open(best) - open(r) ||
      offTrack(best) - offTrack(r) ||
      best.missingUnits - r.missingUnits ||
      (opts.prefer ? opts.prefer(r) - opts.prefer(best) : 0);
    if (d > 0) bestIndex = i;
  }
  return results[bestIndex];
}
