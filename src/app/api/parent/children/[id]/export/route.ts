import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { exportStudentData } from "@/lib/privacy";

export async function GET(_req: Request, ctx: RouteContext<"/api/parent/children/[id]/export">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await ctx.params;
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
