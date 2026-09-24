import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getMemory } from "@/lib/counselor/memory";
import { getOwnedConversation, listConversations, listMessages } from "@/lib/counselor/conversations";
import { Chat } from "../chat";
import { CounselorShell } from "../shell";

export const metadata: Metadata = { title: "Counselor" };

export default async function ConversationPage({ params, searchParams }: PageProps<"/counselor/[id]">) {
  const student = await requireUser(["student"]);
  const { id } = await params;
  const { memory } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const conversation = await getOwnedConversation(db, student.id, id);
  if (!conversation) notFound();
  const [messages, conversations, notes] = await Promise.all([listMessages(db, id), listConversations(db, student.id), getMemory(db, student.id)]);
  return (
    <CounselorShell conversations={conversations} activeId={id} memoryCleared={memory === "cleared"} hasMemory={notes.length > 0}>
      <Chat
        key={id}
        conversationId={id}
        initialMessages={messages.map((m) => ({ id: m.id, role: m.role, kind: m.kind, content: m.content }))}
      />
    </CounselorShell>
  );
}
