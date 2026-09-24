"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { MAX_COURSES, addCourse, deleteCourse, updateCourse } from "@/lib/courses/service";
import { CourseInputSchema, type CourseFormState, courseFormInput } from "@/lib/courses/validation";
import { fieldErrors } from "@/lib/forms";

const NOT_FOUND = "We couldn't find that course. It may have been removed already — try refreshing the page.";

export async function addCourseAction(_prev: CourseFormState, formData: FormData): Promise<CourseFormState> {
  const student = await requireUser(["student"]);
  const parsed = CourseInputSchema.safeParse(courseFormInput(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const res = await addCourse(await getDb(), student.id, parsed.data);
  if (!res.ok) {
    return { message: `You've added ${MAX_COURSES} courses, which is the most we can keep. Remove a few you don't need to add more.` };
  }
  revalidatePath("/plan");
  return { ok: true, message: `Added ${res.value.name}.` };
}

export async function updateCourseAction(_prev: CourseFormState, formData: FormData): Promise<CourseFormState> {
  const student = await requireUser(["student"]);
  const parsed = CourseInputSchema.safeParse(courseFormInput(formData));
  if (!parsed.success) return fieldErrors(parsed.error);

  const res = await updateCourse(await getDb(), student.id, String(formData.get("courseId") ?? ""), parsed.data);
  if (!res.ok) return { message: NOT_FOUND };
  revalidatePath("/plan");
  return { ok: true };
}

export async function deleteCourseAction(_prev: CourseFormState, formData: FormData): Promise<CourseFormState> {
  const student = await requireUser(["student"]);
  const res = await deleteCourse(await getDb(), student.id, String(formData.get("courseId") ?? ""));
  if (!res.ok) return { message: NOT_FOUND };
  revalidatePath("/plan");
  return { ok: true };
}
