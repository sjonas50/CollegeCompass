"use client";

import { useEffect, useRef, useState } from "react";
import { removeMyParentAction } from "@/app/actions/settings";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

/** The confirm step's question: what removing `name` changes, access included. */
export function RemoveParentQuestion({ id, name, accessNote }: { id: string; name: string; accessNote: string }) {
  return (
    <div id={id} className="space-y-2">
      <p className="font-medium">Remove {name} from your account?</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          {name} won&apos;t see your progress anymore. They also can&apos;t change your settings, download your data or delete your
          account.
        </li>
        <li>{accessNote}</li>
        <li>Everything you&apos;ve done stays in your account, including your chats with the counselor.</li>
        <li>We won&apos;t email {name}. You&apos;ll just stop showing up on their parent page.</li>
        <li>You can invite a parent or guardian again anytime.</li>
      </ul>
    </div>
  );
}

/**
 * "Remove" next to a linked parent in the student's Settings. It asks first, and says what changes,
 * including what happens to the student's access (`accessNote`, from removalAccessNote).
 */
export function RemoveParent({ parentId, name, accessNote }: { parentId: string; name: string; accessNote: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useFormAction<FormState>(removeMyParentAction, undefined);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  const questionId = `remove-parent-${parentId}`;

  // Focus the safe choice, so an accidental Enter keeps the parent; "Keep" goes back to Remove.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (kept.current) removeRef.current?.focus();
    kept.current = false;
  }, [confirming]);

  function keep() {
    kept.current = true;
    setConfirming(false);
  }

  return (
    <div className="mt-1 space-y-2">
      <FormMessage message={state?.message} />
      {!confirming && (
        <button ref={removeRef} type="button" onClick={() => setConfirming(true)} className="min-h-11 text-sm text-danger underline">
          Remove<span className="sr-only"> {name}</span>
        </button>
      )}
      {confirming && (
        <form action={action} className="space-y-3 rounded-lg bg-danger-soft p-3 text-sm">
          <input type="hidden" name="parentId" value={parentId} />
          <RemoveParentQuestion id={questionId} name={name} accessNote={accessNote} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="danger" disabled={pending} aria-describedby={questionId}>
              Yes, remove {name}
            </Button>
            <Button ref={keepRef} type="button" variant="secondary" onClick={keep} disabled={pending}>
              Keep {name}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
