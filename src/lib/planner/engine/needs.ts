import { type CourseTypeId, getCourseType, ladderTypes } from "../course-types";
import type { DemandPriority, Reason } from "../engine-io";
import { type FamilyId, MATH_TARGET_DEFS, type MathTarget } from "../families";
import type { ReqId, RuleSetId, Selector, TestRoute } from "../rules";
import type { AltResult, LeafResult } from "./allocate";
import type { CLeaf } from "./compile";
import { leafAccepts } from "./allocate";
import { mightBeRows, pastRungRows, waitingKinds } from "./confirm";
import { type Ctx, type FamilyCtx, leafPriority, type RuleSetCtx } from "./context";
import { prepReason, requirementReason, ruleSetNotes } from "./explain";
import type { Item } from "./model";
import { matchesAny } from "./select";
import { UNITS_PER_CREDIT } from "../common";

// ---------------------------------------------------------------------------
// Needs (design §5.6): each unmet requirement and each major-prep target becomes a demand with a
// priority (P0 graduation … P3 major prep and aid), the classes that would count, and the window
// of grades it can go in. The fill step places classes for them; whatever stays unmet is a gap.
// ---------------------------------------------------------------------------

export type Need = {
  id: string;
  priority: DemandPriority;
  source: "rule" | "prep" | "check";
  rc: RuleSetCtx | null;
  leaf: CLeaf | null;
  familyId: FamilyId | null;
  label: string;
  selectors: Selector[];
  measure: "units" | "courses" | "levels";
  required: number;
  missing: number;
  fromGrade: number;
  byGrade: number;
  /** Rule sets with exclusive allocation: a class counts toward one of their requirements. */
  exclusiveGroup: string | null;
  /** Placed if there's room, never a gap (key courses, aid priority). */
  soft: boolean;
  /** A same-language requirement (placed as consecutive levels of one language). */
  language: { levels: number } | null;
  /** Only in grades that don't already have a class in the subject (enrolled-years checks). */
  distinctGrades: boolean;
  /** The math target it expresses, for the "lower target" option. */
  mathTarget: MathTarget | null;
  testRoutes: TestRoute[];
  forWhat: { ruleSetId: RuleSetId; reqId: ReqId } | { prep: FamilyId };
  reasons: Reason[];
  /**
   * Utah's senior-year math (R277-700-9): only for a college-bound student who hasn't shown
   * college-ready math. `askFirst`: a senior who passed calculus or hasn't said whether they met
   * the competency gets the question, not a class flagged "Needs a plan now".
   */
  seniorMath?: { askFirst: boolean; ce?: boolean };
  /**
   * Waiting on the student to confirm a class (engine/confirm.ts): one of their unconfirmed rows
   * might count here. Never a gap, and a requirement's class isn't added for it (the row might be
   * that class); the next math rung still follows the guess.
   */
  waiting?: boolean;
  /** The kinds a row it waits on might be that would meet it: what a class held for it would be. */
  waitingKinds?: CourseTypeId[];
  /**
   * Short only because a guessed row puts the student past the rung it names: never a gap, but a
   * class for it may still be added where one fits.
   */
  guessedPast?: boolean;
  /**
   * A key course the student is past: a later class in its sequence meets it (Computer Science
   * Principles after Computer Science III or AP Computer Science A: course-types `introTo`).
   */
  metBy?: readonly CourseTypeId[];
};

export function needUnits(need: Need): number {
  return need.measure === "units" ? need.missing : need.missing * UNITS_PER_CREDIT;
}

function leafSelectors(leaf: CLeaf): Selector[] | null {
  if (leaf.req.kind === "credits" || leaf.req.kind === "count") return leaf.req.select;
  if (leaf.req.kind === "same_language") return [{ subjects: ["world_language"] }];
  return null;
}

function deadlineFor(leaf: CLeaf): number {
  // An "on schedule by" check doesn't move the class earlier: a class planned for 12th is on schedule.
  return leaf.req.kind === "credits" && leaf.req.deadlineGrade ? Math.min(12, leaf.req.deadlineGrade) : 12;
}

/** The rule set's test-score routes that stand in for this requirement (or check): routes without `reqIds` stand in for all of them. */
export function testRoutesFor(rc: RuleSetCtx, id: string): TestRoute[] {
  return (rc.rs.testRoutes ?? []).filter((t) => !t.reqIds || t.reqIds.includes(id));
}

function selectorGradeFloor(sels: Selector[]): number {
  const mins = sels.map((s) => (s.grades ? Math.min(...s.grades) : 7));
  return Math.min(...mins);
}

export function needFromLeaf(ctx: Ctx, rc: RuleSetCtx, r: LeafResult, baseRc?: RuleSetCtx): Need | null {
  const leaf = r.leaf;
  const owner = baseRc ?? rc;
  const priority = leafPriority(owner, leaf.strength);
  if (priority === null) return null;
  const sels = leafSelectors(leaf);
  if (!sels) return null;
  const shareable = leaf.req.kind === "credits" && leaf.req.shareable === true;
  return {
    id: `${owner.rs.id}/${leaf.id}`,
    priority,
    source: "rule",
    rc: owner,
    leaf,
    familyId: null,
    label: leaf.label,
    selectors: sels,
    measure: leaf.measure,
    required: r.required,
    missing: r.missing,
    fromGrade: Math.max(ctx.firstGrade, selectorGradeFloor(sels)),
    byGrade: deadlineFor(leaf),
    exclusiveGroup: owner.allocation === "exclusive" && leaf.req.kind === "credits" && !shareable ? owner.rs.id : null,
    soft: leaf.strength === "priority",
    language: leaf.req.kind === "same_language" ? { levels: leaf.req.levels } : null,
    distinctGrades: false,
    mathTarget: null,
    testRoutes: testRoutesFor(owner, leaf.id),
    forWhat: { ruleSetId: owner.rs.id, reqId: leaf.id },
    reasons: [requirementReason(owner, leaf), ...ruleSetNotes(owner)],
  };
}

/**
 * Needs from one rule set's evaluated alternative (base leaves joined through `extends` use the
 * base's id). A requirement that only counts once finished is never a need, and neither are
 * credits that expand another requirement (`expands`). When a class that may stand in for another
 * requirement (Tennessee's computer science credit for the 4th math) is still missing, the
 * requirement it stands in for needs only what that class won't cover.
 */
export function needsFromEval(ctx: Ctx, rc: RuleSetCtx, alt: AltResult, items?: readonly Item[]): Need[] {
  const out: Need[] = [];
  const covered = new Map<string, number>();
  for (const r of alt.leaves) if (r.leaf.subFor && r.missing > 0) covered.set(r.leaf.subFor, (covered.get(r.leaf.subFor) ?? 0) + r.missing);
  for (const raw of alt.leaves) {
    if (raw.missing <= 0) continue;
    if (raw.leaf.req.kind === "credits" && raw.leaf.req.onlyWhenDone) continue;
    // Credits that expand the elective focus are the counselor's call ("ask your counselor which
    // classes count"): a gap, never a class the plan adds (buildGaps).
    if (raw.leaf.expands) continue;
    const cover = covered.get(raw.leaf.id) ?? 0;
    if (cover >= raw.missing) continue;
    const r = cover > 0 ? { ...raw, missing: raw.missing - cover } : raw;
    let base: RuleSetCtx | undefined;
    if (!r.leaf.own) {
      const b = rc.bases.find((x) => x.variant.requirements.some((q) => containsReq(q, r.leaf.id)));
      base = b ? ctx.ruleSets.find((x) => x.rs.id === b.rs.id) : undefined;
      if (!base) continue;
    }
    const need = needFromLeaf(ctx, rc, r, base);
    const might = need && items ? mightBeRows(raw.leaf, raw, items) : [];
    if (need && might.length > 0) {
      need.waiting = true;
      need.waitingKinds = waitingKinds(might, (probe) => raw.leaf.req.kind === "same_language" ? probe.subject === "world_language" : leafAccepts(raw.leaf, probe));
    }
    if (need && items && pastRungRows(raw.leaf, raw, items).length > 0) need.guessedPast = true;
    if (need) out.push(need);
  }
  return out;
}

function containsReq(req: { id: string; kind: string; of?: unknown; on?: unknown; off?: unknown }, id: string): boolean {
  if (req.id === id) return true;
  const kids = [...((req.of as (typeof req)[] | undefined) ?? []), ...(req.on ? [req.on as typeof req] : []), ...(req.off ? [req.off as typeof req] : [])];
  return kids.some((k) => containsReq(k, id));
}

// Major prep --------------------------------------------------------------------------------------

const MATH_TARGET_LABELS: Record<MathTarget, string> = {
  CALC: "Calculus",
  PRECALC: "Precalculus",
  STATS: "Algebra II and statistics",
  "ALG2+": "Algebra II and a 4th year of math",
  APPLIED: "Algebra I, Geometry and Algebra II",
};

function typesAtOrAbove(rank: number): CourseTypeId[] {
  return ladderTypes("math")
    .filter((t) => t.ladder!.rank >= rank)
    .map((t) => t.id);
}

function prepNeed(ctx: Ctx, f: FamilyCtx, what: string, sels: Selector[], units: number, fields: Partial<Need>, citations: string[]): Need {
  const id = `prep:${f.target.familyId}/${what}`;
  return {
    id,
    priority: 3,
    source: "prep",
    rc: null,
    leaf: null,
    familyId: f.target.familyId,
    label: fields.label ?? what,
    selectors: sels,
    measure: "units",
    required: units,
    missing: units,
    fromGrade: Math.max(ctx.firstGrade, 9),
    byGrade: 12,
    exclusiveGroup: null,
    soft: false,
    language: null,
    distinctGrades: false,
    mathTarget: null,
    testRoutes: [],
    forWhat: { prep: f.target.familyId },
    reasons: [prepReason(ctx, f.target.familyId, fields.label ?? what, citations)],
    ...fields,
  };
}

/** A family's reviewed targets as needs (independent: a class counts toward every target it matches). */
export function familyNeeds(ctx: Ctx, f: FamilyCtx): Need[] {
  const fc = f.content;
  if (!fc) return [];
  const out: Need[] = [];
  const mathCite = fc.math.cite;
  for (const target of f.math) {
    const def = MATH_TARGET_DEFS[target];
    const need = prepNeed(ctx, f, `math.${target}`, [{ types: typesAtOrAbove(def.rank) }], 4, { label: MATH_TARGET_LABELS[target], mathTarget: target }, mathCite);
    need.reasons = [prepReason(ctx, f.target.familyId, def.target, mathCite)];
    out.push(need);
    if (def.statistics) out.push(prepNeed(ctx, f, "math.stats", [{ types: ["math.stats"] }], 4, { label: "Statistics" }, mathCite));
    if (def.fourthYear) {
      out.push(
        // Years of math, so a class in a year that already has one (or in summer) doesn't add one.
        prepNeed(ctx, f, "math.fourth_year", [{ subjects: ["math"], grades: [9, 10, 11, 12], exclude: ["math.ms"] }], 16, { label: "Four years of high school math", distinctGrades: true }, mathCite),
      );
    }
  }
  // One class of each: a key course that's a half credit (a speech class) is one class, not two.
  for (const sci of fc.sciences) {
    out.push(prepNeed(ctx, f, sci, [{ types: [sci] }], getCourseType(sci).units, { label: getCourseType(sci).title }, mathCite));
  }
  for (const key of fc.keyCourses) {
    const metBy = getCourseType(key).introTo;
    out.push(prepNeed(ctx, f, key, [{ types: [key] }], getCourseType(key).units, { label: getCourseType(key).title, soft: true, ...(metBy.length ? { metBy } : {}) }, mathCite));
  }
  return out;
}

/** How much of a prep need the student's classes already cover (independent, whole classes). */
export function evaluatePrep(need: Need, items: Item[]): { missing: number; counted: Item[] } {
  const past = need.metBy ? items.find((i) => i.creditable && need.metBy!.includes(i.typeId)) : undefined;
  if (past) return { missing: 0, counted: [past] };
  const matching = items
    .filter((i) => i.creditable && matchesAny(i, need.selectors))
    .sort((a, b) => Number(b.firm) - Number(a.firm) || a.grade - b.grade || (a.key < b.key ? -1 : 1));
  let have = 0;
  const counted: Item[] = [];
  for (const i of matching) {
    if (have >= need.required) break;
    have += need.measure === "units" ? i.units : 1;
    counted.push(i);
  }
  return { missing: Math.max(0, need.required - have), counted };
}

export { isLadderish } from "./ladder";
