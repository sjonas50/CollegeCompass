import { after } from "next/server";
import * as z from "zod";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { counselorExtraTools } from "@/lib/counselor/extra-tools";
import { updateMemory } from "@/lib/counselor/memory";
import { MAX_MESSAGE_CHARS, respond } from "@/lib/counselor/respond";

// Safety screening plus a streamed reply with tool calls can take a while.
export const maxDuration = 60;

// Control characters (other than tab and newlines) can't be stored in Postgres text columns.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const Body = z.object({
  conversationId: z.uuid().optional(),
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MESSAGE_CHARS)
    .refine((t) => !CONTROL_CHARS.test(t), "Invalid characters"),
});

/** Streams counselor events as newline-delimited JSON. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "student") return Response.json({ error: "Sign in required" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });

  const db = await getDb();
  const student = { id: user.id, grade: user.grade, displayName: user.displayName, username: user.username };
  const knownNames = [user.displayName, user.username].filter((n): n is string => Boolean(n));
  const extraTools = await counselorExtraTools(db, student);
  let conversationId = parsed.data.conversationId;

  // Resolves once respond() has fully finished (including crisis flagging), even if the client
  // disconnects first; the memory update waits for it.
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  const clientGone = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        if (clientGone.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          clientGone.abort();
        }
      };
      try {
        for await (const event of respond(db, student, parsed.data, { extraTools, signal: clientGone.signal })) {
          if (event.type === "conversation") conversationId = event.id;
          send(event);
        }
      } catch (error) {
        // Never log error messages here: database errors include query parameters (the student's text).
        console.error("[counselor] request failed", error instanceof Error ? error.name : "unknown");
        send({ type: "notice", text: "Sorry, something went wrong. Please try again." });
        send({ type: "done", messageId: null });
      } finally {
        finished();
        try {
          controller.close();
        } catch {
          // Already closed because the client went away.
        }
      }
    },
    cancel() {
      clientGone.abort();
    },
  });
  req.signal.addEventListener("abort", () => clientGone.abort());

  after(async () => {
    await done;
    if (!conversationId) return;
    try {
      await updateMemory(db, user.id, conversationId, { knownNames });
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
