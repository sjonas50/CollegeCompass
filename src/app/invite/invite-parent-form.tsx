"use client";

import { type InviteFormState, cancelParentInviteAction, sendParentInviteAction } from "@/app/actions/invites";
import { Button, Field, FormMessage, Notice } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";

export type PendingInviteView = { id: string; sentOn: string; worksUntil: string };

/**
 * The student's side of parent invitations: invitations waiting for an answer (each can be
 * cancelled) and, while there's room, a form to send one. Rendered by InviteParentCard.
 */
export function InviteParentForm({ pending, canSend, max }: { pending: PendingInviteView[]; canSend: boolean; max: number }) {
  const [state, action, isPending, values] = useFormAction<InviteFormState>(sendParentInviteAction, undefined);
  const sent = Boolean(state && "sent" in state);
  const delayed = Boolean(state && "delayed" in state && state.delayed);
  const failed = state && !("sent" in state) ? state : undefined;

  return (
    <div className="mt-3 space-y-4">
      {sent && (
        <Notice>
          {delayed
            ? "Invitation sent. The email may take a few minutes to arrive. Ask them to check their email, including the spam folder."
            : "Invitation sent. Ask them to check their email, including the spam folder."}
        </Notice>
      )}

      {pending.length > 0 && (
        <div>
          <h3 id="invites-waiting" className="text-sm font-medium">Invitations sent</h3>
          <ul aria-labelledby="invites-waiting" className="mt-2 space-y-2">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2">
                <span className="text-sm">
                  Sent {invite.sentOn}
                  <span className="block text-muted">The link works until {invite.worksUntil}.</span>
                </span>
                <form action={cancelParentInviteAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <button type="submit" className="min-h-11 text-sm text-muted underline">
                    Cancel<span className="sr-only"> the invitation sent {invite.sentOn}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">We don&apos;t keep the email address, so it isn&apos;t shown here.</p>
        </div>
      )}

      {canSend ? (
        <form action={action} className="space-y-3">
          <FormMessage message={failed?.message} />
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
