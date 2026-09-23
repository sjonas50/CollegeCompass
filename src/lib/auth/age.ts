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

export function isUnder13(birthDate: string, today?: Date): boolean {
  return ageOn(birthDate, today) < COPPA_AGE;
}

/** Validates a birth date for a plausible middle/high school student (ages 10–20). */
export function isPlausibleStudentBirthDate(birthDate: string, today: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) return false;
  const age = ageOn(birthDate, today);
  return age >= 10 && age <= 20;
}

export type GradeBand = "explore" | "build" | "launch";

/** 7–8 explore, 9–10 build, 11–12 launch. */
export function gradeBand(grade: number): GradeBand {
  if (grade <= 8) return "explore";
  if (grade <= 10) return "build";
  return "launch";
}
