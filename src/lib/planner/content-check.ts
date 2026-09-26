import { createHash } from "node:crypto";
import type { IsoDate } from "./common";
import type { CipRoutingFile, FactsFile, GenericCatalogFile, MajorFamiliesFile, RigorFile } from "./content-types";
import { quoteAppears } from "./quotes";
import { contentFingerprint, daysUntilStale } from "./review";
import type { Citation, CitationId, ContentHeader, Req, RuleFile, RuleSet, Strength } from "./rules";
import { type ValidatedContent, walkReqs } from "./validate";

// The checks behind `npm run check:rules` that go beyond the schema and validator: every
// requirement and statement cites a quote with a source link; strength words match their quotes;
// quotes still appear in the saved source copies; staleness warnings; and a summary of what
// changed since a git revision. Pure (the script does the file, network and git work).

/** Stable JSON for hashing (keys sorted). */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 12);

// Citation coverage --------------------------------------------------------------------------

export type CitedThing = { where: string; cite: CitationId[] };

const isLeaf = (r: Req) => !["all", "any", "choose", "option"].includes(r.kind);

/** Every statement that must quote a source: requirement leaves, checks, conditions, warnings, test routes, cards, facts, families and rigor lines. */
export function citedThings(content: ValidatedContent): CitedThing[] {
  const out: CitedThing[] = [];
  for (const file of content.rules) {
    for (const rs of file.ruleSets) {
      out.push({ where: `${rs.id} (strength)`, cite: [rs.strengthCite] });
      for (const t of rs.testRoutes ?? []) out.push({ where: `${rs.id} test route ${t.id}`, cite: t.cite });
      for (const v of rs.variants) {
        for (const r of walkReqs(v.requirements)) {
          if (isLeaf(r) || r.kind === "option") out.push({ where: `${v.id} ${r.id}`, cite: r.cite ?? [] });
        }
        for (const x of v.checks ?? []) out.push({ where: `${v.id} check ${x.id}`, cite: x.cite });
        for (const x of v.conditions ?? []) out.push({ where: `${v.id} condition ${x.id}`, cite: x.cite });
        for (const x of v.warnings ?? []) out.push({ where: `${v.id} warning ${x.id}`, cite: x.cite });
      }
    }
    for (const card of file.infoCards ?? []) out.push({ where: `card ${card.id}`, cite: card.cite });
  }
  for (const f of content.facts) {
    f.options.forEach((o, i) => out.push({ where: `${f.id} option ${i} (${o.kind})`, cite: o.cite }));
    f.middleSchoolMath.forEach((m, i) => out.push({ where: `${f.id} middle-school note ${i}`, cite: m.cite }));
    for (const t of f.terms ?? []) out.push({ where: `${f.id} term ${t.id}`, cite: t.cite });
  }
  for (const fam of content.families?.families ?? []) {
    out.push({ where: `family ${fam.id} math`, cite: fam.math.cite });
    for (const p of fam.ctePathways) out.push({ where: `family ${fam.id} pathway ${p.state} ${p.name}`, cite: p.cite });
    if (fam.txEndorsement) out.push({ where: `family ${fam.id} Texas endorsement`, cite: fam.txEndorsement.cite });
    for (const g of fam.gates) out.push({ where: `family ${fam.id} gate ${g.id}`, cite: g.cite });
    for (const x of fam.cautions) out.push({ where: `family ${fam.id} caution ${x.id}`, cite: x.cite });
  }
  if (content.rigor) {
    for (const t of content.rigor.tiers) out.push({ where: `rigor tier ${t.id}`, cite: t.cite });
    for (const r of content.rigor.raises) out.push({ where: `rigor raise ${r.id}`, cite: r.cite });
    for (const g of content.rigor.guardrails) out.push({ where: `rigor guardrail ${g.id}`, cite: g.cite });
  }
  return out;
}

function headers(content: ValidatedContent): ContentHeader[] {
  const files: ContentHeader[] = [...content.rules, ...content.genericCatalogs, ...content.facts];
  if (content.families) files.push(content.families);
  if (content.cipRouting) files.push(content.cipRouting);
  if (content.rigor) files.push(content.rigor);
  return files;
}

/** Citations with their source, keyed by id (ids may repeat across files only with identical content). */
export function allCitations(content: ValidatedContent): Map<CitationId, { citation: Citation; sourceUrl: string; fileId: string }> {
  const map = new Map<CitationId, { citation: Citation; sourceUrl: string; fileId: string }>();
  for (const file of headers(content)) {
    for (const c of file.citations) map.set(c.id, { citation: c, sourceUrl: file.sources[c.source]?.url ?? "", fileId: file.id });
  }
  return map;
}

/** Statements with no quote, or whose quote has no https source link. Also citation ids reused with different content. */
export function citationCoverageIssues(content: ValidatedContent): { statements: number; issues: string[] } {
  const things = citedThings(content);
  const citations = allCitations(content);
  const issues: string[] = [];
  for (const t of things) {
    if (!t.cite.length) issues.push(`${t.where}: cites no source quote.`);
    for (const id of t.cite) {
      const found = citations.get(id);
      if (!found) issues.push(`${t.where}: cites "${id}", which isn't in its file.`);
      else if (!found.citation.quote.trim()) issues.push(`${t.where}: citation "${id}" has an empty quote.`);
      else if (!/^https:\/\//.test(found.sourceUrl)) issues.push(`${t.where}: citation "${id}" has no https source link.`);
    }
  }
  const seen = new Map<string, string>();
  for (const file of headers(content)) {
    for (const c of file.citations) {
      const body = stableJson({ ...c, source: file.sources[c.source] });
      const before = seen.get(c.id);
      if (before !== undefined && before !== body) issues.push(`citation "${c.id}" appears in more than one file with different words or sources.`);
      seen.set(c.id, body);
    }
  }
  return { statements: things.length, issues };
}

// Strength words -----------------------------------------------------------------------------------

const STRENGTH_WORDS: Record<Strength, RegExp | null> = {
  required: /requir|must|shall|need/i,
  strongly_encouraged: /strongly/i,
  recommended: /recommend|suggest|encourag|should/i,
  priority: /priority/i,
  info: null,
};

/** A rule set or requirement whose strength word isn't backed by its own quote ("strongly encouraged" must say "strongly"). */
export function strengthWordIssues(rules: readonly RuleFile[]): string[] {
  const issues: string[] = [];
  for (const file of rules) {
    const quote = (id: string) => file.citations.find((c) => c.id === id)?.quote ?? "";
    const check = (where: string, strength: Strength, citeId: string) => {
      const word = STRENGTH_WORDS[strength];
      if (word && !word.test(quote(citeId))) issues.push(`${where}: strength "${strength}" isn't supported by the words of "${citeId}".`);
    };
    for (const rs of file.ruleSets) {
      check(rs.id, rs.strength, rs.strengthCite);
      for (const v of rs.variants) for (const r of walkReqs(v.requirements)) if (r.strength && r.strengthCite) check(`${v.id} ${r.id}`, r.strength, r.strengthCite);
    }
  }
  return issues;
}

// Quotes against saved copies ----------------------------------------------------------------------

export type QuoteCheck = { checked: number; notFound: string[]; noCopy: string[] };

/** Checks each quote against the saved copy of its source (`copyFor(sourceKey)` returns the text or null). */
export function checkQuotes(content: ValidatedContent, copyFor: (sourceKey: string) => string | null): QuoteCheck {
  const result: QuoteCheck = { checked: 0, notFound: [], noCopy: [] };
  const done = new Set<string>();
  for (const file of headers(content)) {
    for (const c of file.citations) {
      if (done.has(c.id)) continue;
      done.add(c.id);
      const text = copyFor(c.source);
      if (text === null) {
        result.noCopy.push(`${c.id} (${c.source})`);
        continue;
      }
      result.checked++;
      if (!quoteAppears(c.quote, text)) result.notFound.push(`${c.id} (${c.source}): "${c.quote}"`);
    }
  }
  return result;
}

// Staleness ---------------------------------------------------------------------------------------------

/** Warnings for files and rule sets that are stale or go stale within `withinDays` (dates never fail CI). */
export function stalenessWarnings(content: ValidatedContent, today: IsoDate, withinDays = 60): string[] {
  const warnings: string[] = [];
  const note = (what: string, days: number) => {
    if (days < 0) warnings.push(`${what} is past its check date (${-days} days); it now reads "being re-checked". Re-verify it.`);
    else if (days <= withinDays) warnings.push(`${what} goes stale in ${days} days. Re-verify it before then.`);
  };
  for (const file of headers(content)) note(`${file.id} (checked for ${file.verifiedForSchoolYear})`, daysUntilStale(today, file.verifiedForSchoolYear));
  for (const file of content.rules) {
    for (const rs of file.ruleSets) if (rs.recheckBy) note(`${rs.id} (re-check by ${rs.recheckBy})`, daysUntilStale(today, file.verifiedForSchoolYear, rs.recheckBy));
  }
  return warnings;
}

// Diff against an earlier revision --------------------------------------------------------------------

type Keyed = Map<string, string>;

function keyedParts(file: Record<string, unknown>): Record<string, Keyed> {
  const parts: Record<string, Keyed> = {};
  function add<T>(kind: string, items: readonly T[] | undefined, key: (x: T) => string) {
    if (items) parts[kind] = new Map(items.map((x) => [key(x), hash(x)]));
  }
  const byId = (x: { id: string }) => x.id;
  add("rule set", file.ruleSets as RuleSet[] | undefined, byId);
  add("info card", file.infoCards as { id: string }[] | undefined, byId);
  add("citation", file.citations as Citation[] | undefined, byId);
  add("family", file.families as MajorFamiliesFile["families"] | undefined, byId);
  add("catalog course", file.courses as GenericCatalogFile["courses"] | undefined, (x) => x.typeId);
  add("option", file.options as FactsFile["options"] | undefined, (x) => `${x.kind}${x.programName ? `: ${x.programName}` : ""}`);
  add("routing rule", file.rules as CipRoutingFile["rules"] | undefined, (x) => x.match.join("+"));
  add("rigor tier", file.tiers as RigorFile["tiers"] | undefined, byId);
  add("guardrail", file.guardrails as RigorFile["guardrails"] | undefined, byId);
  return parts;
}

/**
 * What changed in each content file since an earlier revision (`before` is null for a new file).
 * Lines like "tx/options.json: rule set tx.dla changed; citation tx-74-11-g added".
 */
export function diffSummary(files: { label: string; before: Record<string, unknown> | null; after: Record<string, unknown> }[]): string[] {
  const lines: string[] = [];
  for (const { label, before, after } of files) {
    if (!before) {
      lines.push(`${label}: new file.`);
      continue;
    }
    const fpBefore = contentFingerprint(before as ContentHeader);
    const fpAfter = contentFingerprint(after as ContentHeader);
    if (fpBefore === fpAfter) continue;
    const a = keyedParts(before);
    const b = keyedParts(after);
    const changes: string[] = [];
    for (const kind of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const was = a[kind] ?? new Map();
      const now = b[kind] ?? new Map();
      const added = [...now.keys()].filter((k) => !was.has(k));
      const removed = [...was.keys()].filter((k) => !now.has(k));
      const changed = [...now.keys()].filter((k) => was.has(k) && was.get(k) !== now.get(k));
      const list = (verb: string, keys: string[]) => keys.length && changes.push(`${kind}${keys.length > 1 ? "s" : ""} ${verb}: ${keys.join(", ")}`);
      list("added", added);
      list("removed", removed);
      list("changed", changed);
    }
    const review = (after.review as { status?: string } | undefined)?.status;
    lines.push(`${label}: fingerprint ${fpBefore} -> ${fpAfter}${review === "counselor-reviewed" ? " (needs a new counselor review)" : ""}. ${changes.join("; ") || "header changed"}.`);
  }
  return lines;
}
