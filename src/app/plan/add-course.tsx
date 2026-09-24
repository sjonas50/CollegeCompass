"use client";

import { useEffect, useRef, useState } from "react";
import { addCourseAction } from "@/app/actions/plan";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { CourseStatus } from "@/db/schema";
import { gradeName } from "@/lib/courses/catalog";
import type { CourseFormState } from "@/lib/courses/validation";
import { CourseFields } from "./course-fields";

/**
 * "Add a course" for one grade. Stays open after saving so students can add several classes in a
 * row; the form clears and focus returns to the course name.
 */
export function AddCourse({
  gradeLevel,
  defaultStatus,
  defaultHighSchoolCredit,
  startOpen = false,
}: {
  gradeLevel: number;
  defaultStatus: CourseStatus;
  defaultHighSchoolCredit: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [openedByStudent, setOpenedByStudent] = useState(false);
  const [saved, setSaved] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const [state, action, pending, values] = useFormAction<CourseFormState>(async (prev, formData) => {
    const res = await addCourseAction(prev, formData);
    if (res?.ok) setSaved((n) => n + 1);
    return res;
  }, undefined);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  const label = `Add a course to ${gradeName(gradeLevel)}`;
  if (!open) {
    return (
      <Button
        ref={toggleRef}
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => {
          setOpen(true);
          setOpenedByStudent(true);
        }}
      >
        + {label}
      </Button>
    );
  }

  const formId = `add-course-${gradeLevel}`;
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 id={`${formId}-title`} className="font-medium">
        {label}
      </h3>
      <p role="status" className="mt-1 text-sm text-muted">
        {state?.ok && saved > 0 ? `${state.message} Add another, or choose Done.` : ""}
      </p>
      {/* Remounted after each save so every field (including the status choice) starts fresh. */}
      <form key={saved} action={action} aria-labelledby={`${formId}-title`} className="mt-3 space-y-4">
        <FormMessage message={state?.ok ? undefined : state?.message} />
        <CourseFields
          values={state?.ok ? {} : values}
          errors={state?.ok ? undefined : state?.errors}
          defaults={{
            name: "",
            subject: "",
            level: "regular",
            gradeLevel,
            term: "full_year",
            credits: 1,
            status: defaultStatus,
            finalGrade: "",
            highSchoolCredit: defaultHighSchoolCredit,
          }}
          focusName={openedByStudent || saved > 0}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add course"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              returnFocus.current = true;
              setSaved(0);
              setOpen(false);
            }}
          >
            Done
          </Button>
        </div>
      </form>
    </div>
  );
}
