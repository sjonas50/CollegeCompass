"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { MAX_COURSES } from "@/lib/courses/service";
import { LANGUAGES } from "@/lib/planner/course-types";
import { MAX_COLLEGE_LEVEL_PER_YEAR } from "@/lib/planner/engine-io";
import { FAMILY_IDS } from "@/lib/planner/families";
import type { PlanPrefsPatch } from "@/lib/planner/prefs";
import { PATH_KINDS, TN_ELECTIVE_FOCUSES, TX_ENDORSEMENTS } from "@/lib/planner/rules";
import { acceptSuggestion, dismissSuggestion, restoreSuggestions, savePlanSettings } from "@/lib/planner/service";
import { ordinal } from "@/lib/planner/view";

// "Your path" on the Plan page: one-tap Add and "Not for me" on suggestions, and the choices the
// path plans toward. Full access, like the rest of the Plan page. Each action re-checks the
// student and looks the suggestion up in today's plan (lib/planner/service.ts), so nothing the
// browser sends decides what's added. Nothing here writes an audit entry or reaches the AI.

export type PathActionResult = { ok: true; message?: string } | { ok: false; message: string };

const TRY_AGAIN = "We couldn't save that. Please try again.";
const GONE = "That suggestion changed since the page loaded. We refreshed your path; take another look.";

/** "Add" on a suggestion (or one of its other choices): it becomes a planned class of the student's own. */
export async function acceptSuggestionAction(key: string): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof key !== "string") return { ok: false, message: TRY_AGAIN };
  const res = await acceptSuggestion(await getDb(), student.id, key);
  revalidatePath("/plan");
  if (res.ok) return { ok: true, message: `Added ${res.name} to ${ordinal(res.grade)} grade. It's yours now; change or remove it anytime.` };
  if (res.error === "limit") return { ok: false, message: `You've added ${MAX_COURSES} classes, which is the most we can keep. Remove a few you don't need first.` };
  if (res.error === "unsupported") return { ok: false, message: "We can't add that one for you. Add it in the grade below with “Add a course”." };
  return { ok: false, message: GONE };
}

/** "Not for me" on a suggestion: the planner suggests something else, and it stays set aside. */
export async function dismissSuggestionAction(key: string): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof key !== "string") return { ok: false, message: TRY_AGAIN };
  const res = await dismissSuggestion(await getDb(), student.id, key);
  revalidatePath("/plan");
  return res.ok ? { ok: true, message: "Set aside. We'll suggest something else if there's another way to meet it." } : { ok: false, message: GONE };
}

/** Brings back the suggestions the student set aside. */
export async function restoreSuggestionsAction(): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  await restoreSuggestions(await getDb(), student.id);
  revalidatePath("/plan");
  return { ok: true, message: "Brought back the suggestions you set aside." };
}

export type PathSettingsState = { ok?: boolean; message?: string } | undefined;

const NOT_SURE = "";

/** One optional form field: absent leaves the setting alone; "" clears it ("not sure yet"). */
function field<T extends string>(formData: FormData, name: string, values: readonly T[]): T | null | undefined {
  if (!formData.has(name)) return undefined;
  const raw = formData.get(name);
  if (raw === NOT_SURE) return null;
  const parsed = z.enum(values as [T, ...T[]]).safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A checkbox sent with a hidden "present" marker, so unchecked (absent) can be told from "not in this form". */
function checkbox(formData: FormData, name: string): boolean | undefined {
  if (!formData.has(`${name}:present`)) return undefined;
  return formData.get(name) === "on";
}

/**
 * The path's settings (kind of path, the family to plan around, the college-level limit, math
 * acceleration) and the choices a rule depends on (Texas endorsement and DLA, Tennessee elective
 * focus, world language). A form may send any subset: a pending decision's card sends one field.
 */
export async function savePathSettingsAction(_prev: PathSettingsState, formData: FormData): Promise<PathSettingsState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);

  const patch: Omit<PlanPrefsPatch, "dismissed"> = {};
  const path = field(formData, "path", PATH_KINDS);
  if (path !== undefined) patch.path = path;
  const family = field(formData, "familyId", FAMILY_IDS);
  if (family !== undefined) patch.familyId = family;

  const choices: NonNullable<PlanPrefsPatch["choices"]> = {};
  const endorsement = field(formData, "txEndorsement", TX_ENDORSEMENTS);
  if (endorsement !== undefined) choices.txEndorsements = endorsement ? [endorsement] : null;
  const focus = field(formData, "tnElectiveFocus", TN_ELECTIVE_FOCUSES);
  if (focus !== undefined) choices.tnElectiveFocus = focus;
  const language = field(formData, "worldLanguage", LANGUAGES);
  if (language !== undefined) choices.worldLanguage = language;
  const dla = checkbox(formData, "txAimDla");
  if (dla !== undefined) choices.txAimDla = dla;
  if (Object.keys(choices).length) patch.choices = choices;

  const limits: NonNullable<PlanPrefsPatch["limits"]> = {};
  if (formData.has("maxCollegeLevelPerYear")) {
    const max = z.coerce.number().int().min(0).max(MAX_COLLEGE_LEVEL_PER_YEAR).safeParse(formData.get("maxCollegeLevelPerYear"));
    if (!max.success) return { ok: false, message: `Choose a number from 0 to ${MAX_COLLEGE_LEVEL_PER_YEAR}.` };
    limits.maxCollegeLevelPerYear = max.data;
  }
  const accelerate = checkbox(formData, "accelerateMath");
  if (accelerate !== undefined) limits.accelerateMath = accelerate;
  if (Object.keys(limits).length) patch.limits = limits;

  if (!Object.keys(patch).length) return { ok: false, message: TRY_AGAIN };
  await savePlanSettings(await getDb(), student.id, patch);
  revalidatePath("/plan");
  return { ok: true, message: "Saved. Your path is updated." };
}
