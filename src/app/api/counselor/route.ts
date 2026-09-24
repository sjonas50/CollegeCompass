import { after } from "next/server";
import * as z from "zod";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { counselorExtraTools } from "@/lib/counselor/extra-tools";
import { updateMemory } from "@/lib/counselor/memory";
import { MAX_MESSAGE_CHARS, respond } from "@/lib/counselor/respond";

// Safety screening plus a streamed reply with tool calls can take a while.
export const maxDuration = 60;

const Body = z.object({
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

/** Streams counselor events as newline-delimited JSON. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "student") return Response.json({ error: "Sign in required" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });

  const db = await getDb();
  const student = { id: user.id, grade: user.grade, displayName: user.displayName };
  const extraTools = await counselorExtraTools(db, student);
  let conversationId = parsed.data.conversationId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of respond(db, student, parsed.data, { extraTools })) {
          if (event.type === "conversation") conversationId = event.id;
          send(event);
        }
      } catch (error) {
        console.error("[counselor] request failed", error instanceof Error ? error.message : "unknown");
        send({ type: "notice", text: "Sorry, something went wrong. Please try again." });
        send({ type: "done", messageId: null });
      } finally {
        controller.close();
      }
    },
  });

  // Update the student's memory notes once the reply has been sent.
  after(async () => {
    if (!conversationId) return;
    try {
      await updateMemory(db, user.id, conversationId, { knownNames: [user.displayName] });
    } catch (error) {
      console.error("[counselor] memory update failed", error instanceof Error ? error.name : "unknown");
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
