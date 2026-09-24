import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { AiUnavailableError, getAnthropic } from "../ai/client";
import { modelFor, supportsEffort } from "../ai/models";
import { scrubPii } from "../ai/privacy";
import { assessMessage } from "../ai/safety";
import { BudgetExceededError, assertWithinBudget, recordUsage } from "../ai/usage";
import { consumeRateLimit } from "../rate-limit";
import {
  HISTORY_LIMIT,
  appendMessage,
  createConversation,
  flagConversation,
  getOwnedConversation,
  listMessages,
} from "./conversations";
import { COUNSELOR_SYSTEM, buildStudentContext } from "./prompt";
import { type ToolContext, counselorTools } from "./tools";

export const MAX_MESSAGE_CHARS = 2000;

export type CounselorEvent =
  | { type: "conversation"; id: string }
  | { type: "delta"; text: string }
  | { type: "support"; text: string }
  | { type: "notice"; text: string }
  | { type: "done"; messageId: string | null };

export type Student = { id: string; grade: number | null; displayName: string };

type Deps = {
  client?: Anthropic;
  /** Extra student-scoped tools (course plan, roadmap). */
  extraTools?: ToolContext["extra"];
  now?: Date;
};

export const NOTICES = {
  unavailable: "The counselor isn't available right now. Please try again a little later.",
  budget:
    "You've used this month's counselor chats. They'll be back next month. Your roadmap, plan, and career explorer still work in the meantime.",
  error: "Sorry, something went wrong on my end. Please try sending that again.",
  refusal: "I can't help with that one, but I'm happy to talk about school, careers, college, or training.",
  rateLimited: "That's a lot of messages in a short time. Take a quick break and try again in a few minutes.",
};

/** A small push/pull queue so generated text can be held back until safety screening clears. */
class TextQueue {
  private items: string[] = [];
  private waiting: ((r: IteratorResult<string>) => void) | null = null;
  private closed = false;
  push(text: string) {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: text, done: false });
    } else this.items.push(text);
  }
  close() {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }
  async *drain() {
    while (true) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<string>>((resolve) => (this.waiting = resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

type GenerationResult = { text: string; outcome: "ok" | "notice" | "refusal" | "error" | "aborted" };

/**
 * Handles one student message: stores it, screens it for safety while the counselor drafts a
 * reply, and only releases the reply once screening clears. High-risk messages get crisis
 * resources instead and put the conversation in support mode.
 */
export async function* respond(
  db: Db,
  student: Student,
  input: { conversationId?: string; text: string },
  deps: Deps = {},
): AsyncGenerator<CounselorEvent> {
  const text = input.text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return;

  let conversation = input.conversationId ? await getOwnedConversation(db, student.id, input.conversationId) : null;
  if (input.conversationId && !conversation) throw new Error("Conversation not found");
  if (!conversation) conversation = await createConversation(db, student.id, text);
  yield { type: "conversation", id: conversation.id };

  const history = await listMessages(db, conversation.id);
  await appendMessage(db, conversation.id, { role: "user", content: text });

  if (!(await consumeRateLimit(db, `counselor:${student.id}`, 20, 10 * 60_000, deps.now))) {
    // Still screen it: a student in crisis must get help even when rate-limited.
    const safety = await assessMessage(db, student.id, text, { client: deps.client, knownNames: [student.displayName] });
    if (safety.supportMessage) {
      await flagConversation(db, conversation.id);
      const id = await appendMessage(db, conversation.id, { role: "assistant", kind: "support", content: safety.supportMessage });
      yield { type: "support", text: safety.supportMessage };
      yield { type: "done", messageId: id };
      return;
    }
    yield { type: "notice", text: NOTICES.rateLimited };
    yield { type: "done", messageId: null };
    return;
  }

  const knownNames = [student.displayName];
  const queue = new TextQueue();
  const abort = new AbortController();
  const generation = generate(db, student, conversation, history, text, queue, abort.signal, deps).finally(() => queue.close());
  const safety = await assessMessage(db, student.id, text, { client: deps.client, knownNames });

  if (safety.supportMessage) {
    abort.abort();
    await generation.catch(() => undefined);
    await flagConversation(db, conversation.id);
    const id = await appendMessage(db, conversation.id, { role: "assistant", kind: "support", content: safety.supportMessage });
    yield { type: "support", text: safety.supportMessage };
    yield { type: "done", messageId: id };
    return;
  }

  for await (const delta of queue.drain()) yield { type: "delta", text: delta };
  const result = await generation;

  if (result.outcome === "notice") {
    const id = await appendMessage(db, conversation.id, { role: "assistant", kind: "notice", content: result.text });
    yield { type: "notice", text: result.text };
    yield { type: "done", messageId: id };
    return;
  }
  if (result.outcome !== "ok" || !result.text.trim()) {
    const notice =
      result.outcome === "refusal" ? NOTICES.refusal : result.text.trim() ? null : NOTICES.error;
    let messageId: string | null = null;
    if (result.text.trim()) messageId = await appendMessage(db, conversation.id, { role: "assistant", content: result.text });
    if (notice) {
      messageId = await appendMessage(db, conversation.id, { role: "assistant", kind: "notice", content: notice });
      yield { type: "notice", text: notice };
    }
    yield { type: "done", messageId };
    return;
  }
  const messageId = await appendMessage(db, conversation.id, { role: "assistant", content: result.text });
  yield { type: "done", messageId };

  async function generate(
    db: Db,
    student: Student,
    conv: { id: string; concernFlagged: boolean },
    prior: Awaited<ReturnType<typeof listMessages>>,
    latest: string,
    out: TextQueue,
    signal: AbortSignal,
    deps: Deps,
  ): Promise<GenerationResult> {
    let client: Anthropic;
    try {
      await assertWithinBudget(db, student.id, deps.now);
      client = deps.client ?? getAnthropic();
    } catch (error) {
      const notice = error instanceof BudgetExceededError ? NOTICES.budget : error instanceof AiUnavailableError ? NOTICES.unavailable : NOTICES.error;
      return { text: notice, outcome: "notice" };
    }

    const model = modelFor("counselor");
    const context = await buildStudentContext(db, student, { concernFlagged: conv.concernFlagged, now: deps.now });
    const messages: Anthropic.Beta.BetaMessageParam[] = prior
      .slice(-HISTORY_LIMIT)
      .filter((m) => m.kind !== "notice")
      .map((m) => ({ role: m.role, content: m.role === "user" ? scrubPii(m.content, knownNames) : m.content }));
    messages.push({ role: "user", content: scrubPii(latest, knownNames) });
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== "user") messages.shift();

    let text = "";
    try {
      const runner = client.beta.messages.toolRunner(
        {
          model,
          max_tokens: 8000,
          max_iterations: 5,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          cache_control: { type: "ephemeral" },
          ...(supportsEffort(model) && { output_config: { effort: "medium" as const } }),
          system: [
            { type: "text", text: COUNSELOR_SYSTEM },
            { type: "text", text: context },
          ],
          tools: counselorTools({ db, userId: student.id, grade: student.grade, extra: deps.extraTools }),
          messages,
          stream: true,
        },
        { signal },
      );
      for await (const stream of runner) {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            text += event.delta.text;
            out.push(event.delta.text);
          }
        }
        const message = await stream.finalMessage();
        await recordUsage(db, student.id, "counselor", model, message.usage);
        if (message.stop_reason === "refusal") return { text, outcome: "refusal" };
        if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
          return { text, outcome: "error" };
        }
        // Separate text written before and after a tool call.
        if (text && !/\s$/.test(text) && message.stop_reason === "tool_use") {
          text += "\n\n";
          out.push("\n\n");
        }
      }
      return { text, outcome: "ok" };
    } catch (error) {
      if (signal.aborted) return { text, outcome: "aborted" };
      console.error("[counselor] generation failed", error instanceof Anthropic.APIError ? `${error.status} ${error.name}` : error instanceof Error ? error.name : "unknown");
      return { text, outcome: "error" };
    }
  }
}
