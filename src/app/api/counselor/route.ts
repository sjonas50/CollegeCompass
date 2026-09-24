import { after } from "next/server";
import * as z from "zod";
import { getDb } from "@/db";
import { lockedCounselorReply } from "@/lib/access/counselor";
import { accessFor } from "@/lib/access/guard";
import { screenWithRulesOnly } from "@/lib/ai/safety";
import { getCurrentUser } from "@/lib/auth/dal";
import { counselorExtraTools } from "@/lib/counselor/extra-tools";
import { updateMemory } from "@/lib/counselor/memory";
import { MAX_MESSAGE_CHARS, cleanMessage, respond } from "@/lib/counselor/respond";

// Safety screening plus a streamed reply with tool calls can take a while.
export const maxDuration = 60;

const Body = z.object({
  conversationId: z.uuid().optional(),
  text: z.string().transform(cleanMessage).pipe(z.string().min(1).max(MAX_MESSAGE_CHARS)),
});

/** Streams counselor events as newline-delimited JSON. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "student") return Response.json({ error: "Sign in required" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });

  const student = { id: user.id, grade: user.grade, displayName: user.displayName, username: user.username };
  // The counselor needs full access. Without it: 402 with a message the chat shows, after the same
  // safety screening every message gets, so crisis resources are never locked away. If the check
  // itself fails (say, a database outage), the request goes on to the stream below, whose error
  // handling still screens the message for a crisis.
  const locked = await accessFor(user).then(
    (access) => !access.full,
    (error) => {
      console.error("[counselor] access check failed", error instanceof Error ? error.name : "unknown");
      return false;
    },
  );
  if (locked) {
    const body = await lockedCounselorReply(await getDb(), student, parsed.data.text);
    return Response.json(body, { status: 402, headers: { "Cache-Control": "no-store" } });
  }
  const knownNames = [user.displayName, user.username].filter((n): n is string => Boolean(n));
  let conversationId = parsed.data.conversationId;

  // Resolves once respond() has fully finished (including crisis flagging), even if the client
  // disconnects first; the memory update waits for it.
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  const clientGone = new AbortController();
  // Set when crisis resources went out. That turn is kept out of memory even if flagging the
  // conversation failed.
  let supported = false;

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
        const db = await getDb();
        const extraTools = await counselorExtraTools(db, student);
        for await (const event of respond(db, student, parsed.data, { extraTools, signal: clientGone.signal })) {
          if (event.type === "conversation") conversationId = event.id;
          if (event.type === "support") supported = true;
          send(event);
        }
      } catch (error) {
        // Never log error messages here: database errors include query parameters (the student's text).
        console.error("[counselor] request failed", error instanceof Error ? error.name : "unknown");
        // Whatever failed, a message that plainly signals a crisis still gets crisis resources, and
        // resources already sent are never followed by an error.
        if (!supported) {
          const screen = screenWithRulesOnly(parsed.data.text);
          send(screen.supportMessage ? { type: "support", text: screen.supportMessage } : { type: "notice", text: "Sorry, something went wrong. Please try again." });
        }
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
    if (!conversationId || supported) return;
    try {
      await updateMemory(await getDb(), user.id, conversationId, { knownNames });
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
