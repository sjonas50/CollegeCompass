/** COPPA applies to children under this age. */
export const COPPA_AGE = 13;

export const MIN_GRADE = 7;
export const MAX_GRADE = 12;

/** Whole years between an ISO birth date (YYYY-MM-DD) and `today`. */
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * American Samoa (UTC−11, no daylight saving time) is the last US time zone to reach each new day.
 * Its date is the earliest calendar date anywhere in the US.
 */
const LATEST_US_OFFSET_MS = 11 * 60 * 60 * 1000;

/**
 * Whether COPPA applies. The server doesn't know where the child lives, so a child counts as 13
 * only once their 13th birthday has started everywhere in the US (in American Samoa, last of all).
 * Until then they may still be 12 at home.
 */
export function isUnder13(birthDate: string, now: Date = new Date()): boolean {
  return ageOn(birthDate, new Date(now.getTime() - LATEST_US_OFFSET_MS)) < COPPA_AGE;
}

/** Validates a birth date for a plausible middle/high school student (ages 10–20). */
export function isPlausibleStudentBirthDate(birthDate: string, today: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) return false;
  const age = ageOn(birthDate, today);
  return age >= 10 && age <= 20;
}

/**
 * US school years run August–July; a school year is named by the calendar year it starts in.
 * June and July belong to the year that just ended (the summer after that grade).
 */
export function schoolYearOf(date: Date = new Date()): number {
  return date.getUTCMonth() >= 7 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/**
 * A student's grade today. We store the grade they gave and the school year it applied to, so
 * grades advance each August without anyone editing them. Values above 12 mean graduated.
 */
export function currentGrade(
  stored: { grade: number | null; gradeSchoolYear: number | null },
  now: Date = new Date(),
): number | null {
  if (stored.grade === null) return null;
  const elapsed = stored.gradeSchoolYear === null ? 0 : schoolYearOf(now) - stored.gradeSchoolYear;
  return stored.grade + Math.max(0, elapsed);
}

/**
 * How to ask for a grade on a given date. In June and July "this school year" is ambiguous (the
 * year just ended), so we ask for the grade just finished; it's stored against that school year and
 * advances in August like any other.
 */
export function gradeQuestion(today: Date = new Date()): { label: string; min: number; max: number } {
  const month = today.getUTCMonth() + 1;
  return month === 6 || month === 7
    ? { label: "Grade you just finished", min: MIN_GRADE - 1, max: MAX_GRADE - 1 }
    : { label: "Grade this school year", min: MIN_GRADE, max: MAX_GRADE };
}

export function isAllowedGrade(grade: number, today: Date = new Date()): boolean {
  const q = gradeQuestion(today);
  return Number.isInteger(grade) && grade >= q.min && grade <= q.max;
}

export type GradeBand = "explore" | "build" | "launch";

/** 7–8 explore, 9–10 build, 11–12 launch. */
export function gradeBand(grade: number): GradeBand {
  if (grade <= 8) return "explore";
  if (grade <= 10) return "build";
  return "launch";
}
