"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isLinkedParent, setStudentGrade } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";
import { setRemindersEnabled } from "@/lib/reminders";

// An empty value means "leave it as is" (the select shows "Finished high school" for graduates).
const Grade = z.coerce.number().int().min(6).max(12);

export async function setMyGradeAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const grade = Grade.safeParse(formData.get("grade") || undefined);
  if (grade.success && grade.data !== student.grade) await setStudentGrade(await getDb(), student.id, grade.data);
  redirect("/dashboard?settings=saved");
}

export async function setMyRemindersAction(formData: FormData) {
  const student = await requireUser(["student"]);
  await setRemindersEnabled(await getDb(), student.id, formData.get("enabled") === "on");
  redirect("/dashboard?settings=saved");
}

async function linkedChild(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const studentId = z.uuid().safeParse(formData.get("studentId"));
  if (!studentId.success) redirect("/parent");
  const db = await getDb();
  if (!(await isLinkedParent(db, parent.id, studentId.data))) redirect("/parent");
  return { db, studentId: studentId.data };
}

/** Parents correct a linked child's grade. Unchanged or empty values do nothing. */
export async function setChildGradeAction(formData: FormData) {
  const { db, studentId } = await linkedChild(formData);
  const grade = Grade.safeParse(formData.get("grade") || undefined);
  const shown = Number(formData.get("shownGrade"));
  if (grade.success && grade.data !== shown) await setStudentGrade(db, studentId, grade.data);
  redirect("/parent?saved=1");
}

export async function setChildRemindersAction(formData: FormData) {
  const { db, studentId } = await linkedChild(formData);
  await setRemindersEnabled(db, studentId, formData.get("reminders") === "on");
  redirect("/parent?saved=1");
}
