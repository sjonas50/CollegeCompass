"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "support" | "notice";
  content: string;
  pending?: boolean;
};

const STARTERS = [
  "What careers might fit my interests?",
  "What classes should I think about for next year?",
  "How does paying for college or training work?",
  "I'm not sure what I want to do yet.",
];

const MAX_CHARS = 2000;

/** Renders model text as plain paragraphs and "- " lists. Never as HTML. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="my-2 list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">
            {block}
          </p>
        );
      })}
    </>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-accent-foreground">
        <p className="whitespace-pre-wrap">{m.content}</p>
      </div>
    );
  }
  if (m.kind === "support") {
    return (
      <div className="max-w-[95%] rounded-2xl border-2 border-danger bg-danger-soft px-4 py-3">
        <p className="mb-1 font-medium">You deserve support right now</p>
        <RichText text={m.content} />
        <p className="mt-2 text-sm">
          <a href="tel:988" className="font-medium underline">Call 988</a> ·{" "}
          <a href="sms:988" className="font-medium underline">Text 988</a> ·{" "}
          <a href="https://988lifeline.org/chat/" target="_blank" rel="noopener noreferrer" className="font-medium underline">Chat online</a>
        </p>
      </div>
    );
  }
  if (m.kind === "notice") {
    return <p className="max-w-[85%] text-sm italic text-muted">{m.content}</p>;
  }
  return (
    <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2">
      {m.pending && !m.content ? <span className="animate-pulse text-muted">Thinking…</span> : <RichText text={m.content} />}
    </div>
  );
}

export function Chat({ conversationId: initialId, initialMessages }: { conversationId?: string; initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [conversationId, setConversationId] = useState(initialId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput("");
    const replyId = `pending-${messages.length}`;
    setMessages((ms) => [
      ...ms,
      { id: `u-${ms.length}`, role: "user", kind: "chat", content: trimmed },
      { id: replyId, role: "assistant", kind: "chat", content: "", pending: true },
    ]);
    const update = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((ms) => ms.map((m) => (m.id === replyId ? fn(m) : m)));

    try {
      const res = await fetch("/api/counselor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: trimmed }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; id?: string; text?: string };
          if (event.type === "conversation" && event.id && !conversationId) {
            setConversationId(event.id);
            window.history.replaceState(null, "", `/counselor/${event.id}`);
          } else if (event.type === "delta") {
            update((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "support" || event.type === "notice") {
            update((m) => ({ ...m, kind: event.type as "support" | "notice", content: event.text ?? "", pending: false }));
          } else if (event.type === "done") {
            update((m) => ({ ...m, pending: false }));
          }
        }
      }
    } catch {
      update((m) => ({ ...m, kind: "notice", content: "Couldn't reach the counselor. Check your connection and try again.", pending: false }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="font-medium">Hi! I&apos;m your College Compass counselor.</p>
            <p className="mt-1 text-sm text-muted">
              Ask me about careers, classes, college, career training, or how to take your next step. Try one of these:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-11 rounded-full border border-border px-3 text-left text-sm hover:border-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-background py-3"
      >
        <label htmlFor="message" className="sr-only">Message the counselor</label>
        <textarea
          id="message"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="Type your question…"
          className="block w-full resize-none rounded-lg border border-border bg-surface px-3 py-2"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {input.length > MAX_CHARS - 200 ? `${MAX_CHARS - input.length} characters left` : "Enter to send · Shift+Enter for a new line"}
          </span>
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
