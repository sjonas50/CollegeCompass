"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
    <form action={action} className="rounded-lg bg-danger-soft p-4 text-sm" aria-live="polite">
      <input type="hidden" name="entryId" value={entryId} />
      <p>
        Remove <strong>{name}</strong> from your list? Its deadline, checklist, aid offer and notes will be deleted too.
      </p>
      <FormMessage message={state?.message} />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Removing…" : "Yes, remove it"}
        </Button>
        <Button
          ref={keepRef}
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            returnFocus.current = true;
            setConfirming(false);
          }}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}
