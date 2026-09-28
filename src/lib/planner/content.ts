import families from "@/content/planner/major-prep/families.json";
import cipRouting from "@/content/planner/major-prep/cip-routing.json";
import rigor from "@/content/planner/major-prep/rigor.json";
import tnAdmissions from "@/content/planner/tn/admissions.json";
import tnAid from "@/content/planner/tn/aid.json";
import tnFacts from "@/content/planner/tn/facts.json";
import tnGenericCatalog from "@/content/planner/tn/generic-catalog.json";
import tnGraduation from "@/content/planner/tn/graduation.json";
import tnOptions from "@/content/planner/tn/options.json";
import txAdmissions from "@/content/planner/tx/admissions.json";
import txAid from "@/content/planner/tx/aid.json";
import txFacts from "@/content/planner/tx/facts.json";
import txGenericCatalog from "@/content/planner/tx/generic-catalog.json";
import txGraduation from "@/content/planner/tx/graduation.json";
import txOptions from "@/content/planner/tx/options.json";
import utAdmissions from "@/content/planner/ut/admissions.json";
import utAid from "@/content/planner/ut/aid.json";
import utFacts from "@/content/planner/ut/facts.json";
import utGenericCatalog from "@/content/planner/ut/generic-catalog.json";
import utGraduation from "@/content/planner/ut/graduation.json";
import type { IsoDate, PlannerState } from "./common";
import { PLANNER_CONTENT_FILES } from "./content-files";
import type { CipRoutingFile, MajorFamiliesFile, RigorFile } from "./content-types";
import type { PlannerContent, ResolvedCitation, ReviewNotice } from "./engine-io";
import { type FamilyId, routeCip } from "./families";
import { contentFingerprint, reviewNotice, ruleSetFreshness } from "./review";
import type { ContentHeader, InfoCard, RuleFile, RuleSet } from "./rules";
import { contentForState, loadContent, type RawContent, type ValidatedContent } from "./validate";

// The course planner's reviewed content (src/content/planner/, format: rules.ts and
// content-types.ts). It is validated once, when this module is first imported: a malformed file,
// a citation that doesn't resolve, overlapping cohorts or a stale counselor review throws a
// PlannerContentError. The tests import this module (and `next build` will, through the pages
// that use it), so bad content fails both, like the aid guide. Server-side only in practice: it
// pulls in every content file.

const RAW: RawContent = {
  rules: [
    { label: "ut/graduation.json", raw: utGraduation },
    { label: "ut/admissions.json", raw: utAdmissions },
    { label: "ut/aid.json", raw: utAid },
    { label: "tn/graduation.json", raw: tnGraduation },
    { label: "tn/options.json", raw: tnOptions },
    { label: "tn/admissions.json", raw: tnAdmissions },
    { label: "tn/aid.json", raw: tnAid },
    { label: "tx/graduation.json", raw: txGraduation },
    { label: "tx/options.json", raw: txOptions },
    { label: "tx/admissions.json", raw: txAdmissions },
    { label: "tx/aid.json", raw: txAid },
  ],
  genericCatalogs: [
    { label: "ut/generic-catalog.json", raw: utGenericCatalog },
    { label: "tn/generic-catalog.json", raw: tnGenericCatalog },
    { label: "tx/generic-catalog.json", raw: txGenericCatalog },
  ],
  facts: [
    { label: "ut/facts.json", raw: utFacts },
    { label: "tn/facts.json", raw: tnFacts },
    { label: "tx/facts.json", raw: txFacts },
  ],
  families: { label: "major-prep/families.json", raw: families },
  cipRouting: { label: "major-prep/cip-routing.json", raw: cipRouting },
  rigor: { label: "major-prep/rigor.json", raw: rigor },
};

/** Labels in load order, for the manifest check. */
export const LOADED_CONTENT_LABELS: readonly string[] = [
  ...RAW.rules,
  ...RAW.genericCatalogs,
  ...RAW.facts,
  RAW.families!,
  RAW.cipRouting!,
  RAW.rigor!,
].map((f) => f.label);

{
  const manifest = PLANNER_CONTENT_FILES.map((f) => f.label).sort();
  const loaded = [...LOADED_CONTENT_LABELS].sort();
  if (manifest.join() !== loaded.join()) {
    throw new Error(`content.ts and content-files.ts list different files:\n  loaded ${loaded.join(", ")}\n  manifest ${manifest.join(", ")}`);
  }
}

const CONTENT: ValidatedContent = loadContent(RAW);

/** Every validated content file. */
export function plannerContent(): ValidatedContent {
  return CONTENT;
}

/** The files one planner state's plan needs (the engine's `content` input). */
export function plannerContentFor(state: PlannerState): PlannerContent {
  const content = contentForState(CONTENT, state);
  if (!content) throw new Error(`Planner content for ${state} is missing its generic catalog or facts file.`);
  return content;
}

/** Every content file with its label, for review listings and `check:rules`. */
export function contentFiles(): { label: string; file: ContentHeader }[] {
  const labelled = [
    ...CONTENT.rules.map((file, i) => ({ label: RAW.rules[i].label, file: file as ContentHeader })),
    ...CONTENT.genericCatalogs.map((file, i) => ({ label: RAW.genericCatalogs[i].label, file: file as ContentHeader })),
    ...CONTENT.facts.map((file, i) => ({ label: RAW.facts[i].label, file: file as ContentHeader })),
  ];
  if (CONTENT.families) labelled.push({ label: RAW.families!.label, file: CONTENT.families });
  if (CONTENT.cipRouting) labelled.push({ label: RAW.cipRouting!.label, file: CONTENT.cipRouting });
  if (CONTENT.rigor) labelled.push({ label: RAW.rigor!.label, file: CONTENT.rigor });
  return labelled;
}

let CITATION_INDEX: Map<string, ResolvedCitation> | null = null;

/**
 * Citations by id, resolved with their source, for lines the engine doesn't carry (information
 * cards, family cautions, the free graduation pages). Unknown ids are left out.
 */
export function resolveContentCitations(ids: Iterable<string>): Record<string, ResolvedCitation> {
  if (!CITATION_INDEX) {
    CITATION_INDEX = new Map();
    for (const { file } of contentFiles()) {
      for (const c of file.citations) {
        const source = file.sources[c.source];
        if (!source || CITATION_INDEX.has(c.id)) continue;
        CITATION_INDEX.set(c.id, { id: c.id, quote: c.quote, pinpoint: c.pinpoint ?? null, source: { ...source, key: c.source } });
      }
    }
  }
  const out: Record<string, ResolvedCitation> = {};
  for (const id of ids) {
    const found = CITATION_INDEX.get(id);
    if (found) out[id] = found;
  }
  return out;
}

/** Each file's current fingerprint and review status (what /admin/rules shows a reviewer). */
export function contentFingerprints(): { id: string; label: string; fingerprint: string; status: ContentHeader["review"]["status"] }[] {
  return contentFiles().map(({ label, file }) => ({ id: file.id, label, fingerprint: contentFingerprint(file), status: file.review.status }));
}

/** A rule set by its permanent id, with the file it lives in. */
export function findRuleSet(id: string): { ruleSet: RuleSet; file: RuleFile } | null {
  for (const file of CONTENT.rules) {
    const ruleSet = file.ruleSets.find((r) => r.id === id);
    if (ruleSet) return { ruleSet, file };
  }
  return null;
}

/**
 * Review notices for everything a state's path is built from, on `today`: "Not yet reviewed by a
 * school counselor" (or the review date) and, once stale, "Checked for 2026-27; being re-checked.
 * Ask your counselor."
 */
export function reviewNoticesFor(state: PlannerState, today: IsoDate): ReviewNotice[] {
  const content = plannerContentFor(state);
  const files: ContentHeader[] = [...content.rules, content.genericCatalog, content.facts];
  if (content.families) files.push(content.families);
  if (content.rigor) files.push(content.rigor);
  return files.map((file) => reviewNotice(file, today));
}

/** Whether a rule set reads "being re-checked" on `today` (past its school year or re-check date). */
export function ruleSetStaleness(id: string, today: IsoDate): { stale: boolean; label: string | null } | null {
  const found = findRuleSet(id);
  return found ? ruleSetFreshness(found.ruleSet, found.file, today) : null;
}

/** Rule sets that name this college (course patterns and program gates), for its "Course preparation" block. */
export function ruleSetsForCollege(unitId: number): RuleSet[] {
  return CONTENT.rules.flatMap((f) => f.ruleSets.filter((r) => r.appliesWhen.colleges?.includes(unitId)));
}

/** Information cards about a college (admission type, test policy), never evaluated. */
export function infoCardsForCollege(unitId: number): InfoCard[] {
  return CONTENT.rules.flatMap((f) => (f.infoCards ?? []).filter((c) => c.unitId === unitId));
}

/**
 * A state's information cards that aren't about one college: statewide admission programs (Texas
 * automatic admission, Admit Utah) and scholarships decided by GPA and tests (Tennessee HOPE).
 */
export function stateInfoCards(state: PlannerState): { admissions: InfoCard[]; aid: InfoCard[] } {
  const files = CONTENT.rules.filter((f) => f.state === state);
  const cards = (kind: RuleFile["kind"]) => files.filter((f) => f.kind === kind).flatMap((f) => (f.infoCards ?? []).filter((c) => c.unitId === undefined));
  return { admissions: cards("admissions"), aid: cards("aid") };
}

/** The labeled state default rule sets ("Texas: what Texas A&M recommends") for a student with no in-state public college. */
export function stateDefaultRuleSets(state: PlannerState): RuleSet[] {
  return CONTENT.rules.filter((f) => f.state === state).flatMap((f) => f.ruleSets.filter((r) => r.appliesWhen.stateDefault));
}

export function majorFamiliesContent(): MajorFamiliesFile {
  return CONTENT.families!;
}

export function cipRoutingContent(): CipRoutingFile {
  return CONTENT.cipRouting!;
}

export function rigorContent(): RigorFile {
  return CONTENT.rigor!;
}

/** The reviewed routing rules, in order (first match wins). */
export function cipRoutingRules(): CipRoutingFile["rules"] {
  return CONTENT.cipRouting!.rules;
}

/** The family a 6-digit CIP code routes to, or null. */
export function familyForCip(cip6: string): FamilyId | null {
  return routeCip(cip6, cipRoutingRules());
}
