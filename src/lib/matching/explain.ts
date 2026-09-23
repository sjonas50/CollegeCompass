import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type MatchExplanation, matchRuns, users } from "@/db/schema";
import { BIG_FIVE, RIASEC_INFO, type Riasec, WORK_VALUE_INFO } from "../assessments/instruments";
import { displayTrait } from "../assessments/descriptions";
import { latestResult } from "../assessments/service";
import { getAnthropic } from "../ai/client";
import { modelFor, supportsEffort } from "../ai/models";
import { toAiContext } from "../ai/privacy";
import { assertWithinBudget, recordUsage } from "../ai/usage";
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

async function buildContext(db: Db, userId: string) {
  const [student] = await db.select({ grade: users.grade }).from(users).where(eq(users.id, userId));
  const [interests, personality, values] = await Promise.all([
    latestResult(db, userId, "interests"),
    latestResult(db, userId, "personality"),
    latestResult(db, userId, "values"),
  ]);
  return { ctx: toAiContext({ grade: student?.grade ?? null }), interests, personality, values };
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

/** A specific, non-AI reason for every match, from the interest areas the career and student share. */
export function templateExplanation(
  code: string,
  careers: { occupationCode: string; interests?: Record<Riasec, number> }[],
): MatchExplanation {
  const studentTop = code.split("") as Riasec[];
  const names = studentTop.map((l) => RIASEC_INFO[l].name);
  return {
    source: "template",
    overview: `Your strongest interest areas are ${names.slice(0, 2).join(" and ")}, followed by ${names[2]}. The careers below share that mix. Explore a few that catch your eye — you're not choosing forever, just finding a direction for now.`,
    careers: careers.map((c) => {
      if (!c.interests) return { code: c.occupationCode, why: `Shares your ${names[0].toLowerCase()} interests.` };
      const [a1, a2] = topAreas(c.interests);
      const shared = [a1, a2].filter((a) => studentTop.includes(a)).map((a) => RIASEC_INFO[a].name.toLowerCase());
      const why = shared.length
        ? `Combines ${AREA_PHRASE[a1]} and ${AREA_PHRASE[a2]}, which lines up with your ${shared.join(" and ")} interests.`
        : `Centers on ${AREA_PHRASE[a1]} — a different side of your interests to explore.`;
      return { code: c.occupationCode, why };
    }),
  };
}

/**
 * Returns the explanation for the student's latest matches, writing it with the model the first
 * time. Falls back to a template (not stored) if AI is unavailable, over budget, or declines.
 */
export async function explainLatestMatches(db: Db, userId: string, opts: Options = {}): Promise<MatchExplanation | null> {
  const run = await latestMatchRun(db, userId);
  if (!run) return null;
  if (run.explanation) return run.explanation;

  const { ctx, interests, personality, values } = await buildContext(db, userId);
  if (!interests) return null;
  const careers = run.matches;
  const profiles = new Map((await loadOccupationProfiles(db)).map((p) => [p.code, p.interests]));
  const fallback = templateExplanation(
    interests.scores.code,
    run.matches.map((m) => ({ occupationCode: m.occupationCode, interests: profiles.get(m.occupationCode) })),
  );

  try {
    await assertWithinBudget(db, userId, opts.now);
    const client = opts.client ?? getAnthropic();
    const model = modelFor("explain");

    const facts = {
      grade: ctx.grade,
      interestCode: interests.scores.code,
      topInterests: interests.scores.code.split("").map((l) => ({
        area: RIASEC_INFO[l as Riasec].name,
        meaning: RIASEC_INFO[l as Riasec].description,
      })),
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

    const message = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { ...(supportsEffort(model) && { effort: "low" as const }), format: betaZodOutputFormat(Explanation) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Explain these results to the student:\n${JSON.stringify(facts, null, 2)}` }],
    });
    await recordUsage(db, userId, "explain", model, message.usage);
    const parsed = message.stop_reason === "refusal" ? null : message.parsed_output;
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
