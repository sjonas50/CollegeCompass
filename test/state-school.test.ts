import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sameSchoolAsAction, saveChildSchoolAction, saveMySchoolAction } from "@/app/actions/schools";
import { POST as searchApi } from "@/app/api/schools/search/route";
import DashboardPage from "@/app/dashboard/page";
import ParentHome from "@/app/parent/page";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { currentGrade } from "@/lib/auth/age";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { SCHOOL_SEARCH_RATE } from "@/lib/schools/search";
import { saveSchoolSettings, schoolSettings } from "@/lib/schools/student";
import { SCHOOLS, insertSchools } from "@/lib/schools/test-fixtures";

// Where a student goes to school, end to end: the settings forms' actions, the school search
// route, the pages that show the pickers, and the data download and deletion. All of it is free:
// it works for a household whose trial has ended.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { redirectTo: to });
  },
}));
// Cards that load their own data have their own tests.
vi.mock("@/components/weekly-steps", () => ({ WeeklyStepsCard: () => null }));
vi.mock("@/components/invite-parent", () => ({ InviteParentCard: () => null }));

const NOW = new Date("2026-09-25T18:00:00Z");
const PASSWORD = "correct horse battery";
const DAY_MS = 86_400_000;
let db: Db;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = await createTestDb();
  state.db = db;
  await insertSchools(db);
});

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** Where an action redirected to, or its returned state. */
async function run(call: Promise<unknown>): Promise<{ redirect: string } | { result: unknown }> {
  try {
    return { result: await call };
  } catch (e) {
    if (e instanceof Error && "redirectTo" in e) return { redirect: String(e.redirectTo) };
    throw e;
  }
}

async function signIn(id: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  state.user = {
    id: row.id,
    role: row.role,
    displayName: row.displayName,
    username: row.username,
    householdId: row.householdId,
    parentManaged: row.parentManaged,
    grade: currentGrade(row, NOW),
    homeState: row.homeState,
  };
  return state.user;
}

/** A 10th grader whose household's trial ended a while ago (so nothing paid is unlocked). */
async function lockedStudent(name = "Ana") {
  const res = await registerStudent(db, { displayName: name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD, birthDate: "2011-01-15", grade: 10 }, new Date(NOW.getTime() - 60 * DAY_MS));
  if (!res.ok) throw new Error(res.error);
  await db.update(schema.accessGrants).set({ endsAt: new Date(NOW.getTime() - 30 * DAY_MS) });
  return res.value.userId;
}

async function family() {
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: PASSWORD });
  if (!parent.ok) throw new Error();
  const rosa = parent.value.userId;
  const consent = await verifyParentConsent({ parentUserId: rosa, attested: true });
  const kid = async (name: string, grade: number) => {
    const res = await createChildAccount(db, rosa, { displayName: name, username: name.toLowerCase(), password: PASSWORD, birthDate: "2014-03-01", grade }, consent, NOW);
    if (!res.ok) throw new Error(res.error);
    return res.value.userId;
  };
  return { rosa, leo: await kid("Leo", 7), mia: await kid("Mia", 8) };
}

describe("the student's settings", () => {
  it("saves a state and school for a student whose trial ended (it's free)", async () => {
    const ana = await lockedStudent();
    await signIn(ana);
    const out = await run(saveMySchoolAction(undefined, form({ state: "TX", school: `ref:${SCHOOLS.austinHigh.schoolRef}` })));
    expect(out).toEqual({ redirect: "/dashboard?settings=school#school-settings" });
    expect(await schoolSettings(db, ana)).toMatchObject({ homeState: "TX", current: { school: { name: "Austin High School" }, setBy: "student" } });
  });

  it("answers a mistake with the reason, keeping the form", async () => {
    const ana = await lockedStudent();
    await signIn(ana);
    expect(await run(saveMySchoolAction(undefined, form({ state: "UT", school: `ref:${SCHOOLS.austinHigh.schoolRef}` })))).toEqual({
      result: { errors: { school: ["That school is in another state. Choose the state first, then search again."] } },
    });
    expect(await run(saveMySchoolAction(undefined, form({ state: "", school: "not_listed" })))).toEqual({
      result: { errors: { state: ["Choose a state first. Schools are listed by state."] } },
    });
  });

  it("shows the pickers in Settings, and a nudge until a state is set", async () => {
    const ana = await lockedStudent();
    await signIn(ana);
    const before = await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">));
    expect(text(before)).toContain("Add your state and school");
    expect(before).toContain('href="/dashboard?school=edit#school-settings"');
    expect(before).toContain('id="school-settings"');
    expect(text(before)).toContain("Where you go to school");
    expect(before).not.toMatch(/<details id="settings"[^>]*open/);

    await saveSchoolSettings(db, ana, { state: "TN", current: { choice: "listed", schoolRef: SCHOOLS.alcoa.schoolRef } }, { by: "student", now: NOW });
    await signIn(ana);
    const after = await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ settings: "school" }) } as PageProps<"/dashboard">));
    const words = text(after);
    expect(words).toContain("Saved where you go to school.");
    expect(words).not.toContain("Add your state and school");
    expect(after).toMatch(/<details id="settings"[^>]*open/);
    // The saved school is offered as the checked answer, with the state selected.
    expect(words).toContain("Alcoa High School");
    expect(words).toContain("Alcoa · Grades 9–12 · Public");
    expect(after).toMatch(/<option value="TN" selected="">Tennessee \(full class planning\)<\/option>/);
    expect(words).toContain("We use your school only to show its classes. We never share it with the AI counselor or show it to other families.");
    expect(words).toContain("I'd rather not say");
    expect(words).toContain("My school isn't listed");
    expect(words).toContain("Full class planning is available for Tennessee.");
  });

  it("says class planning is coming later outside Utah, Tennessee and Texas", async () => {
    const ana = await lockedStudent();
    await saveSchoolSettings(db, ana, { state: "OH" }, { by: "student", now: NOW });
    await signIn(ana);
    const words = text(await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">)));
    expect(words).toContain("We'll use your state for colleges and aid. Full class planning for Ohio is coming later.");
  });
});

describe("the parent page", () => {
  it("lets a parent set each child's school, shows it to them, and offers the same school for a sibling", async () => {
    const { rosa, leo, mia } = await family();
    await signIn(rosa);
    expect(await run(saveChildSchoolAction(undefined, form({ studentId: mia, state: "UT", school: `ref:${SCHOOLS.utahJunior.schoolRef}` })))).toEqual({
      redirect: `/parent?saved=1#school-${mia}`,
    });
    expect(await schoolSettings(db, mia)).toMatchObject({ homeState: "UT", current: { school: { name: "Copper Mountain Middle" }, setBy: "parent" } });

    const html = await render(ParentHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/parent">));
    const words = text(html);
    expect(words).toContain("Utah · Copper Mountain Middle");
    expect(words).toContain("Where Leo goes to school");
    expect(words).toContain("We use Mia's school only to show its classes.");
    expect(words).toContain("Full class planning is available for Utah. We'll also use the state for colleges and aid.");
    expect(words).toContain("Which high school does Mia expect to go to?");
    expect(words).toContain("Same school as Mia");
    expect(html).toContain(`id="school-${leo}"`);

    expect(await run(sameSchoolAsAction(form({ studentId: leo, fromStudentId: mia })))).toEqual({ redirect: `/parent?saved=1#school-${leo}` });
    expect((await schoolSettings(db, leo))?.current?.school?.name).toBe("Copper Mountain Middle");
  });

  it("changes nothing for a child who isn't theirs", async () => {
    const { leo } = await family();
    const other = await registerParent(db, { displayName: "Sam", email: "sam@example.com", password: PASSWORD });
    if (!other.ok) throw new Error();
    await signIn(other.value.userId);
    expect(await run(saveChildSchoolAction(undefined, form({ studentId: leo, state: "TX" })))).toEqual({ redirect: "/parent" });
    expect(await run(sameSchoolAsAction(form({ studentId: leo, fromStudentId: leo })))).toEqual({ redirect: "/parent" });
    expect((await schoolSettings(db, leo))?.homeState).toBeNull();
  });
});

describe("POST /api/schools/search", () => {
  const post = (body: unknown) =>
    searchApi(new Request("http://localhost/api/schools/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("finds schools for a signed-in student or parent, locked or not, and isn't cached", async () => {
    await signIn(await lockedStudent());
    const res = await post({ state: "TX", query: "plano sr" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.results.map((r: { name: string }) => r.name)).toEqual(["Plano Senior High School", "Plano East Senior High School"]);
    expect(body.results[0]).toEqual({
      ref: SCHOOLS.planoSenior.schoolRef,
      name: "Plano Senior High School",
      city: "Plano",
      state: "TX",
      gradeLow: 11,
      gradeHigh: 12,
      kind: "public",
      virtual: false,
      careerCenter: false,
      district: "Plano ISD",
    });
    const { rosa } = await family();
    await signIn(rosa);
    expect((await post({ state: "TN", query: "alcoa" })).status).toBe(200);
  });

  it("refuses visitors, staff and bad requests, and limits how many searches one person makes", async () => {
    expect((await post({ state: "TX", query: "plano" })).status).toBe(401);
    const ana = await lockedStudent();
    await signIn(ana);
    expect((await post({ state: "Texas", query: "plano" })).status).toBe(400);
    expect((await post({ state: "TX", query: "x".repeat(101) })).status).toBe(400);
    expect((await searchApi(new Request("http://localhost/api/schools/search", { method: "POST", body: "not json" }))).status).toBe(400);
    await db.insert(schema.rateLimits).values({ key: `school-search:${ana}`, windowStart: NOW, count: SCHOOL_SEARCH_RATE.count });
    expect((await post({ state: "TX", query: "plano" })).status).toBe(429);
    state.user = { ...state.user!, role: "admin" };
    expect((await post({ state: "TX", query: "plano" })).status).toBe(401);
  });
});

describe("the data download and deletion", () => {
  it("includes the state and school in the student's and the parent's copies, and deletes them with the student", async () => {
    const { rosa, mia } = await family();
    await saveSchoolSettings(
      db,
      mia,
      { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.utahJunior.schoolRef }, next: { choice: "not_listed", name: "Oak Hill" } },
      { by: "parent", now: NOW },
    );
    for (const requester of [mia, rosa]) {
      const data = await exportStudentData(db, requester, mia);
      expect(data?.profile.homeState).toBe("UT");
      expect(data?.schools).toEqual([
        expect.objectContaining({ role: "current", school: expect.objectContaining({ name: "Copper Mountain Middle", directoryId: SCHOOLS.utahJunior.schoolRef }) }),
        expect.objectContaining({ role: "next", choice: "not_listed", notListedName: "Oak Hill" }),
      ]);
    }
    expect(await deleteStudent(db, rosa, mia)).toBe(true);
    expect(await db.select().from(schema.studentSchools)).toEqual([]);
    // The directory is reference data: deleting a student leaves it alone.
    expect((await db.select().from(schema.schools)).length).toBe(Object.keys(SCHOOLS).length);
  });

  it("keeps students' schools when the directory is reloaded (no foreign key to it)", async () => {
    const ana = await lockedStudent();
    await saveSchoolSettings(db, ana, { state: "TN", current: { choice: "listed", schoolRef: SCHOOLS.alcoa.schoolRef } }, { by: "student", now: NOW });
    // What `npm run data:load` does: replace the table wholesale.
    await db.transaction(async (tx) => {
      await tx.delete(schema.schools);
      await tx.insert(schema.schools).values(Object.values(SCHOOLS));
    });
    expect(await db.select({ schoolRef: schema.studentSchools.schoolRef }).from(schema.studentSchools)).toEqual([{ schoolRef: SCHOOLS.alcoa.schoolRef }]);
    expect((await schoolSettings(db, ana))?.current?.school?.name).toBe("Alcoa High School");
  });
});
