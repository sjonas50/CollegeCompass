import { describe, expect, it } from "vitest";
import {
  CLIENT_NOTICES,
  type ChatMessage,
  type ServerEvent,
  addPageNames,
  announcement,
  applyEvent,
  finishTurn,
  httpFailure,
  startTurn,
} from "./chat-events";

const start = () => ({
  messages: [
    { id: "u-1", role: "user", kind: "chat", content: "hi" },
    { id: "r-1", role: "assistant", kind: "chat", content: "", pending: true },
  ] as ChatMessage[],
  turn: startTurn("r-1"),
});

function run(events: ServerEvent[], broken = false) {
  return finishTurn(events.reduce(applyEvent, start()), broken);
}

const shown = (ms: ChatMessage[]) => ms.slice(1).map((m) => [m.kind, m.content]);

describe("chat events", () => {
  it("streams a reply into the bubble", () => {
    const r = run([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, { type: "done", messageId: "m" }]);
    expect(shown(r.messages)).toEqual([["chat", "Hello"]]);
    expect(r.messages[1].pending).toBe(false);
    expect(r.restoreInput).toBe(false);
    expect(announcement(r.turn)).toBe("Counselor replied: Hello");
  });

  it("takes back a refused draft", () => {
    const r = run([
      { type: "delta", text: "Let me check. " },
      { type: "delta", text: "REFUSED" },
      { type: "replace", text: "Let me check. " },
      { type: "notice", text: "Can't help with that." },
      { type: "done", messageId: null },
    ]);
    expect(shown(r.messages)).toEqual([["chat", "Let me check. "], ["notice", "Can't help with that."]]);
  });

  it("never replaces crisis resources, even with a later error or a dropped connection", () => {
    const r = run([{ type: "support", text: "Call or text 988" }, { type: "notice", text: "Sorry, something went wrong." }], true);
    expect(shown(r.messages)).toEqual([["support", "Call or text 988"], ["notice", "Sorry, something went wrong."]]);
    expect(r.restoreInput).toBe(false);
    expect(announcement(r.turn)).toBe("Important: Call or text 988");
  });

  it("marks a reply cut off when the connection drops mid-stream", () => {
    const r = run([{ type: "delta", text: "Here are three ideas: first" }], true);
    expect(shown(r.messages)).toEqual([["chat", "Here are three ideas: first"], ["notice", CLIENT_NOTICES.cutOff]]);
    expect(r.restoreInput).toBe(false);
  });

  it("marks a reply cut off when the stream closes without finishing", () => {
    const r = run([{ type: "delta", text: "Half a reply" }]);
    expect(shown(r.messages)).toEqual([["chat", "Half a reply"], ["notice", CLIENT_NOTICES.cutOff]]);
  });

  it("restores the message when nothing came back", () => {
    expect(run([], true)).toMatchObject({ restoreInput: true });
    expect(shown(run([], true).messages)).toEqual([["notice", CLIENT_NOTICES.offline]]);
    const limited = run([{ type: "notice", text: "Take a quick break." }, { type: "done", messageId: null }]);
    expect(shown(limited.messages)).toEqual([["notice", "Take a quick break."]]);
    expect(limited.restoreInput).toBe(true);
  });

  it("explains failures before the stream starts without blaming the connection", () => {
    const bad = finishTurn(httpFailure(start(), 400), false);
    expect(shown(bad.messages)).toEqual([["notice", CLIENT_NOTICES.badRequest]]);
    expect(bad.restoreInput).toBe(true);
    expect(shown(finishTurn(httpFailure(start(), 500), false).messages)).toEqual([["notice", CLIENT_NOTICES.server]]);
    const signedOut = finishTurn(httpFailure(start(), 401), false);
    expect(signedOut.messages[1].link).toEqual({ href: "/login?next=/counselor", label: "Sign in" });
  });
});

describe("page names from the end of a reply", () => {
  const known = { "/colleges/1": "Prairie State University" };

  it("adds the names of the colleges and careers a new reply links to", () => {
    const event: ServerEvent = {
      type: "done",
      messageId: "m",
      names: { "/colleges/204796": "Ohio State University-Main Campus", "/careers/29-1141.00": "Registered Nurses" },
    };
    expect(addPageNames(known, event)).toEqual({
      "/colleges/1": "Prairie State University",
      "/colleges/204796": "Ohio State University-Main Campus",
      "/careers/29-1141.00": "Registered Nurses",
    });
    // Nothing new: the same names.
    expect(addPageNames(known, { type: "done", messageId: "m" })).toBe(known);
    expect(addPageNames(known, { type: "delta", text: "/colleges/2" })).toBe(known);
  });

  it("keeps only names for college and career pages", () => {
    const event: ServerEvent = {
      type: "done",
      messageId: null,
      names: { "/admin": "Admin", "/colleges/2?x=1": "X", "/colleges/3": 42, "/colleges/4": " ", "/careers/47-2111.00": "Electricians" },
    };
    expect(addPageNames({}, event)).toEqual({ "/careers/47-2111.00": "Electricians" });
    expect(addPageNames(known, { type: "done", messageId: null, names: "nope" })).toBe(known);
    expect(addPageNames(known, { type: "done", messageId: null, names: null })).toBe(known);
  });
});
