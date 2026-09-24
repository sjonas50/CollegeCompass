import { and, eq, like } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealSafetyContextAction, reviewSafetyEventAction } from "@/app/actions/admin";
import CostsPage from "@/app/admin/costs/page";
import AdminLayout from "@/app/admin/layout";
import AdminHome from "@/app/admin/page";
import SafetyEventPage from "@/app/admin/safety/[id]/page";
import { ContextView } from "@/app/admin/safety/[id]/context-reveal";
import SafetyQueuePage from "@/app/admin/safety/page";
import { type Db, createTestDb, schema } from "@/db";
import { authenticate } from "@/lib/accounts";
import { AdminRequiredError } from "@/lib/admin/access";
import { costReport, studentShortId } from "@/lib/admin/costs";
import { createAdminUser } from "@/lib/admin/create-admin";
import {
  listSafetyQueue,
  queueSummary,
  revealSafetyContext,
  reviewSafetyEvent,
  reviewTiming,
  safetyMonthStats,
} from "@/lib/admin/safety-review";
import { homePathFor, requireUser } from "@/lib/auth/dal";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/sessions";

// Staff tools, end to end: the real requireUser and session checks run against an in-memory
// database; only the session cookie, getDb and Next's redirect/notFound are stand-ins.

const { Redirect, NotFound, state } = vi.hoisted(() => ({
  Redirect: class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  },
  NotFound: class NotFound extends Error {},
  state: { db: null as unknown, token: null as string | null },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock("@/lib/auth/cookies", async (original) => ({
  ...(await original<typeof import("@/lib/auth/cookies")>()),
  readSessionToken: async () => state.token,
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));

const NOW = new Date("2026-09-24T18:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

let db: Db;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = await createTestDb();
  state.db = db;
  state.token = null;
});

afterEach(() => {
  vi.useRealTimers();
});

async function makeUser(role: "student" | "parent" | "admin", fields: Partial<typeof schema.users.$inferInsert> = {}) {
  const [household] = role === "admin" ? [null] : await db.insert(schema.households).values({}).returning();
  const [user] = await db
    .insert(schema.users)
    .values({
      role,
      householdId: household?.id ?? null,
      displayName: role === "student" ? "Maya" : role === "parent" ? "Rosa" : "Jordan",
      email: `${role}-${crypto.randomUUID().slice(0, 8)}@example.com`,
      passwordHash: "x",
      grade: role === "student" ? 10 : null,
      gradeSchoolYear: role === "student" ? 2026 : null,
      birthDate: role === "student" ? "2011-01-15" : null,
      ...fields,
    })
    .returning();
  return user;
}

async function signIn(userId: string | null) {
  state.token = userId ? (await createSession(db, userId)).token : null;
}

async function addEvent(userId: string, fields: Partial<typeof schema.safetyEvents.$inferInsert> = {}) {
  const [event] = await db
    .insert(schema.safetyEvents)
    .values({ userId, category: "self_harm", severity: "high", sources: ["rules", "model"], excerpt: "I don't want to be here anymore", ...fields })
    .returning();
  return event;
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function thrown(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

async function redirectOf(run: () => unknown) {
  const error = await thrown(run);
  if (!(error instanceof Redirect)) throw error ?? new Error("expected a redirect");
  return error.url;
}

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

const auditRows = (action: string) => db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("staff-only access", () => {
  let student: typeof schema.users.$inferSelect;
  let parent: typeof schema.users.$inferSelect;
  let admin: typeof schema.users.$inferSelect;
  let eventId: string;

  beforeEach(async () => {
    student = await makeUser("student");
    parent = await makeUser("parent");
    admin = await makeUser("admin");
    eventId = (await addEvent(student.id)).id;
  });

  const pages: Record<string, () => Promise<ReactNode>> = {
    "layout": () => AdminLayout({ children: null, params: Promise.resolve({}) } as LayoutProps<"/admin">),
    "/admin": () => AdminHome(),
    "/admin/safety": () => SafetyQueuePage({ params: Promise.resolve({}), searchParams: Promise.resolve({ filter: "all" }) } as PageProps<"/admin/safety">),
    "/admin/safety/[id]": () =>
      SafetyEventPage({ params: Promise.resolve({ id: eventId }), searchParams: Promise.resolve({}) } as PageProps<"/admin/safety/[id]">),
    "/admin/costs": () => CostsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/admin/costs">),
  };
  const actions: Record<string, () => Promise<unknown>> = {
    reveal: () => revealSafetyContextAction(undefined, form({ eventId })),
    review: () => reviewSafetyEventAction(undefined, form({ eventId, outcome: "escalated", note: "Called the safety lead" })),
  };

  it("sends signed-out visitors, students and parents away from every page and action, changing nothing", async () => {
    const cases: [string | null, string][] = [
      [null, "/login"],
      [student.id, "/dashboard"],
      [parent.id, "/parent"],
    ];
    for (const [userId, home] of cases) {
      await signIn(userId);
      for (const [name, run] of Object.entries({ ...pages, ...actions })) {
        expect(await redirectOf(run), `${name} as ${home}`).toBe(home);
      }
    }
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.reviewedAt).toBeNull();
    expect(await auditRows("admin.viewed_safety_event")).toHaveLength(0);
    expect(await auditRows("safety.reviewed")).toHaveLength(0);
  });

  it("lets admins in", async () => {
    await signIn(admin.id);
    for (const [name, run] of Object.entries(pages)) {
      expect(await thrown(async () => render(run())), name).toBeNull();
    }
    expect(await actions.reveal()).toMatchObject({ context: { student: { displayName: "Maya" } } });
    expect(await redirectOf(actions.review)).toBe(`/admin/safety/${eventId}?reviewed=1`);
  });

  it("checks the acting account's role again in the data layer", async () => {
    for (const actor of [student.id, parent.id, crypto.randomUUID(), "not-a-uuid"]) {
      await expect(listSafetyQueue(db, actor)).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(queueSummary(db, actor)).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(revealSafetyContext(db, actor, eventId)).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(reviewSafetyEvent(db, actor, eventId, { outcome: "no_action", note: "" })).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(costReport(db, actor, "2026-09")).rejects.toBeInstanceOf(AdminRequiredError);
      await expect(safetyMonthStats(db, actor, "2026-09")).rejects.toBeInstanceOf(AdminRequiredError);
    }
    expect(await db.select().from(schema.auditLog)).toHaveLength(0);
  });

  it("sends admins to /admin, and keeps them out of student and parent pages", async () => {
    expect(homePathFor(admin)).toBe("/admin");
    expect(homePathFor(parent)).toBe("/parent");
    expect(homePathFor(student)).toBe("/dashboard");
    await signIn(admin.id);
    expect(await redirectOf(() => requireUser(["student"]))).toBe("/admin");
    expect(await redirectOf(() => requireUser(["parent"]))).toBe("/admin");
    // Pages open to any signed-in family account don't include staff.
    expect(await redirectOf(() => requireUser())).toBe("/admin");
    await signIn(student.id);
    expect(await requireUser()).toMatchObject({ id: student.id });
    await signIn(parent.id);
    expect(await requireUser(["student", "parent"])).toMatchObject({ id: parent.id });
  });
});

// ---------------------------------------------------------------------------
// The review queue
// ---------------------------------------------------------------------------

describe("safety review queue", () => {
  let admin: typeof schema.users.$inferSelect;
  let ids: Record<string, string>;

  beforeEach(async () => {
    admin = await makeUser("admin");
    const teen = await makeUser("student", { grade: 11 });
    const younger = await makeUser("student", { displayName: "Leo", grade: 7, parentManaged: true });
    const reviewed = { reviewedByUserId: admin.id, reviewOutcome: "no_action" as const };
    const events = {
      medium: await addEvent(teen.id, { severity: "medium", category: "distress", createdAt: ago(5) }),
      imminentNew: await addEvent(younger.id, { severity: "imminent", createdAt: ago(1) }),
      highOverdue: await addEvent(teen.id, { severity: "high", category: "abuse", sources: ["rules", "model_unavailable"], createdAt: ago(30) }),
      high: await addEvent(teen.id, { severity: "high", createdAt: ago(2) }),
      imminentOld: await addEvent(teen.id, { severity: "imminent", createdAt: ago(3) }),
      reviewedRecently: await addEvent(teen.id, { severity: "high", createdAt: ago(10), reviewedAt: ago(1), ...reviewed }),
      reviewedEarlier: await addEvent(younger.id, { severity: "imminent", createdAt: ago(40), reviewedAt: ago(5), ...reviewed }),
    };
    ids = Object.fromEntries(Object.entries(events).map(([k, e]) => [k, e.id]));
  });

  const order = (rows: { id: string }[]) => rows.map((r) => Object.entries(ids).find(([, id]) => id === r.id)?.[0]);

  it("puts unreviewed events first, most severe then longest waiting; reviewed ones follow, latest first", async () => {
    const all = await listSafetyQueue(db, admin.id, { filter: "all", now: NOW });
    expect(order(all.rows)).toEqual(["imminentOld", "imminentNew", "highOverdue", "high", "medium", "reviewedRecently", "reviewedEarlier"]);
    expect(all.total).toBe(7);

    const unreviewed = await listSafetyQueue(db, admin.id, { now: NOW });
    expect(order(unreviewed.rows)).toEqual(["imminentOld", "imminentNew", "highOverdue", "high", "medium"]);
    expect(unreviewed.total).toBe(5);

    const reviewed = await listSafetyQueue(db, admin.id, { filter: "reviewed", now: NOW });
    expect(order(reviewed.rows)).toEqual(["reviewedRecently", "reviewedEarlier"]);

    const limited = await listSafetyQueue(db, admin.id, { now: NOW, limit: 2 });
    expect(order(limited.rows)).toEqual(["imminentOld", "imminentNew"]);
    expect(limited.total).toBe(5);
  });

  it("describes each row with its grade band, tiers and timing, but not who the student is", async () => {
    const { rows } = await listSafetyQueue(db, admin.id, { filter: "all", now: NOW });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.highOverdue)).toMatchObject({
      severity: "high",
      category: "abuse",
      sources: ["rules"],
      modelUnavailable: true,
      gradeBand: "Grades 11–12",
      timing: { state: "waiting", overdue: true },
    });
    expect(byId.get(ids.imminentNew)).toMatchObject({ gradeBand: "Grades 7–8", modelUnavailable: false, timing: { state: "waiting", overdue: false } });
    expect(byId.get(ids.reviewedEarlier)).toMatchObject({ reviewOutcome: "no_action", timing: { state: "reviewed", onTime: false } });
    expect(byId.get(ids.reviewedRecently)?.timing).toMatchObject({ state: "reviewed", onTime: true });
    for (const row of rows) {
      for (const key of ["userId", "displayName", "email", "username", "excerpt"]) expect(row).not.toHaveProperty(key);
    }
  });

  it("counts what's waiting and overdue", async () => {
    expect(await queueSummary(db, admin.id, NOW)).toEqual({
      waiting: 5,
      overdue: 1,
      bySeverity: { imminent: 2, high: 2, medium: 1, low: 0 },
      oldestWaitingAt: ago(30),
    });
  });

  it("uses a 24-hour target for imminent and high, and 3 days for medium", () => {
    const at = (severity: "imminent" | "high" | "medium", hours: number, reviewedAfter?: number) =>
      reviewTiming({ severity, createdAt: ago(hours), reviewedAt: reviewedAfter === undefined ? null : new Date(ago(hours).getTime() + reviewedAfter * HOUR) }, NOW);
    expect(at("imminent", 23)).toMatchObject({ state: "waiting", overdue: false });
    expect(at("imminent", 25)).toMatchObject({ state: "waiting", overdue: true });
    expect(at("medium", 71)).toMatchObject({ overdue: false });
    expect(at("medium", 73)).toMatchObject({ overdue: true });
    expect(at("high", 48, 24)).toMatchObject({ state: "reviewed", onTime: true, tookMs: 24 * HOUR });
    expect(at("high", 48, 25)).toMatchObject({ state: "reviewed", onTime: false });
  });

  it("renders the queue with overdue items called out, filters, and no names", async () => {
    await signIn(admin.id);
    const page = (filter?: string) =>
      render(SafetyQueuePage({ params: Promise.resolve({}), searchParams: Promise.resolve(filter ? { filter } : {}) } as PageProps<"/admin/safety">));

    const html = await page();
    const t = text(html);
    expect(t).toContain("Imminent and high within 24 hours, medium within 3 days of the message.");
    expect(t).toContain("5 waiting · 1 overdue");
    expect(t).toContain("Overdue by 6 hours");
    expect(t).toContain("AI model unavailable: keyword rules alone decided");
    expect(t).toContain("Flagged 30 hours ago · Grades 11–12 · Keyword rules");
    expect(t).toContain("Due in 21 hours");
    expect(html).toMatch(/aria-current="page"[^>]*>Needs review/);
    expect(t).not.toMatch(/Maya|Leo|@example\.com|want to be here/);
    // Most urgent first on the page too.
    expect(html.indexOf(ids.imminentOld)).toBeLessThan(html.indexOf(ids.medium));
    expect(html).not.toContain(ids.reviewedRecently);

    const reviewed = await page("reviewed");
    expect(reviewed).toContain(ids.reviewedRecently);
    expect(reviewed).not.toContain(ids.imminentOld);
    expect(text(reviewed)).toContain("No action needed · took 9 hours (on time)");
    expect(text(reviewed)).toContain("No action needed · took 35 hours (after the target)");

    // Unknown filters fall back to the queue.
    expect(await page("everything")).not.toContain(ids.reviewedRecently);
  });

  it("says when nothing is waiting", async () => {
    await db.update(schema.safetyEvents).set({ reviewedAt: NOW, reviewOutcome: "no_action" });
    await signIn(admin.id);
    const t = text(await render(SafetyQueuePage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/admin/safety">)));
    expect(t).toContain("Nothing is waiting for review.");
  });
});

// ---------------------------------------------------------------------------
// One event: context and review
// ---------------------------------------------------------------------------

describe("safety event detail", () => {
  let admin: typeof schema.users.$inferSelect;
  let student: typeof schema.users.$inferSelect;

  beforeEach(async () => {
    admin = await makeUser("admin");
    student = await makeUser("student", { displayName: "Maya", parentManaged: true });
  });

  async function conversation(texts: [role: "user" | "assistant", content: string, minutesAgo: number, kind?: "chat" | "support"][]) {
    const [conv] = await db.insert(schema.counselorConversations).values({ userId: student.id, concernFlagged: true }).returning();
    for (const [role, content, minutesAgo, kind] of texts) {
      await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role, content, kind: kind ?? "chat", createdAt: new Date(NOW.getTime() - minutesAgo * 60_000) });
    }
    return conv;
  }

  it("shows the excerpt and details without the student's name", async () => {
    const event = await addEvent(student.id, { excerpt: "Nobody would notice\nif I was gone", createdAt: ago(2) });
    await signIn(admin.id);
    const html = await render(
      SafetyEventPage({ params: Promise.resolve({ id: event.id }), searchParams: Promise.resolve({}) } as PageProps<"/admin/safety/[id]">),
    );
    const t = text(html);
    expect(t).toContain("High: Self-harm");
    expect(t).toContain("Nobody would notice if I was gone");
    expect(t).toContain("Flagged by Keyword rules, AI model");
    expect(t).toContain("AI model tier Ran normally");
    expect(t).toContain("Student Grades 9–10");
    expect(t).toContain("Review target Sep 25, 2026, 4:00 PM UTC");
    expect(t).toContain("Show conversation context");
    expect(t).toContain("Save review");
    expect(t).not.toContain("Maya");
    // Opening the page isn't a reveal.
    expect(await auditRows("admin.viewed_safety_event")).toHaveLength(0);
  });

  it("returns not-found for unknown or malformed ids", async () => {
    await signIn(admin.id);
    for (const id of [crypto.randomUUID(), "nope"]) {
      const run = () => SafetyEventPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as PageProps<"/admin/safety/[id]">);
      expect(await thrown(run)).toBeInstanceOf(NotFound);
    }
  });

  it("reveals the student and the messages around the flagged one, and audits it with the event id only", async () => {
    await conversation([
      ["user", "hi", 20],
      ["assistant", "Hi! What's on your mind?", 19],
      ["user", "school is a lot", 10],
      ["assistant", "That sounds hard.", 9],
      ["user", "I don't want to be here anymore", 2],
      ["assistant", "You matter. Call or text 988.", 2, "support"],
      ["user", "ok", 1],
    ]);
    const event = await addEvent(student.id, { createdAt: new Date(NOW.getTime() - 2 * 60_000 + 500) });

    const context = await revealSafetyContext(db, admin.id, event.id);
    expect(context?.student).toEqual({ displayName: "Maya", parentManaged: true, linkedParent: false });
    expect(context?.conversation?.concernFlagged).toBe(true);
    expect(context?.conversation?.messages.map((m) => [m.content, m.flagged])).toEqual([
      ["hi", false],
      ["Hi! What's on your mind?", false],
      ["school is a lot", false],
      ["That sounds hard.", false],
      ["I don't want to be here anymore", true],
      ["You matter. Call or text 988.", false],
      ["ok", false],
    ]);
    expect(context?.conversation).toMatchObject({ earlier: 0, later: 0 });

    const narrow = await revealSafetyContext(db, admin.id, event.id, { window: 1 });
    expect(narrow?.conversation?.messages.map((m) => m.content)).toEqual(["That sounds hard.", "I don't want to be here anymore", "You matter. Call or text 988."]);
    expect(narrow?.conversation).toMatchObject({ earlier: 3, later: 1 });

    const audits = await auditRows("admin.viewed_safety_event");
    expect(audits).toHaveLength(2);
    for (const a of audits) {
      expect(a).toMatchObject({ actorUserId: admin.id, subjectUserId: student.id, metadata: { eventId: event.id } });
      expect(Object.keys(a.metadata ?? {})).toEqual(["eventId"]);
    }
  });

  it("notes a linked parent, and renders the context for staff", async () => {
    const parent = await makeUser("parent");
    await db.insert(schema.parentStudentLinks).values({ parentUserId: parent.id, studentUserId: student.id });
    await conversation([["user", "I don't want to be here anymore", 5]]);
    const event = await addEvent(student.id, { createdAt: ago(5 / 60) });
    const context = await revealSafetyContext(db, admin.id, event.id);
    expect(context?.student.linkedParent).toBe(true);
    const t = text(renderToStaticMarkup(ContextView({ context: context! })));
    expect(t).toContain("Student Maya");
    expect(t).toContain("Managed by a parent");
    expect(t).toContain("a parent is linked");
    expect(t).toContain("Student · Sep 24, 2026, 5:55 PM UTC · Flagged message");
  });

  it("picks the closest matching message when the same words were sent more than once", async () => {
    await conversation([
      ["user", "I want to disappear", 60 * 24 * 3],
      ["assistant", "Reply days ago", 60 * 24 * 3 - 1],
    ]);
    await conversation([
      ["user", "I want to disappear", 8],
      ["assistant", "Reply 8 minutes ago", 8],
    ]);
    await conversation([
      ["user", "I want to disappear", 1],
      ["assistant", "Reply a minute ago", 1],
    ]);
    // Another student's identical message never matches.
    const other = await makeUser("student", { displayName: "Ana" });
    const [otherConv] = await db.insert(schema.counselorConversations).values({ userId: other.id }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: otherConv.id, role: "user", content: "I want to disappear", createdAt: NOW });

    const event = await addEvent(student.id, { excerpt: "I want to disappear", createdAt: ago(1 / 60) });
    const context = await revealSafetyContext(db, admin.id, event.id);
    expect(context?.conversation?.messages.map((m) => m.content)).toEqual(["I want to disappear", "Reply a minute ago"]);
  });

  it("matches a long message whose 1,000-character excerpt cut an emoji in half", async () => {
    const long = `${"a".repeat(999)}😀 and the rest of a long message`;
    await conversation([["user", long, 1]]);
    const event = await addEvent(student.id, { excerpt: long.slice(0, 1000), createdAt: ago(1 / 60) });
    expect(event.excerpt.endsWith("�")).toBe(true);
    const context = await revealSafetyContext(db, admin.id, event.id);
    expect(context?.conversation?.messages).toEqual([expect.objectContaining({ content: long, flagged: true })]);
  });

  it("still reveals the student when the conversation was deleted, and audits nothing for a missing event", async () => {
    const event = await addEvent(student.id, { createdAt: ago(1) });
    const context = await revealSafetyContext(db, admin.id, event.id);
    expect(context).toEqual({ student: { displayName: "Maya", parentManaged: true, linkedParent: false }, conversation: null });
    expect(text(renderToStaticMarkup(ContextView({ context: context! })))).toContain("We couldn't find this message in a saved conversation");

    expect(await revealSafetyContext(db, admin.id, crypto.randomUUID())).toBeNull();
    expect(await revealSafetyContext(db, admin.id, "nope")).toBeNull();
    expect(await auditRows("admin.viewed_safety_event")).toHaveLength(1);

    await signIn(admin.id);
    expect(await revealSafetyContextAction(undefined, form({ eventId: crypto.randomUUID() }))).toEqual({
      message: expect.stringContaining("couldn't find this event"),
    });
  });

  it("records a review once, with only the outcome in the audit log", async () => {
    const event = await addEvent(student.id, { createdAt: ago(3) });
    const result = await reviewSafetyEvent(db, admin.id, event.id, { outcome: "followed_up", note: "Checked in with Maya's mom per policy." }, NOW);
    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(schema.safetyEvents).where(eq(schema.safetyEvents.id, event.id));
    expect(row).toMatchObject({ reviewedAt: NOW, reviewedByUserId: admin.id, reviewOutcome: "followed_up", reviewNote: "Checked in with Maya's mom per policy." });

    const otherAdmin = await makeUser("admin", { displayName: "Sam" });
    expect(await reviewSafetyEvent(db, otherAdmin.id, event.id, { outcome: "no_action", note: "" })).toEqual({ ok: false, error: "already_reviewed" });
    expect(await reviewSafetyEvent(db, admin.id, crypto.randomUUID(), { outcome: "no_action", note: "" })).toEqual({ ok: false, error: "not_found" });
    const [unchanged] = await db.select().from(schema.safetyEvents).where(eq(schema.safetyEvents.id, event.id));
    expect(unchanged).toMatchObject({ reviewedByUserId: admin.id, reviewOutcome: "followed_up" });

    const audits = await auditRows("safety.reviewed");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: admin.id, subjectUserId: student.id, metadata: { outcome: "followed_up" } });
    expect(Object.keys(audits[0].metadata ?? {})).toEqual(["outcome"]);
  });

  it("validates the review form and shows the saved review", async () => {
    const event = await addEvent(student.id, { createdAt: ago(3) });
    await signIn(admin.id);
    expect(await reviewSafetyEventAction(undefined, form({ eventId: event.id, note: "x" }))).toMatchObject({ errors: { outcome: [expect.any(String)] } });
    expect(await reviewSafetyEventAction(undefined, form({ eventId: event.id, outcome: "shrug" }))).toMatchObject({ errors: { outcome: [expect.any(String)] } });
    expect(await reviewSafetyEventAction(undefined, form({ eventId: event.id, outcome: "escalated", note: "   " }))).toMatchObject({
      errors: { note: ["Say what you did, so the next person knows."] },
    });
    expect(await reviewSafetyEventAction(undefined, form({ eventId: event.id, outcome: "no_action", note: "x".repeat(2001) }))).toMatchObject({
      errors: { note: [expect.any(String)] },
    });
    const [still] = await db.select().from(schema.safetyEvents).where(eq(schema.safetyEvents.id, event.id));
    expect(still.reviewedAt).toBeNull();

    expect(await redirectOf(() => reviewSafetyEventAction(undefined, form({ eventId: event.id, outcome: "no_action", note: "" })))).toBe(
      `/admin/safety/${event.id}?reviewed=1`,
    );
    const [saved] = await db.select().from(schema.safetyEvents).where(eq(schema.safetyEvents.id, event.id));
    expect(saved).toMatchObject({ reviewOutcome: "no_action", reviewNote: null });

    expect(await reviewSafetyEventAction(undefined, form({ eventId: event.id, outcome: "escalated", note: "late" }))).toEqual({
      message: expect.stringContaining("already reviewed"),
    });

    const t = text(
      await render(
        SafetyEventPage({ params: Promise.resolve({ id: event.id }), searchParams: Promise.resolve({ reviewed: "1" }) } as PageProps<"/admin/safety/[id]">),
      ),
    );
    expect(t).toContain("Review saved.");
    expect(t).toContain("Outcome No action needed");
    expect(t).toContain("by Jordan");
    expect(t).not.toContain("Save review");
  });

  it("goes away with the student's account", async () => {
    const event = await addEvent(student.id);
    await reviewSafetyEvent(db, admin.id, event.id, { outcome: "escalated", note: "Sensitive follow-up detail" });
    await db.delete(schema.users).where(eq(schema.users.id, student.id));
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(0);
    const [audit] = await auditRows("safety.reviewed");
    expect(audit).toMatchObject({ subjectUserId: null, metadata: { outcome: "escalated" } });
  });
});

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

describe("AI cost dashboard", () => {
  let admin: typeof schema.users.$inferSelect;
  let a: string;
  let b: string;
  let c: string;
  let d: string;

  async function usage(userId: string, feature: string, model: string, costMicros: number, at: string, tokens = { inputTokens: 1000, outputTokens: 100 }) {
    await db.insert(schema.aiUsage).values({ userId, feature, model, costMicros, createdAt: new Date(at), ...tokens });
  }

  beforeEach(async () => {
    admin = await makeUser("admin");
    [a, b, c, d] = [(await makeUser("student")).id, (await makeUser("student")).id, (await makeUser("student")).id, (await makeUser("student")).id];
    // A: over budget. B: 83% of it. C: light use, including the last second of the month. D: August only.
    await usage(a, "counselor", "claude-opus-5", 2_000_000, "2026-09-02T10:00:00Z", { inputTokens: 50_000, outputTokens: 5_000 });
    await usage(a, "safety", "claude-opus-5", 500_000, "2026-09-02T10:00:01Z");
    await usage(a, "counselor", "claude-opus-5", 600_000, "2026-09-15T08:00:00Z");
    await usage(b, "counselor", "claude-sonnet-5", 2_500_000, "2026-09-15T20:00:00Z");
    await usage(c, "explain", "claude-opus-5", 100_000, "2026-09-01T00:00:00Z");
    await usage(c, "safety_backup", "claude-sonnet-5", 20_000, "2026-09-30T23:59:59Z");
    await usage(d, "counselor", "claude-opus-5", 9_000_000, "2026-08-31T23:59:59Z");
    await usage(c, "counselor", "claude-opus-5", 7_000_000, "2026-10-01T00:00:00Z");
  });

  it("adds up a month: totals, per-student spread against the budget, features, models and days", async () => {
    const report = await costReport(db, admin.id, "2026-09", { now: new Date("2026-10-05T12:00:00Z"), budgetUsd: 3 });
    expect(report).toMatchObject({
      month: "2026-09",
      budgetMicros: 3_000_000,
      totalMicros: 5_720_000,
      calls: 6,
      activeStudents: 3,
      medianMicros: 2_500_000,
    });
    expect(report.averageMicros).toBeCloseTo(5_720_000 / 3);
    expect(report.overBudget).toEqual([{ shortId: studentShortId(a), micros: 3_100_000, percentOfBudget: expect.closeTo(103.33, 1) }]);
    expect(report.nearBudget).toEqual([{ shortId: studentShortId(b), micros: 2_500_000, percentOfBudget: expect.closeTo(83.33, 1) }]);

    expect(report.byFeature.map((f) => [f.key, f.micros, f.calls])).toEqual([
      ["counselor", 5_100_000, 3],
      ["safety", 500_000, 1],
      ["explain", 100_000, 1],
      ["safety_backup", 20_000, 1],
    ]);
    expect(report.byFeature[0]).toMatchObject({ inputTokens: 52_000, outputTokens: 5_200, share: expect.closeTo(5.1 / 5.72, 5) });
    expect(report.byModel.map((m) => [m.key, m.micros, m.calls])).toEqual([
      ["claude-opus-5", 3_200_000, 4],
      ["claude-sonnet-5", 2_520_000, 2],
    ]);

    expect(report.daily).toHaveLength(30);
    expect(report.daily[0]).toEqual({ date: "2026-09-01", micros: 100_000 });
    expect(report.daily[1]).toEqual({ date: "2026-09-02", micros: 2_500_000 });
    expect(report.daily[14]).toEqual({ date: "2026-09-15", micros: 3_100_000 });
    expect(report.daily[29]).toEqual({ date: "2026-09-30", micros: 20_000 });
    expect(report.daily.reduce((t, day) => t + day.micros, 0)).toBe(report.totalMicros);

    // No student ids, names or emails, only pseudonymous short ids.
    const json = JSON.stringify(report);
    for (const id of [a, b, c, d]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/Maya|@example\.com/);
    expect(studentShortId(a)).toMatch(/^S-[0-9a-f]{8}$/);
    expect(studentShortId(a)).not.toBe(studentShortId(b));
  });

  it("counts a student exactly at the budget as at 100%, and one exactly at 80% as close to it", async () => {
    const report = await costReport(db, admin.id, "2026-09", { now: NOW, budgetUsd: 3.1 });
    expect(report.overBudget.map((s) => [s.shortId, s.percentOfBudget])).toEqual([[studentShortId(a), 100]]);
    expect(report.nearBudget.map((s) => s.shortId)).toEqual([studentShortId(b)]);
    const eighty = await costReport(db, admin.id, "2026-09", { now: NOW, budgetUsd: 3.125 });
    expect(eighty.overBudget).toEqual([]);
    expect(eighty.nearBudget.map((s) => s.shortId)).toEqual([studentShortId(a), studentShortId(b)]);
  });

  it("stops the current month's days at today, and handles a month with no use", async () => {
    const current = await costReport(db, admin.id, "2026-09", { now: NOW });
    expect(current.daily).toHaveLength(24);
    expect(current.daily.at(-1)?.date).toBe("2026-09-24");

    const empty = await costReport(db, admin.id, "2026-07", { now: NOW, budgetUsd: 3 });
    expect(empty).toMatchObject({ totalMicros: 0, calls: 0, activeStudents: 0, averageMicros: null, medianMicros: null, nearBudget: [], overBudget: [], byFeature: [] });
    expect(empty.daily).toHaveLength(31);
  });

  it("reports safety reviews for the month against the target", async () => {
    const student = await makeUser("student");
    const at = (iso: string) => new Date(iso);
    const reviewed = { reviewedByUserId: admin.id, reviewOutcome: "no_action" as const };
    await addEvent(student.id, { severity: "imminent", createdAt: at("2026-09-02T10:00:00Z"), reviewedAt: at("2026-09-02T12:00:00Z"), ...reviewed });
    await addEvent(student.id, { severity: "high", createdAt: at("2026-09-03T10:00:00Z"), reviewedAt: at("2026-09-04T16:00:00Z"), ...reviewed });
    await addEvent(student.id, { severity: "medium", createdAt: at("2026-09-20T10:00:00Z") });
    await addEvent(student.id, { severity: "medium", createdAt: at("2026-09-23T10:00:00Z") });
    await addEvent(student.id, { severity: "high", createdAt: at("2026-08-31T23:00:00Z") });
    await addEvent(student.id, { severity: "high", createdAt: at("2026-10-01T00:00:00Z") });

    expect(await safetyMonthStats(db, admin.id, "2026-09", NOW)).toEqual({
      total: 4,
      bySeverity: { imminent: 1, high: 1, medium: 2, low: 0 },
      reviewed: 2,
      medianReviewMs: 16 * HOUR,
      reviewedOnTime: 1,
      reviewedLate: 1,
      waiting: 1,
      overdue: 1,
    });

    await signIn(admin.id);
    const html = await render(CostsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ month: "2026-09" }) } as PageProps<"/admin/costs">));
    const t = text(html);
    expect(t).toContain("4 flagged: 1 imminent, 1 high, 2 medium.");
    expect(t).toContain("Median time to review 16 hours");
    expect(t).toContain("Reviewed within the target 1 (50%) 1 after the target");
    expect(t).toContain("Overdue now 1 1 more waiting, not yet due");
  });

  it("renders the dashboard with budget comparisons and pseudonymous ids only", async () => {
    await signIn(admin.id);
    const html = await render(CostsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ month: "2026-09" }) } as PageProps<"/admin/costs">));
    const t = text(html);
    expect(t).toContain("September 2026");
    expect(t).toContain("Total AI spend $5.72 6 AI calls");
    expect(t).toContain("Students using AI 3");
    expect(t).toContain("Median per student $2.50 83% of the $3.00 budget");
    expect(t).toContain(`At or over 100% (1) ${studentShortId(a)} $3.10 · 103%`);
    expect(t).toContain(`80% to 99% (1) ${studentShortId(b)} $2.50 · 83%`);
    expect(t).toContain("AI counselor $5.10 89% 3");
    expect(t).toContain("claude-sonnet-5 $2.52");
    expect(t).toContain("Highest day: Sep 15, $3.10.");
    expect(html).toContain('<option value="2026-09" selected="">September 2026</option>');
    for (const id of [a, b, c]) expect(html).not.toContain(id);
    expect(t).not.toMatch(/Maya|@example\.com/);

    // A future or malformed month shows the current one.
    const fallback = text(await render(CostsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ month: "2031-01" }) } as PageProps<"/admin/costs">)));
    expect(fallback).toContain("September 2026");
  });
});

// ---------------------------------------------------------------------------
// Creating admins (npm run admin:create)
// ---------------------------------------------------------------------------

describe("admin account creation", () => {
  it("creates a staff account that signs in and lands on /admin, audited without personal data", async () => {
    const result = await createAdminUser(db, { email: " Staff@Example.com ", displayName: "Jordan", password: "a long staff passphrase" });
    if (!result.ok) throw new Error(result.error);
    expect(result.email).toBe("staff@example.com");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(user).toMatchObject({ role: "admin", email: "staff@example.com", displayName: "Jordan", householdId: null, birthDate: null, grade: null });
    expect(await verifyPassword(user.passwordHash, "a long staff passphrase")).toBe(true);

    const [audit] = await auditRows("admin.created");
    expect(audit).toMatchObject({ subjectUserId: result.userId, actorUserId: null, metadata: { via: "cli" } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/staff|Jordan/i);

    const login = await authenticate(db, { identifier: "staff@example.com", password: "a long staff passphrase" });
    expect(login).toEqual({ userId: result.userId });
    expect(homePathFor(user)).toBe("/admin");
  });

  it("refuses short passwords and emails that already have an account, without promoting anyone", async () => {
    expect(await createAdminUser(db, { email: "staff@example.com", displayName: "Jordan", password: "fifteen chars!!" })).toMatchObject({
      ok: false,
      error: "invalid",
      messages: ["password: Use at least 16 characters."],
    });
    const parent = await makeUser("parent", { email: "rosa@example.com" });
    expect(await createAdminUser(db, { email: "ROSA@example.com", displayName: "Rosa", password: "a long staff passphrase" })).toEqual({
      ok: false,
      error: "email_taken",
    });
    const [still] = await db.select().from(schema.users).where(eq(schema.users.id, parent.id));
    expect(still.role).toBe("parent");
    expect(await db.select().from(schema.users).where(and(eq(schema.users.role, "admin"), like(schema.users.email, "%example.com")))).toHaveLength(0);
    expect(await auditRows("admin.created")).toHaveLength(0);
  });
});
