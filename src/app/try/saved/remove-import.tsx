"use client";

import { useFormStatus } from "react-dom";
import { removeImportedResultsAction } from "@/app/actions/try";
import { Button } from "@/components/ui";

/** What the button asks before removing: the strengths imported with the quiz go too. */
export function removeImportQuestion(strengths: boolean): string {
  return strengths
    ? "Remove these quiz results and strengths from your account? Then you can take both yourself."
    : "Remove these quiz results from your account? Then you can take the quiz yourself.";
}

/**
 * "Not your answers?": takes the quiz results just added back out of the account, with the
 * strengths imported with them (`strengths`), which removeImportedAssessment deletes too.
 */
export function RemoveImportButton({ attemptId, strengths }: { attemptId: string; strengths: boolean }) {
  return (
    <form
      action={removeImportedResultsAction}
      onSubmit={(e) => {
        if (!window.confirm(removeImportQuestion(strengths))) e.preventDefault();
      }}
    >
      <input type="hidden" name="attemptId" value={attemptId} />
      <RemoveButton />
    </form>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Removing…" : "Remove these results"}
    </Button>
  );
}
