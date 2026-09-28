import { LOAD_WARNING, STRENGTH_PHRASES, SUGGESTION_LABEL, TX_ALGEBRA_2_NOTE, TX_DLA_DEFAULT_NOTE } from "../copy";
import type { PathResult, Reason, ReasonKind, ResolvedCitation } from "../engine-io";
import type { FamilyId } from "../families";
import { staleLabel } from "../review";
import type { CitationId, Req, Strength } from "../rules";
import { getCourseType } from "../course-types";
import type { CLeaf } from "./compile";
import type { Ctx, RuleSetCtx } from "./context";
import type { Item } from "./model";
import { matchesAny } from "./select";
import { uniq } from "./util";

// ---------------------------------------------------------------------------
// Explainability (design §5.10): every slot, deadline, gap and audit line carries reasons with
// the rule set, requirement and source quotes behind it, in plain words. The strength word always
// comes from the rule's own `strength`.
// ---------------------------------------------------------------------------

export function reason(kind: ReasonKind, text: string, fields: Partial<Omit<Reason, "kind" | "text">> = {}): Reason {
  return {
    kind,
    text,
    claim: fields.claim ?? "rule",
    strength: fields.strength ?? null,
    ruleSetId: fields.ruleSetId ?? null,
    reqId: fields.reqId ?? null,
    familyId: fields.familyId ?? null,
    // A rule set the engine builds itself (a school guide's printed total) has no quoted source.
    citations: uniq((fields.citations ?? []).filter((c) => c !== "")),
    params: fields.params ?? {},
  };
}

/**
 * "Required by Texas", "Strongly encouraged by UT Knoxville" (the issuer's own strength word). When
 * the quote behind a "strongly encouraged" strength says "strongly recommended" (UT Austin's "4
 * Credits Strongly Recommended"), the phrase uses the source's own word.
 */
export function strengthPhrase(strength: Strength, issuer: string, quote?: string | null): string {
  if (strength === "info") return `From ${issuer}`;
  if (strength === "strongly_encouraged" && quote && /strongly recommended/i.test(quote)) return `Strongly recommended by ${issuer}`;
  return `${STRENGTH_PHRASES[strength]} ${issuer}`;
}

/** The quote that sets a requirement's strength (its own, else the rule set's). */
function strengthQuote(rc: RuleSetCtx, leaf: CLeaf): string | null {
  const id = leaf.strengthCite ?? rc.rs.strengthCite;
  return rc.file.citations.find((c) => c.id === id)?.quote ?? null;
}

export function leafCitations(rc: RuleSetCtx, leaf: CLeaf): CitationId[] {
  return uniq([...leaf.cite, ...(leaf.strengthCite ? [leaf.strengthCite] : []), rc.rs.strengthCite].filter((c) => c));
}

/** The rule set's title after the issuer, unless it only repeats it ("UT Austin (UT Austin high school prerequisites)"). */
function ruleSetAside(rc: RuleSetCtx): string {
  if (rc.rs.kind === "state_graduation" || rc.rs.kind === "local_graduation") return "";
  const norm = (s: string) => s.toLowerCase().replace(/^the /, "").trim();
  const issuer = norm(rc.rs.issuer.name);
  const title = norm(rc.rs.title);
  return title.includes(issuer) || issuer.includes(title) ? "" : ` (${rc.rs.title})`;
}

/**
 * "Required by Texas: English III." `label` replaces the leaf's own label, for a class that counts
 * toward a requirement with a choice in it (a suggestion's "Required by Utah: Science (two of the
 * five foundation science areas and one more science credit)"). `forSuggestion`: the line explains
 * a suggested class, so projected rules read "Expected by …".
 */
export function requirementReason(rc: RuleSetCtx, leaf: CLeaf, label = leaf.label, forSuggestion = false): Reason {
  const where = ruleSetAside(rc);
  // A suggestion placed for projected rules (the latest published version, for a class the source
  // doesn't cover yet) says so on the line itself.
  const projected = "rules for your class aren't published yet";
  const who =
    forSuggestion && rc.projected
      ? `Expected by ${rc.rs.issuer.name} ${where ? `${where.trim().slice(0, -1)}; ${projected})` : `(${projected})`}`
      : `${strengthPhrase(leaf.strength, rc.rs.issuer.name, strengthQuote(rc, leaf))}${where}`;
  return reason("requirement", `${who}: ${label}.`, {
    claim: "rule",
    strength: leaf.strength,
    ruleSetId: rc.rs.id,
    reqId: leaf.id,
    citations: leafCitations(rc, leaf),
    params: { issuer: rc.rs.issuer.name, label },
  });
}

/** A requirement's own note ("Ask how your school records it."), as a reason. */
export function leafNoteReason(rc: RuleSetCtx, leaf: CLeaf, items: readonly Item[]): Reason | null {
  const note = leaf.req.note;
  if (!note) return null;
  if (!noteApplies(leaf, items)) return null;
  // The note says what may stand in here (computer science as the 3rd lab science); on a route where
  // that kind stands in for another requirement already, say so.
  const once = leaf.noSubstitutesOf ? labelOf(rc, leaf.noSubstitutesOf) : null;
  const text = once ? `${note} ${once} can stand in for only one requirement, and your plan counts it for another one.` : note;
  return reason("state_note", text, { ruleSetId: rc.rs.id, reqId: leaf.id, strength: leaf.strength, citations: leaf.cite });
}

/** A requirement's label, in the rule set's variant or one it extends. */
function labelOf(rc: RuleSetCtx, id: string): string | null {
  const find = (reqs: readonly Req[]): Req | null => {
    for (const r of reqs) {
      if (r.id === id) return r;
      const found = find(r.kind === "all" || r.kind === "any" || r.kind === "choose" ? r.of : r.kind === "option" ? [r.on, r.off] : []);
      if (found) return found;
    }
    return null;
  };
  for (const v of [rc.variant, ...rc.bases.map((b) => b.variant)]) {
    const r = v ? find(v.requirements) : null;
    if (r) return r.label;
  }
  return null;
}

/**
 * A requirement that counts only classes from 9th grade on (Utah's "3 math credits in grades
 * 9-12") has a note about classes taken before 9th grade: it's shown only to a student who has
 * such a class (a high school class in middle school), like the middle-school state notes.
 */
function noteApplies(leaf: CLeaf, items: readonly Item[]): boolean {
  const sels = leaf.req.kind === "credits" || leaf.req.kind === "count" ? leaf.req.select : null;
  if (!sels?.length || !sels.every((s) => s.grades?.length && Math.min(...s.grades) >= 9)) return true;
  const anyGrade = sels.map(({ grades: _grades, ...rest }) => rest);
  return items.some((i) => i.own && i.grade < 9 && !i.noCredit && getCourseType(i.typeId).grades[1] >= 9 && matchesAny(i, anyGrade));
}

/**
 * Utah's senior-year math (R277-700-9(2)), for the class that meets it and the need that asks for
 * it: conditional, so the words say so.
 */
export function seniorMathReason(rc: RuleSetCtx, checkId: string, cite: CitationId[]): Reason {
  return reason("requirement", `${rc.rs.issuer.name} asks college-bound students to show college-ready math or take a full year of math in 12th grade.`, {
    ruleSetId: rc.rs.id,
    reqId: checkId,
    strength: rc.rs.strength,
    citations: cite,
  });
}

/** "Plans change. Here's what still fits." on a class suggested again after an F, W or I. */
export function retakeReason(): Reason {
  return reason("state_note", "Plans change. Here's what still fits.", { claim: "suggestion" });
}

export function prepReason(ctx: Ctx, familyId: FamilyId, what: string, citations: CitationId[]): Reason {
  const family = ctx.families.find((f) => f.target.familyId === familyId);
  const because = family?.target.because ? ` Because you picked ${family.target.because}.` : "";
  return reason("major_prep", `${SUGGESTION_LABEL} for ${family?.title ?? familyId}: ${what}.${because}`, {
    claim: "suggestion",
    familyId,
    citations,
    params: { family: familyId },
  });
}

export function ruleSetNotes(rc: RuleSetCtx): Reason[] {
  const out: Reason[] = [];
  if (rc.viaDlaDefault) out.push(reason("choice", TX_DLA_DEFAULT_NOTE, { claim: "suggestion", ruleSetId: rc.rs.id, citations: [rc.rs.strengthCite] }));
  if (rc.viaStateDefault) {
    out.push(
      reason("choice", `We're using ${rc.rs.title} as a default target because there's no in-state public college on your list yet.`, {
        claim: "suggestion",
        ruleSetId: rc.rs.id,
        citations: [rc.rs.strengthCite],
      }),
    );
  }
  if (rc.projected) {
    out.push(
      reason("projected", "Your class's rules aren't published yet. This is the latest version we have, and it may change. Ask your counselor.", {
        ruleSetId: rc.rs.id,
        citations: [rc.rs.strengthCite],
      }),
    );
  }
  if (rc.stale) out.push(reason("stale", staleLabel(rc.file.verifiedForSchoolYear), { ruleSetId: rc.rs.id }));
  if (rc.rs.confidence === "conflicting") {
    out.push(reason("conflict", `${rc.rs.issuer.name}'s pages don't agree with each other about this. Ask your counselor.`, { ruleSetId: rc.rs.id, citations: [rc.rs.strengthCite] }));
  }
  return out;
}

export function loadReason(): Reason {
  return reason("load", LOAD_WARNING, { claim: "heuristic" });
}

export function algebra2Reason(): Reason {
  return reason("state_note", TX_ALGEBRA_2_NOTE, { claim: "rule" });
}

/** Every citation id referenced anywhere in the path, resolved for "Why?". */
export function resolveCitations(ctx: Ctx, path: Omit<Extract<PathResult, { mode: "catalog" | "mixed" | "generic" }>, "citations">): Record<CitationId, ResolvedCitation> {
  const ids = new Set<string>();
  const visit = (value: unknown, key: string | null) => {
    if (Array.isArray(value)) {
      if (key === "citations") for (const v of value) if (typeof v === "string") ids.add(v);
      for (const v of value) visit(v, null);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(path, null);
  const out: Record<CitationId, ResolvedCitation> = {};
  for (const id of [...ids].sort()) {
    const found = ctx.citations.get(id);
    if (!found) continue;
    out[id] = { id, quote: found.citation.quote, pinpoint: found.citation.pinpoint ?? null, source: { ...found.source, key: found.key } };
  }
  return out;
}
