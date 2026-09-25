import { describe, expect, it } from "vitest";
import {
  MEANINGS,
  PUBLIC_IN_STATE_NOTE,
  TRANSFER_NOTE,
  admissionContext,
  locationText,
  outOfStateCost,
  pageList,
  resultRange,
  sizeText,
  tuitionLines,
} from "./describe";

describe("MEANINGS", () => {
  it("explains what each College Scorecard number does and doesn't count", () => {
    // Public colleges' net price and cost of attendance are for in-state students.
    expect(MEANINGS.netPrice).toContain("At public colleges, it's for students from the college's state.");
    expect(MEANINGS.stickerPrice).toContain("At public colleges, it's the price for students from the college's state.");
    // Transfers count against the graduation rate.
    expect(MEANINGS.completion).toContain("Students who transfer to another college before they finish count as not finishing.");
    // Median debt is among borrowers only.
    expect(MEANINGS.debt).toContain("graduates who took out federal loans");
    expect(MEANINGS.debt).toContain("Students who didn't borrow aren't counted");
  });

  /** Flesch-Kincaid grade level, with a simple syllable count. */
  function gradeLevel(text: string) {
    const syllables = (word: string) => {
      const w = word.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length <= 3) return 1;
      return Math.max(1, (w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g) ?? []).length);
    };
    const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
    const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
    return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syllables(w), 0) / words.length) - 15.59;
  }

  it("reads at about an 8th-grade level or below", () => {
    const texts = [...Object.values(MEANINGS), PUBLIC_IN_STATE_NOTE, TRANSFER_NOTE, admissionContext(null), admissionContext(0.3)];
    for (const text of texts) expect(gradeLevel(text), text).toBeLessThanOrEqual(8.5);
  });
});

describe("outOfStateCost", () => {
  it("adds the extra out-of-state tuition to the in-state cost of attendance", () => {
    // University of Michigan-Ann Arbor, June 2026 release.
    expect(outOfStateCost(34_654, 17_736, 60_946)).toBe(77_864);
    expect(outOfStateCost(20_000, 5_000, 5_000)).toBeNull();
    expect(outOfStateCost(null, 5_000, 9_000)).toBeNull();
    expect(outOfStateCost(20_000, null, 9_000)).toBeNull();
  });
});

describe("tuitionLines", () => {
  it("shows one line when in-state and out-of-state tuition are the same", () => {
    // Harvard University, June 2026 release: $61,676 either way.
    expect(tuitionLines(61_676, 61_676)).toEqual([{ term: "Tuition and fees", amount: 61_676 }]);
  });

  it("shows both when they differ or one is missing", () => {
    expect(tuitionLines(17_736, 60_946)).toEqual([
      { term: "Tuition and fees, in-state", amount: 17_736 },
      { term: "Tuition and fees, out-of-state", amount: 60_946 },
    ]);
    expect(tuitionLines(null, null).map((l) => l.term)).toEqual(["Tuition and fees, in-state", "Tuition and fees, out-of-state"]);
    expect(tuitionLines(9_000, null)).toHaveLength(2);
  });
});

describe("locationText", () => {
  it("joins whatever parts are known", () => {
    expect(locationText("Austin", "TX")).toBe("Austin, TX");
    expect(locationText(null, "TX")).toBe("TX");
    expect(locationText(" Austin ", "")).toBe("Austin");
    expect(locationText(null, null)).toBeNull();
  });
});

describe("sizeText", () => {
  it("names the size band with the undergraduate count", () => {
    expect(sizeText(4_999)).toBe("Small (4,999 undergraduates)");
    expect(sizeText(5_000)).toBe("Medium (5,000 undergraduates)");
    expect(sizeText(15_001)).toBe("Large (15,001 undergraduates)");
    expect(sizeText(1)).toBe("Small (1 undergraduate)");
  });

  it("returns null when enrollment is missing or unusable", () => {
    expect(sizeText(null)).toBeNull();
    expect(sizeText(Number.NaN)).toBeNull();
    expect(sizeText(-1)).toBeNull();
  });
});

describe("admissionContext", () => {
  it("reminds that most colleges admit most applicants", () => {
    expect(admissionContext(0.8)).toBe("Like most colleges, this one admits most of the students who apply.");
    expect(admissionContext(0.4)).toContain("fewer than half");
    expect(admissionContext(0.1)).toContain("very selective");
    expect(admissionContext(0.1)).toContain("Most colleges admit most");
  });

  it("explains a missing rate without saying null", () => {
    for (const rate of [null, undefined, Number.NaN]) {
      const text = admissionContext(rate);
      expect(text).toBe(
        "No admission rate is listed. Colleges that take everyone who applies, like most community colleges, usually don't report one. This is called open admission.",
      );
      expect(text).not.toMatch(/null|NaN/);
    }
  });
});

describe("resultRange", () => {
  it("gives the first and last result shown", () => {
    expect(resultRange(45, 1, 20)).toEqual({ from: 1, to: 20 });
    expect(resultRange(45, 3, 20)).toEqual({ from: 41, to: 45 });
    expect(resultRange(0, 1, 20)).toBeNull();
    expect(resultRange(10, 2, 20)).toBeNull();
  });
});

describe("pageList", () => {
  it("shows nothing for a single page", () => {
    expect(pageList(1, 1)).toEqual([]);
    expect(pageList(1, 0)).toEqual([]);
  });

  it("shows every page when there are only a few", () => {
    expect(pageList(1, 2)).toEqual([1, 2]);
    expect(pageList(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first, last and neighboring pages with gaps between", () => {
    expect(pageList(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageList(6, 20)).toEqual([1, "gap", 5, 6, 7, "gap", 20]);
    expect(pageList(20, 20)).toEqual([1, "gap", 19, 20]);
  });

  it("never hides a single page behind a gap", () => {
    expect(pageList(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageList(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });
});
