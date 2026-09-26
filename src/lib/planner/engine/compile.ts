import { type CourseTypeId, getCourseType } from "../course-types";
import type { PlannerChoices } from "../engine-io";
import type {
  CitationId,
  CountReq,
  CreditsReq,
  RemainingElectivesReq,
  Req,
  ReqArea,
  ReqId,
  SameLanguageReq,
  Selector,
  Strength,
  TotalCreditsReq,
  Variant,
} from "../rules";
import { MAX_ALTERNATIVES_PER_VARIANT } from "../validate";
import { type Item, itemFromSuggestion } from "./model";
import { matchesAny } from "./select";

// ---------------------------------------------------------------------------
// Compilation (design §5.4): a variant's requirement tree becomes flat alternatives, each a list
// of leaves. `all` multiplies, `any` adds, `choose` takes combinations, `option` follows the
// family's choice, and a credit that may substitute for one of k requirements adds k
// alternatives. Author order is kept, so the first alternative is the author's preference, and
// the list is capped at 256 (the validator refuses content that could go past it).
// ---------------------------------------------------------------------------

export type LeafReq = CreditsReq | CountReq | SameLanguageReq | TotalCreditsReq | RemainingElectivesReq;

export type CLeaf = {
  id: ReqId;
  req: LeafReq;
  label: string;
  /** The leaf's own strength, else its nearest group's, else the rule set's. */
  strength: Strength;
  strengthCite: CitationId | null;
  area: ReqArea | null;
  cite: CitationId[];
  /** From the rule set's own variant (false for leaves joined through `extends`). */
  own: boolean;
  /** Group ids above the leaf, outermost first. */
  path: ReqId[];
  /** In this alternative the leaf's classes also count toward that leaf (Tennessee computer science). */
  subFor: ReqId | null;
  /**
   * In this alternative the requirement's substitute selectors for the kind of class that leaf
   * names (a `substituteOnce` credit) are off: that kind stands in somewhere else (Tennessee's
   * computer science as the 4th math, so not as the 3rd lab science too).
   */
  noSubstitutesOf: ReqId | null;
  measure: "units" | "courses" | "levels";
  required: number;
  /** The whole group this leaf belongs to is a family-chosen option branch. */
  optionPref: string | null;
  /**
   * The nearest `choose` or `any` group above the leaf: the leaf is one way to meet it, not the
   * requirement itself. `text` says what the requirement is (Utah's "Science (two of the five
   * foundation science areas and one more science credit)").
   */
  choice: { id: ReqId; kind: "choose" | "any"; text: string } | null;
};

export type Alternative = { index: number; leaves: CLeaf[] };

type Inherited = {
  strength: Strength;
  strengthCite: CitationId | null;
  area: ReqArea | null;
  path: ReqId[];
  optionPref: string | null;
  /** The rule set's top-level requirement the leaf is under. */
  top: Req | null;
  choice: CLeaf["choice"];
};

/** "Two of the five…" → "two of the five…"; names and acronyms keep their capitals. */
function lowerLabel(label: string): string {
  const first = label.split(" ")[0].replace(/[,;:]$/, "");
  if (!/^[A-Z][a-z]+$/.test(first) || /^(English|Spanish|French|Algebra|Geometry|Secondary|Integrated|American|Personal|Texas|Utah|Tennessee)$/.test(first)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** What a requirement with a choice in it asks for, in one line. */
function choiceText(group: Req, top: Req, branch: Req | undefined): string {
  if (group.kind === "choose") {
    if (top === group || (top.kind !== "all" && top.kind !== "any")) return group.label;
    const parts = top.of.map((r) => lowerLabel(r.label));
    return `${top.label} (${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts[parts.length - 1]})`;
  }
  // One route among several (a Texas endorsement's programs): "A public services career and
  // technical program of study (one way: education and training program)".
  return branch ? `${group.label} (one way: ${lowerLabel(branch.label.replace(/\s*\([^()]*\)$/, ""))})` : group.label;
}

const CAP = MAX_ALTERNATIVES_PER_VARIANT;

function product(a: CLeaf[][], b: CLeaf[][]): CLeaf[][] {
  const out: CLeaf[][] = [];
  for (const x of a) {
    for (const y of b) {
      out.push([...x, ...y]);
      if (out.length >= CAP) return out;
    }
  }
  return out;
}

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number) => {
    if (out.length >= CAP) return;
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

function leafOf(req: LeafReq, inh: Inherited, own: boolean): CLeaf {
  const measure = req.kind === "count" ? "courses" : req.kind === "same_language" ? "levels" : "units";
  const required = req.kind === "count" ? req.n : req.kind === "same_language" ? req.levels : req.units;
  return {
    id: req.id,
    req,
    label: req.label,
    strength: req.strength ?? inh.strength,
    strengthCite: req.strength ? (req.strengthCite ?? null) : inh.strengthCite,
    area: req.area ?? inh.area,
    cite: req.cite,
    own,
    path: inh.path,
    subFor: null,
    noSubstitutesOf: null,
    measure,
    required,
    optionPref: inh.optionPref,
    choice: inh.choice,
  };
}

function compileReq(req: Req, inh: Inherited, own: boolean, choices: PlannerChoices): CLeaf[][] {
  const top = inh.top ?? req;
  const child: Inherited = {
    strength: req.strength ?? inh.strength,
    strengthCite: req.strength ? (req.strengthCite ?? null) : inh.strengthCite,
    area: req.area ?? inh.area,
    path: [...inh.path, req.id],
    optionPref: inh.optionPref,
    top,
    choice: inh.choice,
  };
  // The nearest choose/any group: each branch below it is one way to meet it.
  const branchOf = (r: Req): Inherited =>
    req.kind === "any" || req.kind === "choose" ? { ...child, choice: { id: req.id, kind: req.kind, text: choiceText(req, top, r) } } : child;
  switch (req.kind) {
    case "all":
      return req.of.reduce<CLeaf[][]>((acc, r) => product(acc, compileReq(r, child, own, choices)), [[]]);
    case "any":
      return req.of.flatMap((r) => compileReq(r, branchOf(r), own, choices)).slice(0, CAP);
    case "choose": {
      const lists = req.of.map((r) => compileReq(r, branchOf(r), own, choices));
      const out: CLeaf[][] = [];
      for (const combo of combinations(lists.length, req.n)) {
        out.push(...combo.reduce<CLeaf[][]>((acc, i) => product(acc, lists[i]), [[]]));
        if (out.length >= CAP) break;
      }
      return out.slice(0, CAP);
    }
    case "option": {
      const on = choices[req.pref] === true;
      // A branch inside another family-chosen branch keeps the outer choice (a Tennessee focus sized
      // by a world language waiver, then by a fine arts waiver).
      return compileReq(on ? req.on : req.off, { ...child, optionPref: on ? req.pref : inh.optionPref }, own, choices);
    }
    case "credits": {
      const leaf = leafOf(req, inh, own);
      return [[leaf], ...(req.substitutesForOneOf ?? []).map((s) => [{ ...leaf, subFor: s }])];
    }
    default:
      return [[leafOf(req, inh, own)]];
  }
}

/** The leaves of a variant's alternatives, before substitutions are resolved. */
function variantLeaves(variant: Variant, strength: Strength, strengthCite: CitationId, own: boolean, choices: PlannerChoices): CLeaf[][] {
  const root: Inherited = { strength, strengthCite, area: null, path: [], optionPref: null, top: null, choice: null };
  return variant.requirements.reduce<CLeaf[][]>((acc, r) => product(acc, compileReq(r, root, own, choices)), [[]]);
}

/** The leaf a substitution names: the leaf itself, or the last credits leaf of the group it names. */
function substitutionTarget(leaves: CLeaf[], id: ReqId, self: CLeaf): CLeaf | null {
  const direct = leaves.find((l) => l.id === id && l !== self && l.req.kind === "credits");
  return direct ?? [...leaves].reverse().find((l) => l !== self && l.path.includes(id) && l.req.kind === "credits") ?? null;
}

/**
 * A substitution names a requirement id: a leaf, or a group whose last credits leaf takes it. An
 * alternative whose substitution target isn't in it is the same as the plain alternative, so it's
 * dropped.
 */
function resolveSubstitutions(leaves: CLeaf[]): CLeaf[] | null {
  const out: CLeaf[] = [];
  for (const leaf of leaves) {
    if (!leaf.subFor) {
      out.push(leaf);
      continue;
    }
    const target = substitutionTarget(leaves, leaf.subFor, leaf);
    if (!target) return null;
    out.push({ ...leaf, subFor: target.id });
  }
  return out;
}

/** A course type as a plain class, to test which requirements its kind belongs to. */
function typeItem(typeId: CourseTypeId): Item {
  const t = getCourseType(typeId);
  return itemFromSuggestion({ n: -1, key: "kind", typeId, level: "regular", grade: 10, schoolYear: 2030, term: "full_year", units: t.units, cte: t.cte === "always", lectureOnly: false });
}

/** A substitute selector for the kind of class a `substituteOnce` credit counts (computer science). */
function sameKind(sel: Selector, kind: readonly Selector[]): boolean {
  if (!sel.substitute) return false;
  if (sel.types?.length) return sel.types.every((t) => matchesAny(typeItem(t), kind));
  return !!sel.subjects?.length && sel.subjects.every((s) => kind.some((k) => k.subjects?.includes(s)));
}

/**
 * A kind of class that may stand in only once (`substituteOnce`, Tennessee Policy 2.103 I(4)(b)1:
 * computer science for "one (1) credit in mathematics, or one (1) credit in science"): in each
 * alternative, the requirements it may stand in for keep their substitute selectors for that kind
 * on at most one of them. When the credit itself stands in for one, the others lose them; the
 * plain route splits into one alternative per requirement that may still take such a class.
 */
function limitSubstitutions(leaves: CLeaf[]): CLeaf[][] {
  let lists: CLeaf[][] = [leaves];
  for (const src of leaves) {
    const req = src.req;
    if (req.kind !== "credits" || !req.substituteOnce || !req.substitutesForOneOf?.length) continue;
    const next: CLeaf[][] = [];
    for (const list of lists) {
      const self = list.find((l) => l.id === src.id) ?? src;
      const targets: ReqId[] = [];
      for (const id of req.substitutesForOneOf) {
        const t = substitutionTarget(list, id, self);
        if (t && !targets.includes(t.id)) targets.push(t.id);
      }
      const strip = (off: ReqId[]) =>
        list.map((l) => {
          if (!off.includes(l.id) || l.req.kind !== "credits") return l;
          const select = l.req.select.filter((s) => !sameKind(s, req.select));
          return select.length === l.req.select.length || select.length === 0 ? l : { ...l, req: { ...l.req, select }, noSubstitutesOf: src.id };
        });
      if (self.subFor) next.push(strip(targets.filter((t) => t !== self.subFor)));
      else if (targets.length === 0) next.push(list);
      else for (const keep of targets) next.push(strip(targets.filter((t) => t !== keep)));
    }
    lists = next;
  }
  return lists;
}

/**
 * What identifies a leaf across alternatives and rule sets that join it: its id, what it stands in
 * for, and whether a one-time substitution is off for it.
 */
export function leafSignature(l: CLeaf): string {
  return `${l.id}>${l.subFor ?? ""}${l.noSubstitutesOf ? `!${l.noSubstitutesOf}` : ""}`;
}

export type RuleSetStrength = { strength: Strength; strengthCite: CitationId };

/**
 * Every alternative for a variant, with the leaves of the variants it extends joined in (their
 * leaves are marked `own: false`). `bases` are outermost first.
 */
export function compileVariant(variant: Variant, rs: RuleSetStrength, bases: { variant: Variant; rs: RuleSetStrength }[], choices: PlannerChoices): Alternative[] {
  let lists: CLeaf[][] = [[]];
  for (const base of bases) lists = product(lists, variantLeaves(base.variant, base.rs.strength, base.rs.strengthCite, false, choices));
  lists = product(lists, variantLeaves(variant, rs.strength, rs.strengthCite, true, choices));
  const out: Alternative[] = [];
  for (const leaves of lists) {
    const resolved = resolveSubstitutions(leaves);
    if (!resolved) continue;
    for (const limited of limitSubstitutions(resolved)) {
      if (out.length >= CAP) break;
      out.push({ index: out.length, leaves: limited });
    }
  }
  return out;
}
