import { describe, expect, it } from "vitest";
import {
  NOT_REPORTED,
  PROGRAM_NOT_REPORTED,
  cleanTitle,
  formatCount,
  formatDollars,
  formatNetPrice,
  formatPercent,
  orNotReported,
} from "./format";
import { CONTROL_LABELS, DEGREE_LABELS, SIZE_LABELS, asControl, asCredential, asDegree, sizeOf } from "./labels";
import { normalizeState, stateName } from "./states";

describe("formatDollars", () => {
  it("shows whole dollars with commas", () => {
    expect(formatDollars(12_345)).toBe("$12,345");
    expect(formatDollars(1_234_567)).toBe("$1,234,567");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(999.6)).toBe("$1,000");
    expect(formatDollars(12_345.4)).toBe("$12,345");
  });

  it("never shows a negative price", () => {
    expect(formatDollars(-2_500)).toBe("$0");
    expect(formatDollars(-0.4)).toBe("$0");
  });

  it("returns null for missing or unusable values", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatDollars(value)).toBeNull();
  });
});

describe("formatNetPrice", () => {
  it("flags when aid was more than the cost", () => {
    expect(formatNetPrice(-1_200)).toEqual({ text: "$0", aidExceedsCost: true });
    expect(formatNetPrice(0)).toEqual({ text: "$0", aidExceedsCost: false });
    expect(formatNetPrice(8_400)).toEqual({ text: "$8,400", aidExceedsCost: false });
    expect(formatNetPrice(null)).toBeNull();
  });
});

describe("formatPercent", () => {
  it("rounds a 0–1 rate to a whole percent", () => {
    expect(formatPercent(0.4567)).toBe("46%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.995)).toBe("100%");
  });

  it("says less than 1% for tiny rates and clamps bad data", () => {
    expect(formatPercent(0.004)).toBe("Less than 1%");
    expect(formatPercent(0.005)).toBe("1%");
    expect(formatPercent(1.2)).toBe("100%");
  });

  it("returns null for missing or negative values", () => {
    for (const value of [null, undefined, Number.NaN, -0.1]) expect(formatPercent(value)).toBeNull();
  });
});

describe("formatCount and missing values", () => {
  it("formats counts", () => {
    expect(formatCount(15_001)).toBe("15,001");
    expect(formatCount(null)).toBeNull();
    expect(formatCount(Number.NaN)).toBeNull();
  });

  it("falls back to plain words, never null, NaN or PS", () => {
    expect(orNotReported(formatDollars(null))).toBe(NOT_REPORTED);
    expect(orNotReported(formatPercent(Number.NaN))).toBe("Not reported");
    expect(orNotReported(formatDollars(null), PROGRAM_NOT_REPORTED)).toBe("Not enough graduates to report");
    expect(orNotReported(formatDollars(500))).toBe("$500");
  });

  it("cleans Scorecard titles", () => {
    expect(cleanTitle("Computer Science.")).toBe("Computer Science");
    expect(cleanTitle("  Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing. ")).toBe(
      "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing",
    );
  });
});

describe("labels", () => {
  it("sizes colleges by undergraduate enrollment", () => {
    expect(sizeOf(0)).toBe("small");
    expect(sizeOf(4_999)).toBe("small");
    expect(sizeOf(5_000)).toBe("medium");
    expect(sizeOf(15_000)).toBe("medium");
    expect(sizeOf(15_001)).toBe("large");
    expect(sizeOf(null)).toBeNull();
    expect(sizeOf(Number.NaN)).toBeNull();
  });

  it("maps Scorecard codes to words and drops unknown codes", () => {
    expect(CONTROL_LABELS[asControl(3)!]).toBe("Private for-profit");
    expect(asControl(4)).toBeNull();
    expect(asCredential(2)).toBe(2);
    expect(asCredential(0)).toBeNull();
    expect(DEGREE_LABELS[asDegree(2)!].typical).toBe("Mostly associate degrees");
    expect(asDegree(0)).toBeNull();
    expect(SIZE_LABELS.large.detail).toBe("over 15,000 undergraduates");
  });

  it("normalizes states", () => {
    expect(normalizeState(" tx ")).toBe("TX");
    expect(normalizeState("PR")).toBe("PR");
    expect(normalizeState("XX")).toBeNull();
    expect(normalizeState(undefined)).toBeNull();
    expect(stateName("DC")).toBe("District of Columbia");
  });
});
