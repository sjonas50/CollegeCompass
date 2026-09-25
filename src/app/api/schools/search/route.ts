import * as z from "zod";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { consumeRateLimit } from "@/lib/rate-limit";
import { SCHOOL_QUERY_MAX, SCHOOL_SEARCH_RATE, searchSchools } from "@/lib/schools/search";

// The school pickers' search (src/components/school-settings.tsx). POST so what a family types
// (which can name a child's school) never lands in a URL, a server log line or browser history;
// it isn't logged here either. Free: never gated. Signed-in students and parents only, and rate
// limited, because the pickers are the only thing that needs it.

const Body = z.object({
  state: z.string().regex(/^[A-Za-z]{2}$/),
  query: z.string().max(SCHOOL_QUERY_MAX),
});

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "student" && user.role !== "parent")) {
    return Response.json({ error: "sign_in_required" }, { status: 401, headers: noStore });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_search" }, { status: 400, headers: noStore });

  const db = await getDb();
  const { count, windowMs } = SCHOOL_SEARCH_RATE;
  if (!(await consumeRateLimit(db, `school-search:${user.id}`, count, windowMs))) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  }
  const results = await searchSchools(db, parsed.data);
  return Response.json({ results }, { headers: noStore });
}
