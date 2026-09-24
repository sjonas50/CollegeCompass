"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { type ListFormState, updateEntryAction } from "@/app/actions/applications";
import { Button, Field, FieldError, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { AidOffer, ApplicationChecklist, CollegeListStatus, DeadlineType } from "@/db/schema";
import {
  AID_FIELDS,
  AID_FIELD_LABELS,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  type ChecklistKey,
  DEADLINE_TYPES,
  DEADLINE_TYPE_LABELS,
  LIST_STATUSES,
  STATUS_LABELS,
} from "@/lib/applications/labels";
import { NOTES_MAX } from "@/lib/applications/validation";

export type EditableEntry = {
  id: string;
  name: string;
  status: CollegeListStatus;
  deadlineType: DeadlineType | null;
  deadline: string | null;
  notes: string | null;
  checklist: ApplicationChecklist;
  aidOffer: AidOffer | null;
};

const control =
  "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent";

/** Names of the fields that 7th–10th graders see only after opening "You'll use these…". */
const LATER_FIELDS = ["status", "deadlineType", ...CHECKLIST_KEYS.map((k) => `check_${k}`), ...AID_FIELDS.map((f) => `aid_${f}`)];

function Select({
  name,
  label,
  value,
  options,
  errors,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  errors?: string[];
  hint?: string;
}) {
  const described = [hint && `${name}-hint`, errors?.length && `${name}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={`${name}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {/* Keyed so a reset after saving shows the submitted choice. */}
      <select key={value} id={name} name={name} defaultValue={value} aria-invalid={errors?.length ? true : undefined} aria-describedby={described} className={control}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError id={`${name}-error`} errors={errors} />
    </div>
  );
}

/**
 * Everything about one list entry: status, deadline, checklist, aid offer and notes. For grades
 * 7–10 the application-only parts sit behind "You'll use these in 11th and 12th grade".
 */
export function EntryForm({
  entry,
  applying,
  deadlineMin,
  deadlineMax,
}: {
  entry: EditableEntry;
  applying: boolean;
  deadlineMin: string;
  deadlineMax: string;
}) {
  const [state, action, pending, values] = useFormAction<ListFormState>(updateEntryAction, undefined);
  // After a save (or a failed one), show what was submitted; before that, what's saved.
  const submitted = Object.keys(values).length > 0;
  const text = (name: string, saved: string) => (submitted ? (values[name] ?? "") : saved);
  const checked = (k: ChecklistKey) => (submitted ? values[`check_${k}`] === "on" : entry.checklist[k] === true);
  const errors = state?.ok ? undefined : state?.errors;
  const done = CHECKLIST_KEYS.filter((k) => entry.checklist[k] === true).length;

  const status = (
    <Select
      name="status"
      label="Where things stand"
      value={text("status", entry.status)}
      options={LIST_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
      errors={errors?.status}
    />
  );

  const deadlineType = (
    <Select
      name="deadlineType"
      label="Deadline type"
      hint="Colleges list these on their admission pages."
      value={text("deadlineType", entry.deadlineType ?? "")}
      options={[{ value: "", label: "Not sure yet" }, ...DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABELS[t] }))]}
      errors={errors?.deadlineType}
    />
  );

  const deadline = (
    <Field
      type="date"
      name="deadline"
      label="Deadline"
      hint="Check the college's or program's website for the date. Leave it blank if you don't know it yet."
      min={deadlineMin}
      max={deadlineMax}
      defaultValue={text("deadline", entry.deadline ?? "")}
      errors={errors?.deadline}
    />
  );

  const checklist = (
    <fieldset>
      <legend className="font-medium">Application checklist</legend>
      <p className="text-sm text-muted">
        {done} of {CHECKLIST_KEYS.length} done. Not every school needs every step.
      </p>
      <input type="hidden" name="has_checklist" value="1" />
      <div className="mt-2 space-y-1">
        {CHECKLIST_KEYS.map((k) => {
          const { label, hint } = CHECKLIST_LABELS[k];
          const hintId = `check_${k}-hint`;
          return (
            <label key={k} className="flex min-h-11 items-start gap-3 py-1 text-sm">
              <input
                key={`${k}-${checked(k)}`}
                type="checkbox"
                name={`check_${k}`}
                defaultChecked={checked(k)}
                aria-describedby={hint ? hintId : undefined}
                className="mt-0.5 size-5 shrink-0 accent-accent"
              />
              <span>
                <span className="font-medium">{label}</span>
                {hint && (
                  <span id={hintId} className="block text-muted">
                    {hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );

  const aid = (
    <fieldset>
      <legend className="font-medium">Aid offer</legend>
      <p className="text-sm text-muted">
        Copy the yearly amounts from the college&apos;s aid offer, in whole dollars. Leave a box blank if it isn&apos;t on your offer.
      </p>
      <input type="hidden" name="has_aid" value="1" />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {AID_FIELDS.map((f) => (
          <Field
            key={f}
            name={`aid_${f}`}
            label={AID_FIELD_LABELS[f].label}
            hint={AID_FIELD_LABELS[f].hint}
            inputMode="numeric"
            autoComplete="off"
            placeholder="$"
            defaultValue={text(`aid_${f}`, entry.aidOffer?.[f] === undefined ? "" : String(entry.aidOffer[f]))}
            errors={errors?.[`aid_${f}`]}
          />
        ))}
      </div>
      <p className="mt-2 text-sm">
        <Link href="/applications/compare" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Compare aid offers
        </Link>
      </p>
    </fieldset>
  );

  const notes = (
    <div>
      <label htmlFor="notes" className="block text-sm font-medium">
        Notes
      </label>
      <p id="notes-hint" className="text-sm text-muted">
        Just for you: questions to ask, what you liked, visit dates. Please don&apos;t save passwords here.
      </p>
      <textarea
        id="notes"
        name="notes"
        rows={4}
        maxLength={NOTES_MAX}
        defaultValue={text("notes", entry.notes ?? "")}
        aria-invalid={errors?.notes?.length ? true : undefined}
        aria-describedby={["notes-hint", errors?.notes?.length && "notes-error"].filter(Boolean).join(" ")}
        className={`${control} py-2`}
      />
      <FieldError id="notes-error" errors={errors?.notes} />
    </div>
  );

  let body: ReactNode;
  if (applying) {
    body = (
      <>
        {status}
        <fieldset className="space-y-4">
          <legend className="font-medium">Deadline</legend>
          {deadlineType}
          {deadline}
        </fieldset>
        {checklist}
        {aid}
        {notes}
      </>
    );
  } else {
    const openLater = LATER_FIELDS.some((f) => errors?.[f]?.length);
    body = (
      <>
        {deadline}
        {notes}
        <details open={openLater || undefined} className="rounded-lg border border-border p-4">
          {/* Left as a list item (not flex) so browsers keep the open/closed triangle. */}
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium focus-visible:outline-2 focus-visible:outline-accent">
            You&apos;ll use these in 11th and 12th grade
          </summary>
          <p className="text-sm text-muted">Where things stand, deadline type, an application checklist and an aid offer.</p>
          <div className="mt-4 space-y-6">
            {status}
            {deadlineType}
            {checklist}
            {aid}
          </div>
        </details>
      </>
    );
  }

  return (
    <form action={action} className="space-y-6" aria-label={`Update ${entry.name}`}>
      <input type="hidden" name="entryId" value={entry.id} />
      <FormMessage message={state?.ok ? undefined : state?.message} />
      {body}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <p role="status" className="text-sm">
          {state?.ok ? state.message : ""}
        </p>
      </div>
    </form>
  );
}
