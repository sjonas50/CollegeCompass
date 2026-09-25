"use client";

import { useEffect, useRef, useState } from "react";
import { type InviteFormState, cancelParentInviteAction, sendParentInviteAction } from "@/app/actions/invites";
import { Button, Field, FormMessage, Notice } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";

/** `sentTo`: the address the student typed (null for invitations from before addresses were kept). */
export type PendingInviteView = { id: string; sentTo: string | null; sentOn: string; worksUntil: string };

/** Sending and cancelling share one state (see InviteFormState): a cancel form posts an inviteId. */
export function inviteAction(prev: InviteFormState, formData: FormData) {
  return formData.has("inviteId") ? cancelParentInviteAction(prev, formData) : sendParentInviteAction(prev, formData);
}

const focusRing = "rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The notice for what the student just did, if it worked. */
export function inviteNotice(state: InviteFormState): string | null {
  if (state && "cancelled" in state) return "Invitation cancelled. The link in that email won't work anymore.";
  if (state && "sent" in state) {
    return state.delayed
      ? "Invitation sent. The email may take a few minutes to arrive. Ask them to check their email, including the spam folder."
      : "Invitation sent. Ask them to check their email, including the spam folder.";
  }
  return null;
}

/**
 * The student's side of parent invitations: invitations waiting for an answer (each can be
 * cancelled, after a confirm step) and, while there's room, a form to send one. Rendered by
 * InviteParentCard.
 */
export function InviteParentForm({ pending, canSend, max }: { pending: PendingInviteView[]; canSend: boolean; max: number }) {
  const cancelling = useRef(false);
  const [state, action, isPending, values] = useFormAction<InviteFormState>((prev, formData) => {
    cancelling.current = formData.has("inviteId");
    return inviteAction(prev, formData);
  }, undefined);
  const notice = inviteNotice(state);
  const failed = state && !("sent" in state) && !("cancelled" in state) ? state : undefined;
  const statusRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A cancel takes its row, and the button that had focus, off the list (like a removed course on
  // the plan page). Focus goes to the list's heading, or to the status line once no invitations are
  // left; the status line says what happened.
  useEffect(() => {
    if (!cancelling.current) return;
    cancelling.current = false;
    (headingRef.current ?? statusRef.current)?.focus();
  }, [state]);

  return (
    <div className="mt-3 space-y-4">
      <div ref={statusRef} tabIndex={-1} className={`space-y-4 ${focusRing}`}>
        <div aria-live="polite">{notice && <Notice>{notice}</Notice>}</div>
        <FormMessage message={failed?.message} />
      </div>

      {pending.length > 0 && (
        <div>
          <h3 ref={headingRef} id="invites-waiting" tabIndex={-1} className={`text-sm font-medium ${focusRing}`}>
            Invitations sent
          </h3>
          <ul aria-labelledby="invites-waiting" className="mt-2 space-y-2">
            {pending.map((invite) => (
              <PendingInvite key={invite.id} invite={invite} action={action} busy={isPending} />
            ))}
          </ul>
        </div>
      )}

      {canSend ? (
        <form action={action} className="space-y-3">
          <Field
            label={pending.length > 0 ? "Invite someone else" : "Parent or guardian's email"}
            name="parentEmail"
            type="email"
            autoComplete="off"
            required
            // Empty again after a send; kept when there's something to fix.
            defaultValue={failed ? values.parentEmail : undefined}
            errors={failed?.errors?.parentEmail}
          />
          <Button type="submit" variant="secondary" disabled={isPending}>
            Send invitation
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">You can have {max} invitations waiting at once. Cancel one to send another.</p>
      )}
    </div>
  );
}

/** One waiting invitation. Cancel asks first, since the link in the email stops working. */
function PendingInvite({ invite, action, busy }: { invite: PendingInviteView; action: (formData: FormData) => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  // Read with either button, so focus on "Keep it" says what it keeps.
  const questionId = `cancel-invite-${invite.id}`;

  // Focus the safe choice, so an accidental Enter keeps the invitation; "Keep it" goes back to Cancel.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (kept.current) cancelRef.current?.focus();
    kept.current = false;
  }, [confirming]);

  function keep() {
    kept.current = true;
    setConfirming(false);
  }

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm">
          {invite.sentTo ? (
            <>
              Sent to <span className="break-all">{invite.sentTo}</span> on {invite.sentOn}
            </>
          ) : (
            <>Sent {invite.sentOn}</>
          )}
          <span className="block text-muted">The link works until {invite.worksUntil}.</span>
        </span>
        {!confirming && (
          <button ref={cancelRef} type="button" onClick={() => setConfirming(true)} className="min-h-11 text-sm text-muted underline">
            Cancel<span className="sr-only"> the invitation sent {invite.sentOn}{invite.sentTo && ` to ${invite.sentTo}`}</span>
          </button>
        )}
      </div>
      {confirming && (
        <form action={action} className="mt-2 rounded-lg bg-danger-soft p-3 text-sm">
          <input type="hidden" name="inviteId" value={invite.id} />
          <p id={questionId}>Cancel this invitation? The link in the email will stop working.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="danger" disabled={busy} aria-describedby={questionId}>
              Yes, cancel it
            </Button>
            <Button ref={keepRef} type="button" variant="secondary" onClick={keep} disabled={busy} aria-describedby={questionId}>
              Keep it
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
