import { describe, expect, it } from "vitest";
import { normalizeForQuote, quoteAppears } from "./quotes";

describe("quoteAppears", () => {
  it("ignores spacing, line breaks, punctuation, case and curly quotes from PDF and web copies", () => {
    const pdf = "Graduation Requirements 202 6-2027\nLanguage Arts Level 10 ( 1.0 Credi t)\n● ELA 10\n● AP Seminar";
    expect(quoteAppears("Language Arts Level 10 (1.0 Credit) ELA 10 AP Seminar", pdf)).toBe(true);
    expect(quoteAppears("the student's high school transcript", "the student’s high school transcript")).toBe(true);
    expect(normalizeForQuote("Café — ½")).toBe("cafe12");
  });

  it("lets an ellipsis stand for left-out words, in order", () => {
    const text = "Courses offered for dual credit at or in conjunction with a college that provide advanced instruction";
    expect(quoteAppears("Courses offered for dual credit … that provide advanced instruction", text)).toBe(true);
    expect(quoteAppears("that provide advanced instruction ... Courses offered", text)).toBe(false);
  });

  it("finds changed or missing words", () => {
    expect(quoteAppears("must earn 24 credits", "must earn 22 credits")).toBe(false);
  });
});
