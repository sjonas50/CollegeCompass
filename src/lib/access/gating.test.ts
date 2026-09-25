import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestFreeAccessAction } from "@/app/actions/access";
import { addCollegeAction, addCustomEntryAction, removeEntryAction, updateEntryAction } from "@/app/actions/applications";
import { clearMemoryAction, deleteConversationAction } from "@/app/actions/counselor";
import { addCourseAction, deleteCourseAction, updateCourseAction } from "@/app/actions/plan";
import {
  addMilestoneStepAction,
  addStepAction,
  editStepAction,
  markMilestoneAction,
  removeStepAction,
  setStepDoneAction,
} from "@/app/actions/roadmap";
import { POST as counselorApi } from "@/app/api/counselor/route";
import EntryPage from "@/app/applications/[id]/page";
import ComparePage from "@/app/applications/compare/page";
import ApplicationsPage from "@/app/applications/page";
import ConversationPage from "@/app/counselor/[id]/page";
import CounselorPage from "@/app/counselor/page";
import PlanPage from "@/app/plan/page";
import RoadmapPage from "@/app/roadmap/page";
import { type Db, createTestDb, schema } from "@/db";
import { addCustom } from "@/lib/applications/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { createConversation } from "@/lib/counselor/conversations";
import { respond } from "@/lib/counselor/respond";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { CRISIS_LINE } from "./describe";

// Every page, action and route that needs full access refuses without it (sending students to
// /account/access, or answering 402) and works with it. Privacy controls and crisis help never lock.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => "/counselor" }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/counselor/respond", async (original) => ({
  ...(await original<typeof import("@/lib/counselor/respond")>()),
  respond: vi.fn(async function* () {
    yield { type: "delta", text: "Hello!" };
    yield { type: "done", messageId: null };
  }),
}));

const DAY_MS = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  vi.mocked(respond).mockClear();
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

/** A signed-in student whose household's trial is running (`full`) or ended (`locked`). */
async function signIn(access: "full" | "locked", { birthDate = "2010-01-15", role = "student" as SessionUser["role"] } = {}) {
  const [household] = await db.insert(schema.households).values({}).returning();
  const start = access === "full" ? new Date(Date.now() - DAY_MS) : new Date(Date.now() - 30 * DAY_MS);
  await db.insert(schema.accessGrants).values({ householdId: household.id, kind: "trial", startsAt: start, endsAt: new Date(start.getTime() + 14 * DAY_MS) });
  const [user] = await db
    .insert(schema.users)
    .values({ role, householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: role === "student" ? birthDate : null, grade: 11, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role, displayName: "Sam", username: null, householdId: household.id, parentManaged: false, grade: role === "student" ? 11 : null };
  return user.id;
}

/** Where a call redirected to, or null if it didn't. */
async function redirectOf(call: Promise<unknown> | (() => Promise<unknown>)): Promise<string | null> {
  try {
    await (typeof call === "function" ? call() : call);
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const COURSE = { name: "Chemistry", subject: "science", level: "regular", gradeLevel: "11", term: "full_year", credits: "1", status: "planned" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode>) => renderToStaticMarkup(await node);
const pageProps = <T,>(params: object = {}, searchParams: object = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) }) as T;

describe("gated pages", () => {
  const pages: [string, () => Promise<unknown>][] = [
    ["/plan", () => PlanPage()],
    ["/roadmap", () => RoadmapPage(pageProps<PageProps<"/roadmap">>())],
    ["/applications", () => ApplicationsPage(pageProps<PageProps<"/applications">>())],
    ["/applications/compare", () => ComparePage()],
    ["/applications/[id]", () => EntryPage(pageProps<PageProps<"/applications/[id]">>({ id: "00000000-0000-4000-8000-000000000001" }))],
  ];

  for (const [path, page] of pages) {
    it(`${path} sends a locked student to /account/access`, async () => {
      await signIn("locked");
      expect(await redirectOf(page)).toBe("/account/access");
    });
  }

  it("open with full access", async () => {
    const id = await signIn("full");
    const entry = await addCustom(db, id, { name: "Welding program", kind: "program" });
    if (!entry.ok) throw new Error();
    expect(text(await render(PlanPage()))).toContain("Your course plan");
    expect(await redirectOf(RoadmapPage(pageProps<PageProps<"/roadmap">>()))).toBeNull();
    expect(text(await render(ApplicationsPage(pageProps<PageProps<"/applications">>())))).toContain("Welding program");
    expect(await redirectOf(ComparePage())).toBeNull();
    expect(text(await render(EntryPage(pageProps<PageProps<"/applications/[id]">>({ id: entry.value.id }))))).toContain("Welding program");
  });

  it("don't give a trial to a household whose trial ended", async () => {
    await signIn("locked");
    await redirectOf(PlanPage);
    expect(await db.select().from(schema.accessGrants)).toHaveLength(1);
  });
});

describe("the counselor page", () => {
  it("shows a locked panel with crisis help instead of the chat, and keeps past chats deletable", async () => {
    const id = await signIn("locked");
    await createConversation(db, id, "About colleges");
    const html = await render(CounselorPage(pageProps<PageProps<"/counselor">>()));
    const t = text(html);
    expect(t).toContain("Your counselor is part of full access");
    expect(t).toContain(CRISIS_LINE);
    expect(html).toContain('href="tel:988"');
    expect(html).toContain('href="/account/access"');
    expect(html).not.toContain("<textarea");
    // Listed (to delete), but not openable.
    expect(t).toContain("About colleges");
    expect(html).not.toMatch(/href="\/counselor\/[0-9a-f-]{36}"/);
    expect(t).toContain("Delete");
  });

  it("shows the chat with full access", async () => {
    await signIn("full");
    const html = await render(CounselorPage(pageProps<PageProps<"/counselor">>()));
    expect(html).toContain("<textarea");
    expect(text(html)).not.toContain("Your counselor is part of full access");
  });

  it("sends a locked student from a conversation back to /counselor", async () => {
    const id = await signIn("locked");
    const conv = await createConversation(db, id, "About colleges");
    expect(await redirectOf(ConversationPage(pageProps<PageProps<"/counselor/[id]">>({ id: conv.id })))).toBe("/counselor");
  });
});

describe("gated actions", () => {
  const actions: [string, () => Promise<unknown>][] = [
    ["addCourseAction", () => addCourseAction(undefined, form(COURSE))],
    ["updateCourseAction", () => updateCourseAction(undefined, form({ ...COURSE, courseId: "x" }))],
    ["deleteCourseAction", () => deleteCourseAction(undefined, form({ courseId: "x" }))],
    ["markMilestoneAction", () => markMilestoneAction("m", "done")],
    ["addMilestoneStepAction", () => addMilestoneStepAction("m")],
    ["addStepAction", () => addStepAction(undefined, form({ stepText: "Email my counselor" }))],
    ["setStepDoneAction", () => setStepDoneAction("x", true)],
    ["editStepAction", () => editStepAction(undefined, form({ stepId: "x", stepText: "Email my coach" }))],
    ["removeStepAction", () => removeStepAction("x")],
    ["addCollegeAction", () => addCollegeAction({ status: "idle" }, form({ unitId: "100001" }))],
    ["addCustomEntryAction", () => addCustomEntryAction(undefined, form({ name: "Welding program", kind: "program" }))],
    ["updateEntryAction", () => updateEntryAction(undefined, form({ entryId: "x" }))],
    ["removeEntryAction", () => removeEntryAction(undefined, form({ entryId: "x" }))],
  ];

  for (const [name, action] of actions) {
    it(`${name} refuses a locked student`, async () => {
      await signIn("locked");
      expect(await redirectOf(action)).toBe("/account/access");
    });
  }

  it("change nothing while locked", async () => {
    await signIn("locked");
    await redirectOf(() => addCourseAction(undefined, form(COURSE)));
    await redirectOf(() => addStepAction(undefined, form({ stepText: "Email my counselor" })));
    await redirectOf(() => addCustomEntryAction(undefined, form({ name: "Welding program", kind: "program" })));
    expect(await db.select().from(schema.studentCourses)).toHaveLength(0);
    expect(await db.select().from(schema.weeklySteps)).toHaveLength(0);
    expect(await db.select().from(schema.collegeList)).toHaveLength(0);
  });

  it("work with full access", async () => {
    await signIn("full");
    await db.insert(schema.colleges).values({ unitId: 100001, name: "North State University" });
    const milestone = MILESTONES[0].id;

    expect(await addCourseAction(undefined, form(COURSE))).toMatchObject({ ok: true });
    const [course] = await db.select().from(schema.studentCourses);
    expect(await updateCourseAction(undefined, form({ ...COURSE, name: "AP Chemistry", courseId: course.id }))).toEqual({ ok: true });
    expect(await deleteCourseAction(undefined, form({ courseId: course.id }))).toEqual({ ok: true });

    expect(await markMilestoneAction(milestone, "done")).toEqual({ ok: true });
    expect(await addMilestoneStepAction(milestone)).toEqual({ ok: true });
    expect(await addStepAction(undefined, form({ stepText: "Email my counselor" }))).toEqual({ ok: true });
    const [step] = await db.select().from(schema.weeklySteps).where(eq(schema.weeklySteps.text, "Email my counselor"));
    expect(await setStepDoneAction(step.id, true)).toEqual({ ok: true });
    expect(await editStepAction(undefined, form({ stepId: step.id, stepText: "Email my coach" }))).toEqual({ ok: true });
    const [openStep] = await db.select().from(schema.weeklySteps).where(eq(schema.weeklySteps.status, "open"));
    expect(await removeStepAction(openStep.id)).toEqual({ ok: true });
    // A finished step can be removed too.
    expect(await removeStepAction(step.id)).toEqual({ ok: true });

    expect(await addCollegeAction({ status: "idle" }, form({ unitId: "100001" }))).toMatchObject({ status: "added" });
    expect(await addCustomEntryAction(undefined, form({ name: "Welding program", kind: "program" }))).toMatchObject({ ok: true });
    const [entry] = await db.select().from(schema.collegeList).where(eq(schema.collegeList.name, "Welding program"));
    expect(await updateEntryAction(undefined, form({ entryId: entry.id, status: "considering", notes: "Visit in spring" }))).toMatchObject({ ok: true });
    expect(await redirectOf(removeEntryAction(undefined, form({ entryId: entry.id })))).toBe("/applications?removed=1");
  });

  it("leave counselor privacy controls working while locked", async () => {
    const id = await signIn("locked");
    const conv = await createConversation(db, id, "About colleges");
    await db.insert(schema.counselorMemory).values({ userId: id, notes: ["likes chemistry"] });
    expect(await redirectOf(deleteConversationAction(form({ conversationId: conv.id })))).toBe("/counselor");
    expect(await db.select().from(schema.counselorConversations)).toHaveLength(0);
    expect(await redirectOf(clearMemoryAction(form({})))).toBe("/counselor?memory=cleared");
    expect(await db.select().from(schema.counselorMemory)).toHaveLength(0);
  });
});

describe("the counselor API", () => {
  const post = (body: unknown) =>
    counselorApi(new Request("http://localhost/api/counselor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("answers 402 with a notice, the crisis line and the unlock link when locked", async () => {
    await signIn("locked");
    const res = await post({ text: "What classes should I take?" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: "access_required", support: null, unlock: { href: "/account/access" } });
    expect(body.message).toContain(CRISIS_LINE);
    expect(respond).not.toHaveBeenCalled();
  });

  it("still gives crisis resources to a locked student, and queues the message for review", async () => {
    const id = await signIn("locked");
    const res = await post({ text: "i want to kill myself" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.support).toContain("988");
    expect(await db.select().from(schema.safetyEvents)).toEqual([expect.objectContaining({ userId: id, severity: "high" })]);
  });

  it("streams the counselor's reply with full access", async () => {
    await signIn("full");
    const res = await post({ text: "What classes should I take?" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"done"');
    expect(respond).toHaveBeenCalledOnce();
  });
});

describe("the free-access form", () => {
  it("needs the box checked", async () => {
    await signIn("locked");
    expect(await requestFreeAccessAction(undefined, form({}))).toEqual({ errors: { statement: ["Check the box to turn on free access."] } });
    expect((await db.select().from(schema.accessGrants)).filter((g) => g.kind === "free_access")).toHaveLength(0);
  });

  it("unlocks a teen's household and returns them to their access page", async () => {
    await signIn("locked");
    expect(await redirectOf(requestFreeAccessAction(undefined, form({ statement: "on" })))).toBe("/account/access?free=on");
    expect(await redirectOf(PlanPage)).toBeNull();
  });

  it("sends a parent back to billing", async () => {
    await signIn("locked", { role: "parent" });
    expect(await redirectOf(requestFreeAccessAction(undefined, form({ statement: "on" })))).toBe("/account/billing?free=on");
  });

  it("asks a student under 13 to go to their parent", async () => {
    await signIn("locked", { birthDate: "2014-03-01" });
    expect(await requestFreeAccessAction(undefined, form({ statement: "on" }))).toEqual({
      message: "Please ask your parent or guardian to turn on free access from their account.",
    });
  });
});
