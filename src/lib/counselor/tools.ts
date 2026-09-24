import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";
import type { Db } from "@/db";
import { RIASEC_INFO } from "../assessments/instruments";
import { JOB_ZONE_INFO, getCareer, searchCareers } from "../careers";

/**
 * Read-only tools, each bound to one student. Tools never take a user id from the model, so the
 * counselor can only ever see the signed-in student's own data.
 */
export type ToolContext = {
  db: Db;
  userId: string;
  grade: number | null;
  /** Extra student-scoped tools registered by other modules (plan, roadmap). */
  extra?: ReturnType<typeof betaZodTool>[];
};

export function counselorTools(ctx: ToolContext) {
  const search = betaZodTool({
    name: "search_careers",
    description:
      "Search the U.S. Department of Labor's O*NET list of about 1,000 careers by keyword in the job title. Returns codes and titles. Use get_career for details.",
    inputSchema: z.object({ query: z.string().min(2).max(60).describe("A word or short phrase, e.g. 'nurse' or 'engineer'") }),
    run: async ({ query }) => {
      const results = await searchCareers(ctx.db, query, 15);
      return JSON.stringify(results.length ? results.map((r) => ({ code: r.code, title: r.title })) : { note: "No careers matched. Try a shorter or different word." });
    },
  });

  const career = betaZodTool({
    name: "get_career",
    description:
      "Get details for one career by its O*NET code: what the work is, how much preparation it usually needs, the interests of people who enjoy it, and related college majors.",
    inputSchema: z.object({ code: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/).describe("O*NET-SOC code, e.g. 15-1252.00") }),
    run: async ({ code }) => {
      const c = await getCareer(ctx.db, code);
      if (!c) return JSON.stringify({ error: "No career with that code. Use search_careers first." });
      return JSON.stringify({
        code: c.code,
        title: c.title,
        description: c.description,
        preparation: c.jobZone ? JOB_ZONE_INFO[c.jobZone]?.detail : null,
        path: c.pathway === "degree" ? "usually a college degree" : "usually career training",
        topInterests: c.interests.slice(0, 2).map((i) => RIASEC_INFO[i.area].name),
        relatedMajors: c.majors.map((m) => m.title),
      });
    },
  });

  return [search, career, ...(ctx.extra ?? [])];
}
