"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { isInstrumentId } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import { requireUser } from "@/lib/auth/dal";
import { addNorthStar, removeNorthStar } from "@/lib/goals";
import { explainLatestMatches } from "@/lib/matching/explain";
import { computeMatches } from "@/lib/matching/service";

export async function startAssessmentAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const instrument = String(formData.get("instrument"));
  if (!isInstrumentId(instrument)) redirect("/dashboard");
  await startOrResumeAttempt(await getDb(), student.id, instrument);
  redirect(`/discover/${instrument}`);
}

const Answers = z.record(z.string().max(40), z.number().int());

export async function saveAnswersAction(attemptId: string, answers: Record<string, number>) {
  const student = await requireUser(["student"]);
  const parsed = Answers.safeParse(answers);
  if (!parsed.success || !z.uuid().safeParse(attemptId).success) return { ok: false as const };
  const res = await saveResponses(await getDb(), student.id, attemptId, parsed.data);
  return { ok: res.ok };
}

/** Saves the last answers, scores the attempt, and refreshes career matches. */
export async function finishAssessmentAction(attemptId: string, answers: Record<string, number>) {
  const saved = await saveAnswersAction(attemptId, answers);
  if (!saved.ok) return { ok: false as const, message: "We couldn't save your answers. Please try again." };

  const student = await requireUser(["student"]);
  const db = await getDb();
  const result = await completeAttempt(db, student.id, attemptId);
  if (!result.ok) {
    return { ok: false as const, message: "A few questions still need an answer." };
  }
  const runId = await computeMatches(db, student.id);
  redirect(runId ? "/discover/results" : "/dashboard");
}

export async function explainMatchesAction() {
  const student = await requireUser(["student"]);
  return explainLatestMatches(await getDb(), student.id);
}

/**
 * The career page again after a north star change, with its notice. Keeps ?from=quiz (sent by the
 * page's form), so "Back to my results" still leads to the free results.
 */
function careerPageAfter(code: string, formData: FormData, notice?: "starred" | "limit"): string {
  const query = new URLSearchParams();
  if (notice) query.set(notice, "1");
  if (formData.get("from") === "quiz") query.set("from", "quiz");
  const search = query.toString();
  return `/careers/${encodeURIComponent(code)}${search ? `?${search}` : ""}`;
}

export async function addNorthStarAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const code = String(formData.get("code") ?? "");
  const res = await addNorthStar(await getDb(), student.id, code);
  redirect(careerPageAfter(code, formData, res.ok ? "starred" : res.error === "limit" ? "limit" : undefined));
}

export async function removeNorthStarAction(formData: FormData) {
  const student = await requireUser(["student"]);
  const code = String(formData.get("code") ?? "");
  await removeNorthStar(await getDb(), student.id, code);
  const back = formData.get("back");
  redirect(back === "dashboard" ? "/dashboard" : careerPageAfter(code, formData));
}
