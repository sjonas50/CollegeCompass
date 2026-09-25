import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type MatchExplanation, matchRuns, users } from "@/db/schema";
import { BIG_FIVE, RIASEC_INFO, type Riasec, WORK_VALUE_INFO } from "../assessments/instruments";
import { displayTrait } from "../assessments/descriptions";
import {
  type InterestPattern,
  areaNames,
  interestPattern,
  noAreaStandsOut,
  noLeadReason,
  strongAreas,
  tiedAreasText,
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

const AREA_PHRASE: Record<Riasec, string> = {
  R: "hands-on work",
  I: "figuring things out",
  A: "creating things",
  S: "helping people",
  E: "leading and persuading",
  C: "organizing and keeping things running",
};

function topAreas(interests: Record<Riasec, number>) {
  return (Object.keys(interests) as Riasec[]).sort((a, b) => interests[b] - interests[a]).slice(0, 2);
}

const EXPLORE = "Explore a few that catch your eye — you're not choosing forever, just finding a direction for now.";

/** The template's first sentences: only what the scores support, so a tie is never called a lead. */
function templateOverview(pattern: InterestPattern): string {
  if (noAreaStandsOut(pattern)) {
    return `You ${noLeadReason(pattern)}, so no area stands out yet. That's okay. The careers below are a starting point, so explore widely — you're not choosing forever, just finding a direction for now.`;
  }
  if (pattern.kind === "tied") return `${tiedAreasText(pattern)} The careers below share that mix. ${EXPLORE}`;
  const top = pattern.code.split("") as Riasec[];
  const lead = pattern.ties.length
    ? `Your strongest interest areas are ${areaNames(top)}. ${areaNames(pattern.ties[0])} are tied.`
    : `Your strongest interest areas are ${areaNames(top.slice(0, 2))}, followed by ${areaNames(top.slice(2))}.`;
  return `${lead} The careers below share that mix. ${EXPLORE}`;
}

/**
 * A specific, non-AI reason for every match, from the interest areas the career and student share.
 * When no area stands out (see noAreaStandsOut) no area is the student's more than another, so
 * reasons only say what the career involves.
 */
export function templateExplanation(
  areas: Record<Riasec, number>,
  careers: { occupationCode: string; interests?: Record<Riasec, number> }[],
): MatchExplanation {
  const pattern = interestPattern(areas);
  const studentTop = strongAreas(pattern);
  return {
    source: "template",
    overview: templateOverview(pattern),
    careers: careers.map((c) => {
      if (!c.interests) {
        const why = studentTop.length
          ? `Shares your ${RIASEC_INFO[studentTop[0]].name.toLowerCase()} interests.`
          : "Worth a look while you explore.";
        return { code: c.occupationCode, why };
      }
      const [a1, a2] = topAreas(c.interests);
      if (noAreaStandsOut(pattern)) return { code: c.occupationCode, why: `Combines ${AREA_PHRASE[a1]} and ${AREA_PHRASE[a2]}.` };
      const shared = [a1, a2].filter((a) => studentTop.includes(a)).map((a) => RIASEC_INFO[a].name.toLowerCase());
      const why = shared.length
        ? `Combines ${AREA_PHRASE[a1]} and ${AREA_PHRASE[a2]}, which lines up with your ${shared.join(" and ")} interests.`
        : `Centers on ${AREA_PHRASE[a1]} — a different side of your interests to explore.`;
      return { code: c.occupationCode, why };
    }),
  };
}

/**
 * What the model is told about the student's interests: only what the scores support (see
 * interestPattern). The code only when there is a clear one, the areas above a tie as the top
 * interests (never areas picked from a tie in RIASEC order), and any tie as a plain fact.
 */
export function interestFacts(pattern: Extract<InterestPattern, { kind: "code" | "tied" }>) {
  const topInterests = strongAreas(pattern).map((a) => ({ area: RIASEC_INFO[a].name, meaning: RIASEC_INFO[a].description }));
  if (pattern.kind === "code") {
    const tie = pattern.ties.at(0);
    const tiedAreas = tie && `${areaNames(tie)} are tied, so their order doesn't matter.`;
    return { interestCode: pattern.code, topInterests, ...(tiedAreas && { tiedAreas }) };
  }
  const { standOut, tied } = pattern;
  const tiedAreas = standOut.length
    ? `${areaNames(tied)} are tied below the top interests.`
    : `${areaNames(tied)} are tied for the top interest.`;
  return { topInterests, tiedAreas };
}

/**
 * Returns the explanation for the student's latest matches, writing it with the model the first
 * time. Falls back to a template (not stored) if AI is unavailable, over budget, or declines. When
 * no interest area stands out the student always gets the template, even over an explanation stored
 * before this rule: there are no top interests to explain the matches with.
 */
export async function explainLatestMatches(db: Db, userId: string, opts: Options = {}): Promise<MatchExplanation | null> {
  const run = await latestMatchRun(db, userId);
  if (!run) return null;
  const interests = await latestResult(db, userId, "interests");
  if (!interests) return run.explanation;
  const pattern = interestPattern(interests.scores.areas);
  if (run.explanation && !noAreaStandsOut(pattern)) return run.explanation;

  const careers = run.matches;
  const profiles = new Map((await loadOccupationProfiles(db)).map((p) => [p.code, p.interests]));
  const fallback = templateExplanation(
    interests.scores.areas,
    run.matches.map((m) => ({ occupationCode: m.occupationCode, interests: profiles.get(m.occupationCode) })),
  );
  if (noAreaStandsOut(pattern)) return fallback;
  const { ctx, personality, values } = await buildContext(db, userId);

  try {
    await assertWithinBudget(db, userId, opts.now);
    const client = opts.client ?? getAnthropic();
    const model = modelFor("explain");

    const facts = {
      grade: ctx.grade,
      ...interestFacts(pattern),
      strengths: personality
        ? BIG_FIVE.map((t) => displayTrait(t, personality.scores.traits[t])).map((t) => `${t.name}: ${t.text}`)
        : undefined,
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
