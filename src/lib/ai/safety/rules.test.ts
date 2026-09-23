import { describe, expect, it } from "vitest";
import cases from "../../../../evals/safety/cases.json";
import { classifyWithRules } from "./rules";
import { SEVERITY_ORDER, type Severity } from "./types";

type Case = { id: string; text: string; expected: Severity; category?: string; rulesShouldCatch: boolean };

describe("safety rules tier", () => {
  for (const c of (cases as Case[]).filter((c) => c.rulesShouldCatch)) {
    it(`${c.id}: ${c.expected}`, () => {
      const signal = classifyWithRules(c.text);
      if (c.expected === "none") {
        expect(signal).toBeNull();
      } else {
        expect(signal?.category).toBe(c.category);
        expect(SEVERITY_ORDER[signal!.severity]).toBeGreaterThanOrEqual(SEVERITY_ORDER[c.expected]);
      }
    });
  }
});
