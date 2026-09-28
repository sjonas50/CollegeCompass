import { describe, expect, it } from "vitest";
import { allCourseTypes } from "../course-types";
import type { CatalogCourse, CatalogView, PlannerInput } from "../engine-io";
import { plan } from "./index";
import { ALL_SCENARIOS, tx1WorkedExample } from "./testing/scenarios";

// Performance (design §5.12): a plan in under 50 ms (owner's target), and a Katy-sized list of
// about 600 classes [GD §2] well inside the design's 200 ms CI bound. The fastest of several runs
// after a warm-up: the parallel test suite shares the machine, and a busy moment slows any one run,
// never all of them.

function time(input: PlannerInput, runs = 7): number {
  plan(input);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    plan(input);
    times.push(performance.now() - t0);
  }
  return Math.min(...times);
}

/** Every course type at every level it's offered: about 600 rows, like Katy ISD's 209-page guide. */
function katySizedList(): CatalogView {
  const courses: CatalogCourse[] = [];
  for (const t of allCourseTypes()) {
    for (const level of t.levels) {
      courses.push({
        id: `k-${courses.length}`,
        typeId: t.id,
        level,
        subject: t.subject,
        title: `${level === "regular" ? "" : `${level.toUpperCase()} `}${t.title}`,
        units: t.units,
        grades: null,
        terms: t.units <= 2 ? ["fall", "spring"] : ["full_year"],
        prereqs: [],
        approvals: [],
        cte: t.cte === "always",
        lectureOnly: false,
        delivery: "in_person",
        firstSchoolYear: null,
        everyOtherYear: false,
      });
    }
  }
  return {
    id: "katy",
    source: "school_published",
    state: "TX",
    schoolYear: 2026,
    lastYears: false,
    classesPerYear: 7,
    schedule: "traditional",
    localTotalUnits: null,
    confirmedSubjects: "all",
    courses,
  };
}

// The design's budget is 50 ms per plan (about 9 ms on a laptop). Shared CI runners are several
// times slower, so they get three times the budget; a real regression still fails there.
const BUDGET_MS = process.env.CI ? 150 : 50;

describe("performance", () => {
  it(`plans each golden scenario in under ${BUDGET_MS} ms`, () => {
    const slow: string[] = [];
    for (const [name, make] of Object.entries(ALL_SCENARIOS)) {
      const ms = time(make());
      if (ms >= BUDGET_MS) slow.push(`${name}: ${ms.toFixed(1)} ms`);
    }
    expect(slow).toEqual([]);
  });

  it(`plans with a Katy-sized list of about 600 classes in under ${BUDGET_MS} ms`, () => {
    const list = katySizedList();
    expect(list.courses.length).toBeGreaterThan(550);
    const input = tx1WorkedExample({ catalogs: { 9: list, 10: list, 11: list, 12: list } });
    const path = plan(input);
    expect(path.mode).toBe("catalog");
    expect(time(input, 5)).toBeLessThan(BUDGET_MS);
  });
});
