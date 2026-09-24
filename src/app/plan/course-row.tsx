"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteCourseAction, updateCourseAction } from "@/app/actions/plan";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { Course } from "@/lib/courses/service";
import { LEVEL_LABELS, STATUS_LABELS, SUBJECT_LABELS, TERM_LABELS, isLetterGrade } from "@/lib/courses/catalog";
import type { CourseFormState } from "@/lib/courses/validation";
import { CourseFields } from "./course-fields";

export type PlanCourse = Pick<
  Course,
  "id" | "name" | "subject" | "level" | "gradeLevel" | "term" | "credits" | "status" | "finalGrade" | "highSchoolCredit"
>;

const STATUS_STYLES: Record<PlanCourse["status"], string> = {
  planned: "border border-dashed border-border text-muted",
  in_progress: "bg-accent-soft",
  completed: "bg-success-soft",
};

function credits(n: number) {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

function EditCourse({ course, onDone }: { course: PlanCourse; onDone: () => void }) {
  const [state, action, pending, values] = useFormAction<CourseFormState>(async (prev, formData) => {
    const res = await updateCourseAction(prev, formData);
    if (res?.ok) onDone();
    return res;
  }, undefined);
  const titleId = `edit-${course.id}-title`;

  return (
    <form action={action} aria-labelledby={titleId} className="space-y-4">
      <h3 id={titleId} className="font-medium">
        Edit {course.name}
      </h3>
      <input type="hidden" name="courseId" value={course.id} />
      <FormMessage message={state?.message} />
      <CourseFields
        values={values}
        errors={state?.errors}
        defaults={{
          name: course.name,
          subject: course.subject,
          level: course.level,
          gradeLevel: course.gradeLevel,
          term: course.term,
          credits: course.credits,
          status: course.status,
          finalGrade: course.finalGrade ?? "",
          highSchoolCredit: course.highSchoolCredit,
        }}
        editGradeLevel
        focusName
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteCourse({ course, onCancel }: { course: PlanCourse; onCancel: () => void }) {
  const [state, action, pending] = useActionState<CourseFormState, FormData>(deleteCourseAction, undefined);
  // Focus the safe choice, so an accidental Enter keeps the course.
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <form action={action} className="mt-3 rounded-lg bg-danger-soft p-3 text-sm" aria-live="polite">
      <input type="hidden" name="courseId" value={course.id} />
      <p>
        Remove <strong>{course.name}</strong> from your plan?
      </p>
      <FormMessage message={state?.message} />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Removing…" : "Yes, remove it"}
        </Button>
        <Button ref={keepRef} type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Keep it
        </Button>
      </div>
    </form>
  );
}

/** One course in a grade section: details at a glance, plus edit and remove. */
export function CourseRow({ course }: { course: PlanCourse }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<"edit" | "delete" | null>(null);

  useEffect(() => {
    if (mode !== "view" || !returnFocusTo.current) return;
    (returnFocusTo.current === "edit" ? editRef : deleteRef).current?.focus();
    returnFocusTo.current = null;
  }, [mode]);

  function closeEdit() {
    returnFocusTo.current = "edit";
    setMode("view");
  }

  function closeDelete() {
    returnFocusTo.current = "delete";
    setMode("view");
  }

  if (mode === "edit") {
    return (
      <li className="rounded-lg border border-accent p-4">
        <EditCourse course={course} onDone={closeEdit} />
      </li>
    );
  }

  const middleSchool = course.gradeLevel <= 8;
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium break-words">{course.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                course.level === "regular" ? "border border-border" : "bg-accent text-accent-foreground"
              }`}
            >
              {LEVEL_LABELS[course.level]}
            </span>
            <span>{SUBJECT_LABELS[course.subject]}</span>
            <span aria-hidden>·</span>
            <span>{TERM_LABELS[course.term]}</span>
            <span aria-hidden>·</span>
            <span>{credits(course.credits)}</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[course.status]}`}>{STATUS_LABELS[course.status]}</span>
            {course.status === "completed" && isLetterGrade(course.finalGrade) && (
              <span>
                Final grade: <strong>{course.finalGrade}</strong>
              </span>
            )}
          </p>
          {middleSchool && course.highSchoolCredit && <p className="mt-1 text-sm text-muted">Counts for high school credit</p>}
          {!middleSchool && !course.highSchoolCredit && <p className="mt-1 text-sm text-muted">Doesn&apos;t count for high school credit</p>}
        </div>
        {mode === "view" && (
          <div className="flex shrink-0 gap-2">
            <Button ref={editRef} type="button" variant="secondary" className="flex-1 sm:flex-none" onClick={() => setMode("edit")}>
              Edit<span className="sr-only"> {course.name}</span>
            </Button>
            <Button ref={deleteRef} type="button" variant="secondary" className="flex-1 sm:flex-none" onClick={() => setMode("delete")}>
              Remove<span className="sr-only"> {course.name}</span>
            </Button>
          </div>
        )}
      </div>
      {mode === "delete" && <DeleteCourse course={course} onCancel={closeDelete} />}
    </li>
  );
}
