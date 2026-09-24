import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { safetyEvents } from "@/db/schema";
import { assessMessage, screenWithRulesOnly } from "../ai/safety";
import type { SafetyCategory } from "../ai/safety/types";
import { consumeRateLimit } from "../rate-limit";
import { LOCKED_COUNSELOR_NOTICE, UNLOCK_PATH } from "./describe";

/** The counselor API's answer (HTTP 402) when the household doesn't have full access. */
export type AccessRequiredBody = {
  error: "access_required";
  message: string;
  /** Crisis resources, when the message needs them. The lock never holds these back. */
  support: string | null;
  unlock: { href: string; label: string };
};

/** Full safety screening for messages sent while locked, per student; past this, keyword rules decide. */
export const LOCKED_SCREEN_LIMIT = { count: 10, windowMs: 10 * 60_000 };

async function recordRulesOnlyEvent(db: Db, userId: string, text: string, category: SafetyCategory, severity: "high" | "imminent", now?: Date) {
  try {
    if (!(await consumeRateLimit(db, `safety-record:${userId}`, 20, 24 * 60 * 60_000, now))) return;
    await db.insert(safetyEvents).values({ userId, category, severity, sources: ["rules", "locked"], excerpt: text.slice(0, 1000) });
  } catch (error) {
    // Never let a failed write keep crisis resources from the student. Log no message text.
    console.error("[access] failed to record a safety event", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * What a locked student's counselor message gets back. There's no counselor reply, but the message
 * is still screened for safety (a lock never blocks crisis help), and high-risk messages go to the
 * review queue as usual.
 */
export async function lockedCounselorReply(
  db: Db,
  student: { id: string; displayName: string; username?: string | null },
  text: string,
  deps: { client?: Pick<Anthropic, "beta">; now?: Date } = {},
): Promise<AccessRequiredBody> {
  const knownNames = [student.displayName, student.username].filter((n): n is string => Boolean(n));
  let screenInFull = true;
  try {
    screenInFull = await consumeRateLimit(db, `locked-screen:${student.id}`, LOCKED_SCREEN_LIMIT.count, LOCKED_SCREEN_LIMIT.windowMs, deps.now);
  } catch (error) {
    // A failed limit check errs toward screening.
    console.error("[access] locked screening cap failed", error instanceof Error ? error.name : "unknown");
  }
  const screen = screenInFull ? await assessMessage(db, student.id, text, { client: deps.client, knownNames }) : screenWithRulesOnly(text);
  if (!screenInFull && screen.supportMessage && screen.category) {
    // Rules alone decided (assessMessage records its own events). Still queue it for review, with
    // the same daily cap as the counselor's rate-limited path so this can't flood the queue.
    await recordRulesOnlyEvent(db, student.id, text, screen.category, screen.severity === "imminent" ? "imminent" : "high", deps.now);
  }
  return {
    error: "access_required",
    message: LOCKED_COUNSELOR_NOTICE,
    support: screen.supportMessage,
    unlock: { href: UNLOCK_PATH, label: "See how to unlock it" },
  };
}
