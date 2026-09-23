"use client";

import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { Button, Card, Field, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending, values] = useFormAction<FormState>(loginAction, undefined);
  return (
    <Card>
      <form action={action} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <FormMessage message={state?.message} />
        <Field label="Email or username" name="identifier" autoComplete="username" required defaultValue={values.identifier} errors={state?.errors?.identifier} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required errors={state?.errors?.password} />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        New here? <Link href="/signup" className="underline">Create an account</Link>
      </p>
    </Card>
  );
}
