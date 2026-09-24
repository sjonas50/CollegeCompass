import "server-only";
import type { Db } from "@/db";
import { latestResult } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import type { ResultsViewer } from "./save-card";

/** Who is looking at the free quiz's results (see SaveResultsCard). */
export async function resultsViewer(db: Db, user: SessionUser | null): Promise<ResultsViewer> {
  if (!user) return "visitor";
  if (user.role === "parent") return "parent";
  if (user.role === "student") return (await latestResult(db, user.id, "interests")) ? "student_with_results" : "student";
  return "other";
}
