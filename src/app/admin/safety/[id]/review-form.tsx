"use client";

import { reviewSafetyEventAction } from "@/app/actions/admin";
import { Button, FieldError, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { SafetyReviewOutcome } from "@/db/schema";
import { OUTCOME_LABELS, REVIEW_NOTE_MAX, REVIEW_OUTCOMES } from "@/lib/admin/format";
import type { FormState } from "@/lib/forms";

const OUTCOME_HINTS: Record<SafetyReviewOutcome, string> = {
  no_action: "Not a real concern (a joke, a quote, a school assignment), or the support already shown was enough.",
  followed_up: "You reached out or took a step under the follow-up policy.",
  escalated: "You passed it on under the follow-up policy, for example to a safety lead or emergency services.",
};

export function ReviewForm({ eventId }: { eventId: string }) {
  const [state, action, pending, values] = useFormAction<FormState>(reviewSafetyEventAction, undefined);
  const noteErrors = state?.errors?.note;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <FormMessage message={state?.message} />
      {/* Keyed so the choice survives React's form reset after a validation error. */}
      <fieldset key={values.outcome ?? ""} aria-describedby={state?.errors?.outcome ? "outcome-error" : undefined}>
        <legend className="text-sm font-medium">What did you do?</legend>
        <div className="mt-2 space-y-2">
          {REVIEW_OUTCOMES.map((o) => (
            <label key={o} className="flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent">
              <input type="radio" name="outcome" value={o} required defaultChecked={values.outcome === o} className="mt-1 size-4 shrink-0" />
              <span>
                <span className="block font-medium">{OUTCOME_LABELS[o]}</span>
                <span className="block text-sm text-muted">{OUTCOME_HINTS[o]}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldError id="outcome-error" errors={state?.errors?.outcome} />
      </fieldset>
      <div>
        <label htmlFor="note" className="block text-sm font-medium">
          Note
        </label>
        <p id="note-hint" className="text-sm text-muted">
          What you did and why, for whoever looks at this next. Needed unless no action was needed. It stays with
          this event and is deleted with the student&apos;s account.
        </p>
        <textarea
          key={values.note ?? ""}
          id="note"
          name="note"
          rows={4}
          maxLength={REVIEW_NOTE_MAX}
          defaultValue={values.note}
          aria-invalid={noteErrors?.length ? true : undefined}
          aria-describedby={["note-hint", noteErrors?.length && "note-error"].filter(Boolean).join(" ")}
          className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
        />
        <FieldError id="note-error" errors={noteErrors} />
      </div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : "Save review"}
      </Button>
    </form>
  );
}
