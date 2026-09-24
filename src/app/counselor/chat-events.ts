// How one send's stream events change the conversation on screen. Pure, so it can be tested
// without a browser.

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
  | { type: "done"; messageId: string | null };

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

/** A request that failed before streaming started. */
export function httpFailure(step: Step, status: number): Step {
  if (status === 401) return showNotice(step, CLIENT_NOTICES.signedOut, { href: "/login?next=/counselor", label: "Sign in" });
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
