import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { listConversations } from "@/lib/counselor/conversations";
import { Chat } from "./chat";
import { CounselorShell } from "./shell";

export const metadata: Metadata = { title: "Counselor" };

export default async function CounselorPage({ searchParams }: PageProps<"/counselor">) {
  const student = await requireUser(["student"]);
  const { memory } = await searchParams;
  const conversations = await listConversations(await getDb(), student.id);
  return (
    <CounselorShell conversations={conversations} memoryCleared={memory === "cleared"}>
      <Chat initialMessages={[]} />
    </CounselorShell>
  );
}
