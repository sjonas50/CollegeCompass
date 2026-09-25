"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { importSavedResultsAction } from "@/app/actions/try";
import { forgetSavedAssessment, useSavedAssessment, useSavedStrengths } from "@/app/try/saved-store";
import { Button, Card, FormMessage } from "@/components/ui";
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
 * `startedInterests`: the student has an unfinished interests activity, which these answers replace.
 */
export function SavedResultsImport({ startedInterests = false }: { startedInterests?: boolean }) {
  const saved = useSavedAssessment();
  const strengths = useSavedStrengths();
  if (!isFinished(saved)) return null;
  return <ImportCard saved={saved} strengths={isComplete(strengths) ? strengths : null} startedInterests={startedInterests} />;
}

function ImportCard({
  saved,
  strengths,
  startedInterests,
}: {
  saved: SavedAssessment;
  strengths: SavedStrengths | null;
  startedInterests: boolean;
}) {
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
 * The box for a finished quiz. It says when the quiz was taken and its top interests, so whoever is
 * signing up can tell whether it's theirs.
 */
export function SavedQuizChoice({
  saved,
  strengths = null,
  forChild = false,
  defaultChecked = false,
  now,
}: QuizChoiceProps & { saved: SavedAssessment; strengths?: SavedStrengths | null; now?: Date }) {
  const [include, setInclude] = useState(defaultChecked);
  const aboutId = `${useId()}-about`;
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <label className="flex min-h-11 items-start gap-3 py-1">
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => setInclude(e.target.checked)}
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
      {include && <input type="hidden" name={SAVED_ASSESSMENT_FIELD} value={serializeSavedAssessment(saved)} />}
      {include && strengths && <input type="hidden" name={SAVED_STRENGTHS_FIELD} value={serializeSavedAssessment(strengths)} />}
    </div>
  );
}
