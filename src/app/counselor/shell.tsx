import Link from "next/link";
import { clearMemoryAction, deleteConversationAction } from "@/app/actions/counselor";
import { Notice } from "@/components/ui";

type Convo = { id: string; title: string | null; updatedAt: Date };

/** Page chrome shared by the new-chat and conversation pages. */
export function CounselorShell({
  children,
  conversations,
  activeId,
  memoryCleared,
}: {
  children: React.ReactNode;
  conversations: Convo[];
  activeId?: string;
  memoryCleared?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Counselor</h1>
        {activeId && (
          <Link href="/counselor" className="text-sm underline">
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
          <summary className="cursor-pointer font-medium">Past conversations</summary>
          <ul className="mt-3 divide-y divide-border">
            {conversations.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/counselor/${c.id}`} className={`truncate ${c.id === activeId ? "font-medium" : ""} underline-offset-2 hover:underline`}>
                  {c.title ?? "Conversation"}
                </Link>
                <form action={deleteConversationAction}>
                  <input type="hidden" name="conversationId" value={c.id} />
                  <button type="submit" className="shrink-0 text-sm text-muted underline">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={clearMemoryAction} className="mt-3 border-t border-border pt-3">
            <button type="submit" className="text-sm text-muted underline">
              Make the counselor forget its notes about me
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
