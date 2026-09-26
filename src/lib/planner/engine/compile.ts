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
  Strength,
  TotalCreditsReq,
  Variant,
} from "../rules";
import { MAX_ALTERNATIVES_PER_VARIANT } from "../validate";

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
  const first = label.split(" ")[0];
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
  return branch ? `${group.label} (here: ${lowerLabel(branch.label)})` : group.label;
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
      return compileReq(on ? req.on : req.off, { ...child, optionPref: on ? req.pref : null }, own, choices);
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
    const direct = leaves.find((l) => l.id === leaf.subFor && l !== leaf && l.req.kind === "credits");
    const inGroup = [...leaves].reverse().find((l) => l !== leaf && l.path.includes(leaf.subFor!) && l.req.kind === "credits");
    const target = direct ?? inGroup;
    if (!target) return null;
    out.push({ ...leaf, subFor: target.id });
  }
  return out;
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
    if (resolved) out.push({ index: out.length, leaves: resolved });
  }
  return out;
}
