import type Anthropic from "@anthropic-ai/sdk";
import type * as z from "zod";

/**
 * Reads the JSON a structured-output request (`messages.create` with `output_config.format`)
 * returned. Returns null for a refusal, a response cut off at max_tokens, or text that isn't valid
 * JSON for the schema. Never throws: callers record the response's usage first, because a response
 * with no usable output is still billed.
 */
export function readStructuredOutput<T extends z.ZodType>(
  message: Pick<Anthropic.Beta.BetaMessage, "stop_reason" | "content">,
  schema: T,
): z.infer<T> | null {
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return null;
  const block = message.content.find((b) => b.type === "text");
  if (!block) return null;
  let json: unknown;
  try {
    json = JSON.parse(block.text);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}
