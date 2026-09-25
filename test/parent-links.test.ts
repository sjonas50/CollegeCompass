import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeMyParentAction } from "@/app/actions/settings";
import DashboardPage from "@/app/dashboard/page";
import InvitePage from "@/app/invite/[token]/page";
import ParentHome from "@/app/parent/page";
import { RemoveParentQuestion } from "@/components/remove-parent";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { formatAccessDate } from "@/lib/access/describe";
import { evaluateAccess } from "@/lib/access/entitlement";
import { getHouseholdAccess, getUserAccess, grantFreeAccess } from "@/lib/access/service";
import { createChildAccount, isLinkedParent, registerParent, registerStudent } from "@/lib/accounts";
import { type FakeStripeRequest, fakeStripe } from "@/lib/billing/fake-stripe";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import type { Email } from "@/lib/email";
import { acceptInvite, createInvite, findInvite, inviteCardState } from "@/lib/invites";
import { listLinkedParents, removalAccessNote, removeLinkedParent } from "@/lib/parent-links";
import { deleteOwnStudentAccount, deleteParentAccount, deleteStudent, exportStudentData } from "@/lib/privacy";

// A teen sees the parent or guardian linked to their account and can remove them. The parent keeps
// their household and plan; the teen gets a household of their own and the free access they turned on.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async (roles?: string[]) => {
    const user = state.user;
    if (!user) throw new Redirect("/login");
    if (roles && !roles.includes(user.role)) throw new Redirect(user.role === "parent" ? "/parent" : "/dashboard");
    return user;
  },
  getCurrentUser: async () => state.user,
}));
// Cards that load their own data have their own tests.
vi.mock("@/components/weekly-steps", () => ({ WeeklyStepsCard: () => null }));
vi.mock("@/components/invite-parent", () => ({ InviteParentCard: () => null }));

const now = new Date("2026-09-24T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "correct horse battery";
const APP = "https://compass.example";

let db: Db;
let sent: Email[];

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  sent = [];
});

afterEach(() => {
  state.user = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function teen(name = "Ana", email = "ana@example.com") {
  const res = await registerStudent(db, { displayName: name, email, password: PASSWORD, birthDate: "2010-05-01", grade: 10 }, now);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parent(email = "rosa@example.com", name = "Rosa") {
  const res = await registerParent(db, { displayName: name, email, password: PASSWORD });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

/** A child the parent sets up: under 13 (parentManaged, with consent) or 13 and older. */
async function child(parentId: string, username: string, under13: boolean) {
  const consent = under13 ? await verifyParentConsent({ parentUserId: parentId, attested: true }) : null;
  const res = await createChildAccount(
    db,
    parentId,
    { displayName: username, username, password: PASSWORD, birthDate: under13 ? "2014-03-01" : "2011-01-01", grade: under13 ? 7 : 10 },
    consent,
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

/** The student invites `to`, and the parent accepts. Returns the invitation's token. */
async function link(studentId: string, parentId: string, to = "Rosa.Parent@Example.com") {
  const res = await createInvite(db, studentId, to, { appUrl: APP, send: async (e) => void sent.push(e), now });
  if (!res.ok) throw new Error(res.error);
  const token = /\/invite\/(\S+)/.exec(sent.at(-1)!.text)![1];
  const accepted = await acceptInvite(db, token, parentId, now);
  if (!accepted.ok) throw new Error(accepted.error);
  return token;
}

/** Ana linked to Rosa, sharing Rosa's household, with only the grants each test adds. */
async function family() {
  const ana = await teen();
  const rosa = await parent();
  const token = await link(ana, rosa);
  const household = (await householdOf(rosa))!;
  expect(await householdOf(ana)).toBe(household);
  await db.delete(schema.accessGrants);
  return { ana, rosa, token, household };
}

async function householdOf(userId: string) {
  const [row] = await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId));
  return row?.householdId ?? null;
}

const grantsIn = (householdId: string) => db.select().from(schema.accessGrants).where(eq(schema.accessGrants.householdId, householdId));
const billingIn = async (householdId: string) =>
  (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.householdId, householdId)))[0];

function renewingPlan(householdId: string, payerUserId: string) {
  return db.insert(schema.billingAccounts).values({
    householdId,
    stripeCustomerId: "cus_rosa",
    payerUserId,
    stripeSubscriptionId: "sub_rosa",
    status: "active",
    plan: "monthly",
    currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
  });
}

/** Stripe that sets plans to end and deletes customers. */
function stripeAccount() {
  return fakeStripe((req: FakeStripeRequest) => {
    const sub = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(req.path);
    if (req.method === "POST" && sub) return { body: { id: sub[1], object: "subscription", status: "active", cancel_at_period_end: true } };
    if (req.method === "DELETE" && req.path.startsWith("/v1/customers/")) return { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } };
    return undefined;
  });
}
const calls = (requests: FakeStripeRequest[]) => requests.map((r) => `${r.method} ${r.path}`);

async function signIn(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  state.user = { id: u.id, role: u.role, displayName: u.displayName, username: u.username, householdId: u.householdId, parentManaged: u.parentManaged, grade: u.grade };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Redirect)) throw err ?? new Error("did not redirect");
  return err.url;
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => text(renderToStaticMarkup((await node) as ReactNode));

const removalOf = async (studentId: string, at = now) => {
  const [p] = await listLinkedParents(db, studentId, at);
  return p.removal!;
};
const removedAudits = () => db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "parent_link.removed_by_student"));

// ---------------------------------------------------------------------------

describe("who can see and remove a linked parent", () => {
  it("lists the parent for the student themself: their name and the address the student typed", async () => {
    const { ana, rosa } = await family();
    const [p] = await listLinkedParents(db, ana, now);
    expect(p).toMatchObject({ id: rosa, displayName: "Rosa", origin: { kind: "invite", sentTo: "rosa.parent@example.com" } });
    expect(p.removal).toMatchObject({ kind: "split" });
    // Parents and unknown ids get nothing.
    expect(await listLinkedParents(db, rosa, now)).toEqual([]);
    expect(await listLinkedParents(db, "not-a-uuid", now)).toEqual([]);
  });

  it("lets only the student remove their own parent", async () => {
    const { ana, rosa } = await family();
    const bo = await teen("Bo", "bo@example.com");
    const sam = await parent("sam@example.com", "Sam");
    await link(bo, sam, "sam@example.com");

    expect(await removeLinkedParent(db, rosa, rosa, { now })).toEqual({ ok: false, error: "not_found" });
    expect(await removeLinkedParent(db, "not-a-uuid", rosa, { now })).toEqual({ ok: false, error: "not_found" });
    expect(await removeLinkedParent(db, bo, rosa, { now })).toEqual({ ok: false, error: "not_linked" });
    expect(await removeLinkedParent(db, ana, sam, { now })).toEqual({ ok: false, error: "not_linked" });
    expect(await removeLinkedParent(db, ana, "not-a-uuid", { now })).toEqual({ ok: false, error: "not_linked" });
    expect(await isLinkedParent(db, rosa, ana)).toBe(true);
    expect(await isLinkedParent(db, sam, bo)).toBe(true);
    expect(await removedAudits()).toHaveLength(0);
  });

  it("never lets a child their parent set up under 13 remove them, and says the parent manages the account", async () => {
    const rosa = await parent();
    const leo = await child(rosa, "leo12", true);
    const household = await householdOf(rosa);

    expect(await removeLinkedParent(db, leo, rosa, { now })).toEqual({ ok: false, error: "parent_managed" });
    expect(await isLinkedParent(db, rosa, leo)).toBe(true);
    expect(await householdOf(leo)).toBe(household);
    const [p] = await listLinkedParents(db, leo, now);
    expect(p).toMatchObject({ displayName: "Rosa", origin: { kind: "set_up" }, removal: null });

    await signIn(leo);
    expect(await removeMyParentAction(undefined, form({ parentId: rosa }))).toEqual({
      message: "Your parent or guardian set up your account and manages it, so they stay linked.",
    });
    expect(await isLinkedParent(db, rosa, leo)).toBe(true);

    const settings = await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">));
    expect(settings).toContain("Your parent or guardian Your parent or guardian set up your account and manages it, so they stay linked.");
    expect(settings).toContain("Rosa Set up your account");
    expect(settings).not.toContain("Remove Rosa");
  });

  it("lets a teen their parent set up at 13 or older remove them", async () => {
    const rosa = await parent();
    const mia = await child(rosa, "mia15", false);
    expect((await listLinkedParents(db, mia, now))[0]).toMatchObject({ origin: { kind: "set_up" }, removal: { kind: "split" } });
    expect(await removeLinkedParent(db, mia, rosa, { now })).toMatchObject({ ok: true, householdMoved: true });
    expect(await isLinkedParent(db, rosa, mia)).toBe(false);
    expect(await householdOf(mia)).not.toBe(await householdOf(rosa));
  });

  it("the action removes only the signed-in student's own link", async () => {
    const { ana, rosa } = await family();
    const bo = await teen("Bo", "bo@example.com");

    // Another student posting Rosa's id changes nothing.
    await signIn(bo);
    expect(await removeMyParentAction(undefined, form({ parentId: rosa }))).toEqual({ message: "That parent or guardian isn't linked to your account anymore." });
    // A parent can't use it at all.
    await signIn(rosa);
    expect(await redirectOf(removeMyParentAction(undefined, form({ parentId: rosa })))).toBe("/parent");
    expect(await isLinkedParent(db, rosa, ana)).toBe(true);

    await signIn(ana);
    expect(await redirectOf(removeMyParentAction(undefined, form({ parentId: rosa })))).toBe("/dashboard?parent=removed");
    expect(await isLinkedParent(db, rosa, ana)).toBe(false);
    // A second click (or another tab) finds nothing to remove.
    expect(await removeMyParentAction(undefined, form({ parentId: rosa }))).toEqual({ message: "That parent or guardian isn't linked to your account anymore." });
    expect(await removedAudits()).toHaveLength(1);
  });

  it("shows the parent in the student's Settings, with Remove", async () => {
    const { ana } = await family();
    await signIn(ana);
    const html = await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">));
    expect(html).toContain("Your parent or guardian");
    expect(html).toContain("If someone here isn't your parent or guardian, remove them.");
    expect(html).toContain("Rosa Accepted the invitation you sent to rosa.parent@example.com");
    expect(html).toContain("Remove Rosa");
    // The confirm step (and its "Yes") appear only after Remove is pressed.
    expect(html).not.toContain("Yes, remove");
  });
});

// ---------------------------------------------------------------------------

describe("households and access after removing a parent", () => {
  it("gives the teen a household of their own; the parent keeps theirs, its plan and any siblings", async () => {
    const { ana, rosa, household } = await family();
    const leo = await child(rosa, "leo12", true);
    await renewingPlan(household, rosa);
    // The family's trial ended long ago.
    await db.insert(schema.accessGrants).values({ householdId: household, kind: "trial", startsAt: new Date(now.getTime() - 60 * DAY), endsAt: new Date(now.getTime() - 46 * DAY) });
    const { stripe, requests } = stripeAccount();

    const res = await removeLinkedParent(db, ana, rosa, { stripe, now });
    expect(res).toEqual({ ok: true, householdMoved: true, grantsMoved: 0, trialCarried: false, planEnding: false });

    const own = (await householdOf(ana))!;
    expect(own).not.toBe(household);
    expect(await db.select().from(schema.users).where(eq(schema.users.householdId, own))).toHaveLength(1);
    // Rosa, Leo and the plan stay put, and the plan keeps renewing: it still covers Leo.
    expect(await householdOf(rosa)).toBe(household);
    expect(await householdOf(leo)).toBe(household);
    expect(await billingIn(household)).toMatchObject({ stripeCustomerId: "cus_rosa", payerUserId: rosa, cancelAtPeriodEnd: false });
    expect(await billingIn(own)).toBeUndefined();
    expect(requests).toHaveLength(0);
    expect((await getUserAccess(db, leo, now)).sources).toEqual(["subscription"]);

    // Ana has no access now, and removing a parent never starts a new trial.
    const later = new Date(now.getTime() + DAY);
    const access = await getHouseholdAccess(db, own, later);
    expect(access.full).toBe(false);
    expect(await grantsIn(own)).toEqual([expect.objectContaining({ kind: "trial", startsAt: now, endsAt: now })]);
  });

  it("moves free access the teen turned on; free access and comps on the parent's side stay", async () => {
    const { ana, rosa, household } = await family();
    const staff = await parent("staff@example.com", "Staff");
    // Rosa's free access ended; Ana turned it on again; staff gave the household a comp.
    await db.insert(schema.accessGrants).values([
      { householdId: household, kind: "free_access", grantedByUserId: rosa, startsAt: new Date(now.getTime() - 400 * DAY), endsAt: new Date(now.getTime() - 35 * DAY) },
      { householdId: household, kind: "comp", grantedByUserId: staff, startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 100 * DAY) },
    ]);
    const granted = await grantFreeAccess(db, ana, now);
    expect(granted.ok).toBe(true);
    const [anasGrant] = (await grantsIn(household)).filter((g) => g.grantedByUserId === ana);

    const res = await removeLinkedParent(db, ana, rosa, { now });
    expect(res).toMatchObject({ ok: true, householdMoved: true, grantsMoved: 1, trialCarried: false });
    const own = (await householdOf(ana))!;
    // The same grant, not a copy: Rosa's household doesn't keep it.
    expect(await grantsIn(own)).toEqual([expect.objectContaining({ id: anasGrant.id, kind: "free_access", grantedByUserId: ana })]);
    expect((await grantsIn(household)).map((g) => [g.kind, g.grantedByUserId]).sort()).toEqual([
      ["comp", staff],
      ["free_access", rosa],
    ]);
    expect((await getUserAccess(db, ana, now)).sources).toEqual(["free_access"]);
    expect((await getUserAccess(db, rosa, now)).sources).toEqual(["comp"]);
  });

  it("lets the teen keep the days left on a running trial, without extending it", async () => {
    const { ana, rosa, household } = await family();
    const endsAt = new Date(now.getTime() + 9 * DAY);
    await db.insert(schema.accessGrants).values({ householdId: household, kind: "trial", startsAt: new Date(now.getTime() - 5 * DAY), endsAt });

    expect(await removeLinkedParent(db, ana, rosa, { now })).toMatchObject({ ok: true, trialCarried: true });
    const own = (await householdOf(ana))!;
    expect(await grantsIn(own)).toEqual([expect.objectContaining({ kind: "trial", endsAt })]);
    expect(await grantsIn(household)).toEqual([expect.objectContaining({ kind: "trial", endsAt })]);
    expect((await getUserAccess(db, ana, now)).trial).toMatchObject({ active: true, endsAt });
  });

  it("sets the parent's plan to end with its paid period when the teen was its only student", async () => {
    const { ana, rosa, household } = await family();
    await renewingPlan(household, rosa);
    const { stripe, requests } = stripeAccount();

    expect(await removeLinkedParent(db, ana, rosa, { stripe, now })).toMatchObject({ ok: true, planEnding: true });
    expect(calls(requests)).toEqual(["POST /v1/subscriptions/sub_rosa"]);
    expect(requests[0].form.get("cancel_at_period_end")).toBe("true");
    // The plan stays Rosa's and runs to the end of what she paid for.
    expect(await billingIn(household)).toMatchObject({ stripeCustomerId: "cus_rosa", payerUserId: rosa, status: "active", cancelAtPeriodEnd: true });
    expect((await getUserAccess(db, rosa, now)).sources).toEqual(["subscription"]);
    expect((await getUserAccess(db, ana, now)).full).toBe(false);
    const [entry] = await removedAudits();
    expect(entry.metadata).toEqual({ householdMoved: true, grantsMoved: 0, trialCarried: false, planEnding: true });
  });

  it("queues ending the plan when Stripe can't be reached", async () => {
    const { ana, rosa, household } = await family();
    await renewingPlan(household, rosa);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await removeLinkedParent(db, ana, rosa, { stripe: null, now })).toMatchObject({ ok: true, planEnding: true });
    expect(await db.select().from(schema.stripeCleanup)).toEqual([
      expect.objectContaining({ action: "cancel_at_period_end", stripeSubscriptionId: "sub_rosa", stripeCustomerId: null }),
    ]);
    expect(await billingIn(household)).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it("leaves a plan that has already ended alone", async () => {
    const { ana, rosa, household } = await family();
    await db.insert(schema.billingAccounts).values({ householdId: household, stripeCustomerId: "cus_rosa", payerUserId: rosa, stripeSubscriptionId: "sub_rosa", status: "canceled" });
    const { stripe, requests } = stripeAccount();
    expect(await removeLinkedParent(db, ana, rosa, { stripe, now })).toMatchObject({ ok: true, planEnding: false });
    expect(requests).toHaveLength(0);
    expect(await billingIn(household)).toMatchObject({ stripeCustomerId: "cus_rosa", status: "canceled" });
  });

  it("only unlinks when the teen doesn't share a household with the parent", async () => {
    const { ana, rosa } = await family();
    const [elsewhere] = await db.insert(schema.households).values({}).returning();
    await db.update(schema.users).set({ householdId: elsewhere.id }).where(eq(schema.users.id, ana));
    expect(await removalOf(ana)).toEqual({ kind: "unchanged" });
    expect(await removeLinkedParent(db, ana, rosa, { now })).toEqual({ ok: true, householdMoved: false, grantsMoved: 0, trialCarried: false, planEnding: false });
    expect(await householdOf(ana)).toBe(elsewhere.id);
  });
});

// ---------------------------------------------------------------------------

describe("what the teen is told about their access", () => {
  const TURN_ON = "you can turn on free access yourself. It's free, and you won't need any documents.";

  it("a parent's plan stays with them, and the teen can turn on free access", async () => {
    const { ana, rosa, household } = await family();
    await renewingPlan(household, rosa);
    const note = removalAccessNote("Rosa", await removalOf(ana));
    expect(note).toBe(`Your full access comes from Rosa's plan, and it stays with them. After you remove them, ${TURN_ON}`);
    await removeLinkedParent(db, ana, rosa, { stripe: null, now });
    expect((await getUserAccess(db, ana, now)).full).toBe(false);
  });

  it("free access the parent turned on stays with them", async () => {
    const { ana, rosa, household } = await family();
    await db.insert(schema.accessGrants).values({ householdId: household, kind: "free_access", grantedByUserId: rosa, startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 200 * DAY) });
    expect(removalAccessNote("Rosa", await removalOf(ana))).toBe(
      `Your full access comes from free access on Rosa's account, and it stays with them. After you remove them, ${TURN_ON}`,
    );
    await removeLinkedParent(db, ana, rosa, { now });
    expect((await getUserAccess(db, ana, now)).full).toBe(false);
  });

  it("a comp on the parent's household stays with them", async () => {
    const { ana, household } = await family();
    await db.insert(schema.accessGrants).values({ householdId: household, kind: "comp", startsAt: new Date(now.getTime() - DAY), endsAt: null });
    expect(removalAccessNote("Rosa", await removalOf(ana))).toBe(
      `Your full access comes from Rosa's account, and it stays with them. After you remove them, ${TURN_ON}`,
    );
  });

  it("the teen keeps the free access they turned on", async () => {
    const { ana, rosa, household } = await family();
    await renewingPlan(household, rosa);
    const granted = await grantFreeAccess(db, ana, now);
    if (!granted.ok) throw new Error(granted.error);
    expect(removalAccessNote("Rosa", await removalOf(ana))).toBe(
      `Rosa's plan stays with them. You keep the free access you turned on. It lasts until ${formatAccessDate(granted.endsAt)}.`,
    );
    await removeLinkedParent(db, ana, rosa, { stripe: null, now });
    expect((await getUserAccess(db, ana, now)).sources).toEqual(["free_access"]);
  });

  it("the teen keeps a running trial, then can turn on free access", async () => {
    const { ana, rosa, household } = await family();
    const endsAt = new Date(now.getTime() + 9 * DAY);
    await db.insert(schema.accessGrants).values({ householdId: household, kind: "trial", startsAt: new Date(now.getTime() - 5 * DAY), endsAt });
    expect(removalAccessNote("Rosa", await removalOf(ana))).toBe(`You keep your free trial. It ends on ${formatAccessDate(endsAt)}. After that, ${TURN_ON}`);
    await removeLinkedParent(db, ana, rosa, { now });
    expect((await getUserAccess(db, ana, now)).sources).toEqual(["trial"]);
  });

  it("without full access, nothing changes", async () => {
    const { ana, rosa } = await family();
    expect(removalAccessNote("Rosa", await removalOf(ana))).toBe("Your family doesn't have full access right now. Removing Rosa won't change that.");
    await removeLinkedParent(db, ana, rosa, { now });
    expect((await getUserAccess(db, ana, now)).full).toBe(false);
  });

  it("doesn't offer free access to a student who can't turn it on", () => {
    const locked = evaluateAccess({ householdId: "h", grants: [], billing: null }, now);
    const shared = evaluateAccess(
      { householdId: "h", grants: [], billing: { status: "active", plan: "monthly", currentPeriodEnd: null, cancelAtPeriodEnd: false } },
      now,
    );
    const note = removalAccessNote("Rosa", { kind: "split", now: shared, after: locked, leftBehind: "subscription", canTurnOnFreeAccess: false });
    expect(note).toBe(
      "Your full access comes from Rosa's plan, and it stays with them. After you remove them, you won't have full access. Your activities, career matches and college search stay free.",
    );
    expect(removalAccessNote("Rosa", { kind: "unchanged" })).toBe("Your access stays the same.");
  });

  it("the confirm step says what changes, access included", async () => {
    const html = await render(RemoveParentQuestion({ id: "q", name: "Rosa", accessNote: "ACCESS-NOTE" }));
    for (const line of [
      "Remove Rosa from your account?",
      "Rosa won't see your progress anymore. They also can't change your settings, download your data or delete your account.",
      "ACCESS-NOTE",
      "Everything you've done stays in your account, including your chats with the counselor.",
      "We won't email Rosa. You'll just stop showing up on their parent page.",
      "You can invite a parent or guardian again anytime.",
    ]) {
      expect(html).toContain(line);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the parent's side", () => {
  it("stops listing the teen, says nothing about why, and gets no email", async () => {
    const { ana, rosa, token } = await family();
    await signIn(rosa);
    const parentPage = () => render(ParentHome({ searchParams: Promise.resolve({}) } as PageProps<"/parent">));
    expect(await parentPage()).toContain("Ana");
    const emails = sent.length;

    expect((await removeLinkedParent(db, ana, rosa, { now })).ok).toBe(true);
    expect(sent).toHaveLength(emails);
    const after = await parentPage();
    expect(after).not.toContain("Ana");
    expect(after).not.toMatch(/removed|unlinked/i);
    expect(after).toContain("No children added yet.");

    // Nothing of Ana's is theirs any more.
    expect(await exportStudentData(db, rosa, ana)).toBeNull();
    expect(await deleteStudent(db, rosa, ana)).toBe(false);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ana))).toHaveLength(1);

    // The invitation Rosa accepted is gone, with the address it went to, so its link says nothing.
    expect(await findInvite(db, token, now)).toEqual({ status: "not_found" });
    expect(await db.select().from(schema.parentInvites)).toHaveLength(0);
    expect(await render(InvitePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) } as PageProps<"/invite/[token]">))).toContain(
      "We couldn't find this invitation",
    );
  });

  it("is audited with ids and counts only", async () => {
    const { ana, rosa } = await family();
    await removeLinkedParent(db, ana, rosa, { now });
    const [entry] = await removedAudits();
    expect(entry).toMatchObject({ actorUserId: ana, subjectUserId: rosa });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/ana|rosa|@|example/i);
  });
});

// ---------------------------------------------------------------------------

describe("export and delete after removing a parent", () => {
  it("the teen's own copy has the addresses they typed; a parent's copy never does", async () => {
    const { ana, rosa } = await family();
    const own = await exportStudentData(db, ana, ana);
    expect(own?.parentInvites).toEqual([expect.objectContaining({ sentTo: "rosa.parent@example.com", status: "accepted" })]);
    const parentCopy = await exportStudentData(db, rosa, ana);
    expect(parentCopy?.parentInvites).toEqual([expect.not.objectContaining({ sentTo: expect.anything() })]);
    expect(JSON.stringify(parentCopy)).not.toContain("rosa.parent@example.com");
  });

  it("the teen's export and deletion cover their new household, and leave the parent's alone", async () => {
    const { ana, rosa, household } = await family();
    const leo = await child(rosa, "leo12", true);
    await renewingPlan(household, rosa);
    await grantFreeAccess(db, ana, now);
    await removeLinkedParent(db, ana, rosa, { stripe: null, now });
    const own = (await householdOf(ana))!;

    const data = await exportStudentData(db, ana, ana);
    expect(data?.parentInvites).toEqual([]);
    expect(data?.householdAccess.subscription).toBeNull();
    expect(data?.householdAccess.grants).toEqual([expect.objectContaining({ kind: "free_access" })]);
    expect(JSON.stringify(data)).not.toMatch(/rosa/i);
    // Rosa's copy of Leo is unchanged, and says nothing about Ana.
    expect(JSON.stringify(await exportStudentData(db, rosa, leo))).not.toMatch(/"Ana"|ana@example/);

    const { stripe, requests } = stripeAccount();
    expect(await deleteOwnStudentAccount(db, ana, PASSWORD, { stripe, now })).toEqual({ ok: true });
    expect(await db.select().from(schema.households).where(eq(schema.households.id, own))).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(await householdOf(rosa)).toBe(household);
    expect(await householdOf(leo)).toBe(household);
    expect(await billingIn(household)).toMatchObject({ stripeCustomerId: "cus_rosa", cancelAtPeriodEnd: false });
  });

  it("the parent's deletion no longer reaches the teen", async () => {
    const { ana, rosa, household } = await family();
    await renewingPlan(household, rosa);
    const granted = await grantFreeAccess(db, ana, now);
    if (!granted.ok) throw new Error(granted.error);
    const { stripe, requests } = stripeAccount();
    await removeLinkedParent(db, ana, rosa, { stripe, now });
    const own = (await householdOf(ana))!;

    await deleteParentAccount(db, rosa, { stripe });
    // Rosa's household had nobody left, so it went, and its Stripe customer with it.
    expect(await db.select().from(schema.households).where(eq(schema.households.id, household))).toHaveLength(0);
    expect(calls(requests)).toContain("DELETE /v1/customers/cus_rosa");
    // Ana and her household are untouched.
    expect(await householdOf(ana)).toBe(own);
    expect((await getUserAccess(db, ana, now)).sources).toEqual(["free_access"]);
  });

  it("forgets the address when the parent who accepted deletes their account", async () => {
    const { ana, rosa } = await family();
    await deleteParentAccount(db, rosa, { stripe: null });
    const [row] = await db.select().from(schema.parentInvites).where(eq(schema.parentInvites.studentUserId, ana));
    expect(row).toMatchObject({ sentTo: null, acceptedByUserId: null });
    expect(row.acceptedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("inviting again", () => {
  it("the teen can invite a parent again, and the same parent can accept", async () => {
    const { ana, rosa, token, household } = await family();
    const granted = await grantFreeAccess(db, ana, now);
    if (!granted.ok) throw new Error(granted.error);
    await removeLinkedParent(db, ana, rosa, { now });
    const own = (await householdOf(ana))!;

    expect(await inviteCardState(db, ana, now)).toEqual({ eligible: true, pending: [], canSend: true });
    const again = await link(ana, rosa, "rosa@example.com");
    expect(again).not.toBe(token);
    // The old link still doesn't work.
    expect(await findInvite(db, token, now)).toEqual({ status: "not_found" });

    expect(await isLinkedParent(db, rosa, ana)).toBe(true);
    expect(await householdOf(ana)).toBe(household);
    expect(await db.select().from(schema.households).where(eq(schema.households.id, own))).toHaveLength(0);
    // Ana's free access came back with her.
    expect((await getUserAccess(db, rosa, now)).sources).toContain("free_access");
    expect((await listLinkedParents(db, ana, now))[0]).toMatchObject({ id: rosa, origin: { kind: "invite", sentTo: "rosa@example.com" } });
  });

  it("the teen can invite someone else, and the dashboard says the parent was removed", async () => {
    const { ana, rosa } = await family();
    await removeLinkedParent(db, ana, rosa, { now });
    const sam = await parent("sam@example.com", "Sam");
    await link(ana, sam, "sam@example.com");
    expect(await isLinkedParent(db, sam, ana)).toBe(true);
    expect(await isLinkedParent(db, rosa, ana)).toBe(false);

    await removeLinkedParent(db, ana, sam, { now });
    await signIn(ana);
    const html = await render(DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ parent: "removed" }) } as PageProps<"/dashboard">));
    expect(html).toContain("Done. That parent or guardian isn't linked to your account anymore.");
    expect(html).not.toContain("If someone here isn't your parent or guardian");
    expect(html).not.toMatch(/Remove (Sam|Rosa)/);
  });
});
