"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { addMilestoneStep, markMilestone } from "@/lib/roadmap";
import { type AddStepError, MAX_STEPS_PER_WEEK, addStep, completeStep, editStep, removeStep, reopenStep } from "@/lib/steps";

export type ActionResult = { ok: true } | { ok: false; message: string };

export type AddStepState =
  | { ok: true }
  | { ok: false; errors?: { text?: string[] }; message?: string }
  | undefined;

/** The same shape as adding: a field error for the text, or a message for the whole form. */
export type EditStepState = AddStepState;

const TRY_AGAIN = "We couldn't save that. Please try again.";

const ADD_STEP_MESSAGES: Record<AddStepError, string> = {
  invalid_text: "Write a short step (up to 140 characters).",
  milestone_not_found: "We couldn't find that roadmap step. Try refreshing the page.",
  week_full: `This week already has ${MAX_STEPS_PER_WEEK} steps. Remove one you haven't finished to make room for something new.`,
  already_added: "That's already on this week's list.",
  not_found: TRY_AGAIN,
};

/** Done / "Not for me" / Undo on a roadmap milestone. */
export async function markMilestoneAction(milestoneId: string, status: "done" | "skipped" | null): Promise<ActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof milestoneId !== "string" || !(status === "done" || status === "skipped" || status === null)) {
    return { ok: false, message: TRY_AGAIN };
  }
  const res = await markMilestone(await getDb(), student.id, milestoneId, status);
  if (!res.ok) return { ok: false, message: ADD_STEP_MESSAGES.milestone_not_found };
  refresh();
  return { ok: true };
}

/** "Add to this week" on a roadmap milestone. */
export async function addMilestoneStepAction(milestoneId: string): Promise<ActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof milestoneId !== "string") return { ok: false, message: TRY_AGAIN };
  const res = await addMilestoneStep(await getDb(), student.id, milestoneId);
  if (!res.ok) return { ok: false, message: ADD_STEP_MESSAGES[res.error] };
  refresh();
  return { ok: true };
}

/** The "add your own step" form on the weekly steps card (use with useFormAction). */
export async function addStepAction(_prev: AddStepState, formData: FormData): Promise<AddStepState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const res = await addStep(await getDb(), student.id, { text: formData.get("stepText") });
  if (!res.ok) {
    return res.error === "invalid_text"
      ? { ok: false, errors: { text: [res.message ?? ADD_STEP_MESSAGES.invalid_text] } }
      : { ok: false, message: ADD_STEP_MESSAGES[res.error] };
  }
  refresh();
  return { ok: true };
}

/** Checks a weekly step off, or un-checks it. */
export async function setStepDoneAction(stepId: string, done: boolean): Promise<ActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof stepId !== "string" || typeof done !== "boolean") return { ok: false, message: TRY_AGAIN };
  const db = await getDb();
  const ok = done ? await completeStep(db, student.id, stepId) : await reopenStep(db, student.id, stepId);
  if (!ok) return { ok: false, message: TRY_AGAIN };
  refresh();
  return { ok: true };
}

/**
 * The inline "Edit" form on a weekly step (use with useFormAction): fixes the text of one of the
 * student's own steps, with the same rules as adding one.
 */
export async function editStepAction(_prev: EditStepState, formData: FormData): Promise<EditStepState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const res = await editStep(await getDb(), student.id, formData.get("stepId"), formData.get("stepText"));
  if (!res.ok) {
    return res.error === "invalid_text"
      ? { ok: false, errors: { text: [res.message ?? ADD_STEP_MESSAGES.invalid_text] } }
      : { ok: false, message: "We couldn't find that step. Try refreshing the page." };
  }
  refresh();
  return { ok: true };
}

/**
 * Removes a weekly step, open or finished. The card asks first for a finished one, since it stops
 * counting toward the steps finished so far.
 */
export async function removeStepAction(stepId: string): Promise<ActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof stepId !== "string") return { ok: false, message: TRY_AGAIN };
  const ok = await removeStep(await getDb(), student.id, stepId);
  if (!ok) return { ok: false, message: "We couldn't remove that step. Try refreshing the page." };
  refresh();
  return { ok: true };
}
