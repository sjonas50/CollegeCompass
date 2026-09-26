import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePathSettingsAction } from "@/app/actions/path";
import { PathSettings, type PathSettingsValues } from "@/app/plan/path/path-settings";
import { afterAction } from "@/app/plan/path/suggestion-actions";
import { type Db, createTestDb, schema } from "@/db";
import { trialGrant } from "@/lib/access/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { getPlanPrefs } from "@/lib/planner/prefs";

// "Change what your path plans for": only what the student changes is saved (defaults they never
// picked keep following their goals), the class-year correction, and the form's accessibility.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }));

let db: Db;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-25T15:00:00Z") });
  db = await createTestDb();
  state.db = db;
});

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

async function signIn() {
  const [h] = await db.insert(schema.households).values({}).returning();
  await db.insert(schema.accessGrants).values(trialGrant(h.id, new Date(Date.now() - 86_400_000)));
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: h.id, displayName: "Sam", passwordHash: "x", birthDate: "2011-01-15", grade: 10, gradeSchoolYear: 2026, homeState: "TX" })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role: "student", displayName: "Sam", username: null, householdId: h.id, parentManaged: false, grade: 10, homeState: "TX" };
  return user.id;
}

/** What the settings form sends: every control's value, and the names the student changed. */
function settingsForm(changed: string[], fields: Record<string, string> = {}) {
  const f = new FormData();
  const all: Record<string, string> = {
    touched: changed.join(","),
    path: "",
    familyId: "",
    maxCollegeLevelPerYear: "3",
    "accelerateMath:present": "1",
    txEndorsement: "",
    "txAimDla:present": "1",
    txAimDla: "on",
    worldLanguage: "",
    grade9EntryYear: "2025",
    classYear: "2029",
    grade9EntryDefault: "2025",
    classYearDefault: "2029",
    cohortReason: "",
    ...fields,
  };
  for (const [k, v] of Object.entries(all)) f.set(k, v);
  return f;
}

const stored = async (id: string) => (await db.select().from(schema.studentPlanPrefs).where(eq(schema.studentPlanPrefs.userId, id)))[0];

describe("saving the path's settings", () => {
  it("saves only what the student changed: the inferred path, the DLA default and the limit stay defaults", async () => {
    const id = await signIn();
    expect(await savePathSettingsAction(undefined, settingsForm(["worldLanguage"], { worldLanguage: "fr" }))).toMatchObject({ ok: true });
    const row = await stored(id);
    expect(row.targets).toEqual({});
    expect(row.choices).toEqual({ worldLanguage: "fr" });
    expect(row.limits).toEqual({});
    expect(row.cohort).toEqual({});
  });

  it("switching to the training path without touching the DLA puts the DLA back to its default", async () => {
    const id = await signIn();
    await savePathSettingsAction(undefined, settingsForm(["path", "txAimDla"], { path: "degree", txAimDla: "on" }));
    expect((await getPlanPrefs(db, id)).choices.txAimDla).toBe(true);
    await savePathSettingsAction(undefined, settingsForm(["path"], { path: "training" }));
    const prefs = await getPlanPrefs(db, id);
    expect(prefs.path).toBe("training");
    expect(prefs.choices).not.toHaveProperty("txAimDla");
  });

  it("\"Let my goals decide\" clears a chosen path", async () => {
    const id = await signIn();
    await savePathSettingsAction(undefined, settingsForm(["path"], { path: "degree" }));
    expect((await getPlanPrefs(db, id)).path).toBe("degree");
    await savePathSettingsAction(undefined, settingsForm(["path"], { path: "" }));
    expect((await getPlanPrefs(db, id)).path).toBeNull();
  });

  it("a changed class year needs a reason, and the grade's own year clears the correction", async () => {
    const id = await signIn();
    expect(await savePathSettingsAction(undefined, settingsForm(["grade9EntryYear"], { grade9EntryYear: "2026" }))).toMatchObject({ ok: false });
    expect(await stored(id)).toBeUndefined();
    await savePathSettingsAction(undefined, settingsForm(["grade9EntryYear", "cohortReason"], { grade9EntryYear: "2026", cohortReason: "repeated" }));
    expect((await getPlanPrefs(db, id)).cohort).toEqual({ grade9Entry: { year: 2026, reason: "repeated" } });
    await savePathSettingsAction(undefined, settingsForm(["grade9EntryYear"], { grade9EntryYear: "2025", cohortReason: "repeated" }));
    expect((await getPlanPrefs(db, id)).cohort).toEqual({});
  });

  it("a pending decision's one-question form still saves its one field", async () => {
    const id = await signIn();
    const f = new FormData();
    f.set("txEndorsement", "business_industry");
    expect(await savePathSettingsAction(undefined, f)).toMatchObject({ ok: true });
    expect((await getPlanPrefs(db, id)).choices.txEndorsements).toEqual(["business_industry"]);
  });
});

describe("the settings form", () => {
  const initial: PathSettingsValues = {
    path: "",
    pathInferred: true,
    inferredPath: "degree",
    familyId: "",
    maxCollegeLevelPerYear: 3,
    accelerateMath: false,
    txEndorsement: "",
    txAimDla: true,
    tnElectiveFocus: "",
    worldLanguage: "",
    grade9EntryYear: 2025,
    classYear: 2029,
    grade9EntryDefault: 2025,
    classYearDefault: 2029,
    cohortReason: "",
  };
  const html = () => renderToStaticMarkup(createElement(PathSettings, { state: "TX", initial }));

  it("links each hint to its control, so screen readers read the guidance", () => {
    const markup = html();
    for (const name of ["familyId", "maxCollegeLevelPerYear", "txEndorsement", "grade9EntryYear"]) {
      const tag = new RegExp(`<select[^>]*name="${name}"[^>]*>`).exec(markup)?.[0] ?? "";
      const describedBy = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
      expect(describedBy, name).toBeTruthy();
      expect(markup, name).toContain(`id="${describedBy}"`);
    }
  });

  it("follows the goals until the student picks a path, and asks whether the class year is right", () => {
    const markup = html();
    const goals = /<input type="radio"[^>]*name="path"[^>]*value=""[^>]*\/>/.exec(markup)?.[0] ?? "";
    expect(goals).toContain('checked=""');
    expect(markup).not.toMatch(/<input type="radio"[^>]*name="path"[^>]*checked=""[^>]*value="degree"/);
    expect(markup).toContain("Let my goals decide");
    expect(markup).toContain('name="touched"');
    expect(markup).toContain("You started 9th grade in fall 2025 (class of 2029). Is that right?");
  });
});

describe("after an action on a suggestion", () => {
  it("announces a failure once, in the error line only", () => {
    const ui = { setError: vi.fn(), announce: vi.fn(), focus: vi.fn() };
    afterAction({ ok: false, message: "That suggestion changed." }, "year-10", ui);
    expect(ui.setError).toHaveBeenCalledWith("That suggestion changed.");
    expect(ui.announce).not.toHaveBeenCalled();
    expect(ui.focus).not.toHaveBeenCalled();
  });

  it("announces a success in the live region and moves focus", () => {
    const ui = { setError: vi.fn(), announce: vi.fn(), focus: vi.fn() };
    afterAction({ ok: true, message: "Added." }, "year-10", ui);
    expect(ui.announce).toHaveBeenCalledWith("Added.");
    expect(ui.focus).toHaveBeenCalledWith("year-10");
    expect(ui.setError).not.toHaveBeenCalled();
  });
});
