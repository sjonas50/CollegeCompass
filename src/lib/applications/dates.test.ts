import { describe, expect, it } from "vitest";
import { addDays, daysBetween, deadlineWindow, formatDate, isIsoDate, relativeDays, shiftYears, usToday } from "./dates";

describe("deadline dates", () => {
  it("knows real calendar dates", () => {
    expect(isIsoDate("2026-11-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("November 1")).toBe(false);
  });

  it("uses the US Pacific calendar day for today", () => {
    // 3 a.m. UTC on September 25 is still the evening of September 24 in California.
    expect(usToday(new Date("2026-09-25T03:00:00Z"))).toBe("2026-09-24");
    expect(usToday(new Date("2026-09-25T12:00:00Z"))).toBe("2026-09-25");
  });

  it("does date math on calendar days", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-24", "2026-10-24")).toBe(30);
    expect(daysBetween("2026-09-24", "2026-09-20")).toBe(-4);
    // Across the November daylight-saving change.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(shiftYears("2028-02-29", 1)).toBe("2029-03-01");
  });

  it("allows deadlines two years either side of today", () => {
    expect(deadlineWindow("2026-09-24")).toEqual({ min: "2024-09-24", max: "2028-09-24" });
  });

  it("reads dates and distances in plain words", () => {
    expect(formatDate("2026-11-01")).toBe("November 1, 2026");
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(1)).toBe("tomorrow");
    expect(relativeDays(-1)).toBe("yesterday");
    expect(relativeDays(5)).toBe("in 5 days");
    expect(relativeDays(-3)).toBe("3 days ago");
  });
});
