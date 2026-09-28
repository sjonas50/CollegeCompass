"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isLinkedParent } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";
import type { FormState } from "@/lib/forms";
import { schoolSettingsFromForm } from "@/lib/schools/form";
import { type SaveSchoolError, copySchoolSettings, saveSchoolSettings } from "@/lib/schools/student";

// Where a student goes to school: the state and school pickers in the student's Settings and on
// the parent page (src/components/school-settings.tsx). Free for everyone: never gated. Nothing is
// audited or logged: the school is personal data.

const ERRORS: Record<SaveSchoolError, FormState> = {
  invalid_state: { errors: { state: ["Choose a state from the list."] } },
  state_required: { errors: { state: ["Choose a state first. Schools are listed by state."] } },
  school_not_found: { errors: { school: ["We couldn't find that school. Search again, or choose “My school isn’t listed.”"] } },
  school_other_state: { errors: { school: ["That school is in another state. Choose the state first, then search again."] } },
  not_found: { message: "We couldn't save that. Please refresh the page and try again." },
};

/** A student sets their own state and school (Settings on the dashboard). */
export async function saveMySchoolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const student = await requireUser(["student"]);
  const result = await saveSchoolSettings(await getDb(), student.id, schoolSettingsFromForm(formData), { by: "student" });
  if (!result.ok) return ERRORS[result.error];
  redirect("/dashboard?settings=school#school-settings");
}

/** A parent sets a linked child's state and school (the child's Settings on /parent). */
export async function saveChildSchoolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parent = await requireUser(["parent"]);
  const studentId = z.uuid().safeParse(formData.get("studentId"));
  const db = await getDb();
  if (!studentId.success || !(await isLinkedParent(db, parent.id, studentId.data))) redirect("/parent");
  const result = await saveSchoolSettings(db, studentId.data, schoolSettingsFromForm(formData), { by: "parent" });
  if (!result.ok) return ERRORS[result.error];
  redirect(`/parent?saved=1#school-${studentId.data}`);
}

/** "Same school as <sibling>": copies one linked child's state and schools to another. */
export async function sameSchoolAsAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const to = z.uuid().safeParse(formData.get("studentId"));
  const from = z.uuid().safeParse(formData.get("fromStudentId"));
  const db = await getDb();
  if (!to.success || !from.success) redirect("/parent");
  if (!(await isLinkedParent(db, parent.id, to.data)) || !(await isLinkedParent(db, parent.id, from.data))) redirect("/parent");
  await copySchoolSettings(db, from.data, to.data);
  redirect(`/parent?saved=1#school-${to.data}`);
}
