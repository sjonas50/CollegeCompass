import { describe, expect, it } from "vitest";
import { RETAKE_AFTER_DAYS } from "../assessments/service";
import { MILESTONES } from "./milestones";

// Content the app itself backs up: the steps that point to our own quiz, or to help in every state.

const milestone = (id: string) => MILESTONES.find((m) => m.id === id)!;

describe("roadmap content", () => {
  it("sends 10th graders to our own Interests quiz, with the retake wait the app enforces", () => {
    const m = milestone("g10-take-career-interest-quiz");
    expect(m.detail).toContain("On your Home page, open Interests");
    expect(m.detail).toContain(`retake it ${RETAKE_AFTER_DAYS} days after`);
    expect(m.sources.join(" ")).not.toContain("careeronestop.org");
  });

  it("finds state aid for students in any state, not one state's program", () => {
    const m = milestone("g10-check-state-scholarship-rules");
    expect(m.sources).toContain("https://www.nassgap.org/advocacy-news-history/links-and-resources/");
    expect(m.sources.join(" ")).not.toContain("okpromise.org");
    expect(m.detail).not.toContain("Oklahoma");
  });
});
