import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq, inArray } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type MatchExplanation, matchRuns, occupations, users } from "@/db/schema";
import { type BigFive, RIASEC, RIASEC_INFO, type Riasec, WORK_VALUE_INFO } from "../assessments/instruments";
import { displayTrait } from "../assessments/descriptions";
import {
  type AreaLevel,
  type InterestPattern,
  type LeadPattern,
  NOT_SURE_AREA_SCORE,
  areaLevel,
  areaNames,
  fewAreasText,
  interestPattern,
  noAreaStandsOut,
  noLeadReason,
  strongAreas,
  tiedAreasText,
  tiedBelow,
} from "../assessments/interest-pattern";
import { latestResult } from "../assessments/service";
import { getAnthropic } from "../ai/client";
import { modelFor, supportsEffort } from "../ai/models";
import { toAiContext } from "../ai/privacy";
import { readStructuredOutput } from "../ai/structured";
import { assertWithinBudget, recordMessageUsage } from "../ai/usage";
import { currentGrade } from "../auth/age";
import { latestMatchRun, loadOccupationProfiles } from "./service";
import { pathwayFor, strengthsThatCount } from "./match";
import { JOB_ZONE_INFO } from "../job-zones";

const Explanation = z.object({
  overview: z.string().describe("2–3 sentences about what the student's results suggest."),
  careers: z
    .array(z.object({ code: z.string(), why: z.string().describe("1–2 sentences: why this career fits them.") }))
    .describe("One entry per career provided, using its exact code."),
});

const SYSTEM = `You are College Compass, a warm, encouraging guidance counselor for students in grades 7–12. You are explaining a student's career-interest results to them.

Rules:
- Write directly to the student ("you"). Match the reading level to their grade: simple, concrete words for grades 7–8.
- Use only the information provided. Don't state pay, job openings, admission requirements, or anything else not given.
- Frame careers as possibilities to explore "for now", not predictions. Interests change, and that's good.
- Treat college-degree and career-training paths as equally worthwhile.
- Connect each career to specific interests (and values or strengths, if given). Be specific, not generic.
- Mention a personal strength only if it is listed under strengths, and never describe the student's calm, stress, mood or feelings.
- Never show the interest code letters (like "IAS") or the words "Realistic/Investigative/…" as labels; describe interests in plain words.
- Vary how each reason starts and what it highlights; don't repeat the same phrasing across careers.
- Keep the overview under 70 words and each career's reason under 35 words. No emojis, no lists inside strings.`;

type Options = { client?: Pick<Anthropic, "beta">; now?: Date };

/** What the model is told about the student besides their interests. */
async function buildContext(db: Db, userId: string) {
  const [student] = await db
    .select({ grade: users.grade, gradeSchoolYear: users.gradeSchoolYear })
    .from(users)
    .where(eq(users.id, userId));
  const [personality, values] = await Promise.all([latestResult(db, userId, "personality"), latestResult(db, userId, "values")]);
  const grade = student ? currentGrade(student) : null;
  return { ctx: toAiContext({ grade: grade === null ? null : Math.min(grade, 12) }), personality, values };
}

/** Each interest area in a career's reason: plain words, with no "and" inside so two can be paired. */
export const AREA_PHRASE: Record<Riasec, string> = {
  R: "hands-on work",
  I: "figuring things out",
  A: "creating things",
  S: "helping people",
  E: "leading others",
  C: "keeping things organized",
};

/** Longest clause kept from a career's description; reasons stay about 20 words. */
const MAX_CLAUSE_WORDS = 14;
/** Words a long description is cut before: what comes after says how, where or why. */
const CUT_BEFORE = new Set([
  "to", "for", "in", "of", "by", "that", "which", "who", "with", "at", "on", "from", "using", "within", "into",
  "through", "during", "according", "under", "while", "when", "where", "so", "as", "throughout", "without",
  "used", "designed", "intended", "engaged", "involving", "following", "regarding", "usually", "often", "related",
  "associated", "affecting", "coping", "located", "required", "needed", "necessary",
]);
/** Longest reason, in words (see reasonFacts). */
export const MAX_REASON_WORDS = 24;

const words = (text: string) => text.split(/\s+/).filter(Boolean);
/** A word without the comma after it, lowercased. */
const bare = (word: string | undefined) => (word ?? "").replace(/[,.]$/, "").toLowerCase();

/** Prepositions, joining words and words like "the" or "any": they need what comes after them. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "any", "all", "some", "each", "every", "its", "their", "this", "these", "those", "both", "either",
  "many", "several", "various", "one", "more", "other", "such", "and", "or", "nor", "but", "than", "may", "can", "must",
  "about", "across", "after", "against", "along", "among", "around", "before", "between", "beyond", "like", "onto",
  "per", "toward", "towards", "upon", "via", "including",
]);

/**
 * A clause never ends on these: a function word or a linking word, or a word that needs what comes
 * after it ("…a wide variety", "…the selling of", "…duties related", "…and participate", "…goods in
 * connection", "…resources necessary", "…research dealing", "…and ensure", "…fixtures made").
 */
const NOT_LAST = new Set([
  ...FUNCTION_WORDS,
  ...CUT_BEFORE,
  "variety", "number", "range", "kind", "kinds", "type", "types", "part", "array", "series", "amount",
  "participate", "connection", "enabling", "assist", "dealing", "relating", "resulting",
  "specializing", "concerning", "consisting", "working", "applying", "vicinity", "conformity", "accordance",
  "movement", "responsibility", "exposure", "areas", "use", "ensure", "verify",
  // Helping verbs: "…where technical or scientific knowledge is" (required).
  "is", "are", "was", "were", "be", "been", "will", "would", "should",
]);
/** …nor on the word right after these ("…claims to determine", "…and may participate", "…enabling patrons"). */
const NOT_NEXT_TO_LAST = new Set(["to", "may", "enabling"]);
/** …nor on one of these after "and" or "or": "…fires or respond", "…decisions and act", "…office, or work". */
const NOT_LAST_JOINED = new Set(["act", "respond", "work", "engage", "deal", "cope", "comply", "contribute"]);

/**
 * Whether a clause starts with what the worker does: a verb ("Teach…"), maybe after an adverb
 * ("Directly supervise…"), not a phrase about how or where ("Using…", "In a…").
 */
function startsWithVerb(clause: string[]): boolean {
  const adverb = /^[a-z]{4,}ly$/i.test(clause[0]) && !["supply", "comply", "multiply"].includes(bare(clause[0]));
  const first = bare(clause[adverb ? 1 : 0]);
  return /^[a-z]/.test(first) && !FUNCTION_WORDS.has(first) && !CUT_BEFORE.has(first) && !/ing$/.test(first);
}

const IRREGULAR_PARTICIPLES = new Set(["made", "built", "known", "found", "held", "done", "given", "taken", "shown", "seen", "grown", "drawn", "sold"]);
/**
 * A past participle that needs what came after it ("…drugs delivered", "…data, gathered",
 * "…fixtures made"), but not "as prescribed" or "are made".
 */
function participleAtEnd(clause: string[]): boolean {
  const last = bare(clause.at(-1));
  const participle = (/[^e]ed$/.test(last) && last.length > 4) || IRREGULAR_PARTICIPLES.has(last);
  return participle && !["as", "is", "are", "be", "been", "was", "were"].includes(bare(clause.at(-2)));
}

/**
 * Whether the start of a description, cut short, still reads as a whole. It doesn't end on a word
 * in NOT_LAST, on a word right after "to", "may" or "enabling", on a participle, or partway through
 * "too … to"; and it has something for its verbs to act on ("plan, direct, or coordinate" doesn't).
 * A list in it has "and" or "or" before its last item ("install, inspect, test, maintain" and "by
 * telephone, mail" stop partway through one). And a word like "into" in "feed materials into or
 * remove materials from machines" isn't left without the rest of its phrase.
 */
function readsWhole(clause: string[]): boolean {
  const [last, beforeLast] = [bare(clause.at(-1)), bare(clause.at(-2))];
  if (clause.length < 2 || NOT_LAST.has(last) || NOT_NEXT_TO_LAST.has(beforeLast) || participleAtEnd(clause)) return false;
  if (NOT_LAST_JOINED.has(last) && ["and", "or"].includes(beforeLast)) return false;
  // "…duties too varied and diverse" (to be classified…), "…activities in such fields" (as…).
  if (clause.some((w) => bare(w) === "too")) return false;
  const such = clause.findLastIndex((w) => bare(w) === "such");
  if (such >= 0 && !clause.slice(such + 1).some((w) => bare(w) === "as")) return false;
  // Only the verbs, with nothing to act on: "plan, direct, or coordinate", "pack or package".
  const joined = clause.findIndex((w) => w === "and" || w === "or");
  if ((clause[0].endsWith(",") || joined === 1) && joined >= clause.length - 2) return false;
  const lastComma = clause.findLastIndex((w) => w.endsWith(","));
  if (lastComma >= 0 && !["and", "or"].includes(clause[lastComma + 1])) return false;
  const dangling = clause.findIndex((w, i) => CUT_BEFORE.has(bare(w)) && ["and", "or"].includes(clause[i + 1]));
  return dangling < 0 || clause.slice(dangling + 2, -1).some((w) => CUT_BEFORE.has(w));
}

/** Linking words that start a phrase of their own, so "…structures or to loosen rock" can lose "or to…". */
const PREPOSITIONS = new Set([
  "to", "for", "in", "of", "by", "with", "at", "on", "from", "into", "through", "during", "under", "within", "throughout",
  "without", "as",
]);

/**
 * The first `n` words of a description, without a comma, "and" or "or" at the end ("…roads,
 * sidewalks, or utilities, or to improve" ends "…or utilities"), when that reads as a whole. Null
 * when it doesn't, or when the cut splits two words joined without a comma ("grinding and related
 * tools" isn't "grinding"), unless what's left out is a phrase of its own ("…structures or to…").
 */
function cutAt(all: string[], n: number): string[] | null {
  const kept = all.slice(0, n);
  while (["and", "or"].includes(kept.at(-1) ?? "")) {
    if (!kept.at(-2)?.endsWith(",") && !PREPOSITIONS.has(all[n])) return null;
    kept.pop();
  }
  kept[kept.length - 1] = kept.at(-1)!.replace(/,$/, "");
  return readsWhole(kept) ? kept : null;
}

/**
 * Where to cut a description of more than `max` words, as a word count. In order: before the first
 * linking word after a few words ("…to promote…", "…in laboratories", "…used in…"), so what the
 * worker does comes first and how, where or why after, but not before "of" ("activities of
 * workers" belong together); at the first comma that doesn't split a list ("Assess patient health
 * problems and needs, develop…"); only when `listComma`, at a comma in a list after a whole item:
 * a plural ("…operation of farms, ranches…") or before a phrase ("…local area network, wide area
 * network, …"), never a word that shares the words ending the list ("the academic,
 * administrative, or auxiliary activities", "live farm, ranch, open range or aquacultural
 * animals"); before "of" after all, but never after "the …" or a word like "safekeeping" ("the
 * determinants and distribution of disease" belong together); and before any linking word. Only
 * where what's left reads as a whole (see cutAt).
 */
function cutPoint(all: string[], max: number, { listComma }: { listComma: boolean }): number {
  for (const [from, test] of cutRules(all, { listComma })) {
    for (let n = from; n <= Math.min(max, all.length - 1); n++) if (test(n)) return n;
  }
  return 0;
}

/** Every place cutPoint could cut a description, first to last, whatever its length. */
function cutPoints(all: string[], { listComma }: { listComma: boolean }): number[] {
  const rules = cutRules(all, { listComma });
  const points: number[] = [];
  for (let n = 1; n < all.length; n++) if (rules.some(([from, test]) => n >= from && test(n))) points.push(n);
  return points;
}

/** cutPoint's rules in order, each as the fewest words it keeps and a test for a cut before word n. */
function cutRules(all: string[], { listComma }: { listComma: boolean }): [number, (n: number) => boolean][] {
  const whole = (n: number) => cutAt(all, n) !== null;
  // "…the preparation, seasoning, and cooking of foods": "the" before "of", with no linking word
  // between, or a word like "safekeeping of records" right before it.
  const ofBelongs = (n: number) => {
    if (/ing$/.test(bare(all[n - 1]))) return true;
    for (let k = n - 1; k >= 0 && !CUT_BEFORE.has(bare(all[k])); k--) if (bare(all[k]) === "the") return true;
    return false;
  };
  // "Provide individuals, families, and groups with…": what they're provided comes after "with".
  const withAfterVerb = (n: number) => all[n] === "with" && ["provide", "supply", "equip", "furnish", "present"].includes(bare(all[0]));
  const linking = (n: number, of: boolean) =>
    CUT_BEFORE.has(all[n]) && (all[n] !== "of" || (of && !ofBelongs(n))) && !withAfterVerb(n) && whole(n);
  // "…of commercial, real estate, or credit loans": another comma, "and" or "or" within three words.
  const inList = (n: number) => all.slice(n, n + 3).some((w) => w.endsWith(",")) || all[n] === "and" || all[n] === "or";
  // The words in the list item after a comma, up to the next comma, "and" or "or".
  const nextItem = (n: number) => {
    let k = n;
    while (k < all.length && !all[k].endsWith(",") && !["and", "or"].includes(all[k])) k++;
    return (all[k]?.endsWith(",") ? k + 1 : k) - n;
  };
  const comma = (n: number) => all[n - 1].endsWith(",") && whole(n);
  return [
    [5, (n) => linking(n, false)],
    [4, (n) => comma(n) && !inList(n)],
    ...(listComma ? [[4, (n: number) => comma(n) && (nextItem(n) !== 1 || /[^su]s,$/.test(all[n - 1]))] as [number, (n: number) => boolean]] : []),
    [5, (n) => linking(n, true)],
    [3, (n) => linking(n, true)],
  ];
}

/**
 * What a career involves, from the first sentence of its O*NET description, cut to a short clause
 * that follows "you could": "Design or create graphics to meet specific commercial or promotional
 * needs, such as packaging…" becomes "design or create graphics to meet specific commercial or
 * promotional needs". O*NET descriptions start with what the worker does ("Design…", "Teach…"),
 * sometimes after how or where ("Using climbing techniques, cut away…", "In a gambling
 * establishment, conduct…"), which is left out. Null when there's no description to use, or no
 * clean clause: one that starts with a verb and doesn't stop partway through a phrase or a list.
 */
export function careerClause(description: string | null | undefined, maxWords = MAX_CLAUSE_WORDS): string | null {
  let clause = clauseSource(description);
  if (!clause) return null;
  if (clause.length <= maxWords) {
    // The whole first sentence ends where the sentence does ("…to run", "…as needed").
    if (!endsWhole(clause)) return null;
  } else {
    // A comma in a list only for the first cut, never a shorter one ("play parts in stage, television…").
    const cut = cutPoint(clause, maxWords, { listComma: maxWords === MAX_CLAUSE_WORDS });
    if (!cut) return null;
    clause = cutAt(clause, cut)!;
  }
  return clauseText(clause);
}

/** A whole first sentence can end on anything but a function word ("…to run", "…as needed"). */
const endsWhole = (sentence: string[]) => !FUNCTION_WORDS.has(bare(sentence.at(-1)));

/** The words of a clause as it follows "you could": the verb that starts it lowercased, but not an acronym ("GIS"). */
function clauseText(clause: string[]): string {
  const text = clause.join(" ");
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/**
 * The longer clauses a description gives than one of `than` words, shortest first: each clean cut
 * past it (see cutPoint), then the whole first sentence. For a career whose usual clause says only
 * what another career on the page says too: "plan, direct, or coordinate activities" can become
 * "plan, direct, or coordinate activities to solicit and maintain funds".
 */
export function longerClauses(description: string | null | undefined, than: number): string[] {
  const sentence = clauseSource(description);
  if (!sentence) return [];
  const cuts = cutPoints(sentence, { listComma: true }).map((n) => cutAt(sentence, n)!);
  if (endsWhole(sentence)) cuts.push(sentence);
  return [...new Set(cuts.filter((c) => c.length > than).map(clauseText))].sort((a, b) => words(a).length - words(b).length);
}

/**
 * The words clauses are cut from: the description's first sentence without asides, openings like
 * "Using…," or lists of examples. Null when there's no description to use, or it doesn't start
 * with what the worker does.
 */
function clauseSource(description: string | null | undefined): string[] | null {
  if (!description?.trim()) return null;
  // The first sentence: up to a period before a capital letter, but not the one in "U.S. Army".
  let text = description.trim().split(/(?<!\b[A-Z])\.\s+(?=[A-Z])/)[0].replace(/\.$/, "");
  // Asides like "(MEMS)" or "(LAN)", openings like "Under the direction of…," and "Using…,", and
  // "courses pertaining to".
  text = text
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^(?:Under|Using|In|With|At|As|For|On|During|Through|Following|Working)\b[^,]+,\s*/, "")
    .replace(/\bpertaining to\b/g, "in");
  // Lists of examples and second parts: "…, such as…", "…; …", "…, including…".
  // Without its examples, "…in areas" or "…to areas" says nothing: "Transport patients to areas
  // such as operating rooms" is "transport patients". And "material movers, hand" is an O*NET name.
  text = text
    .split(/\s*[;:]\s*|,?\s+(?:such as|including|especially|e\.g\.)\s+/i)[0]
    .replace(/,$/, "")
    .replace(/,?\s+(?:[a-z]+ly\s+)?(?:in|to)\s+(?:areas|fields|settings|places)$/, "")
    .replace(/,\s*hand$/, "")
    .trim();
  // "…perform any or all of the following functions" points to a list that isn't shown.
  if (/\bthe following\b/i.test(text)) return null;
  const sentence = words(text);
  return sentence.length >= 2 && startsWithVerb(sentence) ? sentence : null;
}

/** A career's strongest interest areas: its top area, and any other of its top three at 4 or more (of 1–7). */
export function careerStrongAreas(interests: Record<Riasec, number>): Riasec[] {
  const sorted = [...RIASEC].sort((a, b) => interests[b] - interests[a]);
  return sorted.slice(0, 3).filter((a, i) => i === 0 || interests[a] >= 4);
}

/**
 * The interest areas a reason may name as the student's: strong for the career, and ones the student
 * leans toward (at or above "Not sure" on average), most liked first, at most two. Never an area they
 * leaned toward disliking, and none at all when no area stands out (see noAreaStandsOut).
 */
export function sharedAreas(pattern: InterestPattern, areas: Record<Riasec, number>, career: Record<Riasec, number>): Riasec[] {
  if (noAreaStandsOut(pattern)) return [];
  return careerStrongAreas(career)
    .filter((a) => areas[a] >= NOT_SURE_AREA_SCORE)
    .sort((a, b) => areas[b] - areas[a] || career[b] - career[a])
    .slice(0, 2);
}

type ReasonFacts = { title: string; clause: string | null; preparation: string | null; shared: Riasec[] };

/**
 * The ways a reason can be worded, best first. Neighbors on a page start from different wordings
 * (`variant`), and the last one names the career, so a page never shows the same reason twice.
 */
function reasonWordings({ title, clause, preparation, shared }: ReasonFacts, variant: number): string[] {
  const interest = shared.length ? shared.map((a) => AREA_PHRASE[a]).join(" and ") : null;
  const lead = (s: string) => (preparation ? `${preparation}, ${s}` : s[0].toUpperCase() + s.slice(1));
  let options: string[];
  if (clause) {
    options = interest
      ? [lead(`you could ${clause}, using your interest in ${interest}.`), lead(`you'd ${clause}, which fits your interest in ${interest}.`)]
      : [lead(`you could ${clause}.`), lead(`you'd ${clause}.`)];
  } else {
    options = interest
      ? [lead(`this career uses your interest in ${interest}.`), lead(`this path fits your interest in ${interest}.`)]
      : [lead("this career is worth a look while you explore."), lead("this path is worth a look while you explore.")];
  }
  const ordered = [...options.slice(variant % options.length), ...options.slice(0, variant % options.length)];
  ordered.push(clause ? `${title} ${clause}${interest ? `, which fits your interest in ${interest}` : ""}.` : `${title}: ${ordered[0]}`);
  return ordered;
}

/**
 * The clauses a career's reason can take from its description. `usual`: the first cut (see
 * careerClause), then each shorter clean cut. `longer`: the longer ones (see longerClauses), for a
 * page where another career's reason already says what the usual ones say.
 */
export function reasonClauses(description: string | null | undefined): { usual: string[]; longer: string[] } {
  const first = careerClause(description);
  if (!first) return { usual: [], longer: [] };
  const usual = [first];
  for (let max = MAX_CLAUSE_WORDS - 1; max >= 3; max--) {
    const shorter = careerClause(description, max);
    if (!shorter) break;
    if (shorter !== usual.at(-1)) usual.push(shorter);
  }
  const longer = longerClauses(description, words(usual.at(-1)!).length).filter((c) => !usual.includes(c));
  return { usual, longer };
}

/**
 * The facts a career's reason can use, each short enough to read at a glance (MAX_REASON_WORDS),
 * best first. The first is its usual reason: all its facts, trimmed in order to one interest area
 * instead of two; a shorter clause for what the career involves; no interest area. Then, for a page
 * where another career already says what those clauses say, a longer clause with the words that
 * set this career apart, even if only its shorter wording ("you'd…") is short enough. Last, no
 * clause ("…this career uses your interest in…").
 */
function reasonOptions(career: { title: string; description?: string | null; jobZone?: number | null }, shared: Riasec[]): ReasonFacts[] {
  const preparation = career.jobZone ? (JOB_ZONE_INFO[career.jobZone]?.reasonLead ?? null) : null;
  // Both wordings, or at least one.
  const fits = (f: ReasonFacts) => reasonWordings(f, 0).slice(0, 2).every(short);
  const oneFits = (f: ReasonFacts) => reasonWordings(f, 0).slice(0, 2).some(short);
  const { usual, longer } = reasonClauses(career.description);
  const none: ReasonFacts = { title: career.title, clause: null, preparation, shared };
  const options: ReasonFacts[] = [];
  const add = (clauses: string[], areaChoices: Riasec[][], test: (f: ReasonFacts) => boolean) => {
    for (const areas of areaChoices) {
      for (const clause of clauses) {
        const facts = { ...none, clause, shared: areas };
        if (test(facts)) options.push(facts);
      }
    }
  };
  add(usual.slice(0, 1), [shared], fits);
  add(usual, [shared.slice(0, 1), []], fits);
  add(longer, [shared, shared.slice(0, 1), []], oneFits);
  options.push(none);
  return options;
}

/** A reason short enough to read at a glance. */
const short = (reason: string) => words(reason).length <= MAX_REASON_WORDS;

/** A clause's words, and the words of the description it was cut from, to compare with another career's. */
type SaidClause = { clause: string[]; source: string[] };
const comparable = (text: string) => words(text).map(bare);
const startsWith = (text: string[], start: string[]) => start.length <= text.length && start.every((w, i) => text[i] === w);
/**
 * Whether two careers' clauses say the same thing: neither goes past the words both descriptions
 * start with ("plan, direct, or coordinate activities" for both "…activities to solicit and maintain
 * funds" and "…activities of a spa facility").
 */
const sameClause = (a: SaidClause, b: SaidClause) => startsWith(a.source, b.clause) && startsWith(b.source, a.clause);

const EXPLORE = "Explore a few that catch your eye — you're not choosing forever, just finding a direction for now.";

/** The template's first sentences: only what the scores support, so a tie is never called a lead. */
function templateOverview(pattern: InterestPattern): string {
  if (noAreaStandsOut(pattern)) {
    return `You ${noLeadReason(pattern)}, so no area stands out yet. That's okay. The careers below are a starting point, so explore widely — you're not choosing forever, just finding a direction for now.`;
  }
  if (pattern.kind === "few") return `${fewAreasText(pattern)} The careers below share that mix. ${EXPLORE}`;
  if (pattern.kind === "tied") return `${tiedAreasText(pattern)} The careers below share that mix. ${EXPLORE}`;
  const top = pattern.code.split("") as Riasec[];
  const lead = pattern.ties.length
    ? `Your strongest interest areas are ${areaNames(top)}. ${areaNames(pattern.ties[0])} are tied.`
    : `Your strongest interest areas are ${areaNames(top.slice(0, 2))}, followed by ${areaNames(top.slice(2))}.`;
  return `${lead} The careers below share that mix. ${EXPLORE}`;
}

/** What the template needs about a career; the more it has, the more specific the reason. */
export type TemplateCareer = {
  occupationCode: string;
  /** O*NET interest profile (1–7 per area). */
  interests?: Record<Riasec, number>;
  title: string;
  /** O*NET description; its first clause says what the work is. */
  description?: string | null;
  jobZone?: number | null;
};

/**
 * A specific, non-AI reason for every match, in one short sentence: the preparation the career
 * needs (its job zone), what the work is (from its O*NET description), and the interest areas the
 * student leans toward that are strong for it (see sharedAreas). An area the student leaned toward
 * disliking is never named, and when no area stands out none is: the reason only says what the
 * career involves. No two careers get the same reason, or say the same thing about what the work
 * is: when a career's clause says only what an earlier one's does ("plan, direct, or coordinate
 * activities"), it takes a longer one that sets it apart, or none (see reasonOptions).
 */
export function templateExplanation(areas: Record<Riasec, number>, careers: TemplateCareer[]): MatchExplanation {
  const pattern = interestPattern(areas);
  const used = new Set<string>();
  const said: SaidClause[] = [];
  return {
    source: "template",
    overview: templateOverview(pattern),
    careers: careers.map((c, i) => {
      const shared = c.interests ? sharedAreas(pattern, areas, c.interests) : [];
      const source = (clauseSource(c.description) ?? []).map(bare);
      for (const facts of reasonOptions(c, shared)) {
        const clause = facts.clause && { clause: comparable(facts.clause), source };
        if (clause && said.some((s) => sameClause(s, clause))) continue;
        const wordings = reasonWordings(facts, i).filter((w) => !clause || short(w));
        // The last option has no clause: when both its wordings are taken, the one naming the career.
        const why = wordings.find((w) => !used.has(w)) ?? (clause ? null : wordings[wordings.length - 1]);
        if (!why) continue;
        used.add(why);
        if (clause) said.push(clause);
        return { code: c.occupationCode, why };
      }
      throw new Error("unreachable: the last reason option always gives a reason");
    }),
  };
}

/** How the student rated areas below the top interests, to follow "and". */
const LEVEL_FACT: Record<AreaLevel, string> = {
  liked: "the student leaned toward liking them",
  "not sure": "on average the student was not sure about them",
  disliked: "the student leaned toward disliking them",
};

/**
 * What the model is told about the student's interests: only what the scores support (see
 * interestPattern). The code only when there is a clear one, the areas above a tie or the one or
 * two that reached "Not sure" as the top interests (never areas picked from a tie in RIASEC order,
 * or areas the student disliked), any tie as a plain fact, and how the student rated the areas
 * below the top interests, so liked areas aren't lost and disliked ones aren't claimed.
 */
export function interestFacts(pattern: LeadPattern, areas: Record<Riasec, number>) {
  const topInterests = strongAreas(pattern).map((a) => ({ area: RIASEC_INFO[a].name, meaning: RIASEC_INFO[a].description }));
  if (pattern.kind === "code") {
    const tie = pattern.ties.at(0);
    const tiedAreas = tie && `${areaNames(tie)} are tied, so their order doesn't matter.`;
    return { interestCode: pattern.code, topInterests, ...(tiedAreas && { tiedAreas }) };
  }
  if (pattern.kind === "few") {
    return { topInterests, otherAreas: `${areaNames(pattern.rest)} are below the top interests, and ${LEVEL_FACT.disliked}.` };
  }
  const below = tiedBelow(pattern);
  const tiedAreas = below.length
    ? `${areaNames(below)} are tied below the top interests, and ${LEVEL_FACT[areaLevel(areas[below[0]])]}.`
    : `${areaNames(pattern.tied)} are tied for the top interest.`;
  return { topInterests, tiedAreas };
}

/**
 * What the model is told about the student's personality: only the strengths that count (see
 * strengthsThatCount), highest first, in the wording they see. A trait at or below the middle of the
 * scale isn't sent, so a direct, objective student is never called warm. Never emotional stability
 * (the Mini-IPIP's neuroticism, shown to students as "Staying calm"): how a young person handles
 * stress says nothing about which careers fit them, and it's data the model doesn't need.
 */
export function strengthFacts(traits: Record<BigFive, number>): string[] {
  return strengthsThatCount(traits)
    .map((t) => displayTrait(t, traits[t]))
    .map((t) => `${t.name}: ${t.text}`);
}

/** O*NET descriptions for these careers, for their reasons. */
export async function occupationDescriptions(db: Db, codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .select({ code: occupations.code, description: occupations.description })
    .from(occupations)
    .where(inArray(occupations.code, codes));
  return new Map(rows.map((r) => [r.code, r.description]));
}

/**
 * Stored AI explanations carry the version of the interest facts they were written from. Version 2
 * describes ties and areas below "Not sure" as they are. Before it, the model was told the code's
 * three letters as the top interests, which for a tie or an area the student disliked named
 * interests the scores don't show.
 */
export const EXPLANATION_FACTS_VERSION = 2;

/**
 * The stored explanation to show for these interests, or null when a new one is needed (written by
 * the model, or the template). An explanation from older facts is kept only for a clear code with
 * no ties, where the facts haven't changed. When no area stands out it's always the template.
 */
export function storedExplanation(explanation: MatchExplanation | null, pattern: InterestPattern): MatchExplanation | null {
  if (!explanation || noAreaStandsOut(pattern)) return null;
  if ((explanation.factsVersion ?? 1) >= EXPLANATION_FACTS_VERSION) return explanation;
  return pattern.kind === "code" && pattern.ties.length === 0 ? explanation : null;
}

/**
 * Returns the explanation for the student's latest matches, writing it with the model the first
 * time. Falls back to a template (not stored) if AI is unavailable, over budget, or declines. When
 * no interest area stands out the student always gets the template, even over an explanation stored
 * before this rule: there are no top interests to explain the matches with. An explanation written
 * from older interest facts is written again when those facts have changed (see storedExplanation).
 */
export async function explainLatestMatches(db: Db, userId: string, opts: Options = {}): Promise<MatchExplanation | null> {
  const run = await latestMatchRun(db, userId);
  if (!run) return null;
  const interests = await latestResult(db, userId, "interests");
  if (!interests) return run.explanation;
  const pattern = interestPattern(interests.scores.areas);
  const stored = storedExplanation(run.explanation, pattern);
  if (stored) return stored;

  const careers = run.matches;
  const [profiles, descriptions] = await Promise.all([
    loadOccupationProfiles(db).then((all) => new Map(all.map((p) => [p.code, p.interests]))),
    occupationDescriptions(
      db,
      careers.map((m) => m.occupationCode),
    ),
  ]);
  const fallback = templateExplanation(
    interests.scores.areas,
    careers.map((m) => ({
      occupationCode: m.occupationCode,
      interests: profiles.get(m.occupationCode),
      title: m.title,
      description: descriptions.get(m.occupationCode),
      jobZone: m.jobZone,
    })),
  );
  if (noAreaStandsOut(pattern)) return fallback;
  const { ctx, personality, values } = await buildContext(db, userId);

  try {
    await assertWithinBudget(db, userId, opts.now);
    const client = opts.client ?? getAnthropic();
    const model = modelFor("explain");

    const strengths = personality ? strengthFacts(personality.scores.traits) : [];
    const facts = {
      grade: ctx.grade,
      ...interestFacts(pattern, interests.scores.areas),
      strengths: strengths.length > 0 ? strengths : undefined,
      topValues: values?.scores.ranking.slice(0, 3).map((v) => WORK_VALUE_INFO[v].description),
      careers: careers.map((c) => ({
        code: c.occupationCode,
        title: c.title,
        path: pathwayFor(c.jobZone) === "degree" ? "college degree" : "career training",
      })),
    };

    // `create`, not `parse`: parse throws on unparseable output before the billed usage is recorded.
    const message = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { ...(supportsEffort(model) && { effort: "low" as const }), format: betaZodOutputFormat(Explanation) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Explain these results to the student:\n${JSON.stringify(facts, null, 2)}` }],
    });
    await recordMessageUsage(db, userId, "explain", model, message);
    const parsed = readStructuredOutput(message, Explanation);
    if (!parsed) return fallback;

    // Keep only careers we asked about, in our order; fill any the model skipped from the template.
    const byCode = new Map(parsed.careers.map((c) => [c.code, c.why]));
    const explanation: MatchExplanation = {
      source: "ai",
      factsVersion: EXPLANATION_FACTS_VERSION,
      overview: parsed.overview,
      careers: fallback.careers.map((c) => ({ code: c.code, why: byCode.get(c.code) ?? c.why })),
    };
    await db
      .update(matchRuns)
      .set({ explanation })
      .where(and(eq(matchRuns.id, run.id), eq(matchRuns.userId, userId)));
    return explanation;
  } catch (error) {
    console.error("[explain] falling back to template", error instanceof Error ? error.name : "unknown");
    return fallback;
  }
}
