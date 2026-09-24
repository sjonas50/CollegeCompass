"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { deleteConversation } from "@/lib/counselor/conversations";
import { clearMemory } from "@/lib/counselor/memory";

export async function deleteConversationAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const id = z.uuid().safeParse(formData.get("conversationId"));
  if (id.success) await deleteConversation(await getDb(), student.id, id.data);
  redirect("/counselor");
}

export async function clearMemoryAction() {
  const student = await requireUser(["student"]);
  await clearMemory(await getDb(), student.id);
  redirect("/counselor?memory=cleared");
}
