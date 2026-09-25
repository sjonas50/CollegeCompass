"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { ChildAccountSchema, createChildAccount } from "@/lib/accounts";
import { isUnder13 } from "@/lib/auth/age";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { requireUser } from "@/lib/auth/dal";
import { completeConsentRequest, findConsentRequest } from "@/lib/consent/requests";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { recordCount } from "@/lib/admin/counts";
import { SAVED_ASSESSMENT_FIELD, SAVED_STRENGTHS_FIELD } from "@/lib/assessments/anonymous";
import { importSavedAssessment } from "@/lib/assessments/import";
import { type FormState, birthDateFromForm, fieldErrors } from "@/lib/forms";
import { deleteParentAccount, deleteStudent } from "@/lib/privacy";

export async function createChildAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parent = await requireUser(["parent"]);
  const parsed = ChildAccountSchema.safeParse({
    displayName: formData.get("displayName"),
    username: formData.get("username"),
    password: formData.get("password"),
    birthDate: birthDateFromForm(formData),
    grade: formData.get("grade"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  let consent = null;
  if (isUnder13(parsed.data.birthDate)) {
    consent = await verifyParentConsent({
      parentUserId: parent.id,
      attested: formData.get("consent") === "on",
    });
    if (!consent) {
      return { errors: { consent: ["We need your consent to create an account for a child under 13."] } };
    }
  }

  const db = await getDb();
  const result = await createChildAccount(db, parent.id, parsed.data, consent);
  if (!result.ok) {
    if (result.error === "username_taken") return { errors: { username: ["That username is taken."] } };
    if (result.error === "invalid_grade") return { errors: { grade: ["Choose a grade from the list."] } };
    return { message: "We couldn't create this account. Please check the details and try again." };
  }

  // Finishing a child's consent request: the parent's email is no longer needed as a contact.
  const consentToken = formData.get("consentToken");
  if (typeof consentToken === "string" && consentToken) {
    const request = await findConsentRequest(db, consentToken);
    if (request) await completeConsentRequest(db, request.id);
  }
  // The free quiz the child took on this device (with its strengths add-on, when they took it),
  // when the parent ticked the box.
  const saved = formData.get(SAVED_ASSESSMENT_FIELD);
  const strengths = formData.get(SAVED_STRENGTHS_FIELD);
  let imported = false;
  if (typeof saved === "string" && saved) {
    try {
      imported = (
        await importSavedAssessment(db, parent.id, result.value.userId, saved, {
          via: "parent",
          strengths: typeof strengths === "string" ? strengths : undefined,
        })
      ).ok;
    } catch (error) {
      console.error("[parent] quiz import failed", error instanceof Error ? error.name : "unknown");
    }
  }
  if (imported) await recordCount(db, "child_added_with_quiz");
  // /try/saved clears the browser's copy, so the same answers can't be added to a second child,
  // then goes on to /parent?added=1&imported=1.
  redirect(imported ? "/try/saved" : "/parent?added=1");
}

export async function deleteChildAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  // Nothing was deleted (not an account id, not their child, or already gone): never claim it was,
  // and say no more.
  const studentId = z.uuid().safeParse(formData.get("studentId"));
  if (!studentId.success) redirect("/parent?not-deleted=1");
  if (formData.get("confirm") !== "on") redirect(`/parent/children/${studentId.data}/delete?confirm=required`);
  if (!(await deleteStudent(await getDb(), parent.id, studentId.data))) redirect("/parent?not-deleted=1");
  redirect("/parent?deleted=1");
}

export async function deleteParentAccountAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  if (formData.get("confirm") !== "on") redirect("/parent/delete?confirm=required");
  await deleteParentAccount(await getDb(), parent.id);
  await clearSessionCookie();
  redirect("/?account-deleted=1");
}
