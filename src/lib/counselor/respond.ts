import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { safetyEvents } from "@/db/schema";
import { AiUnavailableError, getAnthropic } from "../ai/client";
import { modelFor, supportsEffort } from "../ai/models";
import { scrubPii } from "../ai/privacy";
import { assessMessage, screenWithRulesOnly } from "../ai/safety";
import { BudgetExceededError, assertWithinBudget, recordMessageUsage } from "../ai/usage";
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
export const RATE_LIMIT = { count: 20, windowMs: 10 * 60_000 };

export type CounselorEvent =
  | { type: "conversation"; id: string }
  | { type: "delta"; text: string }
  | { type: "support"; text: string }
  | { type: "notice"; text: string }
  | { type: "done"; messageId: string | null };

export type Student = { id: string; grade: number | null; displayName: string; username?: string | null };

type Deps = {
  client?: Anthropic;
  /** Extra student-scoped tools (course plan, roadmap). */
  extraTools?: ToolContext["extra"];
  now?: Date;
  /** Aborted when the client disconnects; stops generation. */
  signal?: AbortSignal;
};

export const NOTICES = {
  unavailable: "The counselor isn't available right now. Please try again a little later.",
  budget:
    "You've used this month's counselor chats. They'll be back next month. Your roadmap, plan, and career explorer still work in the meantime.",
  error: "Sorry, something went wrong on my end. Please try sending that again.",
  incomplete: "Sorry, I couldn't finish that answer. Please try asking again.",
  interrupted: "This reply was interrupted.",
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

type GenerationResult = {
  /** Text the student may keep (a refused attempt's text is excluded). */
  text: string;
  outcome: "ok" | "notice" | "refusal" | "incomplete" | "error" | "aborted";
  notice?: string;
};

/**
 * Where the model's view of the history starts. Moves in blocks of 10 rather than sliding every
 * turn, so the cached prompt prefix stays valid for several turns in a row.
 */
export function historyStart(length: number, limit = HISTORY_LIMIT): number {
  if (length <= limit) return 0;
  return Math.ceil((length - limit) / 10) * 10;
}

async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[counselor] ${label} failed`, error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/**
 * Handles one student message: stores it, screens it for safety while the counselor drafts a
 * reply, and only releases the reply once screening clears. High-risk messages get crisis
 * resources instead (sent before anything else can fail) and put the conversation in support mode.
 */
export async function* respond(
  db: Db,
  student: Student,
  input: { conversationId?: string; text: string },
  deps: Deps = {},
): AsyncGenerator<CounselorEvent> {
  const text = input.text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return;
  const knownNames = [student.displayName, student.username].filter((n): n is string => Boolean(n));

  // Rate limit first: a limited request makes no model calls and writes nothing, but a message
  // that plainly signals a crisis still gets help (keyword rules only).
  if (!(await consumeRateLimit(db, `counselor:${student.id}`, RATE_LIMIT.count, RATE_LIMIT.windowMs, deps.now))) {
    const screen = screenWithRulesOnly(text);
    if (screen.supportMessage) {
      yield { type: "support", text: screen.supportMessage };
      // Record it for human review, capped so this path can't be used to flood the queue.
      if (screen.category && (await consumeRateLimit(db, `safety-record:${student.id}`, 20, 24 * 60 * 60_000, deps.now))) {
        await safely("record rate-limited safety event", () =>
          db.insert(safetyEvents).values({
            userId: student.id,
            category: screen.category!,
            severity: screen.severity === "imminent" ? "imminent" : "high",
            sources: ["rules", "rate_limited"],
            excerpt: text.slice(0, 1000),
          }),
        );
      }
      yield { type: "done", messageId: null };
      return;
    }
    yield { type: "notice", text: NOTICES.rateLimited };
    yield { type: "done", messageId: null };
    return;
  }

  let conversation = input.conversationId ? await getOwnedConversation(db, student.id, input.conversationId) : null;
  if (input.conversationId && !conversation) throw new Error("Conversation not found");
  if (!conversation) conversation = await createConversation(db, student.id, text);
  yield { type: "conversation", id: conversation.id };

  const history = await listMessages(db, conversation.id);
  await appendMessage(db, conversation.id, { role: "user", content: text });

  const queue = new TextQueue();
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();
  deps.signal?.addEventListener("abort", onClientAbort);
  let settled = false;
  const generation = generate(conversation, history)
    .finally(() => {
      settled = true;
      queue.close();
    });

  try {
    const safety = await assessMessage(db, student.id, text, { client: deps.client, knownNames });

    if (safety.supportMessage) {
      abort.abort();
      // Crisis resources go out first; nothing below may keep them from the student.
      yield { type: "support", text: safety.supportMessage };
      await generation.catch(() => undefined);
      await safely("flag conversation", () => flagConversation(db, conversation.id));
      const id = await safely("store support message", () =>
        appendMessage(db, conversation.id, { role: "assistant", kind: "support", content: safety.supportMessage! }),
      );
      yield { type: "done", messageId: id };
      return;
    }

    for await (const delta of queue.drain()) yield { type: "delta", text: delta };
    const result = await generation;

    let messageId: string | null = null;
    if (result.text.trim()) {
      messageId = await appendMessage(db, conversation.id, { role: "assistant", content: result.text });
    }
    const notice =
      result.outcome === "ok"
        ? result.text.trim()
          ? null
          : NOTICES.error
        : result.outcome === "notice"
          ? result.notice!
          : result.outcome === "refusal"
            ? NOTICES.refusal
            : result.outcome === "incomplete"
              ? NOTICES.incomplete
              : result.outcome === "aborted"
                ? result.text.trim()
                  ? NOTICES.interrupted
                  : null
                : NOTICES.error;
    if (notice) {
      messageId = await appendMessage(db, conversation.id, { role: "assistant", kind: "notice", content: notice });
      yield { type: "notice", text: notice };
    }
    yield { type: "done", messageId };
  } finally {
    // If the consumer stops early (client gone, error), don't leave the model generating.
    if (!settled) abort.abort();
    deps.signal?.removeEventListener("abort", onClientAbort);
  }

  async function generate(
    conv: { id: string; concernFlagged: boolean },
    prior: Awaited<ReturnType<typeof listMessages>>,
  ): Promise<GenerationResult> {
    let client: Anthropic;
    try {
      await assertWithinBudget(db, student.id, deps.now);
      client = deps.client ?? getAnthropic();
    } catch (error) {
      const notice = error instanceof BudgetExceededError ? NOTICES.budget : error instanceof AiUnavailableError ? NOTICES.unavailable : NOTICES.error;
      return { text: "", outcome: "notice", notice };
    }

    const model = modelFor("counselor");
    const context = await buildStudentContext(db, student, { concernFlagged: conv.concernFlagged, now: deps.now, knownNames });
    const window = prior.filter((m) => m.kind !== "notice");
    const messages: Anthropic.Beta.BetaMessageParam[] = window
      .slice(historyStart(window.length))
      .map((m) => ({ role: m.role, content: m.role === "user" ? scrubPii(m.content, knownNames) : m.content }));
    messages.push({ role: "user", content: scrubPii(text, knownNames) });
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== "user") messages.shift();

    let kept = "";
    // Text streamed in the current iteration; kept if the stream breaks, since the student saw it.
    let inProgress = "";
    let lastStop: string | null = null;
    try {
      const runner = client.beta.messages.toolRunner(
        {
          model,
          max_tokens: 8000,
          max_iterations: 5,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          // Auto-caching covers the conversation; the explicit breakpoint keeps the tools and
          // standing instructions cached even when the student context changes.
          cache_control: { type: "ephemeral" },
          ...(supportsEffort(model) && { output_config: { effort: "medium" as const } }),
          system: [
            { type: "text", text: COUNSELOR_SYSTEM, cache_control: { type: "ephemeral" } },
            { type: "text", text: context },
          ],
          tools: counselorTools({ db, userId: student.id, grade: student.grade, extra: deps.extraTools }),
          messages,
          stream: true,
        },
        { signal: abort.signal },
      );
      for await (const stream of runner) {
        inProgress = "";
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            inProgress += event.delta.text;
            queue.push(event.delta.text);
          }
        }
        const message = await stream.finalMessage();
        lastStop = message.stop_reason;
        await safely("record usage", () => recordMessageUsage(db, student.id, "counselor", model, message));
        if (message.stop_reason === "refusal") return { text: kept, outcome: "refusal" };
        kept += inProgress;
        inProgress = "";
        if (message.stop_reason === "max_tokens") return { text: kept, outcome: "incomplete" };
        // Separate text written before and after a tool call.
        if (message.stop_reason === "tool_use" && kept && !/\s$/.test(kept)) {
          kept += "\n\n";
          queue.push("\n\n");
        }
      }
      // Ran out of iterations while still asking for tools: the answer never got written.
      if (lastStop === "tool_use") return { text: kept, outcome: "incomplete" };
      return { text: kept, outcome: "ok" };
    } catch (error) {
      if (abort.signal.aborted) return { text: kept + inProgress, outcome: "aborted" };
      console.error("[counselor] generation failed", error instanceof Anthropic.APIError ? `${error.status} ${error.name}` : error instanceof Error ? error.name : "unknown");
      return { text: kept + inProgress, outcome: "error" };
    }
  }
}
