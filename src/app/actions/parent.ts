"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { ChildAccountSchema, createChildAccount } from "@/lib/accounts";
import { isUnder13 } from "@/lib/auth/age";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { requireUser } from "@/lib/auth/dal";
import { completeConsentRequest, findConsentRequest } from "@/lib/consent/requests";
import { verifyParentConsent } from "@/lib/consent/verifier";
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
    return { message: "We couldn't create this account. Please check the details and try again." };
  }

  // Finishing a child's consent request: the parent's email is no longer needed as a contact.
  const consentToken = formData.get("consentToken");
  if (typeof consentToken === "string" && consentToken) {
    const request = await findConsentRequest(db, consentToken);
    if (request) await completeConsentRequest(db, request.id);
  }
  redirect("/parent?added=1");
}

export async function deleteChildAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const studentId = String(formData.get("studentId") ?? "");
  if (formData.get("confirm") !== "on") redirect(`/parent/children/${studentId}/delete?confirm=required`);
  await deleteStudent(await getDb(), parent.id, studentId);
  redirect("/parent?deleted=1");
}

export async function deleteParentAccountAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  if (formData.get("confirm") !== "on") redirect("/parent/delete?confirm=required");
  await deleteParentAccount(await getDb(), parent.id);
  await clearSessionCookie();
  redirect("/?account-deleted=1");
}
