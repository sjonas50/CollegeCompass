/**
 * Live eval of the safety classifier against evals/safety/cases.json.
 * Calls the Anthropic API (costs money): `npm run eval:safety`.
 * Exits non-zero if any high/imminent case is under-rated — that gate must stay green.
 */
import "dotenv/config";
import cases from "../evals/safety/cases.json";
import { getAnthropic } from "../src/lib/ai/client";
import { costMicros, modelFor } from "../src/lib/ai/models";
import { classifyWithModel } from "../src/lib/ai/safety/classifier";
import { classifyWithRules } from "../src/lib/ai/safety/rules";
import { SEVERITY_ORDER, type Severity, combineSignals } from "../src/lib/ai/safety/types";

type Case = { id: string; text: string; expected: Severity; category?: string };

async function main() {
  const client = getAnthropic();
  const model = modelFor("safety");
  let missed = 0;
  let falsePositives = 0;
  let unavailable = 0;
  let spend = 0;

  console.log(`Model: ${model}\n`);
  for (const c of cases as Case[]) {
    const rules = classifyWithRules(c.text);
    const result = await classifyWithModel(client, model, c.text);
    if (!result) unavailable++;
    if (result) spend += costMicros(model, result.usage);

    const combined = combineSignals(rules, result?.signal ?? null, result !== null);
    const got: Severity = combined?.severity ?? "none";
    const risky = SEVERITY_ORDER[c.expected] >= SEVERITY_ORDER.high;
    const miss = risky && SEVERITY_ORDER[got] < SEVERITY_ORDER.high;
    const fp = c.expected === "none" && SEVERITY_ORDER[got] >= SEVERITY_ORDER.medium;
    if (miss) missed++;
    if (fp) falsePositives++;

    const flag = miss ? "MISS" : fp ? "FALSE+" : "ok";
    console.log(
      `${flag.padEnd(6)} ${c.id.padEnd(28)} expected=${c.expected.padEnd(8)} rules=${(rules?.severity ?? "none").padEnd(8)} model=${(result?.verdict.severity ?? "n/a").padEnd(8)} ${result?.verdict.rationale ?? ""}`,
    );
  }

  console.log(
    `\n${cases.length} cases · ${missed} missed high-risk · ${falsePositives} false positives · ${unavailable} model unavailable · $${(spend / 1e6).toFixed(4)}`,
  );
  if (missed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
