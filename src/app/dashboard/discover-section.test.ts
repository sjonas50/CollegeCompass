import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import { type Db, createTestDb, schema } from "@/db";
import { INTEREST_ITEMS, type InstrumentId, PERSONALITY_ITEMS, WORK_VALUES } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";

// The dashboard's "Discover your direction" section points at what's actually left to do.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
// Cards that load their own data have their own tests.
vi.mock("@/components/weekly-steps", () => ({ WeeklyStepsCard: () => null }));
vi.mock("@/components/invite-parent", () => ({ InviteParentCard: () => null }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const section = async () => {
  const html = renderToStaticMarkup(
    (await DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">)) as ReactNode,
  );
  const start = html.indexOf("Discover your direction");
  return text(html.slice(start, html.indexOf("</section>", start)));
};

beforeEach(async () => {
  const db = await createTestDb();
  state.db = db;
  const [household] = await db.insert(schema.households).values({}).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: "2010-10-01", grade: 10 })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role: "student", displayName: "Sam", username: null, householdId: household.id, parentManaged: false, grade: 10 };
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

const RESPONSES: Record<InstrumentId, Record<string, number>> = {
  interests: Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, 3])),
  personality: Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])),
  values: Object.fromEntries(WORK_VALUES.map((v, i) => [v, i + 1])),
};

async function finish(instrument: InstrumentId, answers = RESPONSES[instrument]) {
  const start = await startOrResumeAttempt(state.db!, state.user!.id, instrument);
  if (!start.ok) throw new Error();
  await saveResponses(state.db!, state.user!.id, start.attempt.id, answers);
  if (Object.keys(answers).length === Object.keys(RESPONSES[instrument]).length) await completeAttempt(state.db!, state.user!.id, start.attempt.id);
}

describe("dashboard discover section", () => {
  it("starts with interests", async () => {
    expect(await section()).toContain("Three short activities. Start with interests — it unlocks your career matches.");
  });

  it("keeps pointing at interests while they're unfinished", async () => {
    await finish("interests", { R1: 3, I1: 4 });
    const t = await section();
    expect(t).toContain("Keep going with interests — finishing it gives you career matches.");
    expect(t).toContain("2 of 60 answered");
  });

  it("points at what's left once interests are done", async () => {
    await finish("interests");
    let t = await section();
    expect(t).not.toContain("Start with interests");
    expect(t).toContain("Interests are done, so your career matches are ready. Next up: personality, then what matters to you.");
    expect(t).toContain("Start personality");

    await finish("values");
    t = await section();
    expect(t).toContain("Next up: personality.");

    await finish("personality");
    expect(await section()).toContain("All done. You can retake them as you grow.");
  });
});
