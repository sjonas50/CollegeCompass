import { describe, expect, it } from "vitest";
import { describeSavedQuiz, emptySavedAssessment, topInterestsText } from "./anonymous";
import { INTEREST_ITEMS, type Riasec } from "./instruments";
import {
  areaNames,
  codeTieText,
  interestPattern,
  isFlatProfile,
  strongAreas,
  strongAreasText,
  tiedAreasText,
} from "./interest-pattern";
import { scoreInterests } from "./scoring";

// What the results pages may say about a student's interest scores: never a lead that a tie, or
// answers that are all the same, don't support.

const areas = (scores: Partial<Record<Riasec, number>>) => ({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, ...scores });
const allAnswers = (value: (area: Riasec, i: number) => number) =>
  Object.fromEntries(INTEREST_ITEMS.map((item, i) => [item.id, value(item.area, i)]));

describe("interest patterns", () => {
  it("finds no area standing out when every answer is the same, or when they cycle", () => {
    for (const value of [1, 3, 5]) {
      const scores = scoreInterests(allAnswers(() => value));
      // The code still has three letters (RIASEC order), but the results must not use it.
      expect(scores.code).toBe("RIA");
      expect(interestPattern(scores.areas)).toEqual({ kind: "flat" });
    }
    // Clicking down the five answers in turn gives every area the same score too.
    expect(interestPattern(scoreInterests(allAnswers((_, i) => (i % 5) + 1)).areas)).toEqual({ kind: "flat" });
    expect(interestPattern(areas({ R: 30, I: 31, A: 30, S: 29, E: 30, C: 30 }))).toEqual({ kind: "flat" });
  });

  it("uses the same line as matching for a flat profile", () => {
    expect(isFlatProfile([30, 31, 30, 29, 30, 30])).toBe(true);
    // Standard deviation 1.86 and 2.24, out of 0–40.
    expect(isFlatProfile([0, 0, 0, 0, 0, 5])).toBe(true);
    expect(isFlatProfile([0, 0, 0, 0, 0, 6])).toBe(false);
    expect(isFlatProfile([20, 40, 10, 8, 4, 14])).toBe(false);
  });

  it("gives the code when the top three are clear", () => {
    const pattern = interestPattern(areas({ A: 40, S: 30, E: 20 }));
    expect(pattern).toEqual({ kind: "code", code: "ASE", ties: [] });
    expect(strongAreas(pattern)).toEqual(["A", "S", "E"]);
    expect(codeTieText(pattern)).toBeNull();
  });

  it("says when areas inside the code are tied, since their order means nothing", () => {
    const pattern = interestPattern(areas({ R: 30, I: 30, A: 20, S: 10, E: 5 }));
    expect(pattern).toEqual({ kind: "code", code: "RIA", ties: [["R", "I"]] });
    expect(codeTieText(pattern)).toBe("Realistic and Investigative are tied, so their order doesn't matter.");
    expect(codeTieText(interestPattern(areas({ R: 30, I: 30, A: 30, S: 10, E: 5 })))).toBe(
      "Realistic, Investigative and Artistic are tied, so their order doesn't matter.",
    );
  });

  it("has no code when a tie decides the last places, and says which areas tie", () => {
    const third = interestPattern(areas({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 }));
    expect(third).toEqual({ kind: "tied", standOut: ["A", "S"], tied: ["E", "C"] });
    expect(strongAreas(third)).toEqual(["A", "S"]);
    if (third.kind !== "tied") throw new Error();
    expect(tiedAreasText(third)).toBe("Artistic and Social stand out. Enterprising and Conventional are tied after them.");

    // Everyone else scored the same (here 0): only the two that stand out are top interests.
    const rest = interestPattern(areas({ A: 40, S: 30 }));
    expect(rest).toEqual({ kind: "tied", standOut: ["A", "S"], tied: ["R", "I", "E", "C"] });
    if (rest.kind !== "tied") throw new Error();
    expect(tiedAreasText(rest)).toBe("Artistic and Social stand out. The other four areas are tied.");
    const one = interestPattern(areas({ A: 40 }));
    if (one.kind !== "tied") throw new Error();
    expect(tiedAreasText(one)).toBe("Artistic stands out. The other five areas are tied.");

    const first = interestPattern(areas({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 }));
    expect(first).toEqual({ kind: "tied", standOut: [], tied: ["R", "I", "A", "S"] });
    expect(strongAreas(first)).toEqual(["R", "I", "A", "S"]);
    if (first.kind !== "tied") throw new Error();
    expect(tiedAreasText(first)).toBe("Realistic, Investigative, Artistic and Social are tied for your top area.");
  });

  it("keeps the scoring's code whenever there is one", () => {
    // A fixed pseudo-random walk, so the check is the same every run.
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647) % 5;
    for (let n = 0; n < 500; n++) {
      const scores = scoreInterests(allAnswers(() => next() + 1));
      const pattern = interestPattern(scores.areas);
      if (pattern.kind === "code") expect(pattern.code).toBe(scores.code);
      else if (pattern.kind === "tied") expect(scores.code.startsWith(pattern.standOut.join(""))).toBe(true);
    }
  });

  it("names the top interests in words, or none", () => {
    expect(areaNames(["R", "I"], { lower: true })).toBe("realistic and investigative");
    expect(areaNames(["C"])).toBe("Conventional");
    expect(areaNames(["A", "S", "E", "C"])).toBe("Artistic, Social, Enterprising and Conventional");
    expect(strongAreasText(areas({ A: 40, S: 30, E: 20 }))).toBe("artistic, social and enterprising");
    expect(strongAreasText(areas({ A: 40, S: 30 }))).toBe("artistic and social");
    expect(strongAreasText(areas({ R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 }))).toBeNull();
  });

  it("describes a flat quiz on a shared device without inventing top interests", () => {
    const answers = allAnswers(() => 3);
    expect(topInterestsText(answers)).toBeNull();
    expect(describeSavedQuiz({ ...emptySavedAssessment(), answers })).toBe(
      "Someone finished the free interest quiz on this device. They rated all six interest areas about the same.",
    );
  });
});
