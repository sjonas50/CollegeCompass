import type { CourseStatus } from "@/db/schema";
import { PLANNER_STATE_NAMES, type PlannerState, schoolYearLabel, toCredits } from "./common";
import { AUDIT_STATUS_LABELS, STRENGTH_PHRASES } from "./copy";
import type {
  AuditStatus,
  ByWhen,
  PlannedPath,
  PlanSlot,
  RequirementAudit,
  RuleSetAudit,
  StudentCohort,
} from "./engine-io";
import type { CohortKey, Issuer, RuleSetKind, Strength, Variant } from "./rules";

// Wording shared by the Plan page's "Your path", the print view, the parent's read-only view and
// the free graduation pages. Pure, so it's tested directly and safe in any component.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 9 → "9th", 11 → "11th", 12 → "12th". */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "by the end of 11th grade", "by the start of 9th grade", "by December 10 of 12th grade". */
export function byWhenText(by: ByWhen): string {
  if (by.point === "date") return `by ${MONTHS[by.month - 1]} ${by.day} of ${ordinal(by.grade)} grade`;
  return `by the ${by.point} of ${ordinal(by.grade)} grade`;
}

/** "10th grade · 2027-28". */
export function yearLabel(grade: number, schoolYear: number): string {
  return `${ordinal(grade)} grade · ${schoolYearLabel(schoolYear)}`;
}

/** "Required by Texas", "Strongly encouraged by UT Knoxville". The word comes from the rule's own strength. */
export function strengthLine(strength: Strength, issuer: Issuer): string {
  return `${STRENGTH_PHRASES[strength]} ${issuer.name}`;
}

/** "Class of 2030 · started 9th grade in fall 2026". */
export function cohortLine(cohort: StudentCohort): string {
  return `Class of ${cohort.classYear} · started 9th grade in fall ${cohort.grade9EntryYear}`;
}

export function stateTitle(state: PlannerState): string {
  return PLANNER_STATE_NAMES[state];
}

/** "1 credit", "2.5 credits". */
export function creditsText(units: number): string {
  const credits = toCredits(units);
  return `${credits} ${credits === 1 ? "credit" : "credits"}`;
}

/** How much of a requirement is covered: "1 of 1 credit", "1 of 2 levels", "0 of 1 class". */
export function progressText(req: Pick<RequirementAudit, "measure" | "required" | "firm" | "planned">): string {
  const have = req.firm + req.planned;
  if (req.measure === "units") {
    const need = toCredits(req.required);
    return `${Math.min(toCredits(have), need)} of ${need} ${need === 1 ? "credit" : "credits"}`;
  }
  const noun = req.measure === "levels" ? (req.required === 1 ? "level" : "levels") : req.required === 1 ? "class" : "classes";
  return `${Math.min(have, req.required)} of ${req.required} ${noun}`;
}

/** Status glyphs shown next to the words (never color alone). */
export const STATUS_ICONS: Record<AuditStatus, string> = {
  done: "✓",
  planned: "◔",
  room_to_add: "+",
  ask_counselor: "?",
  not_tracked: "–",
};

export const COURSE_STATUS_WORDS: Record<CourseStatus, string> = {
  completed: "Finished",
  in_progress: "Taking now",
  planned: "Planned",
};

/**
 * The word for a requirement: the engine's "done" means finished or in progress, so it reads
 * "In progress" while any class it counts is still being taken.
 */
export function statusWord(status: AuditStatus, countedStatuses: readonly CourseStatus[] = []): string {
  if (status === "done" && countedStatuses.includes("in_progress")) return "In progress";
  return AUDIT_STATUS_LABELS[status];
}

export type AuditGroupId = "graduation" | "colleges" | "scholarships";

export const AUDIT_GROUPS: { id: AuditGroupId; title: string; kinds: readonly RuleSetKind[] }[] = [
  { id: "graduation", title: "Graduation", kinds: ["state_graduation", "graduation_option", "local_graduation"] },
  { id: "colleges", title: "Colleges", kinds: ["college_admission", "program_admission", "guaranteed_admission"] },
  { id: "scholarships", title: "Scholarships and college credit", kinds: ["state_aid", "college_credit_program"] },
];

export function auditGroup(path: PlannedPath, id: AuditGroupId): RuleSetAudit[] {
  const kinds = AUDIT_GROUPS.find((g) => g.id === id)!.kinds;
  return path.audit.filter((rs) => kinds.includes(rs.kind));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;

/** Every suggestion in the path's plans (and middle school sketch), by key, with its grade. */
export function suggestionsByKey(path: PlannedPath): Map<string, Suggested & { grade: number }> {
  const out = new Map<string, Suggested & { grade: number }>();
  const years = [...path.plans.flatMap((p) => p.years), ...(path.middleSchool?.ninthGradeSketch ? [path.middleSchool.ninthGradeSketch] : [])];
  for (const y of years) {
    for (const s of y.slots) if (s.kind === "suggested" && !out.has(s.key)) out.set(s.key, { ...s, grade: y.grade });
  }
  return out;
}

/** The first sentence-ish summary of a slot's reasons, for the collapsed line. */
export function mainReason(slot: Suggested): string | null {
  return slot.reasons[0]?.text ?? null;
}

// Choice labels ----------------------------------------------------------------------------------

export const PATH_LABELS = {
  degree: "A 4-year college",
  training: "Community college, a certificate, an apprenticeship or career training",
  undecided: "Not sure yet",
} as const;

export const TX_ENDORSEMENT_LABELS = {
  stem: "STEM (science, technology, engineering and math)",
  business_industry: "Business and Industry",
  public_services: "Public Services",
  arts_humanities: "Arts and Humanities",
  multidisciplinary: "Multidisciplinary Studies",
} as const;

export const TN_FOCUS_LABELS = {
  cte: "Career and technical education",
  math_science: "Math and science",
  humanities: "Humanities",
  fine_arts: "Fine arts",
  ap_ib: "AP or IB",
  cambridge: "Cambridge",
  computer_science: "Computer science",
  other_local: "Another focus your district offers",
} as const;

/** "Class of 2029 and later", "Started 9th grade in 2026-27 or later". */
export function cohortLabel(key: CohortKey, cohort: Variant["cohort"]): string {
  const { from, to } = cohort;
  if (key === "class_year") {
    if (from !== undefined && to !== undefined) return from === to ? `Class of ${from}` : `Classes of ${from} through ${to}`;
    if (from !== undefined) return `Class of ${from} and later`;
    if (to !== undefined) return `Class of ${to} and earlier`;
    return "Every class";
  }
  const grade = key === "grade9_entry_year" ? "9th" : "7th";
  if (from !== undefined && to !== undefined) return `Started ${grade} grade from ${schoolYearLabel(from)} through ${schoolYearLabel(to)}`;
  if (from !== undefined) return `Started ${grade} grade in ${schoolYearLabel(from)} or later`;
  if (to !== undefined) return `Started ${grade} grade in ${schoolYearLabel(to)} or earlier`;
  return "Every class";
}
