import { describe, expect, it } from "vitest";
import { TRAIT_COPY, TRAIT_GUIDE, displayTrait, strengthFor, strengthsFor, strengthsSummary } from "./descriptions";
import { BIG_FIVE, type BigFive } from "./instruments";

const traits = (t: Partial<Record<BigFive, number>>): Record<BigFive, number> => ({
  extraversion: 50,
  agreeableness: 50,
  conscientiousness: 50,
  neuroticism: 50,
  intellect: 50,
  ...t,
});

describe("strengths", () => {
  it("lists the four career traits that stand out most first, and staying calm last", () => {
    const s = strengthsFor(traits({ extraversion: 10, agreeableness: 60, conscientiousness: 95, intellect: 55, neuroticism: 90 }));
    expect(s.map((x) => x.trait)).toEqual(["conscientiousness", "extraversion", "agreeableness", "intellect", "neuroticism"]);
    expect(s.map((x) => x.label)).toEqual(["Organized", "Thoughtful", "Fair-minded", "Practical", "Feels things deeply"]);
    // Reversed: a high neuroticism score is shown as a low "Staying calm", gently.
    expect(s[4]).toMatchObject({ name: "Staying calm", level: "low" });
  });

  it("frames a low score as a strength too", () => {
    const quiet = strengthFor("extraversion", 5);
    expect(quiet.label).toBe("Thoughtful");
    expect(quiet.text).toBe(TRAIT_COPY.extraversion.low);
    // Never that quiet people can't do people jobs.
    expect(quiet.work).toContain("including jobs with lots of people");
  });

  it("sums up three strengths and never staying calm", () => {
    expect(strengthsSummary(traits({ intellect: 95, conscientiousness: 80, agreeableness: 75, neuroticism: 0 }))).toBe(
      "Curious, organized and caring",
    );
    expect(strengthsSummary(traits({ neuroticism: 100 }))).not.toMatch(/calm|steady|deeply/i);
  });

  it("has school and work lines for every level, with nothing discouraging", () => {
    for (const t of BIG_FIVE) {
      for (const level of ["high", "middle", "low"] as const) {
        const g = TRAIT_GUIDE[t][level];
        for (const line of [g.school, g.work]) {
          expect(line).toMatch(/^[A-Z].*\.$/);
          expect(line).not.toMatch(/\b(can't|cannot|shouldn't|should not|bad at|weak|not good|avoid|never)\b/i);
        }
      }
    }
  });

  it("keeps displayTrait as it was", () => {
    expect(displayTrait("neuroticism", 20)).toEqual({ name: "Staying calm", score: 80, text: TRAIT_COPY.neuroticism.high });
  });
});
