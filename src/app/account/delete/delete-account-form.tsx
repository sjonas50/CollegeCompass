"use client";

import { deleteMyAccountAction } from "@/app/actions/settings";
import { Button, ButtonLink, Field, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

export function DeleteAccountForm() {
  const [state, action, pending] = useFormAction<FormState>(deleteMyAccountAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage message={state?.message} />
      <Field
        label="Your password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={state?.errors?.password}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          Delete my account permanently
        </Button>
        <ButtonLink href="/dashboard" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
