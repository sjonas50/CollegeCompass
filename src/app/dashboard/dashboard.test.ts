import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import { type Db, createTestDb, schema } from "@/db";
import { addCustom, updateEntry } from "@/lib/applications/service";
import type { SessionUser } from "@/lib/auth/sessions";

// The dashboard's locked state: the college list's deadline tracker is part of full access.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
// Cards that load their own data have their own tests.
vi.mock("@/components/weekly-steps", () => ({ WeeklyStepsCard: () => null }));
vi.mock("@/components/invite-parent", () => ({ InviteParentCard: () => null }));

const NOW = new Date("2026-09-24T18:00:00Z");
const DAY_MS = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

/** A grade-12 student whose household has full access or whose trial has ended. */
async function signIn(full: boolean) {
  const db = await createTestDb();
  state.db = db;
  const [household] = await db.insert(schema.households).values({}).returning();
  const start = new Date(NOW.getTime() - (full ? 2 : 30) * DAY_MS);
  await db.insert(schema.accessGrants).values({ householdId: household.id, kind: "trial", startsAt: start, endsAt: new Date(start.getTime() + 14 * DAY_MS) });
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: "2008-10-01", grade: 12, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role: "student", displayName: "Sam", username: null, householdId: household.id, parentManaged: false, grade: 12 };
  const entry = await addCustom(db, user.id, { name: "Lakeside nursing program", kind: "program" });
  if (!entry.ok) throw new Error();
  await updateEntry(db, user.id, entry.value.id, { deadline: "2026-10-01" }, NOW);
  return entry.value.id;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const dashboard = async () =>
  renderToStaticMarkup((await DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">)) as ReactNode);

describe("dashboard colleges card", () => {
  it("shows upcoming deadlines with full access", async () => {
    const entryId = await signIn(true);
    const html = await dashboard();
    expect(text(html)).toContain("Deadlines in the next two weeks:");
    expect(html).toContain(`href="/applications/${entryId}"`);
  });

  it("hides the deadline tracker while the family's access is off, and says how to get it back", async () => {
    const entryId = await signIn(false);
    const html = await dashboard();
    const t = text(html);
    expect(t).toContain("See how to unlock");
    expect(t).not.toContain("Deadlines in the next two weeks:");
    expect(t).not.toContain("Lakeside nursing program");
    expect(html).not.toContain(`/applications/${entryId}`);
    expect(t).toContain("1 on your list. Your deadlines show up here when your family has full access.");
    expect(t).not.toContain("No deadlines in the next two weeks");
    expect(t).toContain("Unlock my list");
  });
});
