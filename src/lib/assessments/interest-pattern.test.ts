import { describe, expect, it } from "vitest";
import { describeSavedQuiz, emptySavedAssessment, topInterestsText } from "./anonymous";
import { INTEREST_ITEMS, type Riasec } from "./instruments";
import {
  NOT_SURE_AREA_SCORE,
  areaLevel,
  areaNames,
  codeTieText,
  fewAreasText,
  interestPattern,
  isFlatProfile,
  noAreaStandsOut,
  noLeadReason,
  strongAreas,
  strongAreasText,
  tiedAreasText,
  tiedBelow,
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

  it("finds no area standing out when no area reaches 'Not sure' on average", () => {
    // "Dislike" on every Conventional activity and "Strongly dislike" on the rest: not flat (the
    // standard deviation is 3.7), but Conventional is only the least disliked area.
    const scores = scoreInterests(allAnswers((area) => (area === "C" ? 2 : 1)));
    expect(scores.areas).toEqual(areas({ C: 10 }));
    expect(isFlatProfile(Object.values(scores.areas))).toBe(false);
    const pattern = interestPattern(scores.areas);
    expect(pattern).toEqual({ kind: "low" });
    expect(noAreaStandsOut(pattern)).toBe(true);
    expect(strongAreas(pattern)).toEqual([]);
    expect(strongAreasText(scores.areas)).toBeNull();
    expect(noLeadReason(pattern)).toBe("leaned toward disliking all six interest areas");

    // Just below "Not sure" everywhere, with a clear shape: still no lead.
    expect(NOT_SURE_AREA_SCORE).toBe(20);
    expect(interestPattern(areas({ A: 19, S: 15, E: 10 }))).toEqual({ kind: "low" });
    // One area at "Not sure" on average is enough to stand out, on its own.
    expect(interestPattern(areas({ C: 20 }))).toEqual({ kind: "few", standOut: ["C"], rest: ["R", "I", "A", "S", "E"] });
    expect(interestPattern(areas({ A: 20, S: 15, E: 10 }))).toEqual({ kind: "few", standOut: ["A"], rest: ["R", "I", "S", "E", "C"] });
    // Every answer "Strongly dislike" is about the same, and says so.
    expect(interestPattern(areas({}))).toEqual({ kind: "flat" });
    expect(noLeadReason({ kind: "flat" })).toBe("rated all six interest areas about the same");
    expect(noAreaStandsOut({ kind: "flat" })).toBe(true);
    expect(noLeadReason(interestPattern(areas({ A: 40 })))).toBeNull();
    expect(noAreaStandsOut(interestPattern(areas({ A: 40 })))).toBe(false);
  });

  it("never ranks an area below 'Not sure' as an interest", () => {
    // "Strongly like" on every artistic activity, one "Dislike" among the social ones, and "Strongly
    // dislike" everywhere else: Social is 1 of 40, so it isn't second, and there's no code.
    const one = interestPattern(areas({ A: 40, S: 1 }));
    expect(one).toEqual({ kind: "few", standOut: ["A"], rest: ["R", "I", "S", "E", "C"] });
    expect(strongAreas(one)).toEqual(["A"]);
    expect(noAreaStandsOut(one)).toBe(false);
    expect(noLeadReason(one)).toBeNull();
    expect(strongAreasText(areas({ A: 40, S: 1 }))).toBe("artistic");
    if (one.kind !== "few") throw new Error();
    expect(fewAreasText(one)).toBe("Artistic stands out. You leaned toward disliking the other five areas.");
    expect(interestPattern(areas({ A: 40, S: 2, E: 1 }))).toEqual(one);

    // Two areas reached "Not sure": no third from below it, and no tie among the rest.
    const two = interestPattern(areas({ A: 40, S: 30, E: 19, C: 5 }));
    expect(two).toEqual({ kind: "few", standOut: ["A", "S"], rest: ["R", "I", "E", "C"] });
    if (two.kind !== "few") throw new Error();
    expect(fewAreasText(two)).toBe("Artistic and Social stand out. You leaned toward disliking the other four areas.");
    // Even when those two are tied with each other.
    expect(interestPattern(areas({ A: 30, S: 30 }))).toEqual({ kind: "few", standOut: ["A", "S"], rest: ["R", "I", "E", "C"] });

    // Areas tied below "Not sure" never make a tie for the top three either.
    expect(interestPattern(areas({ A: 40, S: 10, E: 10 }))).toEqual({ kind: "few", standOut: ["A"], rest: ["R", "I", "S", "E", "C"] });
    expect(interestPattern(areas({ A: 40, S: 30, E: 20, C: 10, R: 10 }))).toEqual({ kind: "code", code: "ASE", ties: [] });
  });

  it("says how an area was rated on average", () => {
    expect(areaLevel(21)).toBe("liked");
    expect(areaLevel(40)).toBe("liked");
    expect(areaLevel(NOT_SURE_AREA_SCORE)).toBe("not sure");
    expect(areaLevel(19)).toBe("disliked");
    expect(areaLevel(0)).toBe("disliked");
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

    expect(tiedBelow(third)).toEqual(["E", "C"]);

    // Everyone else scored the same (here "Not sure"): only the two that stand out are top interests.
    const rest = interestPattern(areas({ A: 40, S: 30, R: 20, I: 20, E: 20, C: 20 }));
    expect(rest).toEqual({ kind: "tied", standOut: ["A", "S"], tied: ["R", "I", "E", "C"] });
    if (rest.kind !== "tied") throw new Error();
    expect(tiedAreasText(rest)).toBe("Artistic and Social stand out. The other four areas are tied.");
    const one = interestPattern(areas({ A: 40, R: 30, I: 30, S: 30, E: 30, C: 30 }));
    if (one.kind !== "tied") throw new Error();
    expect(tiedAreasText(one)).toBe("Artistic stands out. The other five areas are tied.");
    // Below "Not sure", the rest are disliked rather than tied.
    expect(interestPattern(areas({ A: 40, S: 30 }))).toMatchObject({ kind: "few", standOut: ["A", "S"] });
    expect(interestPattern(areas({ A: 40 }))).toMatchObject({ kind: "few", standOut: ["A"] });

    const first = interestPattern(areas({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 }));
    expect(first).toEqual({ kind: "tied", standOut: [], tied: ["R", "I", "A", "S"] });
    expect(strongAreas(first)).toEqual(["R", "I", "A", "S"]);
    if (first.kind !== "tied") throw new Error();
    expect(tiedAreasText(first)).toBe("Realistic, Investigative, Artistic and Social are tied for your top area.");
    // A tie for first is the strong areas, not a tie below them.
    expect(tiedBelow(first)).toEqual([]);
    expect(tiedBelow(interestPattern(areas({ A: 40, S: 30, E: 20 })))).toEqual([]);
    expect(tiedBelow(interestPattern(areas({ A: 40 })))).toEqual([]);
  });

  it("keeps the scoring's code whenever there is one", () => {
    // A fixed pseudo-random walk, so the check is the same every run.
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647) % 5;
    for (let n = 0; n < 500; n++) {
      const scores = scoreInterests(allAnswers(() => next() + 1));
      const pattern = interestPattern(scores.areas);
      if (pattern.kind === "code") expect(pattern.code).toBe(scores.code);
      else if (pattern.kind === "tied" || pattern.kind === "few") expect(scores.code.startsWith(pattern.standOut.join(""))).toBe(true);
      // Nothing below "Not sure" is ever a top interest.
      for (const area of strongAreas(pattern)) expect(scores.areas[area]).toBeGreaterThanOrEqual(NOT_SURE_AREA_SCORE);
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
    const disliked = allAnswers((area) => (area === "C" ? 2 : 1));
    expect(topInterestsText(disliked)).toBeNull();
    expect(describeSavedQuiz({ ...emptySavedAssessment(), answers: disliked })).toBe(
      "Someone finished the free interest quiz on this device. They leaned toward disliking all six interest areas.",
    );
    // "Dislike" on the social activities doesn't make Social a top interest.
    const artistic = allAnswers((area) => (area === "A" ? 5 : area === "S" ? 2 : 1));
    expect(describeSavedQuiz({ ...emptySavedAssessment(), answers: artistic })).toBe(
      "Someone finished the free interest quiz on this device. Their top interests were artistic.",
    );
  });
});
