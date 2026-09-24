"use client";

import { type ContextState, revealSafetyContextAction } from "@/app/actions/admin";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { formatDateTime } from "@/lib/admin/format";
import type { ContextMessage, SafetyContext } from "@/lib/admin/safety-review";

function speaker(m: ContextMessage) {
  if (m.role === "user") return "Student";
  if (m.kind === "support") return "Support resources shown";
  if (m.kind === "notice") return "Notice";
  return "AI counselor";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function ContextView({ context }: { context: SafetyContext }) {
  const { student, conversation } = context;
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Student</dt>
        <dd className="font-medium">{student.displayName}</dd>
        <dt className="text-muted">Account</dt>
        <dd>
          {student.parentManaged ? "Managed by a parent (created by a parent when the child was under 13)" : "The student's own account"}
          {" · "}
          {student.linkedParent ? "a parent is linked" : "no parent linked"}
        </dd>
      </dl>
      {conversation ? (
        <div className="space-y-3">
          {conversation.earlier > 0 && <p className="text-sm text-muted">{plural(conversation.earlier, "earlier message")} not shown.</p>}
          <ol className="space-y-2" aria-label="Messages around the flagged one">
            {conversation.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 ${m.flagged ? "border-danger bg-danger-soft" : "border-border"} ${m.role === "user" ? "" : "sm:ml-8"}`}
              >
                <p className="text-xs text-muted">
                  {speaker(m)} · {formatDateTime(m.createdAt)}
                  {m.flagged && <strong className="text-danger"> · Flagged message</strong>}
                </p>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">{m.content}</p>
              </li>
            ))}
          </ol>
          {conversation.later > 0 && <p className="text-sm text-muted">{plural(conversation.later, "later message")} not shown.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">
          We couldn&apos;t find this message in a saved conversation. The student may have deleted the conversation.
        </p>
      )}
    </div>
  );
}

/** Reveals the student's name and the conversation only on request; each reveal is audited. */
export function ContextReveal({ eventId }: { eventId: string }) {
  const [state, action, pending] = useFormAction<ContextState>(revealSafetyContextAction, undefined);
  if (state?.context) return <ContextView context={state.context} />;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <p className="text-sm text-muted">
        Shows the student&apos;s first name, whether a parent manages the account, and the messages around this one.
        Open it only when you need it for follow-up. Each time you open it, it&apos;s logged.
      </p>
      <FormMessage message={state?.message} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Loading…" : "Show conversation context"}
      </Button>
    </form>
  );
}
