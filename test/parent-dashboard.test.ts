import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ParentHome from "@/app/parent/page";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { schoolYearOf } from "@/lib/auth/age";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { PARENT_DEADLINE_LIMIT, PARENT_TIMELY_LIMIT, fafsaMilestones, parentDashboard } from "@/lib/parent-dashboard";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { weekStartOf } from "@/lib/steps";

// Thursday, September 24, 2026 (a school year that started in August 2026).
const now = new Date("2026-09-24T15:00:00Z");
const thisWeek = weekStartOf(now);
const lastWeek = "2026-09-14";
const DAY_MS = 86_400_000;

let db: Db;

// The parent page reads the database and the signed-in parent through these.
const page = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => page.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => page.user, getCurrentUser: async () => page.user }));

beforeEach(async () => {
  db = await createTestDb();
  page.db = db;
});

afterEach(() => {
  page.user = null;
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function parentId(email = "rosa@example.com") {
  const res = await registerParent(db, { displayName: "Rosa", email, password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function child(parent: string, grade: number, username = `kid${grade}`) {
  const consent = await verifyParentConsent({ parentUserId: parent, attested: true });
  const res = await createChildAccount(
    db,
    parent,
    { displayName: `Kid${grade}`, username, password: "correct horse battery", birthDate: "2010-02-01", grade },
    consent,
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function completedAttempt(userId: string, instrument: string, completed = true) {
  await db.insert(schema.assessmentAttempts).values({
    userId,
    instrument,
    instrumentVersion: "test",
    startedAt: new Date(now.getTime() - 86_400_000),
    completedAt: completed ? new Date(now.getTime() - 3_600_000) : null,
  });
}

describe("parent dashboard summary", () => {
  it("shows a child who just started as an early state with zero counts", async () => {
    const parent = await parentId();
    const kid = await child(parent, 9);
    const [overview] = await parentDashboard(db, parent, now);
    expect(overview.id).toBe(kid);
    expect(overview.progress).toMatchObject({
      grade: 9,
      graduated: false,
      justStarted: true,
      northStars: [],
      steps: { thisWeekDone: 0, thisWeekTotal: 0, lifetimeDone: 0 },
      plan: { courses: 0, estimatedGpa: null },
      colleges: { count: 0, nextDeadlines: null },
      fafsa: null,
    });
    expect(overview.progress.assessments.map((a) => a.state)).toEqual(["not_started", "not_started", "not_started"]);
    expect(overview.progress.roadmap?.done).toBe(0);
    expect(overview.progress.roadmap?.total).toBe(MILESTONES.filter((m) => m.grade === 9).length);
  });

  it("summarizes assessments, north stars, roadmap, steps, classes and the college list", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    await completedAttempt(kid, "interests");
    await completedAttempt(kid, "personality", false);
    await db.insert(schema.northStarGoals).values([
      { userId: kid, occupationCode: "29-1141.00", title: "Registered Nurses" },
      { userId: kid, occupationCode: "29-1123.00", title: "Physical Therapists" },
    ]);
    const grade11 = MILESTONES.filter((m) => m.grade === 11);
    // Done and set aside: three that aren't timely in September, and one that is.
    const later = grade11.filter((m) => !m.months.includes(8) && !m.months.includes(9));
    const september = grade11.filter((m) => m.months.includes(9));
    await db.insert(schema.studentMilestones).values([
      { userId: kid, milestoneId: later[0].id, status: "done" },
      { userId: kid, milestoneId: later[1].id, status: "skipped" },
      { userId: kid, milestoneId: september[0].id, status: "done" },
    ]);
    await db.insert(schema.weeklySteps).values([
      { userId: kid, weekStart: thisWeek, text: "Ask about the PSAT", status: "done" },
      { userId: kid, weekStart: thisWeek, text: "Look up nursing programs" },
      { userId: kid, weekStart: lastWeek, text: "Visit the library", status: "done" },
      { userId: kid, weekStart: lastWeek, text: "Email my coach" },
    ]);
    await db.insert(schema.studentCourses).values([
      { userId: kid, name: "Biology", subject: "science", gradeLevel: 10, status: "completed", finalGrade: "A" },
      { userId: kid, name: "Geometry", subject: "math", gradeLevel: 10, status: "completed", finalGrade: "B" },
      { userId: kid, name: "Chemistry", subject: "science", gradeLevel: 11, status: "in_progress" },
    ]);
    await db.insert(schema.collegeList).values([
      { userId: kid, name: "Far College", deadline: "2027-01-15", deadlineType: "regular" },
      { userId: kid, name: "Soon University", deadline: "2026-10-15", deadlineType: "early_action" },
      { userId: kid, name: "Sent College", deadline: "2026-10-01", status: "applied" },
      { userId: kid, name: "Passed College", deadline: "2026-09-01" },
      { userId: kid, name: "Middle College", deadline: "2026-11-01", deadlineType: "early_decision" },
      { userId: kid, name: "Later College", deadline: "2027-02-01" },
      { userId: kid, name: "Undated Program", kind: "program" },
    ]);

    const [{ progress: p }] = await parentDashboard(db, parent, now);
    expect(p.justStarted).toBe(false);
    expect(p.assessments).toEqual([
      { id: "interests", title: "Interests", state: "done" },
      { id: "personality", title: "Personality", state: "in_progress" },
      { id: "values", title: "What matters to you", state: "not_started" },
    ]);
    expect(p.northStars).toEqual(["Registered Nurses", "Physical Therapists"]);
    // Set-aside milestones don't count against the student.
    expect(p.roadmap).toMatchObject({ done: 2, total: grade11.length - 1 });
    // The same list the student's dashboard leads with: open milestones for this month, then catch-up.
    expect(p.roadmap!.timely.map((m) => m.id)).toEqual(september.slice(1, 1 + PARENT_TIMELY_LIMIT).map((m) => m.id));
    expect(p.steps).toEqual({ thisWeekDone: 1, thisWeekTotal: 2, lifetimeDone: 2 });
    expect(p.plan).toEqual({ courses: 3, estimatedGpa: 3.5 });
    expect(p.colleges.count).toBe(7);
    // Unsent, upcoming, soonest first, at most three.
    expect(p.colleges.nextDeadlines).toHaveLength(PARENT_DEADLINE_LIMIT);
    expect(p.colleges.nextDeadlines!.map((d) => d.name)).toEqual(["Soon University", "Middle College", "Far College"]);
    expect(p.colleges.nextDeadlines![0]).toEqual({ name: "Soon University", deadlineType: "early_action", deadline: "2026-10-15", daysLeft: 21 });
    expect(p.fafsa).toBeNull();
  });

  it("leaves out deadlines before 11th grade", async () => {
    const parent = await parentId();
    const kid = await child(parent, 10);
    await db.insert(schema.collegeList).values({ userId: kid, name: "State University", deadline: "2026-10-15" });
    const [{ progress }] = await parentDashboard(db, parent, now);
    expect(progress.colleges).toEqual({ count: 1, nextDeadlines: null });
  });

  it("shows seniors' FAFSA milestones with their status", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    await db.insert(schema.studentMilestones).values([
      { userId: kid, milestoneId: "g12-file-the-fafsa", status: "done" },
      { userId: kid, milestoneId: "g12-check-state-aid-programs", status: "skipped" },
    ]);
    const [{ progress }] = await parentDashboard(db, parent, now);
    const ids = fafsaMilestones().map((m) => m.id);
    expect(ids).toContain("g12-file-the-fafsa");
    expect(ids.every((id) => id.startsWith("g12-"))).toBe(true);
    expect(progress.fafsa?.map((m) => m.id)).toEqual(ids);
    const status = Object.fromEntries(progress.fafsa!.map((m) => [m.id, m.status]));
    expect(status["g12-file-the-fafsa"]).toBe("done");
    expect(status["g12-check-state-aid-programs"]).toBe("skipped");
    expect(Object.values(status).filter((s) => s === "open").length).toBe(ids.length - 2);
  });

  it("handles a child who finished high school", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    const [{ progress }] = await parentDashboard(db, parent, new Date("2027-09-01T15:00:00Z"));
    expect(progress).toMatchObject({ grade: 13, graduated: true, roadmap: null, fafsa: null });
    expect(kid).toBeTruthy();
  });

  it("only covers the parent's own children", async () => {
    const rosa = await parentId();
    const other = await parentId("other@example.com");
    await child(rosa, 8, "rosakid");
    await child(other, 9, "otherkid");
    const teen = await registerStudent(
      db,
      { displayName: "Solo", email: "solo@example.com", password: "correct horse battery", birthDate: "2010-01-01", grade: 10 },
      now,
    );
    if (!teen.ok) throw new Error();
    expect((await parentDashboard(db, rosa, now)).map((c) => c.username)).toEqual(["rosakid"]);
    expect(await parentDashboard(db, teen.value.userId, now)).toEqual([]);
  });

  it("never includes counselor conversations, memory notes or safety events", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    const [conversation] = await db
      .insert(schema.counselorConversations)
      .values({ userId: kid, title: "SECRET-TITLE", concernFlagged: true, context: "SECRET-CONTEXT" })
      .returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
    await db.insert(schema.counselorMemory).values({ userId: kid, notes: ["SECRET-MEMORY"] });
    await db.insert(schema.safetyEvents).values({ userId: kid, category: "distress", severity: "medium", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
    await db.insert(schema.collegeList).values({ userId: kid, name: "State University", notes: "SECRET-NOTE", aidOffer: { grants: 12345 } });

    const overview = await parentDashboard(db, parent, now);
    const dump = JSON.stringify(overview);
    expect(dump).not.toContain("SECRET");
    expect(dump).not.toContain("12345");
    expect(dump).not.toMatch(/concern|safety|memory|conversation/i);
  });

  it("runs the same number of queries for one child or many", async () => {
    let queries = 0;
    const counted = drizzle({ client: new PGlite(), schema, logger: { logQuery: () => void queries++ } }) as unknown as Db;
    await migrate(counted as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    db = counted;

    const one = await parentId("one@example.com");
    await child(one, 11, "only");
    const many = await parentId("many@example.com");
    for (const grade of [7, 9, 10, 11, 12]) await child(many, grade, `many${grade}`);

    queries = 0;
    await parentDashboard(db, one, now);
    const forOne = queries;
    queries = 0;
    expect(await parentDashboard(db, many, now)).toHaveLength(5);
    expect(queries).toBe(forOne);
    expect(forOne).toBeLessThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// The page (server-rendered with the signed-in parent mocked; it uses the real clock)
// ---------------------------------------------------------------------------

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

async function signInParent(id: string) {
  page.user = { id, role: "parent", displayName: "Rosa", username: null, householdId: null, parentManaged: false, grade: null };
}

async function renderParentPage(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await ParentHome({ searchParams: Promise.resolve(searchParams) } as PageProps<"/parent">));
}

/** Pins a child's grade to this school year on the real clock, so the page shows that grade. */
async function setGradeNow(userId: string, grade: number) {
  await db.update(schema.users).set({ grade, gradeSchoolYear: schoolYearOf(new Date()) }).where(eq(schema.users.id, userId));
}

describe("parent page", () => {
  it("shows progress, keeps the controls, links to the aid guide and billing, and nothing private", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    await setGradeNow(kid, 11);
    await completedAttempt(kid, "interests");
    await db.insert(schema.northStarGoals).values({ userId: kid, occupationCode: "29-1141.00", title: "Registered Nurses" });
    const [conversation] = await db.insert(schema.counselorConversations).values({ userId: kid, title: "SECRET-TITLE" }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
    await db.insert(schema.counselorMemory).values({ userId: kid, notes: ["SECRET-MEMORY"] });
    await db.insert(schema.safetyEvents).values({ userId: kid, category: "distress", severity: "medium", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
    await signInParent(parent);

    const html = await renderParentPage();
    const t = text(html);
    expect(t).toContain("Chats with the AI counselor aren't shown on this page.");
    expect(t).toContain("Registered Nurses");
    expect(t).toContain("1 of 3 done");
    expect(t).toContain("11th grade roadmap");
    expect(html).not.toContain("SECRET");
    expect(html).toContain('href="/aid/en"');
    expect(html).toMatch(/<a[^>]*href="\/aid\/es"[^>]*lang="es"|<a[^>]*lang="es"[^>]*href="\/aid\/es"/);
    expect(html).toContain('href="/account/billing"');
    expect(html).toContain(`href="/api/parent/children/${kid}/export"`);
    expect(html).toContain(`href="/parent/children/${kid}/delete"`);
    expect(html).toContain('name="reminders"');
    expect(html).toContain('name="grade"');
  });

  it("shows an early state for a child who just started", async () => {
    const parent = await parentId();
    await child(parent, 8);
    await signInParent(parent);
    expect(text(await renderParentPage())).toContain("Kid8 is just getting started.");
  });

  it("shows a senior's financial aid steps", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    await setGradeNow(kid, 12);
    await db.insert(schema.studentMilestones).values({ userId: kid, milestoneId: "g12-file-the-fafsa", status: "done" });
    await signInParent(parent);
    const t = text(await renderParentPage());
    expect(t).toContain("Senior year: applying for financial aid");
    expect(t).toContain("File your FAFSA as soon as you can Done");
  });

  it("words the billing card for the family's access and whether plans are offered", async () => {
    const parent = await parentId();
    await signInParent(parent);
    // A new family is on its trial. Without paid plans, the card offers only free access.
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    resetEnvCache();
    let t = text(await renderParentPage());
    expect(t).toContain("Paid plans aren't available yet, but you can turn on free access there.");
    expect(t).not.toContain("See or change your family's plan");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
    resetEnvCache();
    expect(text(await renderParentPage())).toContain("Choose a plan for your family. If cost is a problem, you can turn on free access there.");

    const [{ householdId }] = await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, parent));
    await db.insert(schema.accessGrants).values({
      householdId: householdId!,
      kind: "free_access",
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt: new Date(Date.now() + 300 * DAY_MS),
    });
    t = text(await renderParentPage());
    expect(t).toContain("See when your free access ends and when you can renew it.");
    expect(t).not.toContain("If cost is a problem");
  });

  it("says nothing was deleted when a delete found nothing, and never claims a deletion", async () => {
    const parent = await parentId();
    await child(parent, 9);
    await signInParent(parent);
    const t = text(await renderParentPage({ "not-deleted": "1" }));
    expect(t).toContain("Nothing was deleted. That account may already be gone.");
    expect(t).not.toContain("were deleted");
  });

  it("gives the Delete my parent account link a full-size target", async () => {
    await signInParent(await parentId());
    expect(await renderParentPage()).toMatch(/<a class="[^"]*\binline-flex\b[^"]*\bmin-h-11\b[^"]*" href="\/parent\/delete">Delete my parent account<\/a>/);
  });

  it("helps a parent with no children yet, and confirms a new link", async () => {
    const parent = await parentId();
    await signInParent(parent);
    const t = text(await renderParentPage({ linked: "1" }));
    expect(t).toContain("No children added yet.");
    expect(t).toContain("ask them to invite you from their dashboard");
    expect(t).toContain("You're linked.");
    expect(t).toContain("Paying for college");
  });
});
