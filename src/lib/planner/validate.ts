import type { PlannerState } from "./common";
import {
  parseCipRoutingFile,
  parseFactsFile,
  parseGenericCatalogFile,
  parseMajorFamiliesFile,
  parseRuleFile,
  type ParseResult,
} from "./content-schema";
import type { CipRoutingFile, FactsFile, GenericCatalogFile, MajorFamiliesFile } from "./content-types";
import { getCourseType } from "./course-types";
import type { PlannerContent } from "./engine-io";
import { FAMILY_IDS } from "./families";
import { contentFingerprint } from "./review";
import { type ContentHeader, type Req, RULE_FILE_HOLDS, type RuleFile, type RuleSet, type Variant } from "./rules";

// ---------------------------------------------------------------------------
// Content validator (a stub to grow). It parses every file with content-schema.ts, then runs the
// checks that need a whole file or several files. Loading content through `loadContent` throws
// on any issue, so bad content fails tests and `next build` like the aid guide does.
//
// Done here: ids unique; every citation, source, rule set, variant and requirement reference
// resolves; strength overrides are quoted; rule set kinds match their file; cohort ranges are
// valid and don't overlap; state graduation covers the classes of 2027-2034 (or labels them
// projected); at most 256 alternatives per variant; `choose` asks for no more than it lists;
// counselor-reviewed files match their fingerprint; generic catalog levels exist for the type;
// the families file has all 32 families; CIP routing has no rule hidden by an earlier one.
//
// Left for `npm run check:rules` (needs the network or the database): source links still load
// and quotes still appear; every UNITID exists in `colleges`; every CIP prefix exists in `majors`;
// rendered strength labels match; golden plans.
// ---------------------------------------------------------------------------

/** The most alternatives one variant may expand into (design §5.4). */
export const MAX_ALTERNATIVES_PER_VARIANT = 256;

/** Every state graduation rule set must resolve these classes (graduation years) to one variant or a projection. */
export const COHORT_COVERAGE = { fromClass: 2027, toClass: 2034 } as const;

export class PlannerContentError extends Error {
  constructor(readonly issues: string[]) {
    super(`Planner content has ${issues.length} problem(s):\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "PlannerContentError";
  }
}

export type LabeledRaw = { label: string; raw: unknown };

export type RawContent = {
  rules: LabeledRaw[];
  genericCatalogs: LabeledRaw[];
  facts: LabeledRaw[];
  families?: LabeledRaw;
  cipRouting?: LabeledRaw;
};

export type ValidatedContent = {
  rules: RuleFile[];
  genericCatalogs: GenericCatalogFile[];
  facts: FactsFile[];
  families: MajorFamiliesFile | null;
  cipRouting: CipRoutingFile | null;
};

export type ValidationResult =
  | { ok: true; content: ValidatedContent; warnings: string[] }
  | { ok: false; issues: string[]; warnings: string[] };

// Requirements ------------------------------------------------------------------------

/** Children of a group requirement (none for a leaf). */
export function childReqs(req: Req): Req[] {
  switch (req.kind) {
    case "all":
    case "any":
    case "choose":
      return req.of;
    case "option":
      return [req.on, req.off];
    default:
      return [];
  }
}

/** Every requirement in the tree, parents before children. */
export function walkReqs(reqs: readonly Req[]): Req[] {
  return reqs.flatMap((r) => [r, ...walkReqs(childReqs(r))]);
}

/** e_n of the counts: the number of ways to pick n of the listed requirements, weighted by their own alternatives. */
function chooseCount(counts: number[], n: number): number {
  const e = [1, ...Array(n).fill(0)];
  for (const c of counts) for (let k = n; k >= 1; k--) e[k] += e[k - 1] * c;
  return e[n];
}

/**
 * How many flat alternatives a requirement compiles to (design §5.4): `all` multiplies, `any`
 * adds, `choose` counts the combinations, `option` counts both branches, and a credit that may
 * substitute for one of k requirements multiplies by k + 1. The engine's compiler must agree.
 */
export function countAlternatives(req: Req): number {
  switch (req.kind) {
    case "all":
      return req.of.reduce((n, r) => n * countAlternatives(r), 1);
    case "any":
      return req.of.reduce((n, r) => n + countAlternatives(r), 0);
    case "choose":
      return chooseCount(req.of.map(countAlternatives), req.n);
    case "option":
      return countAlternatives(req.on) + countAlternatives(req.off);
    case "credits":
      return 1 + (req.substitutesForOneOf?.length ?? 0);
    default:
      return 1;
  }
}

export function variantAlternatives(variant: Variant): number {
  return variant.requirements.reduce((n, r) => n * countAlternatives(r), 1);
}

/** Every citation id a rule set refers to. */
function citedIds(ruleSet: RuleSet): string[] {
  const ids = [ruleSet.strengthCite, ...(ruleSet.testRoutes ?? []).flatMap((t) => t.cite)];
  for (const v of ruleSet.variants) {
    for (const r of walkReqs(v.requirements)) {
      ids.push(...(r.cite ?? []));
      if (r.strengthCite) ids.push(r.strengthCite);
    }
    for (const c of v.checks ?? []) ids.push(...c.cite);
    for (const c of v.conditions ?? []) ids.push(...c.cite);
    for (const w of v.warnings ?? []) ids.push(...w.cite);
  }
  return ids;
}

function cohortValueForClass(key: RuleSet["cohortKey"], classYear: number): number {
  // A class of 2030 started 9th grade in fall 2026 and 7th grade in fall 2024.
  return key === "class_year" ? classYear : key === "grade9_entry_year" ? classYear - 4 : classYear - 6;
}

function inRange(value: number, range: Variant["cohort"]) {
  return (range.from === undefined || value >= range.from) && (range.to === undefined || value <= range.to);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

// Per-file checks --------------------------------------------------------------------------

function checkHeader(file: ContentHeader, label: string, cited: string[], issues: string[], warnings: string[]) {
  for (const d of duplicates(file.citations.map((c) => c.id))) issues.push(`${label}: citation id "${d}" is used twice.`);
  for (const c of file.citations) {
    if (!file.sources[c.source]) issues.push(`${label}: citation "${c.id}" names source "${c.source}", which isn't in "sources".`);
  }
  const known = new Set(file.citations.map((c) => c.id));
  for (const id of new Set(cited)) if (!known.has(id)) issues.push(`${label}: cites "${id}", which isn't in "citations".`);
  const used = new Set(cited);
  for (const c of file.citations) if (!used.has(c.id)) warnings.push(`${label}: citation "${c.id}" isn't used.`);
  if (file.review.status === "counselor-reviewed") {
    const now = contentFingerprint(file);
    if (file.review.contentFingerprint !== now) {
      issues.push(
        `${label}: the content changed after the counselor's review (fingerprint is now ${now}). Set review.status back to "draft" until a counselor reviews the change.`,
      );
    }
  }
}

function checkVariant(v: Variant, where: string, issues: string[]) {
  const all = walkReqs(v.requirements);
  for (const d of duplicates(all.map((r) => r.id))) issues.push(`${where}: requirement id "${d}" is used twice.`);
  const ids = new Set(all.map((r) => r.id));
  for (const r of all) {
    if (r.strength && !r.strengthCite) issues.push(`${where} ${r.id}: a requirement that sets its own strength must quote it (strengthCite).`);
    if (r.kind === "choose" && r.n > r.of.length) issues.push(`${where} ${r.id}: chooses ${r.n} of only ${r.of.length}.`);
    if (r.kind === "credits") {
      for (const s of r.substitutesForOneOf ?? []) if (!ids.has(s)) issues.push(`${where} ${r.id}: substitutesForOneOf names unknown requirement "${s}".`);
    }
  }
  if (!v.extends) {
    for (const c of v.checks ?? []) {
      if (c.kind === "on_schedule_by" && !ids.has(c.req)) issues.push(`${where} ${c.id}: on_schedule_by names unknown requirement "${c.req}".`);
    }
  }
  const alternatives = variantAlternatives(v);
  if (alternatives > MAX_ALTERNATIVES_PER_VARIANT) {
    issues.push(`${where}: expands to ${alternatives} alternatives; the most is ${MAX_ALTERNATIVES_PER_VARIANT}. Split the rule set.`);
  }
  const { from, to } = v.cohort;
  if (from !== undefined && to !== undefined && from > to) issues.push(`${where}: cohort "from" ${from} is after "to" ${to}.`);
}

function checkRuleSet(rs: RuleSet, file: RuleFile, label: string, issues: string[]) {
  const where = `${label} ${rs.id}`;
  if (rs.state !== file.state) issues.push(`${where}: state ${rs.state} in a ${file.state} file.`);
  if (!RULE_FILE_HOLDS[file.kind].includes(rs.kind)) issues.push(`${where}: a ${rs.kind} rule set doesn't belong in a ${file.kind} file.`);
  const gate = rs.appliesWhen;
  if ((rs.kind === "college_admission" || rs.kind === "guaranteed_admission") && !gate.colleges) {
    issues.push(`${where}: admission rule sets list their colleges (appliesWhen.colleges).`);
  }
  if (rs.kind === "program_admission" && (!gate.colleges || !gate.families)) {
    issues.push(`${where}: program rule sets list their colleges and families (appliesWhen.colleges and .families).`);
  }
  if (rs.kind === "graduation_option" && !gate.choice) issues.push(`${where}: a graduation option applies when chosen (appliesWhen.choice).`);
  for (const v of rs.variants) checkVariant(v, `${where} ${v.id}`, issues);
  // Variants must not overlap: any cohort value matches at most one.
  const sorted = [...rs.variants].sort((a, b) => (a.cohort.from ?? -Infinity) - (b.cohort.from ?? -Infinity));
  let furthest: Variant | null = null;
  for (const v of sorted) {
    if (furthest && (v.cohort.from ?? -Infinity) <= (furthest.cohort.to ?? Infinity)) {
      issues.push(`${where}: variants ${furthest.id} and ${v.id} overlap.`);
    }
    if (!furthest || (v.cohort.to ?? Infinity) > (furthest.cohort.to ?? Infinity)) furthest = v;
  }
  if (rs.kind === "state_graduation") {
    for (let classYear = COHORT_COVERAGE.fromClass; classYear <= COHORT_COVERAGE.toClass; classYear++) {
      const value = cohortValueForClass(rs.cohortKey, classYear);
      const projected = rs.projectedBeyond !== undefined && value > rs.projectedBeyond;
      if (!projected && !rs.variants.some((v) => inRange(value, v.cohort))) {
        issues.push(`${where}: no variant covers the class of ${classYear} (${rs.cohortKey} ${value}). Add one, or set projectedBeyond.`);
      }
    }
  }
}

function checkRuleFiles(files: { file: RuleFile; label: string }[], issues: string[], warnings: string[]) {
  const ruleSets = files.flatMap(({ file }) => file.ruleSets);
  for (const d of duplicates(ruleSets.map((r) => r.id))) issues.push(`rule set id "${d}" is used twice.`);
  const variants = ruleSets.flatMap((r) => r.variants);
  for (const d of duplicates(variants.map((v) => v.id))) issues.push(`variant id "${d}" is used twice.`);
  const ruleSetIds = new Set(ruleSets.map((r) => r.id));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const { file, label } of files) {
    checkHeader(file, label, file.ruleSets.flatMap(citedIds), issues, warnings);
    for (const rs of file.ruleSets) {
      checkRuleSet(rs, file, label, issues);
      for (const v of rs.variants) {
        if (v.extends) {
          const base = variantById.get(v.extends);
          if (!base) issues.push(`${label} ${v.id}: extends unknown variant "${v.extends}".`);
          const ids = new Set(walkReqs([...(base?.requirements ?? []), ...v.requirements]).map((r) => r.id));
          for (const c of v.checks ?? []) {
            if (c.kind === "on_schedule_by" && !ids.has(c.req)) issues.push(`${label} ${v.id} ${c.id}: on_schedule_by names unknown requirement "${c.req}".`);
          }
        }
        for (const c of v.checks ?? []) {
          if (c.kind !== "requires_rule_set") continue;
          for (const id of c.anyOf) if (!ruleSetIds.has(id)) issues.push(`${label} ${v.id} ${c.id}: requires unknown rule set "${id}".`);
        }
      }
    }
  }
}

function checkGenericCatalog(file: GenericCatalogFile, label: string, issues: string[], warnings: string[]) {
  checkHeader(file, label, file.courses.flatMap((c) => c.cite ?? []), issues, warnings);
  for (const d of duplicates(file.courses.map((c) => c.typeId))) issues.push(`${label}: course type "${d}" is listed twice.`);
  for (const c of file.courses) {
    const offered = getCourseType(c.typeId).levels;
    for (const level of c.levels) {
      if (!offered.includes(level)) issues.push(`${label} ${c.typeId}: level "${level}" isn't one of the type's levels (${offered.join(", ")}).`);
    }
  }
}

function checkFamilies(file: MajorFamiliesFile, label: string, issues: string[], warnings: string[]) {
  const cited = file.families.flatMap((f) => [
    ...f.math.cite,
    ...f.ctePathways.flatMap((p) => p.cite),
    ...f.gates.flatMap((g) => g.cite),
    ...f.cautions.flatMap((c) => c.cite),
  ]);
  checkHeader(file, label, cited, issues, warnings);
  const ids = file.families.map((f) => f.id);
  for (const d of duplicates(ids)) issues.push(`${label}: family "${d}" appears twice.`);
  for (const id of FAMILY_IDS) if (!ids.includes(id)) issues.push(`${label}: family "${id}" is missing (all 32 are required).`);
}

function checkCipRouting(file: CipRoutingFile, label: string, issues: string[], warnings: string[]) {
  checkHeader(file, label, [], issues, warnings);
  const earlier: string[] = [];
  file.rules.forEach((rule, i) => {
    for (const prefix of rule.match) {
      const hiddenBy = earlier.find((e) => prefix.startsWith(e));
      if (hiddenBy) issues.push(`${label} rules.${i}: prefix ${prefix} can never match; rule for ${hiddenBy} comes first.`);
    }
    earlier.push(...rule.match);
  });
}

// Entry points ---------------------------------------------------------------------------------

function collect<T>(results: { label: string; result: ParseResult<T> }[], issues: string[]): { file: T; label: string }[] {
  return results.flatMap(({ label, result }) => {
    if (result.ok) return [{ file: result.value, label }];
    issues.push(...result.issues);
    return [];
  });
}

/** Parses and checks every content file. Never throws. */
export function validateContent(raw: RawContent): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const rules = collect(raw.rules.map(({ label, raw }) => ({ label, result: parseRuleFile(raw, label) })), issues);
  const catalogs = collect(raw.genericCatalogs.map(({ label, raw }) => ({ label, result: parseGenericCatalogFile(raw, label) })), issues);
  const facts = collect(raw.facts.map(({ label, raw }) => ({ label, result: parseFactsFile(raw, label) })), issues);
  const families = raw.families ? collect([{ label: raw.families.label, result: parseMajorFamiliesFile(raw.families.raw, raw.families.label) }], issues) : [];
  const routing = raw.cipRouting
    ? collect([{ label: raw.cipRouting.label, result: parseCipRoutingFile(raw.cipRouting.raw, raw.cipRouting.label) }], issues)
    : [];

  const headers = [...rules, ...catalogs, ...facts, ...families, ...routing].map(({ file }) => file.id);
  for (const d of duplicates(headers)) issues.push(`content file id "${d}" is used twice.`);
  for (const d of duplicates(catalogs.map(({ file }) => file.state))) issues.push(`two generic catalogs for ${d}.`);
  for (const d of duplicates(facts.map(({ file }) => file.state))) issues.push(`two facts files for ${d}.`);

  checkRuleFiles(rules, issues, warnings);
  for (const { file, label } of catalogs) checkGenericCatalog(file, label, issues, warnings);
  for (const { file, label } of facts) checkHeader(file, label, [...file.options, ...file.middleSchoolMath].flatMap((o) => o.cite), issues, warnings);
  for (const { file, label } of families) checkFamilies(file, label, issues, warnings);
  for (const { file, label } of routing) checkCipRouting(file, label, issues, warnings);

  if (issues.length) return { ok: false, issues, warnings };
  return {
    ok: true,
    warnings,
    content: {
      rules: rules.map(({ file }) => file),
      genericCatalogs: catalogs.map(({ file }) => file),
      facts: facts.map(({ file }) => file),
      families: families[0]?.file ?? null,
      cipRouting: routing[0]?.file ?? null,
    },
  };
}

/** Like `validateContent`, but throws a PlannerContentError listing every problem. */
export function loadContent(raw: RawContent): ValidatedContent {
  const result = validateContent(raw);
  if (!result.ok) throw new PlannerContentError(result.issues);
  return result.content;
}

/** The files one state's plan needs, or null if that state's catalog or facts are missing. */
export function contentForState(content: ValidatedContent, state: PlannerState): PlannerContent | null {
  const genericCatalog = content.genericCatalogs.find((f) => f.state === state);
  const facts = content.facts.find((f) => f.state === state);
  if (!genericCatalog || !facts) return null;
  return { rules: content.rules.filter((f) => f.state === state), genericCatalog, facts, families: content.families };
}
