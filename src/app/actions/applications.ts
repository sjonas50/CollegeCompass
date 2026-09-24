"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { MAX_LIST_ENTRIES, addCollege, addCustom, removeEntry, updateEntry } from "@/lib/applications/service";
import {
  type FieldErrors,
  UnitIdSchema,
  customEntryFormInput,
  entryFormInput,
  formErrors,
} from "@/lib/applications/validation";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";

// Thin wrappers: sign-in and access checks, then the service (which validates and scopes everything
// to the signed-in student). Entry ids from forms are never trusted on their own.

export type ListFormState = { ok?: boolean; message?: string; errors?: FieldErrors } | undefined;

export type AddCollegeState = { status: "idle" | "added" | "already" | "limit" | "not_found"; message?: string };

const FULL_MESSAGE = `Your list already has ${MAX_LIST_ENTRIES} colleges and programs, which is the most it can hold. Remove one you're less sure about to add another.`;
const NOT_FOUND = "We couldn't find that entry. It may have been removed already. Try refreshing the page.";

function revalidateList(entryId?: string) {
  revalidatePath("/applications");
  revalidatePath("/applications/compare");
  if (entryId) revalidatePath(`/applications/${entryId}`);
}

/** "Add to my list" on a college's page. */
export async function addCollegeAction(_prev: AddCollegeState, formData: FormData): Promise<AddCollegeState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const unitId = UnitIdSchema.safeParse(formData.get("unitId"));
  if (!unitId.success) return { status: "not_found", message: "We couldn't find that college. Try refreshing the page." };

  const res = await addCollege(await getDb(), student.id, unitId.data);
  if (!res.ok) {
    return res.error === "limit"
      ? { status: "limit", message: FULL_MESSAGE }
      : { status: "not_found", message: "We couldn't find that college. Try refreshing the page." };
  }
  revalidateList();
  revalidatePath(`/colleges/${unitId.data}`);
  return res.alreadyListed
    ? { status: "already", message: `${res.value.name} is already on your list.` }
    : { status: "added", message: `Added ${res.value.name} to your list.` };
}

/** A college or program that isn't in our search, like an apprenticeship. */
export async function addCustomEntryAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const res = await addCustom(await getDb(), student.id, customEntryFormInput(formData));
  if (!res.ok) {
    if (res.error === "invalid") return { errors: res.errors };
    return { message: res.error === "limit" ? FULL_MESSAGE : "We couldn't add that. Please try again." };
  }
  revalidateList();
  return { ok: true, message: `Added ${res.value.name} to your list.` };
}

export async function updateEntryAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const entryId = String(formData.get("entryId") ?? "");
  const res = await updateEntry(await getDb(), student.id, entryId, entryFormInput(formData));
  if (!res.ok) {
    if (res.error === "invalid") {
      return { errors: formErrors(res.errors), message: "Some answers need a fix. Check the messages below." };
    }
    return { message: NOT_FOUND };
  }
  revalidateList(res.value.id);
  return { ok: true, message: "Saved." };
}

export async function removeEntryAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const res = await removeEntry(await getDb(), student.id, String(formData.get("entryId") ?? ""));
  if (!res.ok) return { message: NOT_FOUND };
  revalidateList();
  redirect("/applications?removed=1");
}
