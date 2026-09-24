"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { supportActions } from "./support-actions";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "support" | "notice";
  content: string;
  pending?: boolean;
  link?: { href: string; label: string };
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
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {supportActions(m.content).map((a) => (
            <li key={a.href}>
              <a
                href={a.href}
                {...(a.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex min-h-11 items-center justify-center rounded-lg border border-danger bg-surface px-3 text-center text-sm font-medium"
              >
                {a.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (m.kind === "notice") {
    return (
      <p className="max-w-[85%] text-sm italic text-muted">
        {m.content}
        {m.link && (
          <>
            {" "}
            <a href={m.link.href} className="font-medium not-italic underline">
              {m.link.label}
            </a>
          </>
        )}
      </p>
    );
  }
  return (
    <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2">
      {m.pending && !m.content ? <span className="animate-pulse text-muted">Thinking…</span> : <RichText text={m.content} />}
    </div>
  );
}

// On phones and tablets (coarse pointer), Enter adds a new line and the Send button sends.
const COARSE = "(pointer: coarse)";
function subscribePointer(onChange: () => void) {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
}

export function Chat({ conversationId: initialId, initialMessages }: { conversationId?: string; initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [conversationId, setConversationId] = useState(initialId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Screen readers hear each finished reply once, not every streamed fragment.
  const [announcement, setAnnouncement] = useState("");
  const enterSends = useSyncExternalStore(
    subscribePointer,
    () => !window.matchMedia(COARSE).matches,
    () => true,
  );
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const lastCount = useRef(initialMessages.length);
  const sendCount = useRef(0);

  useEffect(() => {
    const onScroll = () => (follow.current = nearBottom());
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Always scroll when a message is added; while text streams in, only if they're at the bottom.
    const added = messages.length !== lastCount.current;
    lastCount.current = messages.length;
    if (added || follow.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput("");
    setAnnouncement("Sent. The counselor is replying.");
    follow.current = true;
    sendCount.current += 1;
    const replyId = `pending-${sendCount.current}`;
    setMessages((ms) => [
      ...ms,
      { id: `u-${replyId}`, role: "user", kind: "chat", content: trimmed },
      { id: replyId, role: "assistant", kind: "chat", content: "", pending: true },
    ]);
    const update = (fn: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === replyId ? fn(m) : m)));

    let reply = "";
    let final: { kind: ChatMessage["kind"]; text: string } | null = null;
    try {
      const res = await fetch("/api/counselor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: trimmed }),
      });
      if (res.status === 401) {
        setInput(trimmed);
        final = { kind: "notice", text: "Your session ended. Sign in again to keep chatting." };
        update((m) => ({ ...m, kind: "notice", content: final!.text, link: { href: "/login?next=/counselor", label: "Sign in" }, pending: false }));
        return;
      }
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
            reply += event.text;
            update((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "support") {
            final = { kind: "support", text: event.text ?? "" };
            update((m) => ({ ...m, kind: "support", content: event.text ?? "", pending: false }));
          } else if (event.type === "notice") {
            // A notice after partial text is shown as its own line under the reply.
            const text = event.text ?? "";
            final = { kind: "notice", text };
            if (reply) {
              setMessages((ms) => [...ms, { id: `n-${replyId}`, role: "assistant", kind: "notice", content: text }]);
            } else {
              update((m) => ({ ...m, kind: "notice", content: text, pending: false }));
            }
          }
        }
      }
    } catch {
      if (!reply) setInput(trimmed);
      final = { kind: "notice", text: "Couldn't reach the counselor. Check your connection and try again." };
      update((m) => (reply ? m : { ...m, kind: "notice", content: final!.text, pending: false }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
      const f = final as { kind: ChatMessage["kind"]; text: string } | null;
      setAnnouncement(
        f?.kind === "support" ? `Important: ${f.text}` : reply ? `Counselor replied: ${reply}${f ? ` ${f.text}` : ""}` : f?.text ?? "",
      );
      if (!document.activeElement || document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {conversationId && !initialId && (
        <button
          type="button"
          // A full navigation on purpose: the URL was changed with replaceState (so a stream in progress
          // isn't remounted), which means the router still thinks this is /counselor and push() would no-op.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => window.location.assign("/counselor")}
          className="min-h-11 self-end text-sm underline"
        >
          New chat
        </button>
      )}
      <div role="log" aria-live="off" aria-label="Conversation" className="flex flex-col gap-3">
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
                  onClick={() => {
                    inputRef.current?.focus({ preventScroll: true });
                    send(s);
                  }}
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
        <div ref={endRef} className="scroll-mb-40" />
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-background py-3"
      >
        <label htmlFor="message" className="sr-only">
          Message the counselor
        </label>
        <textarea
          id="message"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || !enterSends || e.nativeEvent.isComposing) return;
            e.preventDefault();
            send(input);
          }}
          enterKeyHint={enterSends ? "send" : "enter"}
          rows={2}
          placeholder="Type your question…"
          className="block w-full resize-none rounded-lg border border-border bg-surface px-3 py-2"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {input.length > MAX_CHARS - 200
              ? `${MAX_CHARS - input.length} characters left`
              : enterSends
                ? "Enter to send · Shift+Enter for a new line"
                : ""}
          </span>
          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send" aria-busy={busy}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
