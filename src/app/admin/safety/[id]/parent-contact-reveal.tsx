"use client";

import { type ParentContactState, revealParentContactAction } from "@/app/actions/admin";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { ParentContact } from "@/lib/admin/safety-review";

export function ParentContactView({ contact }: { contact: ParentContact }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Family reference</dt>
        <dd className="font-mono">{contact.familyRef}</dd>
        <dt className="text-muted">{contact.parents.length === 1 ? "Parent email" : "Parent emails"}</dt>
        <dd>
          {contact.parents.length === 0 ? (
            <>No parent is linked to this account. Follow what the policy says for that case.</>
          ) : (
            <ul className="space-y-1">
              {contact.parents.map((p, i) => (
                <li key={p.email ?? i} className="break-all">
                  {p.email ?? "A linked parent with no email on file"}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <p className="text-xs text-muted">
        Use these only to follow up under the parent-notification policy. Don&apos;t copy them into notes, tickets or
        chat; use {contact.familyRef} instead.
      </p>
    </div>
  );
}

/** Reveals the linked parents' emails only on request; each reveal is audited. */
export function ParentContactReveal({ eventId }: { eventId: string }) {
  const [state, action, pending] = useFormAction<ParentContactState>(revealParentContactAction, undefined);
  if (state?.contact) return <ParentContactView contact={state.contact} />;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <p className="text-sm text-muted">
        Shows the email of each parent linked to this student, so you can follow up under the parent-notification
        policy. Open it only when you need to reach them. Each time you open it, it&apos;s logged.
      </p>
      <FormMessage message={state?.message} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Loading…" : "Show parent contact"}
      </Button>
    </form>
  );
}
