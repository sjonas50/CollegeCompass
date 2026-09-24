import type { Metadata } from "next";
import { getDb } from "@/db";
import { accessFor } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { getMemory } from "@/lib/counselor/memory";
import { listConversations } from "@/lib/counselor/conversations";
import { Chat } from "./chat";
import { CounselorLocked } from "./locked";
import { CounselorShell } from "./shell";

export const metadata: Metadata = { title: "Counselor" };

export default async function CounselorPage({ searchParams }: PageProps<"/counselor">) {
  const student = await requireUser(["student"]);
  const { memory } = await searchParams;
  const db = await getDb();
  const [conversations, notes, access] = await Promise.all([
    listConversations(db, student.id),
    getMemory(db, student.id),
    accessFor(student),
  ]);
  // Without full access the chat is replaced by a locked panel (with crisis help); past
  // conversations and the counselor's notes can still be deleted.
  return (
    <CounselorShell conversations={conversations} memoryCleared={memory === "cleared"} hasMemory={notes.length > 0} locked={!access.full}>
      {access.full ? <Chat initialMessages={[]} /> : <CounselorLocked hasConversations={conversations.length > 0} />}
    </CounselorShell>
  );
}
