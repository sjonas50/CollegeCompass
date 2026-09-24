"use client";

import { requestFreeAccessAction } from "@/app/actions/access";
import { Button, FieldError, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

/** The whole free-access "application": one statement to check. Nothing else is asked or kept. */
export function FreeAccessForm({ renewal, months }: { renewal: boolean; months: number }) {
  const [state, action, pending, values] = useFormAction<FormState>(requestFreeAccessAction, undefined);
  const error = state?.errors?.statement;
  return (
    <form action={action} className="space-y-4">
      <FormMessage message={state?.message} />
      <label className="flex items-start gap-3 rounded-lg border border-border p-4">
        <input
          type="checkbox"
          name="statement"
          // Keyed so the box stays checked after a form reset when it was checked.
          key={values.statement ?? ""}
          defaultChecked={values.statement === "on"}
          aria-invalid={error?.length ? true : undefined}
          aria-describedby={error?.length ? "statement-error" : undefined}
          className="mt-1 size-5 shrink-0"
        />
        <span>
          Our family qualifies for free or reduced-price school meals, SNAP, Medicaid, or similar help, or the cost would keep us from
          using College Compass.
        </span>
      </label>
      <FieldError id="statement-error" errors={error} />
      <p className="text-sm text-muted">
        We don&apos;t ask for proof and we don&apos;t save a reason. It covers everyone in your family&apos;s account for {months} months,
        and you can renew it.
      </p>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {renewal ? "Renew free access" : "Turn on free access"}
      </Button>
    </form>
  );
}
