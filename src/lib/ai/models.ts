import { env } from "@/env";

export type AiFeature = "safety" | "counselor" | "explain";

/** Model per feature, overridable by env so evals can compare models without code changes. */
export function modelFor(feature: AiFeature): string {
  const e = env();
  // Match explanations are counselor-voiced, so they share its model.
  return feature === "safety" ? e.AI_MODEL_SAFETY : e.AI_MODEL_COUNSELOR;
}

// US dollars per million tokens (input, output). Update when pricing changes.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
// Unknown models are costed at the most expensive rate so budgets fail safe.
const FALLBACK_PRICE = { input: 10, output: 50 };

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** Cost in millionths of a dollar. Cache writes bill at 1.25× input, cache reads at 0.1×. */
export function costMicros(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  const inputEquivalent =
    usage.input_tokens +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0);
  return Math.ceil(inputEquivalent * price.input + usage.output_tokens * price.output);
}

/** Haiku 4.5 rejects `output_config.effort`; newer models accept it. */
export function supportsEffort(model: string): boolean {
  return !model.startsWith("claude-haiku-4");
}
