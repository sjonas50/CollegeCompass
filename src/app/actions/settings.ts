"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isLinkedParent, setStudentGrade } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";
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
