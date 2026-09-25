import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq, inArray } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type MatchExplanation, matchRuns, occupations, users } from "@/db/schema";
import { BIG_FIVE, type BigFive, RIASEC, RIASEC_INFO, type Riasec, WORK_VALUE_INFO } from "../assessments/instruments";
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
import { pathwayFor } from "./match";

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

/** O*NET Job Zones (how much preparation a career needs), in plain words that start a reason. */
const PREPARATION: Record<number, string> = {
  1: "With little or no training",
  2: "With some on-the-job training",
  3: "With career training or a two-year degree",
  4: "With a bachelor's degree",
  5: "With a graduate degree",
};

/** Longest clause kept from a career's description; reasons stay about 20 words. */
const MAX_CLAUSE_WORDS = 14;
/** Words a long description is cut before: what comes after says how, where or why. */
const CUT_BEFORE = new Set([
  "to", "for", "in", "of", "by", "that", "which", "who", "with", "at", "on", "from", "using", "within", "into",
  "through", "during", "according", "under", "while", "when", "where", "so", "as", "throughout", "without",
  "used", "designed", "intended", "engaged", "involving", "following", "regarding", "usually", "often", "related",
  "associated", "affecting", "coping", "located", "required", "needed",
]);
/** Longest reason, in words, before it's trimmed (see reasonFacts). */
export const MAX_REASON_WORDS = 24;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** A clause never ends on these ("…using any", "…the", "…a wide variety"). */
const NOT_LAST = new Set([
  "a", "an", "the", "any", "all", "some", "each", "every", "its", "their", "one", "more", "other", "to",
  "variety", "number", "range", "kind", "kinds", "type", "types", "part", "parts",
]);

/**
 * Where to cut a description of more than `max` words, as a word count. In order: before the first
 * linking word after a few words ("…to promote…", "…in laboratories", "…used in…"), so what the
 * worker does comes first and how, where or why after, but not before "of" ("activities of
 * workers" belong together); at the first comma that doesn't split a list ("Assess patient health
 * problems and needs, develop…"); before "of" after all; before any linking word; and, only when
 * `anyComma`, at the first comma. Never right after "to" ("…claims to determine") or "the".
 */
function cutPoint(all: string[], max: number, { anyComma }: { anyComma: boolean }): number {
  const endsWell = (n: number) => !NOT_LAST.has(all[n - 1].toLowerCase()) && all[n - 2] !== "to";
  const linking = (n: number, of: boolean) => CUT_BEFORE.has(all[n]) && (of || all[n] !== "of") && endsWell(n);
  // "…of commercial, real estate, or credit loans": another comma, "and" or "or" within three words.
  const inList = (n: number) => all.slice(n, n + 3).some((w) => w.endsWith(",")) || all[n] === "and" || all[n] === "or";
  const comma = (n: number) => all[n - 1].endsWith(",") && endsWell(n);
  const find = (from: number, test: (n: number) => boolean) => {
    for (let n = from; n <= Math.min(max, all.length - 1); n++) if (test(n)) return n;
    return 0;
  };
  return (
    find(5, (n) => linking(n, false)) ||
    find(4, (n) => comma(n) && !inList(n)) ||
    find(5, (n) => linking(n, true)) ||
    find(3, (n) => linking(n, true)) ||
    (anyComma ? find(4, comma) : 0)
  );
}

/**
 * What a career involves, from the first sentence of its O*NET description, cut to a short clause
 * that follows "you could": "Design or create graphics to meet specific commercial or promotional
 * needs, such as packaging…" becomes "design or create graphics to meet specific commercial or
 * promotional needs". O*NET descriptions start with what the worker does ("Design…", "Teach…").
 * Null when there's no description to use.
 */
export function careerClause(description: string | null | undefined, maxWords = MAX_CLAUSE_WORDS): string | null {
  if (!description?.trim()) return null;
  // The first sentence: up to a period before a capital letter, but not the one in "U.S. Army".
  let text = description.trim().split(/(?<!\b[A-Z])\.\s+(?=[A-Z])/)[0].replace(/\.$/, "");
  // Asides like "(MEMS)" or "(LAN)", "Under the direction of…," openings, and "courses pertaining to".
  text = text
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^Under [^,]+,\s*/, "")
    .replace(/\bpertaining to\b/g, "in");
  // Lists of examples and second parts: "…, such as…", "…; …", "…, including…".
  text = text.split(/\s*[;:]\s*|,?\s+(?:such as|including|especially|e\.g\.)\s+/i)[0].replace(/,$/, "").trim();
  const all = words(text);
  if (all.length < 2) return null;
  if (all.length > maxWords) {
    // A comma that may split a list is a last resort for the first cut, never for a shorter one
    // ("play parts in stage, television, radio…" isn't "play parts in stage").
    const cut = cutPoint(all, maxWords, { anyComma: maxWords === MAX_CLAUSE_WORDS });
    if (!cut) return null;
    text = all.slice(0, cut).join(" ").replace(/(?:,|\s+and|\s+or)+$/, "");
  }
  // Lowercase the verb that starts it, but not an acronym ("GIS").
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
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

/** A career's facts for its reason, trimmed until the reason is short enough to read at a glance. */
function reasonFacts(
  career: { title: string; description?: string | null; jobZone?: number | null },
  shared: Riasec[],
): ReasonFacts {
  const preparation = career.jobZone ? (PREPARATION[career.jobZone] ?? null) : null;
  let facts: ReasonFacts = { title: career.title, clause: careerClause(career.description), preparation, shared };
  const length = (f: ReasonFacts) => words(reasonWordings(f, 0)[0]).length;
  // First name one interest area instead of two, then shorten what the career involves.
  if (length(facts) > MAX_REASON_WORDS && shared.length > 1) facts = { ...facts, shared: shared.slice(0, 1) };
  // When there's no good shorter cut, a reason a few words over is better than a clause that says
  // too little.
  for (let max = MAX_CLAUSE_WORDS - 1; length(facts) > MAX_REASON_WORDS && max >= 3; max--) {
    const shorter = careerClause(career.description, max);
    if (!shorter) break;
    facts = { ...facts, clause: shorter };
  }
  return facts;
}

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
 * career involves. No two careers get the same reason.
 */
export function templateExplanation(areas: Record<Riasec, number>, careers: TemplateCareer[]): MatchExplanation {
  const pattern = interestPattern(areas);
  const used = new Set<string>();
  return {
    source: "template",
    overview: templateOverview(pattern),
    careers: careers.map((c, i) => {
      const shared = c.interests ? sharedAreas(pattern, areas, c.interests) : [];
      const wordings = reasonWordings(reasonFacts(c, shared), i);
      const why = wordings.find((w) => !used.has(w)) ?? wordings[wordings.length - 1];
      used.add(why);
      return { code: c.occupationCode, why };
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
 * The personality traits the model may be told about, as strengths. Never emotional stability
 * (the Mini-IPIP's neuroticism, shown to students as "Staying calm"): how a young person handles
 * stress says nothing about which careers fit them, and it's data the model doesn't need.
 */
export const EXPLAIN_TRAITS: readonly BigFive[] = BIG_FIVE.filter((t) => t !== "neuroticism");

/** What the model is told about the student's personality: the strengths wording they see. */
export function strengthFacts(traits: Record<BigFive, number>): string[] {
  return EXPLAIN_TRAITS.map((t) => displayTrait(t, traits[t])).map((t) => `${t.name}: ${t.text}`);
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

    const facts = {
      grade: ctx.grade,
      ...interestFacts(pattern, interests.scores.areas),
      strengths: personality ? strengthFacts(personality.scores.traits) : undefined,
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
