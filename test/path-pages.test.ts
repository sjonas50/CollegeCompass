import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GraduationIndexPage from "@/app/graduation/page";
import GraduationStatePage, { generateStaticParams as graduationParams } from "@/app/graduation/[state]/page";
import ChildPlanPage from "@/app/parent/children/[id]/plan/page";
import ChildPlanPrintPage from "@/app/parent/children/[id]/plan/print/page";
import ParentHome from "@/app/parent/page";
import PlanPage from "@/app/plan/page";
import PlanPrintPage from "@/app/plan/print/page";
import { MilestoneCard } from "@/app/roadmap/milestone-card";
import { type Db, createTestDb, schema } from "@/db";
import type { CourseSubject } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { trialGrant } from "@/lib/access/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { comingLaterNote, DRAFT_NOTICE, graduationPageTitle, LOAD_WARNING, STANDING_PLAN_NOTE } from "@/lib/planner/copy";
import { REVIEW_LABELS } from "@/lib/planner/review";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { saveSchoolSettings } from "@/lib/schools/student";
import { insertSchools, SCHOOLS } from "@/lib/schools/test-fixtures";

// Server-rendered checks for "Your path" on the Plan page, the print view, the parent's read-only
// view and the free graduation pages, with the signed-in user and database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }));

let db: Db;

// Students are created with grade 2026-27, and the pages plan from today: pin today so the tests
// don't move a grade every August.
const TODAY = new Date("2026-09-25T15:00:00Z");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  db = await createTestDb();
  state.db = db;
});

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const props = <T,>(params: object = {}, searchParams: object = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) }) as T;

/** `type: ""`: typed with a name only, its kind not picked (a guess until confirmed). */
type Row = { name: string; subject: CourseSubject; grade: number; type: string; credits?: number };

/** A household with a running trial, in the class planner beta unless `beta` is false. */
async function household(beta = true) {
  const [h] = await db.insert(schema.households).values({ plannerBeta: beta }).returning();
  await db.insert(schema.accessGrants).values(trialGrant(h.id, new Date(Date.now() - 86_400_000)));
  return h.id;
}

/** A student in a household with a running trial; signed in unless `signIn` is false. */
async function student({ grade, homeState, rows = [], signIn = true, householdId }: { grade: number; homeState: string | null; rows?: Row[]; signIn?: boolean; householdId?: string }) {
  const hh = householdId ?? (await household());
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: hh, displayName: "Maya", passwordHash: "x", birthDate: "2011-01-15", grade, gradeSchoolYear: 2026, homeState })
    .returning({ id: schema.users.id });
  for (const r of rows) {
    await db.insert(schema.studentCourses).values({
      userId: user.id,
      name: r.name,
      subject: r.subject,
      gradeLevel: r.grade,
      credits: r.credits ?? 1,
      status: r.grade < grade ? "completed" : r.grade === grade ? "in_progress" : "planned",
      finalGrade: r.grade < grade ? "A" : null,
      courseTypeId: r.type || null,
      courseTypeSource: r.type ? "student" : null,
    });
  }
  if (signIn) state.user = { id: user.id, role: "student", displayName: "Maya", username: null, householdId: hh, parentManaged: false, grade, homeState };
  return user.id;
}

const TX_NINTH: Row[] = [
  { name: "English I", subject: "english", grade: 9, type: "ela.9" },
  { name: "Algebra I", subject: "math", grade: 9, type: "math.alg1" },
  { name: "Biology", subject: "science", grade: 9, type: "sci.bio" },
  { name: "World Geography", subject: "social_studies", grade: 9, type: "ss.world_geo" },
  { name: "Spanish I", subject: "world_language", grade: 9, type: "lang.es.1" },
];

describe("“Your path” on the Plan page", () => {
  it("shows a Texas student's draft: notices, by when, year by year, what counts and questions", async () => {
    await student({ grade: 9, homeState: "TX", rows: TX_NINTH });
    const html = await render(PlanPage(props<PageProps<"/plan">>()));
    const t = text(html);
    for (const s of [
      "Your path",
      DRAFT_NOTICE,
      REVIEW_LABELS.draft,
      STANDING_PLAN_NOTE,
      "Choices to make",
      "Name your Texas endorsement",
      "Year by year",
      "10th grade · 2027-28",
      "What counts toward what",
      "Required by Texas",
      "Texas Foundation High School Program",
      "We don't track these",
      "Questions for your counselor",
      "Your classes by grade",
      "Your GPA (estimate)",
    ]) {
      expect(t, s).toContain(s);
    }
    // One-tap actions with names for screen readers, 44px targets, and a print link.
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Add<span class="sr-only">: /);
    expect(html).toContain("Not for me<span class=\"sr-only\">: ");
    expect(html).toContain('href="/plan/print"');
    expect(html).toContain('href="/graduation/tx"');
    // The path replaces the generic checklist and course ideas for planner states.
    expect(t).not.toContain("College-prep classes");
    // Guardrails: no "Stretch", no scoring by AP count, never red "behind".
    expect(t).not.toMatch(/stretch|behind|more competitive/i);
  });

  it("keeps a student's own classes and flags a heavy year with the sleep guidance", async () => {
    await student({
      grade: 11,
      homeState: "TX",
      rows: [
        { name: "AP English Language", subject: "english", grade: 11, type: "ela.lang_comp" },
        { name: "AP Calculus AB", subject: "math", grade: 11, type: "math.calc" },
        { name: "AP Chemistry", subject: "science", grade: 11, type: "sci.chem" },
        { name: "AP U.S. History", subject: "social_studies", grade: 11, type: "ss.us_hist" },
      ].map((r) => ({ ...r, subject: r.subject as CourseSubject })),
    });
    await db.update(schema.studentCourses).set({ level: "ap" });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(t).toContain("AP Calculus AB");
    expect(t).toContain(LOAD_WARNING);
  });

  it("a Utah 7th grader sees the middle-school view", async () => {
    await student({ grade: 7, homeState: "UT", rows: [{ name: "Math 7", subject: "math", grade: 7, type: "math.ms" }] });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(t).toContain("Math in middle school");
    expect(t).toContain("A 9th-grade sketch");
    expect(t).toContain("can earn high school math credit only if");
    expect(t).not.toContain("Year by year");
  });

  it("outside Utah, Tennessee and Texas: the checklist and course ideas stay, plus “coming later”", async () => {
    await student({ grade: 10, homeState: "OH" });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(t).toContain(comingLaterNote("Ohio"));
    expect(t).toContain("College-prep classes");
    expect(t).toContain("Class ideas for your goals");
    expect(t).not.toContain("What counts toward what");
  });

  it("with no state yet, asks for one", async () => {
    await student({ grade: 10, homeState: null });
    const html = await render(PlanPage(props<PageProps<"/plan">>()));
    expect(html).toContain('href="/dashboard?school=edit#school-settings"');
    expect(text(html)).toContain("College-prep classes");
  });

  it("names the student's school only on their own screen, and says its list isn't in yet", async () => {
    const id = await student({ grade: 9, homeState: "TX", rows: TX_NINTH });
    await insertSchools(db, [SCHOOLS.austinHigh]);
    await saveSchoolSettings(db, id, { state: "TX", current: { choice: "listed", schoolRef: SCHOOLS.austinHigh.schoolRef } }, { by: "student" });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(t).toContain("We don't have Austin High School's class list yet");
  });
});

describe("the printable draft", () => {
  it("lists classes by year and 3 to 8 questions, without the first name unless asked", async () => {
    await student({ grade: 9, homeState: "TX", rows: TX_NINTH });
    const html = await render(PlanPrintPage(props<PageProps<"/plan/print">>()));
    const t = text(html);
    expect(t).toContain("Draft class plan, to talk over with my school counselor");
    expect(t).toContain(DRAFT_NOTICE);
    expect(t).toContain("Questions for my counselor");
    const questions = /<h2 id="print-questions"[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
    const count = (questions.match(/<li>/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(8);
    expect(html).toContain("<caption");
    expect(t).not.toMatch(/Student Maya/);
    const named = text(await render(PlanPrintPage(props<PageProps<"/plan/print">>({}, { name: "1" }))));
    expect(named).toMatch(/Student Maya/);
  });

  it("has nothing to print outside the planner's states", async () => {
    await student({ grade: 10, homeState: "OH" });
    expect(text(await render(PlanPrintPage(props<PageProps<"/plan/print">>())))).toContain("Nothing to print yet");
  });
});

describe("a parent's read-only view", () => {
  async function parentWithChild(homeState: string) {
    const hh = await household();
    const childId = await student({ grade: 9, homeState, rows: TX_NINTH, signIn: false, householdId: hh });
    const [parent] = await db.insert(schema.users).values({ role: "parent", householdId: hh, displayName: "Pat", passwordHash: "x", email: "pat@example.com" }).returning({ id: schema.users.id });
    await db.insert(schema.parentStudentLinks).values({ parentUserId: parent.id, studentUserId: childId });
    state.user = { id: parent.id, role: "parent", displayName: "Pat", username: null, householdId: hh, parentManaged: false, grade: null };
    return childId;
  }

  it("shows the child's path with no buttons or forms", async () => {
    const childId = await parentWithChild("TX");
    const html = await render(ChildPlanPage(props<PageProps<"/parent/children/[id]/plan">>({ id: childId })));
    const t = text(html);
    expect(t).toContain("Maya's class path");
    expect(t).toContain(DRAFT_NOTICE);
    expect(t).toContain("What counts toward what");
    expect(t).toContain("Their choices");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).toContain(`href="/parent/children/${childId}/plan/print"`);
    const print = text(await render(ChildPlanPrintPage(props<PageProps<"/parent/children/[id]/plan/print">>({ id: childId }))));
    expect(print).toContain("Draft class plan, to talk over with my school counselor");
  });

  it("puts a short summary on the parent dashboard", async () => {
    const childId = await parentWithChild("TX");
    const html = await render(ParentHome(props<PageProps<"/parent">>()));
    expect(text(html)).toMatch(/Class path Texas, class of 2030\. Graduation requirements: \d+ done/);
    expect(html).toContain(`href="/parent/children/${childId}/plan"`);
  });

  it("is only for the parent's own children", async () => {
    await parentWithChild("TX");
    const stranger = await student({ grade: 9, homeState: "TX", signIn: false });
    await expect(ChildPlanPage(props<PageProps<"/parent/children/[id]/plan">>({ id: stranger }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("outside the planner's states shows the checklist and what's coming", async () => {
    const childId = await parentWithChild("OH");
    const t = text(await render(ChildPlanPage(props<PageProps<"/parent/children/[id]/plan">>({ id: childId }))));
    expect(t).toContain(comingLaterNote("Ohio"));
    expect(t).toContain("College-prep classes");
  });
});

describe("the free graduation pages", () => {
  it("exist for Utah, Tennessee and Texas, for anyone, with sources and the draft label", async () => {
    expect(graduationParams()).toEqual([{ state: "ut" }, { state: "tn" }, { state: "tx" }]);
    const index = text(await render(GraduationIndexPage()));
    for (const s of ["UT", "TN", "TX"] as const) expect(index).toContain(graduationPageTitle(s));
    for (const [param, code, words] of [
      ["ut", "UT", /Class of 2029 and later/],
      ["tn", "TN", /Started 9th grade in 2024-25 or later/],
      ["tx", "TX", /Endorsements and the Distinguished Level of Achievement/],
    ] as const) {
      const html = await render(GraduationStatePage(props<PageProps<"/graduation/[state]">>({ state: param })));
      const t = text(html);
      expect(t).toContain(graduationPageTitle(code));
      expect(t).toContain(REVIEW_LABELS.draft);
      expect(t).toContain(DRAFT_NOTICE);
      expect(t).toContain(STANDING_PLAN_NOTE);
      expect(t).toMatch(words);
      expect(t).toContain("Where this comes from");
      // Quotes are there to open ("Why?"), with their sources.
      expect(html).toMatch(/<blockquote[^>]*>“/);
      expect(html).toContain('target="_blank"');
    }
  });

  it("have no page for other states", async () => {
    await expect(GraduationStatePage(props<PageProps<"/graduation/[state]">>({ state: "oh" }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(GraduationStatePage(props<PageProps<"/graduation/[state]">>({ state: "TX" }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("roadmap milestones about choosing classes", () => {
  it("link to “Your path”; others don't", () => {
    const pick = MILESTONES.find((m) => m.id === "g9-pick-10th-grade-classes")!;
    const other = MILESTONES.find((m) => m.id !== pick.id && !/class/i.test(m.title))!;
    expect(renderToStaticMarkup(MilestoneCard({ milestone: pick, status: "open", showPathLink: true }))).toContain('href="/plan#path"');
    expect(renderToStaticMarkup(MilestoneCard({ milestone: other, status: "open", showPathLink: true }))).not.toContain('href="/plan#path"');
    // Outside the class planner beta, no link to a path the student doesn't have.
    expect(renderToStaticMarkup(MilestoneCard({ milestone: pick, status: "open" }))).not.toContain('href="/plan#path"');
  });
});

// Round 9: "Your path" is in beta (lib/planner/beta.ts). Only households staff mark with
// `npm run beta:planner` (or everyone, with PLANNER_PATH=everyone) see it; everyone else keeps
// today's checklist and course ideas. The graduation pages and state and school settings stay public.
describe("the class planner beta", () => {
  afterEach(() => {
    delete process.env.PLANNER_PATH;
    resetEnvCache();
  });

  it("outside it, a Texas student keeps the checklist and course ideas, with no path, print view or path links", async () => {
    const hh = await household(false);
    await student({ grade: 9, homeState: "TX", rows: TX_NINTH, householdId: hh });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(t).toContain("College-prep classes");
    expect(t).toContain("Class ideas for your goals");
    for (const s of ["Your path", "What counts toward what", DRAFT_NOTICE, "Confirm your classes", comingLaterNote("Texas")]) expect(t, s).not.toContain(s);
    await expect(PlanPrintPage(props<PageProps<"/plan/print">>())).rejects.toMatchObject({ digest: expect.stringContaining("/plan;") });
    // The free graduation page stays, and sends the student to their course plan.
    const grad = await render(GraduationStatePage(props<PageProps<"/graduation/[state]">>({ state: "tx" })));
    expect(grad).toContain('href="/plan"');
    expect(text(grad)).toContain("Go to your course plan");
  });

  it("in it, the student sees the path and the graduation page opens it", async () => {
    await student({ grade: 9, homeState: "TX", rows: TX_NINTH });
    expect(text(await render(PlanPage(props<PageProps<"/plan">>())))).toContain("What counts toward what");
    const grad = await render(GraduationStatePage(props<PageProps<"/graduation/[state]">>({ state: "tx" })));
    expect(grad).toContain('href="/plan#path"');
  });

  it("PLANNER_PATH=everyone shows it to every household", async () => {
    process.env.PLANNER_PATH = "everyone";
    resetEnvCache();
    const hh = await household(false);
    await student({ grade: 9, homeState: "TX", rows: TX_NINTH, householdId: hh });
    expect(text(await render(PlanPage(props<PageProps<"/plan">>())))).toContain("What counts toward what");
  });

  it("outside it, a parent sees no class path for their child, and the read-only path sends them back", async () => {
    const hh = await household(false);
    const childId = await student({ grade: 9, homeState: "TX", rows: TX_NINTH, signIn: false, householdId: hh });
    const [parent] = await db.insert(schema.users).values({ role: "parent", householdId: hh, displayName: "Pat", passwordHash: "x", email: "pat@example.com" }).returning({ id: schema.users.id });
    await db.insert(schema.parentStudentLinks).values({ parentUserId: parent.id, studentUserId: childId });
    state.user = { id: parent.id, role: "parent", displayName: "Pat", username: null, householdId: hh, parentManaged: false, grade: null };
    const home = await render(ParentHome(props<PageProps<"/parent">>()));
    expect(text(home)).not.toContain("Class path");
    expect(home).not.toContain(`/parent/children/${childId}/plan`);
    await expect(ChildPlanPage(props<PageProps<"/parent/children/[id]/plan">>({ id: childId }))).rejects.toMatchObject({ digest: expect.stringContaining("/parent;") });
    await expect(ChildPlanPrintPage(props<PageProps<"/parent/children/[id]/plan/print">>({ id: childId }))).rejects.toMatchObject({ digest: expect.stringContaining("/parent;") });
  });
});

// Round 9, confirm first: classes typed with a name only are listed at the top of "Your path" with
// the planner's guess as one tap, at most six at once, grouped by year. A name that's the state's
// own title for a class (exact-titles.ts) isn't a guess, so it isn't listed.
describe("Confirm your classes", () => {
  // Short names the planner guesses from ("English I", "Biology" would be exact titles).
  const TYPED: Row[] = [
    { name: "Eng I", subject: "english", grade: 9, type: "" },
    { name: "Alg I", subject: "math", grade: 9, type: "" },
    { name: "Bio", subject: "science", grade: 9, type: "" },
    { name: "World Geo", subject: "social_studies", grade: 9, type: "" },
    { name: "Spanish Level 1", subject: "world_language", grade: 9, type: "" },
    { name: "Eng II", subject: "english", grade: 10, type: "" },
    { name: "Geom", subject: "math", grade: 10, type: "" },
    { name: "Algebra II/Trigonometry", subject: "math", grade: 10, type: "" },
    { name: "Math Lab", subject: "math", grade: 10, type: "" },
  ];

  it("doesn't ask about classes typed with the state's own titles, only a name joining two classes (the demo Texas 9th grader)", async () => {
    await student({
      grade: 9,
      homeState: "TX",
      rows: [
        { name: "English I", subject: "english", grade: 9, type: "" },
        { name: "Geometry", subject: "math", grade: 9, type: "" },
        { name: "Biology", subject: "science", grade: 9, type: "" },
        { name: "World Geography", subject: "social_studies", grade: 9, type: "" },
        { name: "Spanish I", subject: "world_language", grade: 9, type: "" },
        { name: "Principles of Applied Engineering", subject: "career_technical", grade: 9, type: "" },
        { name: "Alg 2/Trig", subject: "math", grade: 10, type: "" },
      ],
    });
    const t = text(await render(PlanPage(props<PageProps<"/plan">>())));
    const card = t.slice(t.indexOf("Confirm your classes"), t.indexOf(DRAFT_NOTICE));
    expect(card).toContain("Alg 2/Trig · Algebra II?");
    expect(card.match(/Yes ?, /g) ?? []).toHaveLength(1);
    for (const name of ["English I", "Geometry", "Biology", "World Geography", "Spanish I", "Principles of Applied Engineering"]) expect(card).not.toContain(name);
    expect(card).not.toMatch(/more class/);
  });

  it("lists six typed classes at a time with one-tap guesses, grouped by year, and confirming stores the kind", async () => {
    const id = await student({ grade: 10, homeState: "TX", rows: TYPED });
    const html = await render(PlanPage(props<PageProps<"/plan">>()));
    const t = text(html);
    expect(t).toContain("Confirm your classes");
    const card = t.slice(t.indexOf("Confirm your classes"), t.indexOf(DRAFT_NOTICE));
    // At the top of the path, before the draft notice.
    expect(card.length).toBeGreaterThan(0);
    expect(card).toMatch(/9th grade .* 10th grade/);
    expect(card).toContain("3 more classes after these.");
    const yes = card.match(/Yes ?, /g) ?? [];
    expect(yes.length).toBeGreaterThan(0);
    expect(yes.length).toBeLessThanOrEqual(6);
    expect(card).toContain("Something else…");
    // Keyboard reachable: real buttons, each named for its class.
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Yes<span class="sr-only">, Eng I is English I<\/span><\/button>/);

    const { confirmCourseTypeAction } = await import("@/app/actions/path");
    const [english] = await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.name, "Eng I"));
    expect(await confirmCourseTypeAction(english.id, "ela.9")).toMatchObject({ ok: true, message: expect.stringContaining("Saved: Eng I is English I.") });
    const [saved] = await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.id, english.id));
    expect(saved).toMatchObject({ courseTypeId: "ela.9", courseTypeSource: "student", userId: id });
    // A kind that doesn't fit the class's subject, or another student's class, changes nothing.
    const [lab] = await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.name, "Math Lab"));
    expect(await confirmCourseTypeAction(lab.id, "sci.chem")).toMatchObject({ ok: false });
    expect(await confirmCourseTypeAction("00000000-0000-4000-8000-000000000000", "math.alg2")).toMatchObject({ ok: false });
    const after = text(await render(PlanPage(props<PageProps<"/plan">>())));
    expect(after).toContain("2 more classes after these.");
  });

  it("a class the guesser can't place opens the list, and the printed questions ask about the unconfirmed classes", async () => {
    // "Weight Training" names no Texas PE class the guesser knows.
    await student({ grade: 10, homeState: "TX", rows: [{ name: "Weight Training", subject: "health_pe", grade: 10, type: "" }] });
    const html = await render(PlanPage(props<PageProps<"/plan">>()));
    expect(html).toMatch(/<label[^>]*>What kind of class is Weight Training\?<\/label>/);
    const print = text(await render(PlanPrintPage(props<PageProps<"/plan/print">>())));
    expect(print).toMatch(/I haven't confirmed what kind of class one of my classes is|One of my classes looks like .*, but its kind is a guess/);
  });
});
