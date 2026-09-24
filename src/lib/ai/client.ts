import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

export class AiUnavailableError extends Error {
  constructor(message = "AI is not configured") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiUnavailableError();
  client ??= new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}
