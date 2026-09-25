"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  type FreeMatchesResult,
  anonymousRateKey,
  countFreeFinish,
  importSavedAssessment,
  matchFreeAssessment,
  rateKeySecret,
  removeImportedAssessment,
} from "@/lib/assessments/import";
import { requireUser } from "@/lib/auth/dal";
import { clientIp } from "@/lib/request";

/**
 * Career matches for the free quiz at /try. Public: takes only the six interest area scores
 * (never the answers), and stores nothing but a hashed, day-scoped rate-limit counter.
 */
export async function freeMatchesAction(scores: unknown): Promise<FreeMatchesResult> {
  const rateKey = anonymousRateKey(await clientIp(), rateKeySecret());
  return matchFreeAssessment(await getDb(), scores, { rateKey });
}

/**
 * Counts one finish of the free quiz ("interests") or its strengths add-on ("personality") in the
 * anonymous daily totals. Public: takes only which one was finished, never answers or scores, and
 * stores nothing about the visitor but a hashed, day-scoped rate-limit counter. The browser calls it
 * once per finished set of answers (see markFinishCounted).
 */
export async function countFreeFinishAction(activity: unknown): Promise<void> {
  const rateKey = anonymousRateKey(await clientIp(), rateKeySecret(), new Date(), "count");
  await countFreeFinish(await getDb(), activity, { rateKey });
}

export type ImportSavedResult = { ok: true } | { ok: false; error: "already_done" | "invalid" | "failed"; message: string };

/**
 * Brings the free quiz saved in this browser into the signed-in student's own account, with the
 * strengths add-on's answers when the visitor took it.
 */
export async function importSavedResultsAction(saved: unknown, strengths?: unknown): Promise<ImportSavedResult> {
  const student = await requireUser(["student"]);
  try {
    const res = await importSavedAssessment(await getDb(), student.id, student.id, saved, { via: "dashboard", strengths });
    if (res.ok) return { ok: true };
    if (res.error === "already_done") {
      return { ok: false, error: "already_done", message: "Your account already has interest results, so we didn't add these." };
    }
    return {
      ok: false,
      error: "invalid",
      message: "We couldn't use those saved answers. You can take the interests activity in your account instead.",
    };
  } catch (error) {
    console.error("[try] import failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: "failed", message: "Something went wrong. Please try again." };
  }
}

/**
 * "These weren't my answers": takes back free quiz results just brought into the signed-in
 * student's account (see /try/saved), so they can take the interests activity themselves.
 */
export async function removeImportedResultsAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const attemptId = formData.get("attemptId");
  const res =
    typeof attemptId === "string" && attemptId
      ? await removeImportedAssessment(await getDb(), student.id, student.id, attemptId)
      : { ok: false as const };
  redirect(res.ok ? "/discover/interests" : "/try/saved?undo=failed");
}
