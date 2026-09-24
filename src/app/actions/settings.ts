"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isLinkedParent, setStudentGrade } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";
import { setRemindersEnabled } from "@/lib/reminders";

const Grade = z.coerce.number().int().min(7).max(12);

export async function setMyGradeAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const grade = Grade.safeParse(formData.get("grade"));
  if (grade.success) await setStudentGrade(await getDb(), student.id, grade.data);
  redirect("/dashboard?settings=saved");
}

export async function setMyRemindersAction(formData: FormData) {
  const student = await requireUser(["student"]);
  await setRemindersEnabled(await getDb(), student.id, formData.get("enabled") === "on");
  redirect("/dashboard?settings=saved");
}

/** Parents manage settings for linked children (grade corrections, reminder emails). */
export async function setChildSettingsAction(formData: FormData) {
  const parent = await requireUser(["parent"]);
  const studentId = z.uuid().safeParse(formData.get("studentId"));
  if (!studentId.success) redirect("/parent");
  const db = await getDb();
  if (!(await isLinkedParent(db, parent.id, studentId.data))) redirect("/parent");
  const grade = Grade.safeParse(formData.get("grade"));
  if (grade.success) await setStudentGrade(db, studentId.data, grade.data);
  await setRemindersEnabled(db, studentId.data, formData.get("reminders") === "on");
  redirect("/parent?saved=1");
}
