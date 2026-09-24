import type { CourseStatus, CourseSubject } from "@/db/schema";

/**
 * A rough guide to the high school classes many four-year colleges look for. Never a hard
 * requirement: expectations vary by college and state, and a school counselor knows the details.
 */

export const CHECKLIST_FRAMING = "Many four-year colleges look for about:";
export const CHECKLIST_CAVEAT =
  "Requirements vary by college and by state, and some colleges ask for more or less. Your school counselor can tell you what your state and the colleges you're curious about expect.";
export const CTE_NOTE =
  "Heading toward a career-training path, like an apprenticeship or a technical program? Career and technical education (CTE) pathway courses and industry certifications count for a lot there.";

export type ChecklistArea = {
  subject: CourseSubject;
  label: string;
  /** About how many years (credits) many four-year colleges look for. */
  years: number;
  /** Some colleges like to see more. */
  recommendedYears?: number;
  note: string;
};

export const COLLEGE_PREP_AREAS: ChecklistArea[] = [
  { subject: "english", label: "English", years: 4, note: "Usually one English class each year." },
  { subject: "math", label: "Math", years: 3, recommendedYears: 4, note: "Including Algebra II." },
  { subject: "science", label: "Science", years: 3, note: "Including lab sciences, like biology, chemistry or physics." },
  { subject: "social_studies", label: "Social studies", years: 3, note: "Like history, government and economics." },
  { subject: "world_language", label: "World language", years: 2, recommendedYears: 3, note: "Usually two or more years of the same language." },
  { subject: "arts", label: "Arts", years: 1, note: "Visual or performing arts, like art, music, theater or dance." },
];

/**
 * - covered: finished or in-progress classes reach the amount
 * - on_track: counting planned classes, the plan reaches it
 * - room_to_add: there's still room in the plan (never framed as falling short)
 */
export type ChecklistStatus = "covered" | "on_track" | "room_to_add";

export type ChecklistItem = ChecklistArea & {
  /** Years (credits) finished or in progress. */
  doneOrInProgress: number;
  /** Years (credits) planned. */
  planned: number;
  status: ChecklistStatus;
};

export type ProgressState = "done_or_in_progress" | "planned" | "not_yet";

export type Checklist = {
  items: ChecklistItem[];
  /** Algebra II, or a class that usually comes after it (Integrated Math III, pre-calculus, calculus, trig). */
  algebra2: ProgressState;
  cte: { doneOrInProgress: number; planned: number };
};

export type ChecklistCourse = {
  name: string;
  subject: CourseSubject;
  credits: number;
  status: CourseStatus;
  finalGrade: string | null;
  highSchoolCredit: boolean;
};

/**
 * Algebra II, or a math class that usually comes after it. Shared with the course ideas so the
 * checklist and the suggestions agree on whether Algebra II is in the plan.
 */
export const ALGEBRA_2_OR_BEYOND =
  /\b(algebra\s*(ii|2)|integrated\s*(math(ematics)?\s*)?(iii|3)|math\s*(iii|3)|pre-?\s?calc(ulus)?|calculus|calc\s*(ab|bc)|trig(onometry)?)\b/i;

/** Finished classes with F, W or I didn't earn the credit, so they don't count as covered. */
function bucket(c: ChecklistCourse): "done" | "planned" | null {
  if (!c.highSchoolCredit) return null;
  if (c.status === "planned") return "planned";
  if (c.status === "completed" && (c.finalGrade === "F" || c.finalGrade === "W" || c.finalGrade === "I")) return null;
  return "done";
}

function sumCredits(courses: ChecklistCourse[]) {
  // Credits are quarter steps, so these sums are exact.
  return courses.reduce((n, c) => n + c.credits, 0);
}

export function collegePrepChecklist(courses: ChecklistCourse[]): Checklist {
  const done = courses.filter((c) => bucket(c) === "done");
  const planned = courses.filter((c) => bucket(c) === "planned");

  const items = COLLEGE_PREP_AREAS.map((area): ChecklistItem => {
    const d = sumCredits(done.filter((c) => c.subject === area.subject));
    const p = sumCredits(planned.filter((c) => c.subject === area.subject));
    const status: ChecklistStatus = d >= area.years ? "covered" : d + p >= area.years ? "on_track" : "room_to_add";
    return { ...area, doneOrInProgress: d, planned: p, status };
  });

  const isAlgebra2 = (c: ChecklistCourse) => ALGEBRA_2_OR_BEYOND.test(c.name);
  const algebra2: ProgressState = done.some(isAlgebra2) ? "done_or_in_progress" : planned.some(isAlgebra2) ? "planned" : "not_yet";

  return {
    items,
    algebra2,
    cte: {
      doneOrInProgress: sumCredits(done.filter((c) => c.subject === "career_technical")),
      planned: sumCredits(planned.filter((c) => c.subject === "career_technical")),
    },
  };
}
