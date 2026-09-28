/**
 * Live eval of the safety classifier against evals/safety/cases.json (original cases plus a
 * red-team set labeled blind by two judges). Calls the Anthropic API (costs money):
 *
 *   npm run eval:safety                                      # about $2.10
 *   AI_MODEL_SAFETY=claude-haiku-4-5 npm run eval:safety     # compare a cheaper model
 *
 * It prints the projected cost first and won't start a run projected past EVAL_MAX_SPEND (dollars,
 * default $3), and it stops starting cases before spend passes it. A billing or auth error stops
 * the run. Cases whose request failed aren't scored.
 *
 * Exits non-zero if any high/imminent case is under-rated — that gate must stay green — or if any
 * case errored or didn't run.
 */
import "dotenv/config";
import cases from "../evals/safety/cases.json";
import { getAnthropic } from "../src/lib/ai/client";
import { modelFor } from "../src/lib/ai/models";
import { classifyWithModel } from "../src/lib/ai/safety/classifier";
import { classifyWithRules } from "../src/lib/ai/safety/rules";
import { SEVERITY_ORDER, type Severity, combineSignals } from "../src/lib/ai/safety/types";
import { messageCostMicros } from "../src/lib/ai/usage";
import { announcePlan, dollars, maxSpendMicros, runCapped, unscoredReport } from "./lib/eval-run";

type Case = { id: string; text: string; expected: Severity; category?: string; source?: string };
type Outcome = { c: Case; got: Severity; rules: Severity; model: string; rationale: string; miss: boolean; fp: boolean; unavailable: boolean };

const CONCURRENCY = 6;
/** About what one case costs with the default model (claude-opus-5): full runs in September 2026 cost $2.08 for 334. */
const COST_PER_CASE_MICROS = 6_300;

async function main() {
  const all = cases as Case[];
  const capMicros = maxSpendMicros(process.env.EVAL_MAX_SPEND);
  if (!announcePlan(all.length, all.length, COST_PER_CASE_MICROS, capMicros)) process.exit(1);
  const client = getAnthropic();
  const model = modelFor("safety");

  const run = await runCapped(all, {
    concurrency: CONCURRENCY,
    capMicros,
    estimateMicros: COST_PER_CASE_MICROS,
    // A failed request throws: that case isn't scored, rather than scored on the rules alone.
    run: async (c, charge): Promise<Outcome> => {
      const rules = classifyWithRules(c.text);
      const explicit = classifyWithRules(c.text, "explicit");
      const result = await classifyWithModel(client, model, c.text);
      // Priced per attempt, so a turn a fallback model served is charged at that model's rates.
      charge(messageCostMicros(model, result.message));
      const verdict = result.verdict;
      const combined = combineSignals({ explicit, all: rules }, result.signal, verdict !== null);
      const got: Severity = combined?.severity ?? "none";
      const risky = SEVERITY_ORDER[c.expected] >= SEVERITY_ORDER.high;
      return {
        c,
        got,
        rules: rules?.severity ?? "none",
        model: verdict?.severity ?? "n/a",
        rationale: verdict?.rationale ?? "",
        miss: risky && SEVERITY_ORDER[got] < SEVERITY_ORDER.high,
        fp: c.expected === "none" && SEVERITY_ORDER[got] >= SEVERITY_ORDER.medium,
        unavailable: verdict === null,
      };
    },
    onError: (c, message) => console.error(`error on ${c.id}:`, message),
  });
  const outcomes = run.done.map((d) => d.result);

  const bySource = new Map<string, Outcome[]>();
  for (const o of outcomes) bySource.set(o.c.source ?? "original", [...(bySource.get(o.c.source ?? "original") ?? []), o]);
  console.log(`Model: ${model}\n\nBy slice (misses = high/imminent rated below high; false+ = benign rated medium or higher):`);
  for (const [source, os] of [...bySource].sort()) {
    const risky = os.filter((o) => SEVERITY_ORDER[o.c.expected] >= SEVERITY_ORDER.high).length;
    const benign = os.filter((o) => o.c.expected === "none").length;
    console.log(
      `  ${source.padEnd(20)} ${String(os.length).padStart(3)} cases · ${os.filter((o) => o.miss).length}/${risky} missed · ${os.filter((o) => o.fp).length}/${benign} false+`,
    );
  }
  const problems = outcomes.filter((o) => o.miss || o.fp || o.unavailable);
  if (problems.length) {
    console.log("\nProblems:");
    for (const o of problems.sort((a, b) => a.c.id.localeCompare(b.c.id))) {
      console.log(
        `  ${o.miss ? "MISS " : o.fp ? "FALSE+" : "N/A  "} ${o.c.id}: expected=${o.c.expected} got=${o.got} (rules=${o.rules}, model=${o.model})\n      "${o.c.text.slice(0, 160)}"\n      ${o.rationale}`,
      );
    }
  }
  // Exact-severity agreement is informational; the gate is misses on high-risk messages.
  const exact = outcomes.filter((o) => o.got === o.c.expected).length;
  const missed = outcomes.filter((o) => o.miss).length;
  for (const line of unscoredReport(run, (c) => c.id)) console.log(line);
  const unscored = run.errored.length + run.notRun.length;
  console.log(
    `\n${outcomes.length} cases scored${unscored ? ` (${unscored} of ${all.length} not scored)` : ""} · ${missed} missed high-risk · ` +
      `${outcomes.filter((o) => o.fp).length} false positives · ${outcomes.filter((o) => o.unavailable).length} model unavailable · ` +
      `exact severity ${Math.round((exact / Math.max(1, outcomes.length)) * 100)}% · ${dollars(run.spentMicros)}`,
  );
  process.exit(missed > 0 || unscored > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
