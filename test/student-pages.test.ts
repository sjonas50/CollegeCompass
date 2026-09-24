import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstrumentPage from "@/app/discover/[instrument]/page";
import PlanPage from "@/app/plan/page";
import { WeeklyStepsCard } from "@/components/weekly-steps";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";

// Server-rendered checks for student pages, with the signed-in student and database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user }));

afterEach(() => {
  state.db = null;
  state.user = null;
});

async function signInStudent(grade: number | null) {
  const db = await createTestDb();
  state.db = db;
  const res = await registerStudent(
    db,
    { displayName: "Sam", email: "sam@example.com", password: "correct horse battery", birthDate: "2008-03-01", grade: 10 },
    new Date("2025-09-01T12:00:00Z"),
  );
  if (!res.ok) throw new Error(res.error);
  state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

describe("weekly steps card, empty", () => {
  it("sends a student to their roadmap for ideas", async () => {
    await signInStudent(10);
    const html = await render(WeeklyStepsCard({}));
    expect(html).toContain('href="/roadmap"');
    expect(text(html)).toContain("Find ideas on your roadmap");
  });

  it("points at the Add to this week buttons on the roadmap page", async () => {
    await signInStudent(10);
    const html = await render(WeeklyStepsCard({ linkToRoadmap: false }));
    expect(html).not.toContain('href="/roadmap"');
    expect(text(html)).toContain("Tap “Add to this week” on anything below, or write your own.");
  });

  it("asks a graduate for their own steps, without roadmap ideas or buttons they don't have", async () => {
    await signInStudent(13);
    for (const linkToRoadmap of [true, false]) {
      const html = await render(WeeklyStepsCard({ linkToRoadmap }));
      expect(html).not.toContain('href="/roadmap"');
      expect(html).not.toContain("Add to this week");
      expect(text(html)).toContain("Add your own steps below for whatever comes next for you.");
      expect(html).toContain('name="stepText"');
    }
  });
});

describe("back to dashboard links", () => {
  const backLink = (html: string) => /<a[^>]*href="\/dashboard"[^>]*>Back to dashboard<\/a>/.exec(html)?.[0];

  it("are full-size touch targets on the plan page", async () => {
    await signInStudent(10);
    expect(backLink(await render(PlanPage()))).toMatch(/class="[^"]*\bmin-h-11\b/);
  });

  it("are full-size touch targets on an activity's start page", async () => {
    await signInStudent(10);
    const page = InstrumentPage({
      params: Promise.resolve({ instrument: "interests" }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/discover/[instrument]">);
    expect(backLink(await render(page))).toMatch(/class="[^"]*\bmin-h-11\b/);
  });
});
