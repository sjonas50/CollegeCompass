"use client";

import Link from "next/link";
import {
  type AgeGateState,
  type ParentRequestState,
  checkAgeAction,
  registerStudentAction,
  requestParentConsentAction,
} from "@/app/actions/auth";
import { SavedQuizField } from "@/components/saved-results-import";
import { BirthdayFields, Button, Card, Field, FormMessage, GradeSelect, Notice, PageHeading } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { isFinished } from "@/lib/assessments/anonymous";
import type { FormState } from "@/lib/forms";
import { useSavedAssessment } from "../try/saved-store";

/**
 * `savingQuiz`: the visitor came from "Save my results" on the free quiz's results, so the box that
 * adds the quiz saved on this device starts ticked. Otherwise it starts unticked: on a shared
 * computer the saved quiz may be someone else's.
 */
export function StudentSignup({ startWithParentStep, savingQuiz = false }: { startWithParentStep: boolean; savingQuiz?: boolean }) {
  const [age, ageAction, agePending, ageValues] = useFormAction<AgeGateState>(
    checkAgeAction,
    startWithParentStep ? { step: "child" } : undefined,
  );

  if (age && "step" in age && age.step === "child") return <ParentHandoff />;
  if (age && "step" in age && age.step === "teen") return <TeenSignup birthDate={age.birthDate} savingQuiz={savingQuiz} />;

  const errors = age && "errors" in age ? age.errors : undefined;
  return (
    <>
      <PageHeading title="Let's get started" lead="First, when's your birthday?" />
      <Card>
        <form action={ageAction} className="space-y-4">
          <BirthdayFields
            legend="Your birthday"
            errors={errors?.birthDate}
            defaults={{ month: ageValues.birthMonth, day: ageValues.birthDay, year: ageValues.birthYear }}
          />
          <Button type="submit" disabled={agePending} className="w-full sm:w-auto">
            Continue
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-muted">
        Already have an account? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </>
  );
}

function TeenSignup({ birthDate, savingQuiz }: { birthDate: string; savingQuiz: boolean }) {
  const [state, action, pending, values] = useFormAction<FormState>(registerStudentAction, undefined);
  return (
    <>
      <PageHeading title="Create your account" lead="Just the basics. You can change these later." />
      <Card>
        <form action={action} className="space-y-4">
          <input type="hidden" name="birthDate" value={birthDate} />
          <FormMessage message={state?.message} />
          <Field label="First name or nickname" name="displayName" autoComplete="given-name" required defaultValue={values.displayName} errors={state?.errors?.displayName} />
          <GradeSelect errors={state?.errors?.grade} defaultValue={values.grade} />
          <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={values.email} errors={state?.errors?.email} />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters. A short phrase is easiest to remember."
            required
            errors={state?.errors?.password}
          />
          <SavedQuizField defaultChecked={savingQuiz} />
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            Create account
          </Button>
        </form>
      </Card>
    </>
  );
}

/** For a child who comes back once their parent has set things up. */
function SignInWithUsername() {
  return (
    <p className="mt-4 text-sm text-muted">
      Got your username from your parent? <Link href="/login" className="underline">Sign in</Link>
    </p>
  );
}

/** After the email to the parent went out (`delayed`: it may take a few minutes to arrive). */
export function ParentEmailSent({ delayed }: { delayed: boolean }) {
  return (
    <>
      <PageHeading title="Check with your parent" />
      <Notice>
        We sent your parent an email. Once they set things up, they&apos;ll give you your username and password.
        {delayed && <> It may take a few minutes to arrive. If your parent doesn&apos;t see it soon, ask them to check their spam folder.</>}
      </Notice>
      <SignInWithUsername />
    </>
  );
}

function ParentHandoff() {
  const [state, action, pending, values] = useFormAction<ParentRequestState>(requestParentConsentAction, undefined);
  if (state && "sent" in state) return <ParentEmailSent delayed={Boolean(state.delayed)} />;
  const errors = state && "errors" in state ? state.errors : undefined;
  const message = state && "message" in state ? state.message : undefined;
  return (
    <>
      <PageHeading
        title="Let's get a parent to help"
        lead="A parent or guardian needs to set up your account. Enter their email and we'll send them a link."
      />
      <Card>
        <form action={action} className="space-y-4">
          <Field label="Parent's email" name="parentEmail" type="email" required defaultValue={values.parentEmail} errors={errors?.parentEmail} />
          <p className="text-sm text-muted">
            We only use this email to ask your parent for permission. If they don&apos;t respond, we delete it.
          </p>
          <SavedQuizNote />
          {message && (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            Send to my parent
          </Button>
        </form>
      </Card>
      <SignInWithUsername />
    </>
  );
}

/** Under-13s can't sign up themselves, so the quiz waits in this browser until they sign in. */
function SavedQuizNote() {
  const saved = useSavedAssessment();
  if (!isFinished(saved)) return null;
  return (
    <p className="text-sm text-muted">
      Your quiz results stay on this device. Once your parent sets up your account, sign in here and you can add them.
    </p>
  );
}
