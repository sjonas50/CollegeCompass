import * as z from "zod";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { exportStudentData } from "@/lib/privacy";

/**
 * A student's data as a JSON download, for the student themselves or a linked parent. What's in it
 * depends on who asks: see exportStudentData.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/parent/children/[id]/export">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await ctx.params;
  // Student ids are UUIDs; anything else can't be one of ours (and would make Postgres throw).
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const data = await exportStudentData(await getDb(), user.id, id);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="college-compass-export-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
