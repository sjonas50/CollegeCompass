"use client";

import { type Ref, useActionState, useEffect, useId, useRef, useState } from "react";
import { type ListFormState, removeEntryAction } from "@/app/actions/applications";
import { Button, FormMessage } from "@/components/ui";

/** "Remove from my list", with a confirm step that focuses the safe choice. */
export function RemoveEntry({ entryId, name }: { entryId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ListFormState, FormData>(removeEntryAction, undefined);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      openRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <Button ref={openRef} type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setConfirming(true)}>
        Remove from my list<span className="sr-only">: {name}</span>
      </Button>
    );
  }

  return (
    <RemoveConfirm
      entryId={entryId}
      name={name}
      action={action}
      pending={pending}
      message={state?.message}
      keepRef={keepRef}
      onKeep={() => {
        returnFocus.current = true;
        setConfirming(false);
      }}
    />
  );
}

/**
 * The confirm step. Focus lands on "Keep it", so both buttons carry the question and the warning
 * as their description: a screen reader reads what will be deleted along with the button, instead
 * of just "Keep it, button".
 */
export function RemoveConfirm({
  entryId,
  name,
  action,
  pending,
  message,
  keepRef,
  onKeep,
}: {
  entryId: string;
  name: string;
  action: (formData: FormData) => void;
  pending: boolean;
  message?: string;
  keepRef?: Ref<HTMLButtonElement>;
  onKeep: () => void;
}) {
  const questionId = useId();
  return (
    <form action={action} className="rounded-lg bg-danger-soft p-4 text-sm">
      <input type="hidden" name="entryId" value={entryId} />
      <p id={questionId}>
        Remove <strong>{name}</strong> from your list? Its deadline, checklist, aid offer and notes will be deleted too.
      </p>
      <FormMessage message={message} />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" disabled={pending} aria-describedby={questionId}>
          {pending ? "Removing…" : "Yes, remove it"}
        </Button>
        <Button ref={keepRef} type="button" variant="secondary" disabled={pending} aria-describedby={questionId} onClick={onKeep}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
