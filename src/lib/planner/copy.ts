import { PLANNER_STATE_NAMES, type PlannerState } from "./common";
import type { AuditModifier, AuditStatus } from "./engine-io";
import type { Strength } from "./rules";

// Fixed wording the engine, the Plan page, the print view and the free graduation pages share.
// Tests pin these; change them here, never by retyping them elsewhere.

/** On every plan, printout and counselor answer about a plan. */
export const DRAFT_NOTICE = "Draft: take this to your school counselor.";

/** The banner at the top of the path. */
export const DRAFT_BANNER = "This is a draft to take to your school counselor. Rules change, and your counselor knows your school.";

/** On every path (owner decision: a standing note, no special setting). */
export const STANDING_PLAN_NOTE =
  "If you have an IEP or 504 plan, or are learning English, your school team may set different graduation requirements. Ask your counselor.";

/**
 * The Texas Algebra II wording (design §6). Never "no TEXAS Grant" or "no TEOG": TEOG has no
 * course requirement, and for the TEXAS Grant the coursework sets priority [TX flag 5].
 */
export const TX_ALGEBRA_2_NOTE =
  "Algebra II isn't required to graduate. Skipping it rules out the Distinguished Level of Achievement, the course route to automatic admission, and lowers your priority for the TEXAS Grant.";

/** How the Texas default target is explained (owner decision). */
export const TX_DLA_DEFAULT_NOTE =
  "We're planning toward the Distinguished Level of Achievement, the course route to automatic admission at Texas public universities. There's also a test-score route.";

/** Soft load warning (never a block), with the sleep guidance [MP CDC-SLEEP]. */
export const LOAD_WARNING =
  "That's a lot of college-level classes for one year. Teens need 8 to 10 hours of sleep, and strong work in the subjects that matter for your goals counts for more than the number of advanced classes.";

/** For students outside the planner's states. */
export function comingLaterNote(stateName: string): string {
  return `Full class planning for ${stateName} is coming later. For now you'll see a general college-prep checklist.`;
}

/** Title of the free page at /graduation/[state]. */
export function graduationPageTitle(state: PlannerState): string {
  return `What ${PLANNER_STATE_NAMES[state]} requires to graduate`;
}

/** Status words (never color alone, never red). */
export const AUDIT_STATUS_LABELS = {
  done: "Done",
  planned: "Planned",
  room_to_add: "Room to add",
  ask_counselor: "Ask your counselor",
  not_tracked: "We don't track this",
} as const satisfies Record<AuditStatus, string>;

export const AUDIT_MODIFIER_LABELS = {
  projected: "Projected",
  sources_disagree: "Sources disagree",
  guessed_type: "Guessed class type",
  stale: "Being re-checked",
  unverified: "Not confirmed",
  needs_plan_now: "Needs a plan now",
} as const satisfies Record<AuditModifier, string>;

/** "Required by Texas", "Strongly encouraged by UT Knoxville". The word always comes from the rule's own strength. */
export const STRENGTH_PHRASES = {
  required: "Required by",
  strongly_encouraged: "Strongly encouraged by",
  recommended: "Recommended by",
  priority: "Gives priority with",
  info: "From",
} as const satisfies Record<Strength, string>;

export const SUGGESTION_LABEL = "College Compass suggestion";
