// How one send's stream events change the conversation on screen. Pure, so it can be tested
// without a browser.

import type { PageNames } from "@/lib/counselor/page-names";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "support" | "notice";
  content: string;
  pending?: boolean;
  link?: { href: string; label: string };
};

export type ServerEvent =
  | { type: "conversation"; id: string }
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "support"; text: string }
  | { type: "notice"; text: string }
  | { type: "done"; messageId: string | null; names?: unknown };

// Only names for the pages the chat names after their college or career (see chatLinks).
const NAMED_PAGE = /^\/(?:colleges\/\d+|careers\/\d{2}-\d{4}\.\d{2})$/;

/**
 * The page names the chat knows, with those the server sent when a reply finished (the real names
 * of the colleges and careers it links to). Anything else in them is ignored.
 */
export function addPageNames(known: PageNames, event: ServerEvent): PageNames {
  if (event.type !== "done" || typeof event.names !== "object" || event.names === null) return known;
  const added = Object.entries(event.names).filter(
    (entry): entry is [string, string] => NAMED_PAGE.test(entry[0]) && typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  return added.length ? { ...known, ...Object.fromEntries(added) } : known;
}

/** What has happened so far in one send. */
export type Turn = {
  replyId: string;
  /** Reply text on screen. */
  reply: string;
  /** Crisis resources were shown; nothing may replace them. */
  support: string | null;
  /** The last notice shown. */
  notice: string | null;
  /** The server finished the turn. */
  done: boolean;
};

export const CLIENT_NOTICES = {
  offline: "Couldn't reach the counselor. Check your connection and try again.",
  cutOff: "The reply was cut off. Check your connection and try asking again.",
  badRequest: "That message couldn't be sent. Try removing any unusual characters and send it again.",
  server: "Something went wrong on our end. Try again in a moment.",
  signedOut: "Your session ended. Sign in again to keep chatting.",
  locked:
    "Chatting with the counselor is part of full access, and your family's access isn't on right now. If you're going through something hard, call or text 988 any time.",
};

export const startTurn = (replyId: string): Turn => ({ replyId, reply: "", support: null, notice: null, done: false });

type Step = { messages: ChatMessage[]; turn: Turn };

function setReply(messages: ChatMessage[], turn: Turn, fn: (m: ChatMessage) => ChatMessage) {
  return messages.map((m) => (m.id === turn.replyId ? fn(m) : m));
}

/** Shows a notice: in the reply bubble if it's still empty, otherwise as its own line under it. */
function showNotice({ messages, turn }: Step, text: string, link?: ChatMessage["link"]): Step {
  const bubbleFree = !turn.reply && !turn.support && !turn.notice;
  const next = bubbleFree
    ? setReply(messages, turn, (m) => ({ ...m, kind: "notice", content: text, link, pending: false }))
    : [...messages, { id: `n${messages.length}-${turn.replyId}`, role: "assistant" as const, kind: "notice" as const, content: text, link }];
  return { messages: next, turn: { ...turn, notice: text } };
}

export function applyEvent(step: Step, event: ServerEvent): Step {
  const { messages, turn } = step;
  switch (event.type) {
    case "delta":
      if (turn.support) return step;
      return {
        messages: setReply(messages, turn, (m) => ({ ...m, content: m.content + event.text })),
        turn: { ...turn, reply: turn.reply + event.text },
      };
    case "replace":
      if (turn.support) return step;
      return { messages: setReply(messages, turn, (m) => ({ ...m, content: event.text })), turn: { ...turn, reply: event.text } };
    case "support": {
      const support = { kind: "support" as const, content: event.text, pending: false };
      const next = turn.reply || turn.support
        ? [...messages, { id: `s${messages.length}-${turn.replyId}`, role: "assistant" as const, ...support }]
        : setReply(messages, turn, (m) => ({ ...m, ...support }));
      return { messages: next, turn: { ...turn, support: event.text } };
    }
    case "notice":
      return showNotice(step, event.text);
    case "done":
      return { messages, turn: { ...turn, done: true } };
    default:
      return step;
  }
}

/** The counselor API's 402 body when the family doesn't have full access (see lockedCounselorReply). */
export type AccessRequired = { message?: unknown; support?: unknown; unlock?: { href?: unknown; label?: unknown } } | null;

/**
 * The family's access ran out. Crisis resources come first when the message needed them;
 * otherwise the notice says why (with the 988 line) and links to how to unlock.
 */
export function accessRequired(step: Step, body: AccessRequired): Step {
  if (typeof body?.support === "string" && body.support) return applyEvent(step, { type: "support", text: body.support });
  const text = typeof body?.message === "string" && body.message ? body.message : CLIENT_NOTICES.locked;
  // Only our own unlock page, whatever the body says.
  return showNotice(step, text, { href: "/account/access", label: typeof body?.unlock?.label === "string" ? body.unlock.label : "See how to unlock it" });
}

/** A request that failed before streaming started. */
export function httpFailure(step: Step, status: number): Step {
  if (status === 401) return showNotice(step, CLIENT_NOTICES.signedOut, { href: "/login?next=/counselor", label: "Sign in" });
  if (status === 402) return accessRequired(step, null);
  return showNotice(step, status === 400 || status === 413 ? CLIENT_NOTICES.badRequest : CLIENT_NOTICES.server);
}

/**
 * Wraps up a send once the stream ends. `broken` means the connection failed. Returns whether to
 * put the student's message back in the box: only when nothing came back and it wasn't a crisis.
 */
export function finishTurn(step: Step, broken: boolean): Step & { restoreInput: boolean } {
  let next = step;
  if (!step.turn.support) {
    if (broken) next = showNotice(step, step.turn.reply ? CLIENT_NOTICES.cutOff : CLIENT_NOTICES.offline);
    // The stream closed without finishing the turn (e.g. the server timed out).
    else if (!step.turn.done && !step.turn.notice) next = showNotice(step, step.turn.reply ? CLIENT_NOTICES.cutOff : CLIENT_NOTICES.server);
  }
  const messages = setReply(next.messages, next.turn, (m) => ({ ...m, pending: false }));
  return { messages, turn: next.turn, restoreInput: !next.turn.support && !next.turn.reply && Boolean(next.turn.notice) };
}

/** What a screen reader hears once the turn is over. */
export function announcement(turn: Turn): string {
  if (turn.support) return `Important: ${turn.support}`;
  if (turn.reply) return `Counselor replied: ${turn.reply}${turn.notice ? ` ${turn.notice}` : ""}`;
  return turn.notice ?? "";
}
