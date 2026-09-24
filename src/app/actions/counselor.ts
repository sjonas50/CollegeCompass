"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { deleteConversation } from "@/lib/counselor/conversations";
import { clearMemory } from "@/lib/counselor/memory";

// No full-access check here on purpose: deleting conversations and erasing the counselor's notes
// are privacy controls, and those are always free. The locked counselor page still lists past
// conversations so a student can delete them.

/** The counselor page the student was on: /counselor or /counselor/<id>, else /counselor. */
function returnPath(formData: FormData) {
  const raw = formData.get("returnTo");
  const id = typeof raw === "string" ? /^\/counselor\/([0-9a-f-]{36})$/i.exec(raw)?.[1] : undefined;
  return id && z.uuid().safeParse(id).success ? { path: `/counselor/${id}`, id } : { path: "/counselor", id: null };
}

/** Deletes a conversation and returns the student to the chat they were in, unless that was it. */
export async function deleteConversationAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const id = z.uuid().safeParse(formData.get("conversationId"));
  if (id.success) await deleteConversation(await getDb(), student.id, id.data);
  const back = returnPath(formData);
  redirect(back.id && back.id !== (id.success ? id.data : null) ? back.path : "/counselor");
}

export async function clearMemoryAction(formData: FormData) {
  const student = await requireUser(["student"]);
  await clearMemory(await getDb(), student.id);
  redirect(`${returnPath(formData).path}?memory=cleared`);
}
