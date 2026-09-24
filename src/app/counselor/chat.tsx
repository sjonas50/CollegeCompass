"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import {
  type AccessRequired,
  type ChatMessage,
  type ServerEvent,
  type Turn,
  accessRequired,
  announcement as announce,
  applyEvent,
  finishTurn,
  httpFailure,
  startTurn,
} from "./chat-events";
import { chatLinks } from "./chat-links";
import { supportActions } from "./support-actions";

export type { ChatMessage };

const STARTERS = [
  "What careers might fit my interests?",
  "What classes should I think about for next year?",
  "How does paying for college or training work?",
  "I'm not sure what I want to do yet.",
];

const MAX_CHARS = 2000;

/**
 * Text with our pages and https addresses as links. Our pages show their names (the path is still
 * the link's address); other websites open in a new tab and say so.
 */
export function Linked({ text }: { text: string }) {
  return (
    <>
      {chatLinks(text).map((s, i) =>
        s.type === "text" ? (
          s.text
        ) : s.external ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="break-words underline underline-offset-2">
            {s.text}
            <span className="sr-only"> (opens in a new tab)</span>
            <span aria-hidden="true" className="ml-0.5">
              ↗
            </span>
          </a>
        ) : (
          <Link key={i} href={s.href} lang={s.lang} hrefLang={s.lang} className="underline underline-offset-2">
            {s.text}
          </Link>
        ),
      )}
    </>
  );
}

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
                <li key={j}>
                  <Linked text={l.replace(/^\s*[-•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">
            <Linked text={block} />
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

// Streamed text follows the end of the chat while the student is within this distance of it.
const FOLLOW_PX = 160;

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
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const autoScrolling = useRef(false);
  const composing = useRef(false);
  const lastCount = useRef(initialMessages.length);
  const sendCount = useRef(0);
  const seenSupport = useRef(new Set(initialMessages.filter((m) => m.kind === "support").map((m) => m.id)));

  // A chat started here moves its URL to /counselor/<id> without a navigation. Tapping Counselor in
  // the nav goes back to /counselor without remounting this component, so start a fresh chat. Each
  // fresh chat is a new "epoch": a reply still streaming from the old one can't write into it.
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  const [epoch, setEpoch] = useState(0);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (!initialId && pathname === "/counselor" && conversationId) {
      setMessages([]);
      setConversationId(undefined);
      setAnnouncement("");
      setBusy(false);
      setEpoch((e) => e + 1);
    }
  }
  const epochRef = useRef(epoch);
  useEffect(() => {
    epochRef.current = epoch;
  }, [epoch]);

  // How far the end of the chat sits below the top of the sticky message box (negative: above it).
  function endOverlap() {
    const end = endRef.current?.getBoundingClientRect().bottom ?? 0;
    const formTop = formRef.current?.getBoundingClientRect().top ?? window.innerHeight;
    return end - Math.min(formTop, window.innerHeight);
  }

  useEffect(() => {
    const onScroll = () => {
      // Our own scrolling isn't the student moving away.
      if (autoScrolling.current) {
        autoScrolling.current = false;
        return;
      }
      follow.current = endOverlap() <= FOLLOW_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Crisis resources are always brought into view, top first, even if the student scrolled up.
    const support = messages.find((m) => m.kind === "support" && !seenSupport.current.has(m.id));
    if (support) {
      seenSupport.current.add(support.id);
      autoScrolling.current = true;
      document.getElementById(`message-${support.id}`)?.scrollIntoView({ block: "start" });
      return;
    }
    // Always scroll when a message is added; while text streams in, only if they're following.
    const added = messages.length !== lastCount.current;
    lastCount.current = messages.length;
    if (!added && !follow.current) return;
    const overlap = endOverlap() + 12;
    if (overlap > 0) {
      autoScrolling.current = true;
      window.scrollBy({ top: overlap });
    }
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
    // The turn's progress doesn't depend on the message list, so it's tracked here and the list
    // updater stays pure. Each change applies to the latest list, so a reset from the nav drops
    // this turn's output.
    let turn = startTurn(replyId);
    const myEpoch = epochRef.current;
    // The student started a fresh chat while this turn was still running.
    const stale = () => epochRef.current !== myEpoch;
    const apply = (fn: (s: { messages: ChatMessage[]; turn: Turn }) => { messages: ChatMessage[]; turn: Turn }) => {
      const before = turn;
      turn = fn({ messages: [], turn: before }).turn;
      if (stale()) {
        // Only crisis resources still reach the screen, with the message they answer.
        if (turn.support && !before.support) {
          const support = turn.support;
          setMessages((ms) => [
            ...ms,
            { id: `u-${replyId}`, role: "user", kind: "chat", content: trimmed },
            { id: replyId, role: "assistant", kind: "support", content: support },
          ]);
        }
        return;
      }
      setMessages((ms) => fn({ messages: ms, turn: before }).messages);
    };

    let broken = false;
    try {
      const res = await fetch("/api/counselor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: trimmed }),
      });
      if (res.status === 402) {
        // The family's access ended while this page was open.
        const body = (await res.json().catch(() => null)) as AccessRequired;
        apply((s) => accessRequired(s, body));
        return;
      }
      if (!res.ok || !res.body) {
        apply((s) => httpFailure(s, res.status));
        return;
      }
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
          const event = JSON.parse(line) as ServerEvent;
          if (event.type === "conversation") {
            // Only while the student is still on this new chat (not after leaving or starting another).
            if (!conversationId && !stale() && window.location.pathname === "/counselor") {
              setConversationId(event.id);
              window.history.replaceState(null, "", `/counselor/${event.id}`);
            }
          } else apply((s) => applyEvent(s, event));
        }
      }
    } catch {
      broken = true;
    } finally {
      if (stale()) {
        // The fresh chat owns the input, the busy state and the status line; only resources speak.
        if (turn.support) setAnnouncement(announce(turn));
      } else {
        const restore = finishTurn({ messages: [], turn }, broken).restoreInput;
        apply((s) => finishTurn(s, broken));
        // Put the message back unless they've started typing another one.
        if (restore) setInput((prev) => (prev.trim() ? prev : trimmed));
        setBusy(false);
        setAnnouncement(announce(turn));
        if (!document.activeElement || document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true });
      }
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
          <div key={m.id} id={`message-${m.id}`} className="flex scroll-mt-4 flex-col">
            <Bubble m={m} />
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <form
        ref={formRef}
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
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            // Enter that confirms an IME character isn't a send. Safari reports it as keyCode 229
            // after compositionend has already fired.
            const ime = e.nativeEvent.isComposing || composing.current || e.keyCode === 229;
            if (e.key !== "Enter" || e.shiftKey || !enterSends || ime) return;
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
