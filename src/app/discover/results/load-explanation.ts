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
