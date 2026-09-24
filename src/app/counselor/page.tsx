import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getMemory } from "@/lib/counselor/memory";
import { listConversations } from "@/lib/counselor/conversations";
import { Chat } from "./chat";
import { CounselorShell } from "./shell";

export const metadata: Metadata = { title: "Counselor" };

export default async function CounselorPage({ searchParams }: PageProps<"/counselor">) {
  const student = await requireUser(["student"]);
  const { memory } = await searchParams;
  const db = await getDb();
  const [conversations, notes] = await Promise.all([listConversations(db, student.id), getMemory(db, student.id)]);
  return (
    <CounselorShell conversations={conversations} memoryCleared={memory === "cleared"} hasMemory={notes.length > 0}>
      <Chat initialMessages={[]} />
    </CounselorShell>
  );
}
