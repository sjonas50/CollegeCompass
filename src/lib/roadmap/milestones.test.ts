import { describe, expect, it } from "vitest";
import { schoolYearOf } from "../auth/age";
import { MILESTONES, VERIFIED_FOR_SCHOOL_YEAR } from "./milestones";
import { MILESTONE_CATEGORIES } from "./types";

describe("roadmap library", () => {
  it("has well-formed, unique milestones for every grade 7–12", () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MILESTONES) {
      expect(m.id).toMatch(new RegExp(`^g${m.grade}-[a-z0-9-]+$`));
      expect(m.months.length).toBeGreaterThan(0);
      expect(m.months.every((x) => Number.isInteger(x) && x >= 1 && x <= 12)).toBe(true);
      expect(MILESTONE_CATEGORIES).toContain(m.category);
      expect(["all", "degree", "training"]).toContain(m.pathway);
      expect(m.title.length).toBeLessThanOrEqual(60);
      expect(m.detail.length).toBeLessThanOrEqual(320);
      expect(m.sources.every((s) => s.startsWith("https://"))).toBe(true);
    }
    for (let g = 7; g <= 12; g++) expect(MILESTONES.filter((m) => m.grade === g).length).toBeGreaterThanOrEqual(8);
  });

  it("has been fact-checked for the current school year", () => {
    const current = schoolYearOf(new Date());
    expect(
      current,
      `Roadmap content was verified for the ${VERIFIED_FOR_SCHOOL_YEAR}–${VERIFIED_FOR_SCHOOL_YEAR + 1} school year. ` +
        "Re-check every milestone's dates, fees and program names against its sources, then bump VERIFIED_FOR_SCHOOL_YEAR.",
    ).toBeLessThanOrEqual(VERIFIED_FOR_SCHOOL_YEAR);
  });
});
