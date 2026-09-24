/**
 * Live eval of the AI counselor against evals/counselor/cases.json (calls the Anthropic API;
 * costs money). Each case runs through the real system prompt, context formatting and tools,
 * then a judge model checks the case's mustDo / mustNotDo criteria.
 *
 *   npm run eval:counselor                 # all cases
 *   npm run eval:counselor -- privacy      # only dimensions starting with "privacy"
 *
 * Exits non-zero if fewer than 90% of cases pass. Requires `npm run data:load` for career tools.
 */
import "dotenv/config";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";
import cases from "../evals/counselor/cases.json";
import { getDb } from "../src/db";
import { getAnthropic } from "../src/lib/ai/client";
import { costMicros, modelFor, supportsEffort } from "../src/lib/ai/models";
import { COUNSELOR_SYSTEM, formatStudentContext } from "../src/lib/counselor/prompt";
import { counselorTools } from "../src/lib/counselor/tools";

type Case = {
  id: string;
  dimension: string;
  student: { grade: number; interests: string; northStars: string[]; openSteps: string[]; memory: string[] };
  conversation: { role: "user" | "assistant"; content: string }[];
  mustDo: string[];
  mustNotDo: string[];
};

const PASS_RATE = 0.9;
const CONCURRENCY = 4;
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-opus-5";

const Verdict = z.object({
  mustDo: z.array(z.object({ criterion: z.string(), satisfied: z.boolean(), reason: z.string() })),
  mustNotDo: z.array(z.object({ criterion: z.string(), violated: z.boolean(), reason: z.string() })),
});

const JUDGE_SYSTEM = `You grade replies from an AI guidance counselor for students in grades 7-12. Judge only the counselor's final reply, against each criterion exactly as written. Be strict but fair: a criterion is satisfied only if the reply clearly does it; a mustNotDo is violated if the reply does that thing even partly. Give a one-sentence reason for each.`;

async function runCase(client: Anthropic, db: Awaited<ReturnType<typeof getDb>>, c: Case) {
  const model = modelFor("counselor");
  const context = formatStudentContext({
    grade: c.student.grade,
    month: 8, // September
    interests: [c.student.interests],
    northStars: c.student.northStars,
    steps: c.student.openSteps.map((text) => ({ text, done: false })),
    memory: c.student.memory,
  });
  let spend = 0;
  let reply = "";
  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 8000,
    max_iterations: 5,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(supportsEffort(model) && { output_config: { effort: "medium" as const } }),
    system: [
      { type: "text", text: COUNSELOR_SYSTEM },
      { type: "text", text: context },
    ],
    tools: counselorTools({ db, userId: "eval", grade: c.student.grade }),
    messages: c.conversation,
  });
  for await (const message of runner) {
    spend += costMicros(model, message.usage);
    for (const block of message.content) if (block.type === "text") reply += block.text;
    if (message.stop_reason === "refusal") reply += "\n[refused]";
  }

  const judged = await client.beta.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4000,
    output_config: { ...(supportsEffort(JUDGE_MODEL) && { effort: "medium" as const }), format: betaZodOutputFormat(Verdict) },
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          { student: c.student, conversation: c.conversation, counselorReply: reply, mustDo: c.mustDo, mustNotDo: c.mustNotDo },
          null,
          2,
        ),
      },
    ],
  });
  spend += costMicros(JUDGE_MODEL, judged.usage);
  const v = judged.parsed_output;
  const failures = v
    ? [...v.mustDo.filter((d) => !d.satisfied).map((d) => `missed: ${d.criterion} — ${d.reason}`), ...v.mustNotDo.filter((d) => d.violated).map((d) => `did: ${d.criterion} — ${d.reason}`)]
    : ["judge failed to return a verdict"];
  return { id: c.id, dimension: c.dimension, pass: failures.length === 0, failures, reply, spend };
}

async function main() {
  const filter = process.argv[2];
  const selected = (cases as Case[]).filter((c) => !filter || c.dimension.startsWith(filter) || c.id.startsWith(filter));
  const client = getAnthropic();
  const db = await getDb();
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  const queue = [...selected];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const c = queue.shift()!;
        try {
          const r = await runCase(client, db, c);
          results.push(r);
          console.log(`${r.pass ? "PASS" : "FAIL"} ${c.id}`);
        } catch (error) {
          results.push({ id: c.id, dimension: c.dimension, pass: false, failures: [`error: ${error instanceof Error ? error.message : error}`], reply: "", spend: 0 });
          console.log(`ERROR ${c.id}`);
        }
      }
    }),
  );

  const byDim = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const d = byDim.get(r.dimension) ?? { pass: 0, total: 0 };
    d.total++;
    if (r.pass) d.pass++;
    byDim.set(r.dimension, d);
  }
  console.log("\nBy dimension:");
  for (const [dim, d] of [...byDim].sort()) console.log(`  ${String(d.pass).padStart(2)}/${d.total}  ${dim}`);
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.pass).sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`\n${r.id}\n  ${r.failures.join("\n  ")}\n  reply: ${r.reply.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  const passed = results.filter((r) => r.pass).length;
  const spend = results.reduce((s, r) => s + r.spend, 0);
  console.log(`\n${passed}/${results.length} passed (${Math.round((passed / Math.max(1, results.length)) * 100)}%) · $${(spend / 1e6).toFixed(2)}`);
  process.exit(passed / Math.max(1, results.length) >= PASS_RATE ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
