// Small shared vocabulary for the course planner contracts: the states the planner covers, grades,
// quarter-credit units and ISO dates. Pure data and types, so client components can import it.

/** States with full class planning in the proof of concept. Everyone else keeps today's checklist. */
export const PLANNER_STATES = ["UT", "TN", "TX"] as const;
export type PlannerState = (typeof PLANNER_STATES)[number];

export const PLANNER_STATE_NAMES: Record<PlannerState, string> = { UT: "Utah", TN: "Tennessee", TX: "Texas" };

export function isPlannerState(code: string | null | undefined): code is PlannerState {
  return typeof code === "string" && (PLANNER_STATES as readonly string[]).includes(code);
}

/** Grades the app serves. Middle school (7-8) courses can carry high school credit. */
export const SCHOOL_GRADES = [7, 8, 9, 10, 11, 12] as const;
export type SchoolGrade = (typeof SCHOOL_GRADES)[number];

export function isSchoolGrade(n: number): n is SchoolGrade {
  return (SCHOOL_GRADES as readonly number[]).includes(n);
}

/**
 * Credits are counted in quarter-credit units everywhere in the planner: 1 credit = 4 units, a
 * semester course (0.5 credit) = 2 units. This matches `CREDIT_STEP` (0.25) in
 * src/lib/courses/catalog.ts, and keeps every sum an exact integer.
 */
export const UNITS_PER_CREDIT = 4;

/** Credits (a multiple of 0.25) to quarter-credit units. Throws on anything that isn't a quarter step. */
export function toUnits(credits: number): number {
  const units = credits * UNITS_PER_CREDIT;
  if (!Number.isFinite(units) || Math.abs(units - Math.round(units)) > 1e-9) {
    throw new RangeError(`${credits} credits isn't a multiple of 0.25.`);
  }
  return Math.round(units);
}

/** Quarter-credit units back to credits, for display ("1.5 credits"). */
export function toCredits(units: number): number {
  return units / UNITS_PER_CREDIT;
}

/** "2026-10-01". Content dates and the engine's clock are plain ISO dates, never Date objects. */
export type IsoDate = string;

/**
 * School years are named by the calendar year they start in (2026 = the 2026-27 school year), the
 * same convention as `schoolYearOf()` in src/lib/auth/age.ts.
 */
export type SchoolYear = number;

/** "2026-27" */
export function schoolYearLabel(year: SchoolYear): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}
