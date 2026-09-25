import type { MatchExplanation } from "@/db/schema";

/*
 * The results page asks for its explanation once per match run: the overview and the career lists
 * share one request (see ExplanationProvider), and so do calls made while it is on its way (React
 * runs effects twice in development). The first request for a run can take a while, since the
 * model writes it.
 */

const pending = new Map<string, Promise<MatchExplanation | null>>();

export function loadExplanation(runId: string, explain: () => Promise<MatchExplanation | null>): Promise<MatchExplanation | null> {
  const waiting = pending.get(runId);
  if (waiting) return waiting;
  const request = explain().finally(() => pending.delete(runId));
  pending.set(runId, request);
  return request;
}

/** The explanation to show, or `ok: false` when there's none to show, so the page can offer to try again. */
export type ExplanationResult = { ok: true; explanation: MatchExplanation } | { ok: false };

/**
 * Asks for the explanation (see loadExplanation) and never rejects: a request that fails (a dropped
 * connection, a server error) or comes back empty is `ok: false`. Trying again asks again.
 */
export async function requestExplanation(runId: string, explain: () => Promise<MatchExplanation | null>): Promise<ExplanationResult> {
  try {
    const explanation = await loadExplanation(runId, explain);
    return explanation ? { ok: true, explanation } : { ok: false };
  } catch {
    return { ok: false };
  }
}
