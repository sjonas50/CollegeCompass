"use client";

import Link from "next/link";
import { registerParentAction } from "@/app/actions/auth";
import { Button, Card, Field, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

export function ParentSignupForm({ next }: { next?: string }) {
  const [state, action, pending, values] = useFormAction<FormState>(registerParentAction, undefined);
  return (
    <Card>
      <form action={action} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <FormMessage message={state?.message} />
        <Field label="Your first name" name="displayName" autoComplete="given-name" required defaultValue={values.displayName} errors={state?.errors?.displayName} />
        <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={values.email} errors={state?.errors?.email} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required errors={state?.errors?.password} />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          Create parent account
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have one?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
