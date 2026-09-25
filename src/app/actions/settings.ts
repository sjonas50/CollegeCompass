"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isLinkedParent, setStudentGrade } from "@/lib/accounts";
import { ChangePasswordSchema, type PasswordChangeError, changeOwnPassword } from "@/lib/auth/change-password";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { requireUser } from "@/lib/auth/dal";
import { createSession } from "@/lib/auth/sessions";
import { type FormState, fieldErrors } from "@/lib/forms";
import { removeLinkedParent } from "@/lib/parent-links";
import { deleteOwnStudentAccount } from "@/lib/privacy";
import { setOwnRemindersEnabled, setRemindersEnabled } from "@/lib/reminders";

const Grade = z.coerce.number().int().min(6).max(12);
const SchoolYear = z.coerce.number().int().min(2000).max(2100);

/**
 * The grade picked in a settings grade form (GradeSettingSelect), or null for "no change": an
 * empty value (the "keep as is" option) or the grade the form showed (`shownGrade`). Comparing
 * with what was shown, not with today's grade, means a page loaded before grades advance in August
 * and saved after can't move the student back a year.
 */
function pickedGrade(formData: FormData): { grade: number; schoolYear?: number } | null {
  const raw = formData.get("grade");
  if (typeof raw !== "string" || raw === "") return null;
  const grade = Grade.safeParse(raw);
  if (!grade.success) return null;
  const shown = formData.get("shownGrade");
  if (typeof shown === "string" && shown !== "" && Number(shown) === grade.data) return null;
  // The school year the form's question referred to (see setStudentGrade).
  const year = SchoolYear.safeParse(formData.get("gradeYear"));
  return { grade: grade.data, schoolYear: year.success ? year.data : undefined };
}

export async function setMyGradeAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const picked = pickedGrade(formData);
  const saved = picked === null || (await setStudentGrade(await getDb(), student.id, picked.grade, new Date(), picked.schoolYear));
  redirect(saved ? "/dashboard?settings=saved" : "/dashboard?settings=stale");
}

/** Refused for reminders that go to a parent: only the parent changes those, on /parent. */
export async function setMyRemindersAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const saved = await setOwnRemindersEnabled(await getDb(), student.id, formData.get("enabled") === "on");
  redirect(saved ? "/dashboard?settings=saved" : "/dashboard");
}

/** A teen deletes their own account (see deleteOwnStudentAccount), then lands signed out on the home page. */
export async function deleteMyAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const student = await requireUser(["student"]);
  const password = formData.get("password");
  if (typeof password !== "string" || password === "") return { errors: { password: ["Enter your password."] } };
  const result = await deleteOwnStudentAccount(await getDb(), student.id, password);
  if (!result.ok) {
    switch (result.error) {
      case "wrong_password":
        return { errors: { password: ["That password isn't right."] } };
      case "rate_limited":
        return { message: "Too many tries. Please wait 15 minutes and try again." };
      case "parent_managed":
        return { message: "Your parent or guardian set up this account, so they can delete it from their parent page." };
      default:
        return { message: "We couldn't delete this account. Please sign out, sign in again and try again." };
    }
  }
  await clearSessionCookie();
  redirect("/?account-deleted=1");
}

/** The change-password fields (see NewPasswordFields), checked, or the errors to show. */
function newPasswordFrom(formData: FormData): { ok: true; current: string; next: string } | { ok: false; state: FormState } {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: field("currentPassword"),
    newPassword: field("newPassword"),
    confirmPassword: field("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, state: fieldErrors(parsed.error) };
  return { ok: true, current: parsed.data.currentPassword, next: parsed.data.newPassword };
}

/** What a student is told when their new password wasn't saved. */
function passwordErrorState(error: PasswordChangeError): FormState {
  switch (error) {
    case "wrong_password":
      return { errors: { currentPassword: ["That password isn't right."] } };
    case "same_password":
      return { errors: { newPassword: ["Choose a password that's different from the one you have now."] } };
    case "invalid_password":
      return { errors: { newPassword: ["Use 10 to 128 characters."] } };
    case "rate_limited":
      return { message: "Too many tries. Please wait 15 minutes and try again." };
    case "parent_managed":
      return { message: "Your parent or guardian set up your account and manages it, so you can't change its password here." };
    default:
      return { message: "We couldn't change your password. Please sign out, sign in again and try again." };
  }
}

/** Every session ended with the password change, so this device gets a new one. */
async function signInAgainHere(studentId: string) {
  const { token, expiresAt } = await createSession(await getDb(), studentId);
  await setSessionCookie(token, expiresAt);
}

/** A teen who owns their account changes its password (see changeOwnPassword). */
export async function changeMyPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const student = await requireUser(["student"]);
  const input = newPasswordFrom(formData);
  if (!input.ok) return input.state;
  const result = await changeOwnPassword(await getDb(), student.id, { current: input.current, next: input.next });
  if (!result.ok) return passwordErrorState(result.error);
  await signInAgainHere(student.id);
  redirect("/dashboard?settings=password");
}

/**
 * "Yes, remove" on a linked parent in the student's Settings (after the confirm step). Always the
 * signed-in student's own link; see removeLinkedParent. When that parent set up the account, the
 * confirm step asks for a new password, which is saved with the removal.
 */
export async function removeMyParentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const student = await requireUser(["student"]);
  const parentId = formData.get("parentId");
  let password: { current: string; next: string } | undefined;
  if (formData.has("newPassword")) {
    const input = newPasswordFrom(formData);
    if (!input.ok) return input.state;
    password = { current: input.current, next: input.next };
  }
  const result = await removeLinkedParent(await getDb(), student.id, typeof parentId === "string" ? parentId : "", { password });
  if (!result.ok) {
    switch (result.error) {
      case "parent_managed":
        return { message: "Your parent or guardian set up your account and manages it, so they stay linked." };
      case "password_required":
        // Settings were out of date: the refreshed confirm step asks for the new password.
        refresh();
        return { message: "They made your password, so choose a new one to remove them." };
      case "not_found":
      case "not_linked":
        // Removed already (from another tab, say): the refreshed Settings show who's still linked.
        refresh();
        return { message: "That parent or guardian isn't linked to your account anymore." };
      default:
        return passwordErrorState(result.error);
    }
  }
  if (result.passwordChanged) await signInAgainHere(student.id);
  redirect(result.passwordChanged ? "/dashboard?parent=removed&settings=password" : "/dashboard?parent=removed");
}

async function linkedChild(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const studentId = z.uuid().safeParse(formData.get("studentId"));
  if (!studentId.success) redirect("/parent");
  const db = await getDb();
  if (!(await isLinkedParent(db, parent.id, studentId.data))) redirect("/parent");
  return { db, studentId: studentId.data };
}

/** Parents correct a linked child's grade. "Keep as is" and unchanged values do nothing. */
export async function setChildGradeAction(formData: FormData) {
  const { db, studentId } = await linkedChild(formData);
  const picked = pickedGrade(formData);
  const saved = picked === null || (await setStudentGrade(db, studentId, picked.grade, new Date(), picked.schoolYear));
  redirect(saved ? "/parent?saved=1" : "/parent?stale=1");
}

export async function setChildRemindersAction(formData: FormData) {
  const { db, studentId } = await linkedChild(formData);
  await setRemindersEnabled(db, studentId, formData.get("reminders") === "on");
  redirect("/parent?saved=1");
}
