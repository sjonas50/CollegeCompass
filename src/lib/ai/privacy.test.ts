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

  it("removes names that start or end with accented letters, and usernames before their name prefix", () => {
    expect(scrubPii("Soy José y mi hermana es Zoë, él es Ángel", ["José", "Zoë", "Ángel"])).toBe("Soy [name] y mi hermana es [name], él es [name]");
    expect(scrubPii("I'm maya, username mayalopez", ["Maya", "mayalopez"])).toBe("I'm [name], username [name]");
    // Doesn't clip names inside longer words.
    expect(scrubPii("Joséphine and Zoëlle", ["José", "Zoë"])).toBe("Joséphine and Zoëlle");
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

  it("carries the student's state, and never their school", () => {
    const student = {
      grade: 10,
      homeState: "TX",
      school: { name: "Plano Senior High School", ref: "nces:483510003969" },
      schoolRef: "nces:483510003969",
      district: "Plano ISD",
    };
    const ctx = toAiContext(student as never);
    expect(ctx).toEqual({ grade: 10, gradeBand: "build", homeState: "TX" });
    expect(JSON.stringify(ctx)).not.toMatch(/Plano|nces|4835/);
    // Only a real postal code gets through.
    expect(toAiContext({ grade: 10, homeState: "Plano ISD" })).toEqual({ grade: 10, gradeBand: "build" });
    expect(toAiContext({ grade: 10, homeState: null })).toEqual({ grade: 10, gradeBand: "build" });
  });

  it("has no field for a school", () => {
    // Adding one would be a deliberate change to what the AI may know (CLAUDE.md); this pins it.
    const keys: (keyof ReturnType<typeof toAiContext>)[] = ["grade", "gradeBand", "homeState"];
    expect(Object.keys(toAiContext({ grade: 9, homeState: "UT" })).sort()).toEqual([...keys].sort());
  });
});
