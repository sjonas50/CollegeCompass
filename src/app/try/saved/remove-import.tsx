"use client";

import { useFormStatus } from "react-dom";
import { removeImportedResultsAction } from "@/app/actions/try";
import { Button } from "@/components/ui";

/** "Not your answers?": takes the quiz results just added back out of the account. */
export function RemoveImportButton({ attemptId }: { attemptId: string }) {
  return (
    <form
      action={removeImportedResultsAction}
      onSubmit={(e) => {
        if (!window.confirm("Remove these quiz results from your account? Then you can take the quiz yourself.")) e.preventDefault();
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
