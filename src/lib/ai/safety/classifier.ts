import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";
import { type TokenUsage, supportsEffort } from "../models";
import type { SafetySignal } from "./types";

const ModelVerdict = z.object({
  category: z.enum([
    "none", "self_harm", "abuse", "violence", "sexual_content", "eating_disorder", "substance_use", "bullying", "distress",
  ]),
  severity: z.enum(["none", "low", "medium", "high", "imminent"]),
  rationale: z.string().describe("One short sentence explaining the rating."),
});
export type ModelVerdict = z.infer<typeof ModelVerdict>;

const SYSTEM = `You screen messages that students aged 12–18 send to College Compass, an AI guidance counselor for college and career planning. Your only job is to rate the safety risk in the student's message so a caring response and a human reviewer can follow up.

Categories: self_harm (suicide, self-injury), abuse (being hurt, neglected, or sexually abused by anyone), violence (threats or plans to hurt others), sexual_content (sexual content involving the student or requests for it), eating_disorder, substance_use, bullying, distress (hopelessness, overwhelming stress, loneliness), or none.

Severity:
- imminent: a stated plan, means, or timeframe to seriously hurt themselves or someone else, or being in danger right now.
- high: clear thoughts of suicide or self-harm, disclosure of abuse, or a real threat toward others.
- medium: concerning but indirect signals (e.g. passive wishes to disappear, not eating, being bullied, risky substance use).
- low: ordinary stress or sadness worth a gentle check-in.
- none: no risk.

Rate the student's own situation, not the topic. Schoolwork, research, or career interest in hard subjects (a history essay on war, wanting to be a suicide-prevention counselor or ER nurse) is none. Common idioms ("this test is killing me", "I'd die for a day off") are none. When unsure between two severities, choose the higher one: a human reviews every flagged message.`;

type ParseClient = Pick<Anthropic, "beta">;

export type ModelClassification = { signal: SafetySignal | null; verdict: ModelVerdict; usage: TokenUsage };

/**
 * Asks the model to rate a message. Returns null when the model declines or returns nothing,
 * so the caller can fall back to the rules tier and flag the gap.
 */
export async function classifyWithModel(
  client: ParseClient,
  model: string,
  text: string,
): Promise<ModelClassification | null> {
  const message = await client.beta.messages.parse({
    model,
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { ...(supportsEffort(model) && { effort: "low" as const }), format: betaZodOutputFormat(ModelVerdict) },
    system: SYSTEM,
    messages: [{ role: "user", content: `<student_message>\n${text}\n</student_message>` }],
  });
  const verdict = message.stop_reason === "refusal" ? null : message.parsed_output;
  if (!verdict) return null;

  const signal: SafetySignal | null =
    verdict.category === "none" || verdict.severity === "none"
      ? null
      : { category: verdict.category, severity: verdict.severity };
  return { signal, verdict, usage: message.usage };
}
