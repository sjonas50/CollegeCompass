import { describe, expect, it } from "vitest";
import { admissionContext, locationText, pageList, resultRange, sizeText } from "./describe";

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
      expect(text).toContain("open admission");
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
