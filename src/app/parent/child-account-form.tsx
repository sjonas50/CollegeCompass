"use client";

import { createChildAction } from "@/app/actions/parent";
import { BirthdayFields, Button, Card, Field, FieldError, FormMessage, GradeSelect } from "@/components/ui";
import { SavedQuizField } from "@/components/saved-results-import";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

/**
 * Creates a student account in the parent's household. The consent checkbox is required by the
 * server only when the child is under 13.
 */
export function ChildAccountForm({ consentToken }: { consentToken?: string }) {
  const [state, action, pending, values] = useFormAction<FormState>(createChildAction, undefined);
  return (
    <Card>
      <form action={action} className="space-y-4">
        {consentToken && <input type="hidden" name="consentToken" value={consentToken} />}
        <FormMessage message={state?.message} />
        <Field label="Child's first name or nickname" name="displayName" required defaultValue={values.displayName} errors={state?.errors?.displayName} />
        <BirthdayFields
          legend="Child's birthday"
          errors={state?.errors?.birthDate}
          defaults={{ month: values.birthMonth, day: values.birthDay, year: values.birthYear }}
        />
        <GradeSelect errors={state?.errors?.grade} defaultValue={values.grade} />
        <Field
          label="Username for your child"
          name="username"
          autoComplete="off"
          hint="Your child signs in with this. Avoid using their full name."
          required
          defaultValue={values.username}
          errors={state?.errors?.username}
        />
        <Field
          label="Password for your child"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Share it with your child."
          required
          errors={state?.errors?.password}
        />
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">If your child is under 13</p>
          <p className="mt-1 text-muted">
            College Compass stores your child&apos;s first name, birthday, grade, their assessment answers and plans,
            and their conversations with our AI counselor, to guide them toward college. We never sell their data,
            show ads, or use it to train AI. At any time, you can download a copy of everything, including their
            counselor chats, or delete it all from your parent page.
          </p>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" name="consent" className="mt-1 size-4" />
            <span>I am this child&apos;s parent or legal guardian, and I consent to College Compass collecting and using their information as described.</span>
          </label>
          <FieldError id="consent-error" errors={state?.errors?.consent} />
        </div>
        <p className="text-sm text-muted">
          If your child is 13 or older, the account is theirs. You&apos;ll see their progress and plans, but their chats
          with our AI counselor stay private to them, and your download of their data leaves those chats out.
        </p>
        {/* Unticked by default, so a parent's own quiz (or another child's) isn't added by mistake. */}
        <SavedQuizField forChild />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          Create my child&apos;s account
        </Button>
      </form>
    </Card>
  );
}
