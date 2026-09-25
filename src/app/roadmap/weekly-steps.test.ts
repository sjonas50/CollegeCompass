import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editStepAction, removeStepAction } from "@/app/actions/roadmap";
import { type Db, createTestDb, schema } from "@/db";
import type { SessionUser } from "@/lib/auth/sessions";
import { STEP_TEXT_MAX, weekStartOf } from "@/lib/steps";
import { WeeklyStepsList, type WeeklyStepItem } from "./weekly-steps-list";

// Editing and removing weekly steps: the actions (signed-in student and database mocked) and the
// server-rendered list (vitest runs in node, without a DOM).

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user }));
vi.mock("next/cache", () => ({ refresh: () => {} }));

const DAY_MS = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

/** A student whose household's trial is running (`full`) or ended (`locked`), signed in unless `signedIn` is false. */
async function student(name: string, access: "full" | "locked" = "full", signedIn = true) {
  const [household] = await db.insert(schema.households).values({}).returning();
  const start = access === "full" ? new Date(Date.now() - DAY_MS) : new Date(Date.now() - 30 * DAY_MS);
  await db.insert(schema.accessGrants).values({ householdId: household.id, kind: "trial", startsAt: start, endsAt: new Date(start.getTime() + 14 * DAY_MS) });
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: household.id, displayName: name, passwordHash: "x", birthDate: "2010-01-15", grade: 10, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  if (signedIn) {
    state.user = { id: user.id, role: "student", displayName: name, username: null, householdId: household.id, parentManaged: false, grade: 10 };
  }
  return user.id;
}

async function stepFor(userId: string, text: string, status: "open" | "done" = "open") {
  const [step] = await db
    .insert(schema.weeklySteps)
    .values({ userId, weekStart: weekStartOf(), text, status, completedAt: status === "done" ? new Date() : null })
    .returning();
  return step;
}

const textOf = async (id: string) => (await db.select().from(schema.weeklySteps).where(eq(schema.weeklySteps.id, id)))[0]?.text;

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** Where a call redirected to, or null if it didn't. */
async function redirectOf(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
}

describe("editStepAction", () => {
  it("saves the student's own step, trimmed", async () => {
    const me = await student("Ana");
    const step = await stepFor(me, "Emial my counselor");
    expect(await editStepAction(undefined, form({ stepId: step.id, stepText: "  Email my counselor " }))).toEqual({ ok: true });
    expect(await textOf(step.id)).toBe("Email my counselor");
  });

  it("fixes a finished step, which stays finished", async () => {
    const me = await student("Ana");
    const step = await stepFor(me, "Visit the libary", "done");
    expect(await editStepAction(undefined, form({ stepId: step.id, stepText: "Visit the library" }))).toEqual({ ok: true });
    const [row] = await db.select().from(schema.weeklySteps).where(eq(schema.weeklySteps.id, step.id));
    expect(row).toMatchObject({ text: "Visit the library", status: "done" });
  });

  it("won't change another student's step, and says only that it couldn't find it", async () => {
    const ben = await student("Ben", "full", false);
    const theirs = await stepFor(ben, "Ben's step");
    await student("Ana");
    expect(await editStepAction(undefined, form({ stepId: theirs.id, stepText: "Ana was here" }))).toEqual({
      ok: false,
      message: "We couldn't find that step. Try refreshing the page.",
    });
    expect(await textOf(theirs.id)).toBe("Ben's step");
    // Nor a missing or made-up id.
    expect(await editStepAction(undefined, form({ stepText: "Ana was here" }))).toMatchObject({ ok: false, message: expect.any(String) });
    expect(await editStepAction(undefined, form({ stepId: "not-a-uuid", stepText: "Ana was here" }))).toMatchObject({ ok: false });
  });

  it("checks the text like adding a step, as an error on the field", async () => {
    const me = await student("Ana");
    const step = await stepFor(me, "Visit the library");
    expect(await editStepAction(undefined, form({ stepId: step.id, stepText: "   " }))).toEqual({
      ok: false,
      errors: { text: ["Write a short step, like “Ask my counselor about summer programs.”"] },
    });
    expect(await editStepAction(undefined, form({ stepId: step.id, stepText: "x".repeat(STEP_TEXT_MAX + 1) }))).toEqual({
      ok: false,
      errors: { text: [`Keep it to ${STEP_TEXT_MAX} characters or fewer.`] },
    });
    expect(await editStepAction(undefined, form({ stepId: step.id }))).toMatchObject({ ok: false, errors: { text: [expect.any(String)] } });
    expect(await textOf(step.id)).toBe("Visit the library");
  });

  it("needs full access, and changes nothing without it", async () => {
    const me = await student("Ana", "locked");
    const step = await stepFor(me, "Visit the library", "done");
    expect(await redirectOf(editStepAction(undefined, form({ stepId: step.id, stepText: "Changed" })))).toBe("/account/access");
    expect(await redirectOf(removeStepAction(step.id))).toBe("/account/access");
    expect(await textOf(step.id)).toBe("Visit the library");
  });
});

describe("removeStepAction", () => {
  it("removes a finished step, but only the student's own", async () => {
    const ben = await student("Ben", "full", false);
    const theirs = await stepFor(ben, "Ben's step", "done");
    const me = await student("Ana");
    const mine = await stepFor(me, "Visit the library", "done");
    expect(await removeStepAction(theirs.id)).toEqual({ ok: false, message: "We couldn't remove that step. Try refreshing the page." });
    expect(await textOf(theirs.id)).toBe("Ben's step");
    expect(await removeStepAction(mine.id)).toEqual({ ok: true });
    expect(await textOf(mine.id)).toBeUndefined();
  });
});

describe("weekly steps list", () => {
  const steps: WeeklyStepItem[] = [
    { id: "00000000-0000-4000-8000-000000000001", text: "Ask about the PSAT", status: "done", milestoneId: null },
    { id: "00000000-0000-4000-8000-000000000002", text: "Look up nursing programs", status: "open", milestoneId: null },
  ];
  const render = () =>
    renderToStaticMarkup(
      createElement(WeeklyStepsList, {
        steps,
        stats: { stepsCompleted: 1, weeksWithProgress: 1 },
        max: 3,
        maxLength: STEP_TEXT_MAX,
        ideas: "roadmap",
        headingId: "weekly-steps-heading",
      }),
    );

  it("gives every step, finished or not, a labeled Edit and Remove button", () => {
    const html = render();
    for (const step of steps) {
      expect(html).toContain(`Edit<span class="sr-only">: ${step.text}</span>`);
      expect(html).toContain(`Remove<span class="sr-only">: ${step.text}</span>`);
    }
    // Real buttons, reachable by keyboard, with full-size targets.
    expect(html.match(/<button type="button" class="min-h-11[^"]*">Edit</g)).toHaveLength(2);
    expect(html.match(/<button type="button" class="min-h-11[^"]*">Remove</g)).toHaveLength(2);
  });

  it("still has the add form while there's room", () => {
    const html = render();
    expect(html).toContain('name="stepText"');
    expect(html).toContain("Room for 1 more.");
  });
});
