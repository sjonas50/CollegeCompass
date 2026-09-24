import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPercent,
  formatUsd,
  gradeBandLabel,
  median,
  monthKeyOf,
  monthLabel,
  monthRange,
  parseMonth,
  recentMonths,
  sourceLabel,
} from "./format";

const NOW = new Date("2026-09-24T18:00:00Z");

describe("months", () => {
  it("uses the UTC month, like the AI budget", () => {
    expect(monthKeyOf(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09");
    expect(monthKeyOf(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });

  it("accepts past and current months and falls back to the current month otherwise", () => {
    expect(parseMonth("2026-08", NOW)).toBe("2026-08");
    expect(parseMonth("2026-09", NOW)).toBe("2026-09");
    expect(parseMonth("2025-12", NOW)).toBe("2025-12");
    for (const bad of [undefined, "", "2026-10", "2027-01", "2026-13", "2026-00", "2026-9", "26-09", "1999-12", ["2026-08"], "2026-08; drop"]) {
      expect(parseMonth(bad, NOW)).toBe("2026-09");
    }
  });

  it("gives each month's UTC bounds and length", () => {
    expect(monthRange("2026-09")).toEqual({ start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z"), days: 30 });
    expect(monthRange("2026-12").end).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(monthRange("2028-02").days).toBe(29);
    expect(() => monthRange("2026-13")).toThrow();
  });

  it("lists recent months newest first, across the new year", () => {
    expect(recentMonths(new Date("2027-02-10T00:00:00Z"), 4)).toEqual(["2027-02", "2027-01", "2026-12", "2026-11"]);
    expect(recentMonths(NOW)).toHaveLength(12);
  });

  it("names months", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});

describe("numbers", () => {
  it("takes the median of odd and even counts without reordering the input", () => {
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  it("formats millionths of a dollar", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(4_999)).toBe("<$0.01");
    expect(formatUsd(10_000)).toBe("$0.01");
    expect(formatUsd(1_250_000)).toBe("$1.25");
    expect(formatUsd(1_234_567_890)).toBe("$1,234.57");
    expect(formatPercent(83.4)).toBe("83%");
    expect(formatPercent(99.6)).toBe("100%");
  });
});

describe("durations and times", () => {
  it("uses minutes, then hours up to two days, then days", () => {
    expect(formatDuration(30_000)).toBe("under a minute");
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(59 * 60_000)).toBe("59 minutes");
    expect(formatDuration(60 * 60_000)).toBe("1 hour");
    expect(formatDuration(47 * 3_600_000)).toBe("47 hours");
    expect(formatDuration(48 * 3_600_000)).toBe("2 days");
    expect(formatDuration(-3 * 3_600_000)).toBe("3 hours");
  });

  it("says how long ago, in UTC", () => {
    expect(formatAgo(new Date(NOW.getTime() - 10_000), NOW)).toBe("just now");
    expect(formatAgo(new Date(NOW.getTime() - 5 * 3_600_000), NOW)).toBe("5 hours ago");
    expect(formatDateTime(NOW)).toBe("Sep 24, 2026, 6:00 PM UTC");
    expect(formatDay("2026-09-01")).toBe("Sep 1");
  });
});

describe("labels", () => {
  it("shows grade bands, never exact grades", () => {
    expect(gradeBandLabel(7)).toBe("Grades 7–8");
    expect(gradeBandLabel(6)).toBe("Grades 7–8");
    expect(gradeBandLabel(10)).toBe("Grades 9–10");
    expect(gradeBandLabel(12)).toBe("Grades 11–12");
    expect(gradeBandLabel(13)).toBe("Finished high school");
    expect(gradeBandLabel(null)).toBe("Grade not set");
  });

  it("names classifier sources and passes unknown ones through", () => {
    expect(sourceLabel("rules")).toBe("Keyword rules");
    expect(sourceLabel("rate_limited")).toBe("Sent while rate-limited (rules only)");
    expect(sourceLabel("something_new")).toBe("something_new");
  });
});
