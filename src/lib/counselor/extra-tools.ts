import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";
import type { Db } from "@/db";
import { planSummary } from "../courses/service";
import { roadmapSummary } from "../roadmap";
import type { ToolContext } from "./tools";

/**
 * Student-scoped tools for the counselor to read the signed-in student's own course plan and
 * roadmap. They take no ids from the model, so they can only ever return this student's data.
 */
export async function counselorExtraTools(db: Db, student: { id: string; grade: number | null }): Promise<NonNullable<ToolContext["extra"]>> {
  const plan = betaZodTool({
    name: "get_my_plan",
    description:
      "Get the student's own course plan: courses by grade (planned, in progress, completed, with grades), an estimated GPA, progress on common college-prep subjects, and course ideas for their north-star careers.",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await planSummary(db, student.id)),
  });
  const roadmap = betaZodTool({
    name: "get_my_roadmap",
    description:
      "Get the student's own grade-by-grade roadmap: what's timely this month and coming up, what they could catch up on, their progress this grade, and this week's steps.",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await roadmapSummary(db, student.id, student.grade)),
  });
  return [plan, roadmap];
}
