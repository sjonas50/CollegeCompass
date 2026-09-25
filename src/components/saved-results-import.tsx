"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { importSavedResultsAction } from "@/app/actions/try";
import { forgetSavedAssessment, useSavedAssessment, useSavedStrengths } from "@/app/try/saved-store";
import { Button, Card, FormMessage } from "@/components/ui";
import type { InstrumentStatus } from "@/lib/assessments/service";
import {
  SAVED_ASSESSMENT_FIELD,
  SAVED_STRENGTHS_FIELD,
  type SavedAssessment,
  type SavedStrengths,
  describeSavedQuiz,
  isComplete,
  isFinished,
  serializeSavedAssessment,
} from "@/lib/assessments/anonymous";

/**
 * Offers to bring a free quiz finished in this browser (at /try) into the signed-in student's
 * account, with its strengths add-on when that's finished too. Renders nothing unless the browser
 * holds a finished quiz. The dashboard shows it only while the student hasn't finished the
 * interests activity; the server refuses a second import.
 *
 * - `startedInterests`: the student has an unfinished interests activity, which these answers replace.
 * - `personality`: the student's own personality (strengths) activity. Once they've started or
 *   finished it, the strengths from this browser aren't added (the server never replaces answers
 *   given in the account), and the card says so.
 */
export function SavedResultsImport({
  startedInterests = false,
  personality = "not_started",
}: {
  startedInterests?: boolean;
  personality?: InstrumentStatus["state"];
}) {
  const saved = useSavedAssessment();
  const strengths = useSavedStrengths();
  if (!isFinished(saved)) return null;
  return (
    <ImportCard
      saved={saved}
      strengths={isComplete(strengths) ? strengths : null}
      startedInterests={startedInterests}
      personality={personality}
    />
  );
}

/** Why the strengths from this browser stay out of the account, when they do. */
const STRENGTHS_KEPT_OUT: Partial<Record<InstrumentStatus["state"], string>> = {
  in_progress:
    "The strengths answers on this device won't be added, because you've started the strengths activity in your account. You can finish it there.",
  done: "The strengths answers on this device won't be added, because your account already has your strengths.",
};

/** The card itself, for a finished quiz (exported for tests: the browser's copy is read only in the browser). */
export function ImportCard({
  saved,
  strengths: browserStrengths,
  startedInterests,
  personality = "not_started",
}: {
  saved: SavedAssessment;
  strengths: SavedStrengths | null;
  startedInterests: boolean;
  personality?: InstrumentStatus["state"];
}) {
  const keptOut = browserStrengths ? STRENGTHS_KEPT_OUT[personality] : undefined;
  const strengths = keptOut ? null : browserStrengths;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function add() {
    setError(undefined);
    startTransition(async () => {
      const res = await importSavedResultsAction(
        serializeSavedAssessment(saved),
        strengths ? serializeSavedAssessment(strengths) : undefined,
      );
      if (!res.ok) return setError(res.message);
      forgetSavedAssessment();
      router.push("/discover/results");
    });
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Add your quiz results?</h2>
      <p className="text-sm text-muted">
        {describeSavedQuiz(saved, undefined, { strengths: Boolean(strengths) })} If that was you, add the results to your
        account to see your career matches.
      </p>
      {startedInterests && (
        <p className="text-sm text-muted">These answers will take the place of the interests activity you started here.</p>
      )}
      {keptOut && <p className="text-sm text-muted">{keptOut}</p>}
      <FormMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={add} disabled={pending}>
          {pending ? "Adding…" : "Add my results"}
        </Button>
        <Button variant="secondary" onClick={forgetSavedAssessment} disabled={pending}>
          Not mine, remove them
        </Button>
      </div>
    </Card>
  );
}

type QuizChoiceProps = {
  /** A parent creating a child's account, rather than a student's own signup. */
  forChild?: boolean;
  /**
   * Ticked only when the person just asked to save these results ("Save my results" on /try/results).
   * Otherwise a shared family or library computer could add someone else's quiz to a new account.
   */
  defaultChecked?: boolean;
  /**
   * The form's last submitted values (useFormAction's `values`, empty until the first submit). React
   * resets a form after its action, so after a submit the box starts as it was sent, like the rest
   * of the form.
   */
  submitted?: Record<string, string>;
};

/**
 * For account-creation forms: sends a free quiz finished in this browser with the form, in the
 * `savedAssessment` field, while the box is ticked, and its strengths add-on in `savedStrengths`
 * when that's finished too. Renders nothing when there's no finished quiz. Only the answers are
 * sent; the server checks them strictly and scores them itself.
 */
export function SavedQuizField(props: QuizChoiceProps) {
  const saved = useSavedAssessment();
  const strengths = useSavedStrengths();
  if (!isFinished(saved)) return null;
  return <SavedQuizChoice saved={saved} strengths={isComplete(strengths) ? strengths : null} {...props} />;
}

/**
 * As a form is submitted, adds the strengths answers to its data when the quiz is going with it,
 * and only then (see SavedQuizChoice).
 */
export function addSavedStrengths(formData: FormData, strengths: string) {
  if (formData.get(SAVED_ASSESSMENT_FIELD)) formData.set(SAVED_STRENGTHS_FIELD, strengths);
}

/**
 * The box for a finished quiz. It says when the quiz was taken and its top interests, so whoever is
 * signing up can tell whether it's theirs.
 *
 * The box is itself the `savedAssessment` field, and uncontrolled, so the quiz is sent exactly when
 * the box shows a tick, whatever React's form reset does. The strengths answers follow the quiz
 * into the form's data as it's submitted.
 */
export function SavedQuizChoice({
  saved,
  strengths = null,
  forChild = false,
  defaultChecked = false,
  submitted = {},
  now,
}: QuizChoiceProps & { saved: SavedAssessment; strengths?: SavedStrengths | null; now?: Date }) {
  const aboutId = `${useId()}-about`;
  const box = useRef<HTMLInputElement>(null);
  // After a submit, as it was sent; before one, the form's default.
  const ticked = Object.keys(submitted).length > 0 ? Boolean(submitted[SAVED_ASSESSMENT_FIELD]) : defaultChecked;
  const strengthsAnswers = strengths ? serializeSavedAssessment(strengths) : null;

  useEffect(() => {
    const form = box.current?.form;
    if (!form || !strengthsAnswers) return;
    const add = (event: FormDataEvent) => addSavedStrengths(event.formData, strengthsAnswers);
    form.addEventListener("formdata", add);
    return () => form.removeEventListener("formdata", add);
  }, [strengthsAnswers]);

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <label className="flex min-h-11 items-start gap-3 py-1">
        <input
          ref={box}
          type="checkbox"
          name={SAVED_ASSESSMENT_FIELD}
          value={serializeSavedAssessment(saved)}
          defaultChecked={ticked}
          aria-describedby={aboutId}
          className="mt-0.5 size-5 shrink-0"
        />
        <span>
          {forChild
            ? "My child took the free quiz on this device. Add those results to their account."
            : "Add the free quiz results saved on this device to my account"}
        </span>
      </label>
      <p id={aboutId} className="mt-1 pl-8 text-muted">
        {describeSavedQuiz(saved, now, { strengths: Boolean(strengths) })}{" "}
        {forChild ? "Only add them if this child took the quiz." : "Only add them if you took the quiz."}
      </p>
    </div>
  );
}
