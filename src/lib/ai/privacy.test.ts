import { describe, expect, it } from "vitest";
import { scrubPii, toAiContext } from "./privacy";

describe("scrubPii", () => {
  it("removes contact details and the student's name", () => {
    const out = scrubPii(
      "Hi I'm Maya Lopez, email maya.l@gmail.com or call (555) 123-4567, I live at 42 Oak Street",
      ["Maya", "Lopez"],
    );
    expect(out).toBe("Hi I'm [name] [name], email [email] or call [phone], I live at [address]");
  });

  it("leaves ordinary text alone", () => {
    const text = "I got a 1350 on the PSAT and want to study biology in 2029";
    expect(scrubPii(text, ["Al"])).toBe(text);
  });
});

describe("toAiContext", () => {
  it("carries only non-identifying fields", () => {
    const ctx = toAiContext({ grade: 8, displayName: "Maya", email: "m@x.com", birthDate: "2013-01-01" } as never);
    expect(ctx).toEqual({ grade: 8, gradeBand: "explore" });
  });
});
