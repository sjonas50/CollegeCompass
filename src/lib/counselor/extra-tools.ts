import type { Db } from "@/db";
import type { ToolContext } from "./tools";

/**
 * Student-scoped tools contributed by other features (course plan, roadmap). Registered here so
 * the counselor can read the student's own plan and roadmap.
 */
export async function counselorExtraTools(_db: Db, _student: { id: string; grade: number | null }): Promise<NonNullable<ToolContext["extra"]>> {
  return [];
}
