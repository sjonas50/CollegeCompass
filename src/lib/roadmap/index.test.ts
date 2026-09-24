import { describe, expect, it } from "vitest";
import {
  buildRoadmap,
  countedTotal,
  gradeProgressLabel,
  milestoneTiming,
  milestonesByMonth,
  monthList,
  monthsInSchoolYearOrder,
  progressByGrade,
  schoolYearIndex,
} from "./index";
import type { Milestone } from "./types";

function ms(id: string, grade: number, months: number[], extra: Partial<Milestone> = {}): Milestone {
  return {
    id,
    grade,
    months,
    title: `Title ${id}`,
    detail: "Detail",
    why: "Why",
    category: "habits",
    pathway: "all",
    sources: [],
    ...extra,
  };
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const ids = (items: { id: string }[]) => items.map((i) => i.id);

// A 10th grader in mid-October: now = Oct, coming up = Nov + Dec.
const LIBRARY: Milestone[] = [
  ms("aug", 10, [8]),
  ms("sep-oct", 10, [9, 10]),
  ms("oct", 10, [10]),
  ms("nov", 10, [11]),
  ms("dec", 10, [12]),
  ms("jan", 10, [1]),
  ms("sep-and-apr", 10, [9, 4]),
  ms("may", 10, [5]),
  ms("jul", 10, [7]),
  ms("anytime", 10, []),
  ms("g9-oct", 9, [10]),
  ms("g11-aug", 11, [8]),
];

describe("school-year order", () => {
  it("runs August (0) through July (11)", () => {
    expect([8, 9, 12, 1, 6, 7].map(schoolYearIndex)).toEqual([0, 1, 4, 5, 10, 11]);
  });

  it("lists months in school-year order", () => {
    expect(monthsInSchoolYearOrder(ms("x", 10, [3, 9, 3, 13, 0]))).toEqual([9, 3]);
    expect(monthList([10])).toBe("October");
    expect(monthList([10, 11])).toBe("October and November");
    expect(monthList([9, 10, 11])).toBe("September, October and November");
  });
});

describe("buildRoadmap", () => {
  it("sorts a grade's milestones into now, coming up, catch up and later", () => {
    const r = buildRoadmap(LIBRARY, 10, at("2026-10-15"));
    expect(r).toMatchObject({ grade: 10, month: 10, summer: false, graduated: false, comingUpMonths: [11, 12] });
    // A milestone with no months fits any time, so it's always something to do now.
    expect(ids(r.now)).toEqual(["sep-oct", "oct", "anytime"]);
    expect(ids(r.comingUp)).toEqual(["nov", "dec"]);
    expect(ids(r.catchUp)).toEqual(["aug"]);
    // A milestone that comes around again later this year isn't something to catch up on.
    expect(ids(r.later)).toEqual(["jan", "sep-and-apr", "may", "jul"]);
    expect(r.done).toEqual([]);
  });

  it("only includes the student's own grade", () => {
    const r = buildRoadmap(LIBRARY, 10, at("2026-10-15"));
    const all = [...r.now, ...r.comingUp, ...r.catchUp, ...r.later, ...r.done];
    expect(all.every((m) => m.grade === 10)).toBe(true);
    expect(all).toHaveLength(10);
    expect(ids(r.items)).toEqual(["aug", "sep-oct", "oct", "anytime", "nov", "dec", "jan", "sep-and-apr", "may", "jul"]);
  });

  it("moves done and skipped milestones out of the other sections", () => {
    const progress = new Map([
      ["oct", "done"],
      ["aug", "skipped"],
      ["may", "done"],
    ] as const);
    const r = buildRoadmap(LIBRARY, 10, at("2026-10-15"), progress);
    expect(ids(r.now)).toEqual(["sep-oct", "anytime"]);
    expect(r.catchUp).toEqual([]);
    expect(ids(r.later)).not.toContain("may");
    expect(r.done.map((m) => [m.id, m.status])).toEqual([
      ["aug", "skipped"],
      ["oct", "done"],
      ["may", "done"],
    ]);
    expect(r.now[0]).toMatchObject({ status: "open", timing: "now" });
  });

  it("wraps from December into January without leaving the school year", () => {
    const r = buildRoadmap(LIBRARY, 10, at("2026-12-01"));
    expect(r.comingUpMonths).toEqual([1, 2]);
    expect(ids(r.now)).toEqual(["dec", "anytime"]);
    expect(ids(r.comingUp)).toEqual(["jan"]);
    expect(ids(r.catchUp)).toEqual(["aug", "sep-oct", "oct", "nov"]);
  });

  it("treats August as the start of the year", () => {
    const r = buildRoadmap(LIBRARY, 10, at("2026-08-03"));
    expect(ids(r.now)).toEqual(["aug", "anytime"]);
    // Ordered by the month that makes them "coming up" (September before October).
    expect(ids(r.comingUp)).toEqual(["sep-oct", "sep-and-apr", "oct"]);
    expect(r.catchUp).toEqual([]);
  });

  it("keeps June and July with the grade that just finished, and looks ahead to next grade", () => {
    const june = buildRoadmap(LIBRARY, 10, at("2027-06-10"));
    expect(june.summer).toBe(true);
    expect(june.comingUpMonths).toEqual([7, 8]);
    expect(ids(june.comingUp)).toEqual(["jul", "g11-aug"]);
    expect(june.comingUp[1]).toMatchObject({ grade: 11, timing: "coming_up" });
    expect(ids(june.catchUp)).toContain("may");
    expect(june.later).toEqual([]);

    const july = buildRoadmap(LIBRARY, 10, at("2027-07-10"));
    expect(ids(july.now)).toEqual(["jul", "anytime"]);
    expect(july.later).toEqual([]);
    expect(july.comingUpMonths).toEqual([8, 9]);
    expect(ids(july.comingUp)).toEqual(["g11-aug"]);
  });

  it("doesn't look past 12th grade", () => {
    const lib = [ms("g12-jul", 12, [7]), ms("g12-jun", 12, [6])];
    const r = buildRoadmap(lib, 12, at("2027-06-15"));
    expect(r.comingUpMonths).toEqual([7]);
    expect(ids(r.now)).toEqual(["g12-jun"]);
    expect(ids(r.comingUp)).toEqual(["g12-jul"]);
    expect(buildRoadmap(lib, 12, at("2027-07-15")).comingUpMonths).toEqual([]);
  });

  it("shows nothing for graduates", () => {
    const r = buildRoadmap(LIBRARY, 13, at("2027-09-15"));
    expect(r.graduated).toBe(true);
    expect([...r.now, ...r.comingUp, ...r.catchUp, ...r.later, ...r.done, ...r.items]).toEqual([]);
    expect(r.comingUpMonths).toEqual([]);
  });

  it("ignores invalid months and handles an empty library", () => {
    const lib = [ms("bad", 10, [0, 13]), ms("half", 10, [13, 10])];
    const r = buildRoadmap(lib, 10, at("2026-10-15"));
    // No valid months is the same as no months: relevant any time.
    expect(ids(r.now)).toEqual(["bad", "half"]);
    expect(r.later).toEqual([]);
    expect(buildRoadmap([], 9, at("2026-10-15")).now).toEqual([]);
  });

  it("keeps any-time milestones in Right now all year, never in Later or Catch up", () => {
    const anytime = ms("anytime", 10, []);
    for (let month = 1; month <= 12; month++) {
      const date = new Date(Date.UTC(2027, month - 1, 15, 12));
      expect(milestoneTiming(anytime, 10, date)).toBe("now");
      const r = buildRoadmap([anytime], 10, date);
      expect(ids(r.now)).toEqual(["anytime"]);
    }
    // Next grade's any-time items wait for next grade rather than joining the summer look-ahead.
    expect(milestoneTiming(ms("g11-anytime", 11, []), 10, at("2027-07-10"))).toBeNull();
    // Done or set aside still wins.
    expect(ids(buildRoadmap([anytime], 10, at("2027-07-10"), new Map([["anytime", "done"]])).done)).toEqual(["anytime"]);
  });

  it("uses the UTC month", () => {
    // 11pm on Oct 31 in Denver is already November in UTC.
    expect(milestoneTiming(ms("nov", 10, [11]), 10, new Date("2026-11-01T05:00:00Z"))).toBe("now");
    expect(milestoneTiming(ms("g9", 9, [11]), 10, new Date("2026-11-01T05:00:00Z"))).toBeNull();
  });
});

describe("progressByGrade", () => {
  it("counts done, skipped and total for each grade 7–12", () => {
    const progress = new Map([
      ["oct", "done"],
      ["nov", "done"],
      ["aug", "skipped"],
      ["g9-oct", "done"],
      ["gone-from-library", "done"],
    ] as const);
    const grades = progressByGrade(LIBRARY, progress);
    expect(grades.map((g) => g.grade)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(grades.find((g) => g.grade === 10)).toEqual({ grade: 10, done: 2, skipped: 1, total: 10 });
    expect(grades.find((g) => g.grade === 9)).toEqual({ grade: 9, done: 1, skipped: 0, total: 1 });
    expect(grades.find((g) => g.grade === 7)).toEqual({ grade: 7, done: 0, skipped: 0, total: 0 });
  });
});

describe("gradeProgressLabel", () => {
  const g = (done: number, skipped: number, total: number) => ({ grade: 10, done, skipped, total });

  it("leaves set-aside milestones out of the count but still names them", () => {
    expect(countedTotal(g(2, 2, 5))).toBe(3);
    expect(gradeProgressLabel(g(0, 0, 5))).toBe("0 of 5 done");
    expect(gradeProgressLabel(g(2, 0, 5))).toBe("2 of 5 done");
    expect(gradeProgressLabel(g(2, 2, 5))).toBe("2 of 3 done · 2 set aside");
    expect(gradeProgressLabel(g(3, 2, 5))).toBe("3 of 3 done · 2 set aside");
  });

  it("only says there's nothing to track when the grade has no milestones", () => {
    expect(gradeProgressLabel(g(0, 0, 0))).toBe("Nothing to track yet");
    expect(gradeProgressLabel(g(0, 4, 4))).toBe("All 4 set aside for now");
    expect(gradeProgressLabel(g(0, 1, 1))).toBe("Set aside for now");
  });
});

describe("milestonesByMonth", () => {
  it("groups one grade by first month in school-year order, with month-less items last", () => {
    const groups = milestonesByMonth(LIBRARY, 10, new Map([["jan", "done"]]));
    expect(groups.map((g) => g.month)).toEqual([8, 9, 10, 11, 12, 1, 5, 7, null]);
    expect(ids(groups[1].items)).toEqual(["sep-oct", "sep-and-apr"]);
    expect(groups.find((g) => g.month === 1)?.items[0].status).toBe("done");
    expect(groups.at(-1)?.items.map((i) => i.id)).toEqual(["anytime"]);
    expect(milestonesByMonth(LIBRARY, 7)).toEqual([]);
  });
});
