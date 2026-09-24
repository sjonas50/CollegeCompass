import Link from "next/link";
import { clearMemoryAction, deleteConversationAction } from "@/app/actions/counselor";
import { Notice } from "@/components/ui";
import { ConfirmButton } from "./confirm-button";

type Convo = { id: string; title: string | null; updatedAt: Date };

/** Page chrome shared by the new-chat and conversation pages. */
export function CounselorShell({
  children,
  conversations,
  activeId,
  memoryCleared,
  hasMemory,
  locked = false,
}: {
  children: React.ReactNode;
  conversations: Convo[];
  activeId?: string;
  memoryCleared?: boolean;
  hasMemory: boolean;
  /** No full access: past conversations are listed (to delete) but can't be opened. */
  locked?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Counselor</h1>
        {activeId && (
          <Link href="/counselor" className="inline-flex min-h-11 items-center text-sm underline">
            New chat
          </Link>
        )}
      </div>
      {memoryCleared && <Notice>Done. The counselor has forgotten its notes about you.</Notice>}
      {children}
      <p className="text-xs text-muted">
        This counselor is an AI, not a person. It can make mistakes, so double-check important dates and details with your school
        counselor or official websites. If you&apos;re going through something hard, call or text 988 any time.
      </p>
      {conversations.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer content-center font-medium">Past conversations</summary>
          <ul className="mt-3 divide-y divide-border">
            {conversations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                {locked ? (
                  <span className="inline-flex min-h-11 min-w-0 items-center truncate">{c.title ?? "Conversation"}</span>
                ) : (
                  <Link
                    href={`/counselor/${c.id}`}
                    className={`inline-flex min-h-11 min-w-0 items-center truncate ${c.id === activeId ? "font-medium" : ""} underline-offset-2 hover:underline`}
                  >
                    {c.title ?? "Conversation"}
                  </Link>
                )}
                <ConfirmButton
                  action={deleteConversationAction}
                  fields={{ conversationId: c.id }}
                  label="Delete"
                  accessibleLabel={`Delete conversation: ${c.title ?? "Conversation"}`}
                  question="Delete this conversation?"
                  confirmLabel="Yes, delete it"
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Deleting a conversation doesn&apos;t erase notes the counselor already took from it.</p>
        </details>
      )}
      {hasMemory && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>The counselor keeps a few short notes to remember your goals.</span>
          <ConfirmButton
            action={clearMemoryAction}
            label="Make it forget its notes about me"
            question="Erase the counselor's notes about you?"
            confirmLabel="Yes, erase them"
          />
        </div>
      )}
    </div>
  );
}
