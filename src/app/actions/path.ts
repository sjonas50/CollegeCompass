"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { MAX_COURSES, setCourseType, splitCombinedCourse } from "@/lib/courses/service";
import { plannerPathEnabled } from "@/lib/planner/beta";
import { isPlannerState } from "@/lib/planner/common";
import { courseTypeTitle, isCourseTypeId, LANGUAGES } from "@/lib/planner/course-types";
import { COHORT_OVERRIDE_REASONS, MAX_COLLEGE_LEVEL_PER_YEAR } from "@/lib/planner/engine-io";
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
const NOT_ON = "Your path isn't available for your account yet.";
const GONE = "That suggestion changed since the page loaded. We refreshed your path; take another look.";

/** "Add" on a suggestion (or one of its other choices): it becomes a planned class of the student's own. */
export async function acceptSuggestionAction(key: string): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof key !== "string") return { ok: false, message: TRY_AGAIN };
  const db = await getDb();
  if (!(await plannerPathEnabled(db, student.id))) return { ok: false, message: NOT_ON };
  const res = await acceptSuggestion(db, student.id, key);
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
  const db = await getDb();
  if (!(await plannerPathEnabled(db, student.id))) return { ok: false, message: NOT_ON };
  const res = await dismissSuggestion(db, student.id, key);
  revalidatePath("/plan");
  return res.ok ? { ok: true, message: "Set aside. We'll suggest something else if there's another way to meet it." } : { ok: false, message: GONE };
}

/**
 * "Confirm your classes": the student says what kind of class one of their typed classes is (one tap
 * on the guess, or another kind from the list). It's stored as their choice, like the edit form's.
 */
export async function confirmCourseTypeAction(courseId: string, typeId: string): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof courseId !== "string" || typeof typeId !== "string" || !isCourseTypeId(typeId)) return { ok: false, message: TRY_AGAIN };
  const res = await setCourseType(await getDb(), student.id, courseId, typeId);
  revalidatePath("/plan");
  if (!res.ok) {
    return {
      ok: false,
      message: res.error === "mismatch" ? "That kind of class doesn't fit the class's subject. Edit the class below to change its subject first." : "We couldn't find that class. It may have been removed; try refreshing the page.",
    };
  }
  const state = isPlannerState(student.homeState) ? student.homeState : null;
  return { ok: true, message: `Saved: ${res.value.name} is ${courseTypeTitle(typeId, state)}. Your path now counts it that way.` };
}

/**
 * "Confirm your classes": a class whose name joins two half-credit classes ("Gov/Econ") is those two
 * classes. The row becomes the two, each with half its credits and its kind as the student's choice.
 * Whether the name joins two such classes is decided on the server from the stored row.
 */
export async function splitCourseAction(courseId: string): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (typeof courseId !== "string") return { ok: false, message: TRY_AGAIN };
  const state = isPlannerState(student.homeState) ? student.homeState : null;
  const res = await splitCombinedCourse(await getDb(), student.id, courseId, state);
  revalidatePath("/plan");
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.error === "limit"
          ? `You've added ${MAX_COURSES} classes, which is the most we can keep. Remove a few you don't need first.`
          : res.error === "not_combined"
            ? "We can't split that class. Choose what kind of class it is instead."
            : "We couldn't find that class. It may have been removed; try refreshing the page.",
    };
  }
  const [a, b] = res.value;
  return { ok: true, message: `Saved: ${a.name} and ${b.name} are two half-credit classes now. Your path counts each one.` };
}

/** Brings back the suggestions the student set aside. */
export async function restoreSuggestionsAction(): Promise<PathActionResult> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const db = await getDb();
  if (!(await plannerPathEnabled(db, student.id))) return { ok: false, message: NOT_ON };
  await restoreSuggestions(db, student.id);
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
 * The fields a form says the student changed. The settings form lists them in `touched`, so a
 * default shown in the form (the path inferred from goals, the DLA on the degree path, the
 * college-level limit) is never saved as if the student chose it. A form without the list (a
 * pending decision's one-question card) saves what it sends.
 */
function changedFields(formData: FormData): (name: string) => boolean {
  if (!formData.has("touched")) return () => true;
  const touched = new Set(String(formData.get("touched")).split(",").filter(Boolean));
  return (name) => touched.has(name);
}

/**
 * The path's settings (kind of path, the family to plan around, the college-level limit, math
 * acceleration, the student's class year) and the choices a rule depends on (Texas endorsement and
 * DLA, Tennessee elective focus, world language). A form may send any subset: a pending decision's
 * card sends one field.
 */
export async function savePathSettingsAction(_prev: PathSettingsState, formData: FormData): Promise<PathSettingsState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  if (!(await plannerPathEnabled(await getDb(), student.id))) return { ok: false, message: NOT_ON };
  const changed = changedFields(formData);
  const has = (name: string) => formData.has(name) && changed(name);

  const patch: Omit<PlanPrefsPatch, "dismissed"> = {};
  // "" is "Let my goals decide": the stored path is cleared and follows the goals again.
  const path = has("path") ? field(formData, "path", PATH_KINDS) : undefined;
  if (path !== undefined) patch.path = path;
  const family = has("familyId") ? field(formData, "familyId", FAMILY_IDS) : undefined;
  if (family !== undefined) patch.familyId = family;

  const choices: NonNullable<PlanPrefsPatch["choices"]> = {};
  const endorsement = has("txEndorsement") ? field(formData, "txEndorsement", TX_ENDORSEMENTS) : undefined;
  if (endorsement !== undefined) choices.txEndorsements = endorsement ? [endorsement] : null;
  const focus = has("tnElectiveFocus") ? field(formData, "tnElectiveFocus", TN_ELECTIVE_FOCUSES) : undefined;
  if (focus !== undefined) choices.tnElectiveFocus = focus;
  const language = has("worldLanguage") ? field(formData, "worldLanguage", LANGUAGES) : undefined;
  if (language !== undefined) choices.worldLanguage = language;
  const dla = changed("txAimDla") ? checkbox(formData, "txAimDla") : undefined;
  if (dla !== undefined) choices.txAimDla = dla;
  // Leaving the degree path without touching the DLA: it goes back to its default (off there).
  else if (path !== undefined && path !== null && path !== "degree") choices.txAimDla = null;
  if (Object.keys(choices).length) patch.choices = choices;

  const limits: NonNullable<PlanPrefsPatch["limits"]> = {};
  if (has("maxCollegeLevelPerYear")) {
    const max = z.coerce.number().int().min(0).max(MAX_COLLEGE_LEVEL_PER_YEAR).safeParse(formData.get("maxCollegeLevelPerYear"));
    if (!max.success) return { ok: false, message: `Choose a number from 0 to ${MAX_COLLEGE_LEVEL_PER_YEAR}.` };
    limits.maxCollegeLevelPerYear = max.data;
  }
  const accelerate = changed("accelerateMath") ? checkbox(formData, "accelerateMath") : undefined;
  if (accelerate !== undefined) limits.accelerateMath = accelerate;
  if (Object.keys(limits).length) patch.limits = limits;

  const cohort = cohortPatch(formData, has);
  if (typeof cohort === "string") return { ok: false, message: cohort };
  if (cohort) patch.cohort = cohort;

  if (!Object.keys(patch).length) {
    if (formData.has("touched")) return { ok: true, message: "Nothing changed." };
    return { ok: false, message: TRY_AGAIN };
  }
  await savePlanSettings(await getDb(), student.id, patch);
  revalidatePath("/plan");
  return { ok: true, message: "Saved. Your path is updated." };
}

/**
 * "You started 9th grade in fall 2026 (class of 2030). Is that right?": a year that differs from
 * the one the grade gives needs a reason; choosing the grade's own year (or "It isn't different")
 * clears the correction. Returns a message when something doesn't check out.
 */
function cohortPatch(formData: FormData, has: (name: string) => boolean): PlanPrefsPatch["cohort"] | string | null {
  if (!has("grade9EntryYear") && !has("classYear") && !has("cohortReason")) return null;
  const year = z.coerce.number().int().min(2000).max(2100);
  const entry = year.safeParse(formData.get("grade9EntryYear"));
  const klass = year.safeParse(formData.get("classYear"));
  const entryDefault = year.safeParse(formData.get("grade9EntryDefault"));
  const classDefault = year.safeParse(formData.get("classYearDefault"));
  const reason = z.enum(COHORT_OVERRIDE_REASONS).safeParse(formData.get("cohortReason"));
  if (!entry.success || !klass.success || !entryDefault.success || !classDefault.success) return TRY_AGAIN;
  const entryDiffers = entry.data !== entryDefault.data;
  const classDiffers = klass.data !== classDefault.data;
  if ((entryDiffers || classDiffers) && !reason.success) return "Choose why your year is different, or set it back.";
  return {
    grade9Entry: entryDiffers && reason.success ? { year: entry.data, reason: reason.data } : null,
    classYear: classDiffers && reason.success ? { year: klass.data, reason: reason.data } : null,
  };
}
