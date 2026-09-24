"use client";

import { useState } from "react";
import { type ListFormState, addCustomEntryAction } from "@/app/actions/applications";
import { Button, Field, FieldError, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { ENTRY_KINDS, KIND_LABELS } from "@/lib/applications/labels";
import { NAME_MAX } from "@/lib/applications/validation";

/** Adds a college or program that isn't in the college search, like an apprenticeship. */
export function AddCustomForm() {
  const [saved, setSaved] = useState(0);
  const [state, action, pending, values] = useFormAction<ListFormState>(async (prev, formData) => {
    const res = await addCustomEntryAction(prev, formData);
    if (res?.ok) setSaved((n) => n + 1);
    return res;
  }, undefined);
  const ok = Boolean(state?.ok);
  const v = ok ? {} : values;
  const errors = ok ? undefined : state?.errors;
  const kind = v.kind ?? "program";

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 id="add-custom-title" className="font-medium">
        Add one that isn&apos;t in our search
      </h3>
      <p className="mt-1 text-sm text-muted">Like an apprenticeship, a training program, or a school outside the U.S.</p>
      <p role="status" className="mt-2 text-sm">
        {ok ? state?.message : ""}
      </p>
      {/* Remounted after each save so the fields start fresh. */}
      <form key={saved} action={action} aria-labelledby="add-custom-title" className="mt-2 space-y-4">
        <FormMessage message={ok ? undefined : state?.message} />
        <Field label="Name" name="name" required maxLength={NAME_MAX} autoComplete="off" defaultValue={v.name ?? ""} errors={errors?.name} />
        <fieldset>
          <legend className="text-sm font-medium">What is it?</legend>
          <div className="mt-1 space-y-1">
            {ENTRY_KINDS.map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-3">
                <input
                  // Keyed so a reset after a validation error keeps the submitted choice.
                  key={`${k}-${kind}`}
                  type="radio"
                  name="kind"
                  value={k}
                  defaultChecked={kind === k}
                  className="size-5 shrink-0 accent-accent"
                  aria-describedby={errors?.kind ? "kind-error" : undefined}
                />
                {KIND_LABELS[k]}
              </label>
            ))}
          </div>
          <FieldError id="kind-error" errors={errors?.kind} />
        </fieldset>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Adding…" : "Add to my list"}
        </Button>
      </form>
    </div>
  );
}
