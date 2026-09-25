"use client";

import { changeMyPasswordAction } from "@/app/actions/settings";
import { Button, Field, FormMessage } from "@/components/ui";
import { useFocusFirstInvalid } from "@/components/use-focus-first-invalid";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

/**
 * The current password and a new one typed twice, for changing the password in Settings and for
 * removing a parent who made it. `idPrefix` keeps the ids apart when both are on the page. Nothing
 * typed here is kept for the next render (see useFormAction).
 */
export function NewPasswordFields({ idPrefix, errors }: { idPrefix: string; errors?: Record<string, string[] | undefined> }) {
  return (
    <>
      <Field
        id={`${idPrefix}-current-password`}
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        errors={errors?.currentPassword}
      />
      <Field
        id={`${idPrefix}-new-password`}
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters. Pick one you'll remember. If you forget it, we can't reset it for you."
        errors={errors?.newPassword}
      />
      <Field
        id={`${idPrefix}-confirm-password`}
        label="Type the new password again"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={errors?.confirmPassword}
      />
    </>
  );
}

/** "Change your password" in the student's Settings. A new password signs out every other device. */
export function ChangePasswordForm() {
  const [state, action, pending] = useFormAction<FormState>(changeMyPasswordAction, undefined);
  const form = useFocusFirstInvalid(state);
  return (
    <form ref={form} action={action} className="mt-3 max-w-sm space-y-3">
      <FormMessage message={state?.message} />
      <NewPasswordFields idPrefix="settings" errors={state?.errors} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Change password
      </Button>
    </form>
  );
}
