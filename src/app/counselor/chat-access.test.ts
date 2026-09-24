import { describe, expect, it } from "vitest";
import { CRISIS_LINE } from "@/lib/access/describe";
import { CLIENT_NOTICES, type ChatMessage, accessRequired, announcement, finishTurn, httpFailure, startTurn } from "./chat-events";

// What the chat shows when the counselor API answers 402 (the family's access ended).

const start = () => ({
  messages: [
    { id: "u-1", role: "user", kind: "chat", content: "hi" },
    { id: "r-1", role: "assistant", kind: "chat", content: "", pending: true },
  ] as ChatMessage[],
  turn: startTurn("r-1"),
});

describe("a locked counselor", () => {
  it("says why, with the crisis line and a link to unlock, and gives the message back", () => {
    const body = { error: "access_required", message: "Access isn't on. Call or text 988 any time.", support: null, unlock: { href: "/account/access", label: "See how to unlock it" } };
    const r = finishTurn(accessRequired(start(), body), false);
    expect(r.messages[1]).toMatchObject({
      kind: "notice",
      content: "Access isn't on. Call or text 988 any time.",
      link: { href: "/account/access", label: "See how to unlock it" },
      pending: false,
    });
    expect(r.restoreInput).toBe(true);
  });

  it("shows crisis resources first when the message needed them", () => {
    const r = finishTurn(accessRequired(start(), { message: "locked", support: "Please call or text 988 now.", unlock: {} }), false);
    expect(r.messages[1]).toMatchObject({ kind: "support", content: "Please call or text 988 now." });
    expect(r.restoreInput).toBe(false);
    expect(announcement(r.turn)).toBe("Important: Please call or text 988 now.");
  });

  it("falls back to its own notice, and only ever links to our unlock page", () => {
    const r = accessRequired(start(), { unlock: { href: "https://evil.example", label: "Go" } });
    expect(r.messages[1]).toMatchObject({ content: CLIENT_NOTICES.locked, link: { href: "/account/access", label: "Go" } });
    expect(CLIENT_NOTICES.locked).toContain(CRISIS_LINE);
    expect(httpFailure(start(), 402).messages[1]).toMatchObject({ content: CLIENT_NOTICES.locked, link: { href: "/account/access" } });
    expect(accessRequired(start(), null).messages[1].content).toBe(CLIENT_NOTICES.locked);
  });
});
