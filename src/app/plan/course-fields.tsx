"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FieldError } from "@/components/ui";
import type { CourseStatus } from "@/db/schema";
import {
  COURSE_GRADE_LEVELS,
  COURSE_LEVELS,
  COURSE_STATUSES,
  COURSE_SUBJECTS,
  COURSE_TERMS,
  CREDIT_OPTIONS,
  GRADE_LABELS,
  LETTER_GRADES,
  LEVEL_LABELS,
  STATUS_LABELS,
  SUBJECT_LABELS,
  TERM_LABELS,
  gradeName,
} from "@/lib/courses/catalog";

type Errors = Record<string, string[] | undefined> | undefined;

/** What the form starts with: a course being edited, or sensible defaults for a new one. */
export type CourseDefaults = {
  name: string;
  subject: string;
  level: string;
  gradeLevel: number;
  term: string;
  credits: number;
  status: CourseStatus;
  finalGrade: string;
  highSchoolCredit: boolean;
};

const control =
  "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent";

function describedBy(...ids: (string | false | 0 | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
}

function SelectField({
  id,
  name,
  label,
  hint,
  options,
  defaultValue,
  errors,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  errors?: string[];
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {/* Keyed so React remounts it with the new default after a form reset. */}
      <select
        key={defaultValue}
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, errors?.length && `${id}-error`)}
        className={control}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-error`} errors={errors} />
    </div>
  );
}

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((v) => ({ value: v, label: labels[v] }));

const creditLabel = (c: number) => (c === 0.5 ? "0.5 (usually a semester)" : c === 1 ? "1 (usually a full year)" : String(c));

/**
 * The fields of the add and edit course forms. `values` holds what was just submitted (after a
 * validation error) so nothing the student typed is lost; otherwise `defaults` fill the form.
 */
export function CourseFields({
  values,
  errors,
  defaults,
  editGradeLevel = false,
  focusName = false,
}: {
  values: Record<string, string>;
  errors: Errors;
  defaults: CourseDefaults;
  /** The edit form lets students move a course to another grade; the add form's grade is fixed. */
  editGradeLevel?: boolean;
  focusName?: boolean;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const submitted = Object.keys(values).length > 0;
  const initial = (key: keyof CourseDefaults) => (submitted ? (values[key] ?? "") : String(defaults[key]));
  const [status, setStatus] = useState(initial("status"));
  const creditChecked = submitted ? values.highSchoolCredit === "on" : defaults.highSchoolCredit;

  useEffect(() => {
    if (focusName) nameRef.current?.focus();
  }, [focusName]);

  const nameId = `${id}-name`;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium">
          Course name
        </label>
        <p id={`${nameId}-hint`} className="text-sm text-muted">
          As it appears in your school&apos;s course list, like &quot;Biology&quot; or &quot;AP U.S. History&quot;.
        </p>
        <input
          ref={nameRef}
          id={nameId}
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          defaultValue={initial("name")}
          aria-invalid={errors?.name?.length ? true : undefined}
          aria-describedby={describedBy(`${nameId}-hint`, errors?.name?.length && `${nameId}-error`)}
          className={control}
        />
        <FieldError id={`${nameId}-error`} errors={errors?.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id={`${id}-subject`}
          name="subject"
          label="Subject"
          options={[{ value: "", label: "Choose a subject" }, ...options(COURSE_SUBJECTS, SUBJECT_LABELS)]}
          defaultValue={initial("subject")}
          errors={errors?.subject}
        />
        <SelectField
          id={`${id}-level`}
          name="level"
          label="Level"
          options={options(COURSE_LEVELS, LEVEL_LABELS)}
          defaultValue={initial("level")}
          errors={errors?.level}
        />
        <SelectField
          id={`${id}-term`}
          name="term"
          label="When"
          options={options(COURSE_TERMS, TERM_LABELS)}
          defaultValue={initial("term")}
          errors={errors?.term}
        />
        <SelectField
          id={`${id}-credits`}
          name="credits"
          label="Credits"
          options={CREDIT_OPTIONS.map((c) => ({ value: String(c), label: creditLabel(c) }))}
          defaultValue={initial("credits")}
          errors={errors?.credits}
        />
        {editGradeLevel && (
          <SelectField
            id={`${id}-gradeLevel`}
            name="gradeLevel"
            label="Grade"
            options={COURSE_GRADE_LEVELS.map((g) => ({ value: String(g), label: gradeName(g) }))}
            defaultValue={initial("gradeLevel")}
            errors={errors?.gradeLevel}
          />
        )}
      </div>
      {!editGradeLevel && (
        <>
          <input type="hidden" name="gradeLevel" value={defaults.gradeLevel} />
          <FieldError id={`${id}-gradeLevel-error`} errors={errors?.gradeLevel} />
        </>
      )}

      <fieldset aria-describedby={errors?.status?.length ? `${id}-status-error` : undefined}>
        <legend className="text-sm font-medium">Status</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {COURSE_STATUSES.map((s) => (
            <label
              key={s}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-2 text-center text-sm has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium has-focus-visible:outline-2 has-focus-visible:outline-accent"
            >
              <input
                // Keyed like the selects so a reset after a validation error keeps the submitted choice.
                key={`${s}-${initial("status")}`}
                type="radio"
                name="status"
                value={s}
                defaultChecked={initial("status") === s}
                onChange={() => setStatus(s)}
                className="sr-only"
              />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </div>
        <FieldError id={`${id}-status-error`} errors={errors?.status} />
      </fieldset>

      {status === "completed" && (
        <SelectField
          id={`${id}-finalGrade`}
          name="finalGrade"
          label="Final grade (optional)"
          hint="P, W and I don't count toward your GPA."
          options={[{ value: "", label: "No grade yet" }, ...LETTER_GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }))]}
          defaultValue={initial("finalGrade")}
          errors={errors?.finalGrade}
        />
      )}
      {status !== "completed" && errors?.finalGrade && <FieldError id={`${id}-finalGrade-error`} errors={errors.finalGrade} />}

      <div>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            key={String(creditChecked)}
            type="checkbox"
            name="highSchoolCredit"
            defaultChecked={creditChecked}
            aria-describedby={`${id}-credit-hint`}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>
            <span className="font-medium">Counts for high school credit</span>
            <span id={`${id}-credit-hint`} className="block text-muted">
              {defaults.gradeLevel <= 8
                ? "Most middle school classes don't, but some do — like Algebra I or a world language. Your school counselor can tell you."
                : "Almost every high school class does. Uncheck it if your school says this one doesn't."}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
