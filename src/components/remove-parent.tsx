"use client";

import { type Ref, useEffect, useRef, useState } from "react";
import { removeMyParentAction } from "@/app/actions/settings";
import { NewPasswordFields } from "@/components/change-password";
import { Button, FormMessage } from "@/components/ui";
import { useFocusFirstInvalid } from "@/components/use-focus-first-invalid";
import { useFormAction } from "@/components/use-form-action";
import type { FormState } from "@/lib/forms";

/**
 * The confirm step's question: what removing `name` changes, access included. When `name` made
 * the student's password (they set up the account), removing them takes a new one, and it says so:
 * without it, they could still sign in as the student.
 */
export function RemoveParentQuestion({
  id,
  name,
  accessNote,
  madePassword = false,
}: {
  id: string;
  name: string;
  accessNote: string;
  madePassword?: boolean;
}) {
  const noLonger = `${name} won't see your progress anymore. They also can't change your settings, download your data or delete your account.`;
  return (
    <div id={id} className="space-y-2">
      <p className="font-medium">Remove {name} from your account?</p>
      <ul className="list-disc space-y-1 pl-5">
        {madePassword ? (
          <>
            <li>
              {name} made your password, so they could still sign in as you. To remove them, choose a new password that only you know.
              We&apos;ll sign you out on every other device.
            </li>
            <li>After that, {noLonger}</li>
          </>
        ) : (
          <li>{noLonger}</li>
        )}
        <li>{accessNote}</li>
        <li>Everything you&apos;ve done stays in your account, including your chats with the counselor.</li>
        <li>We won&apos;t email {name}. You&apos;ll just stop showing up on their parent page.</li>
        <li>You can invite a parent or guardian again anytime.</li>
      </ul>
    </div>
  );
}

/**
 * The confirm step itself. Both buttons point to the question, so a screen reader reads it with
 * whichever button has focus ("Keep" does when it opens).
 */
export function RemoveParentConfirm({
  parentId,
  name,
  accessNote,
  madePassword,
  state,
  pending = false,
  action,
  formRef,
  keepRef,
  onKeep,
}: {
  parentId: string;
  name: string;
  accessNote: string;
  madePassword: boolean;
  state?: FormState;
  pending?: boolean;
  action?: (formData: FormData) => void;
  formRef?: Ref<HTMLFormElement>;
  keepRef?: Ref<HTMLButtonElement>;
  onKeep?: () => void;
}) {
  const questionId = `remove-parent-${parentId}`;
  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg bg-danger-soft p-3 text-sm">
      <FormMessage message={state?.message} />
      <input type="hidden" name="parentId" value={parentId} />
      <RemoveParentQuestion id={questionId} name={name} accessNote={accessNote} madePassword={madePassword} />
      {madePassword && <NewPasswordFields idPrefix={`remove-parent-${parentId}`} errors={state?.errors} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" disabled={pending} aria-describedby={questionId}>
          Yes, remove {name}
        </Button>
        <Button ref={keepRef} type="button" variant="secondary" onClick={onKeep} disabled={pending} aria-describedby={questionId}>
          Keep {name}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Remove" next to a linked parent in the student's Settings. It asks first, and says what changes,
 * including what happens to the student's access (`accessNote`, from removalAccessNote). When the
 * parent made the student's password (`madePassword`), it asks for a new one too.
 */
export function RemoveParent({
  parentId,
  name,
  accessNote,
  madePassword = false,
}: {
  parentId: string;
  name: string;
  accessNote: string;
  madePassword?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useFormAction<FormState>(removeMyParentAction, undefined);
  const formRef = useFocusFirstInvalid(state);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);

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
      {!confirming && (
        <button ref={removeRef} type="button" onClick={() => setConfirming(true)} className="min-h-11 text-sm text-danger underline">
          Remove<span className="sr-only"> {name}</span>
        </button>
      )}
      {confirming && (
        <RemoveParentConfirm
          parentId={parentId}
          name={name}
          accessNote={accessNote}
          madePassword={madePassword}
          state={state}
          pending={pending}
          action={action}
          formRef={formRef}
          keepRef={keepRef}
          onKeep={keep}
        />
      )}
    </div>
  );
}
