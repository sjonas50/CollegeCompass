import Anthropic from "@anthropic-ai/sdk";

/** The parts of a Messages API response a test controls; the rest gets defaults. */
export type StubResponse = {
  stop_reason?: string;
  text?: string;
  model?: string;
  usage?: Record<string, unknown>;
};

type StubRequest = { model: string; system?: string; messages: { content: string }[]; output_config?: unknown };

/**
 * A real SDK client whose HTTP calls return canned Messages API responses, so tests exercise the
 * SDK's own request building and response handling. `respond` gets each request body in turn.
 */
export function stubAnthropic(respond: (body: StubRequest, index: number) => StubResponse) {
  const requests: StubRequest[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as StubRequest;
      requests.push(body);
      const r = respond(body, requests.length - 1);
      const message = {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: r.model ?? body.model,
        content: r.text === undefined ? [] : [{ type: "text", text: r.text }],
        stop_reason: r.stop_reason ?? "end_turn",
        stop_sequence: null,
        usage: r.usage ?? { input_tokens: 100, output_tokens: 20 },
      };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { client, requests };
}

/**
 * Usage for a turn where the requested model declined partway and a fallback model finished it:
 * 1000 in / 400 out on the declined attempt, 1000 in / 200 out on the fallback.
 */
export function fallbackUsage(declined: string, fallback: string) {
  return {
    input_tokens: 1000,
    output_tokens: 200,
    iterations: [
      { type: "message", model: declined, input_tokens: 1000, output_tokens: 400 },
      { type: "fallback_message", model: fallback, input_tokens: 1000, output_tokens: 200 },
    ],
  };
}
