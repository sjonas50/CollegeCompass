import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvitePage from "@/app/invite/[token]/page";
import { InviteParentCard } from "@/components/invite-parent";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, isLinkedParent, registerParent, registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { hashToken } from "@/lib/auth/tokens";
import { verifyParentConsent } from "@/lib/consent/verifier";
import type { Email } from "@/lib/email";
import {
  INVITE_TTL_DAYS,
  MAX_INVITE_SENDS_PER_DAY,
  MAX_PENDING_INVITES,
  acceptInvite,
  cancelInvite,
  createInvite,
  exportParentInvites,
  findInvite,
  inviteCardState,
  inviteEmail,
  listPendingInvites,
} from "@/lib/invites";
import { deleteParentAccount, deleteStudent } from "@/lib/privacy";

const now = new Date("2026-09-24T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const APP = "https://compass.example";
const PARENT_EMAIL = "Rosa.Parent@Example.com";

let db: Db;
let sent: Email[];
const send = async (email: Email) => {
  sent.push(email);
};

// Pages and the card read the database and the signed-in user through these.
const page = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => page.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => page.user, getCurrentUser: async () => page.user }));

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  page.db = db;
});

afterEach(() => {
  page.user = null;
});

async function teen(name = "Ana", email = "ana@example.com") {
  const res = await registerStudent(
    db,
    { displayName: name, email, password: "correct horse battery", birthDate: "2010-05-01", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parent(email = "rosa@example.com") {
  const res = await registerParent(db, { displayName: "Rosa", email, password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function householdOf(userId: string) {
  const [row] = await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId));
  return row.householdId!;
}

/** Sends an invitation and returns the raw token from the emailed link. */
async function invite(studentId: string, at = now, to = PARENT_EMAIL) {
  const res = await createInvite(db, studentId, to, { appUrl: APP, send, now: at });
  if (!res.ok) throw new Error(res.error);
  const link = /https:\/\/compass\.example\/invite\/(\S+)/.exec(sent.at(-1)!.text);
  return { ...res, token: link![1] };
}

describe("sending an invitation", () => {
  it("emails a link with the student's name and keeps only the token's hash", async () => {
    const studentId = await teen();
    const { token, expiresAt } = await invite(studentId);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("rosa.parent@example.com");
    expect(sent[0].subject).toBe("Ana invited you to College Compass");
    expect(sent[0].text).toContain(`${APP}/invite/${token}`);
    expect(sent[0].text).toContain("stay private");

    const rows = await db.select().from(schema.parentInvites);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_DAYS * DAY);
    expect(rows[0].expiresAt.getTime()).toBe(expiresAt.getTime());

    // The address is nowhere in the database: not in invites, audit entries or rate limits.
    for (const table of [schema.parentInvites, schema.auditLog, schema.rateLimits]) {
      const dump = JSON.stringify(await db.select().from(table)).toLowerCase();
      expect(dump).not.toContain("rosa.parent");
      expect(dump).not.toContain(hashToken("rosa.parent@example.com"));
    }
    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "parent_invite.sent"));
    expect(entry).toMatchObject({ actorUserId: studentId, subjectUserId: studentId, metadata: null });
  });

  it("keeps line breaks in a display name out of the email subject", () => {
    expect(inviteEmail("a@example.com", "Ana\r\nBcc: x@example.com", "https://x").subject).toBe("Ana Bcc: x@example.com invited you to College Compass");
  });

  it("allows at most three waiting invitations; cancelling one makes room", async () => {
    const studentId = await teen();
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite(studentId, now, `p${i}@example.com`);
    const fourth = await createInvite(db, studentId, "p9@example.com", { appUrl: APP, send, now });
    expect(fourth).toEqual({ ok: false, error: "too_many_pending" });
    expect(sent).toHaveLength(MAX_PENDING_INVITES);

    const [first] = await listPendingInvites(db, studentId, now);
    expect(await cancelInvite(db, studentId, first.id)).toBe(true);
    expect((await createInvite(db, studentId, "p9@example.com", { appUrl: APP, send, now })).ok).toBe(true);
  });

  it("expired invitations stop counting as waiting", async () => {
    const studentId = await teen();
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite(studentId, now, `p${i}@example.com`);
    const later = new Date(now.getTime() + (INVITE_TTL_DAYS + 1) * DAY);
    expect(await listPendingInvites(db, studentId, later)).toEqual([]);
    expect((await createInvite(db, studentId, "new@example.com", { appUrl: APP, send, now: later })).ok).toBe(true);
  });

  it("limits sends per day, cancelled ones included, and resets the next day", async () => {
    const studentId = await teen();
    for (let i = 0; i < MAX_INVITE_SENDS_PER_DAY; i++) {
      const { inviteId } = await invite(studentId, now, `p${i}@example.com`);
      await cancelInvite(db, studentId, inviteId);
    }
    const again = await createInvite(db, studentId, "p9@example.com", { appUrl: APP, send, now: new Date(now.getTime() + 60_000) });
    expect(again).toEqual({ ok: false, error: "rate_limited" });
    expect(sent).toHaveLength(MAX_INVITE_SENDS_PER_DAY);

    const tomorrow = new Date(now.getTime() + DAY + 60_000);
    expect((await createInvite(db, studentId, "p9@example.com", { appUrl: APP, send, now: tomorrow })).ok).toBe(true);
  });

  it("refuses students who have a parent, parent-created accounts, parents and the student's own address", async () => {
    const parentId = await parent();
    const consent = await verifyParentConsent({ parentUserId: parentId, attested: true });
    const child = await createChildAccount(
      db,
      parentId,
      { displayName: "Leo", username: "leo12", password: "correct horse battery", birthDate: "2014-03-01", grade: 7 },
      consent,
      now,
    );
    if (!child.ok) throw new Error();
    const teenWithParent = await createChildAccount(
      db,
      parentId,
      { displayName: "Mia", username: "mia15", password: "correct horse battery", birthDate: "2011-01-01", grade: 10 },
      null,
      now,
    );
    if (!teenWithParent.ok) throw new Error();
    const studentId = await teen();

    const attempt = (id: string, to = PARENT_EMAIL) => createInvite(db, id, to, { appUrl: APP, send, now });
    expect(await attempt(child.value.userId)).toEqual({ ok: false, error: "not_eligible" });
    expect(await attempt(teenWithParent.value.userId)).toEqual({ ok: false, error: "has_parent" });
    expect(await attempt(parentId)).toEqual({ ok: false, error: "not_eligible" });
    expect(await attempt(studentId, " ANA@example.com ")).toEqual({ ok: false, error: "own_email" });
    expect(sent).toHaveLength(0);
    expect(await db.select().from(schema.parentInvites)).toHaveLength(0);

    expect(await inviteCardState(db, child.value.userId, now)).toEqual({ eligible: false });
    expect(await inviteCardState(db, teenWithParent.value.userId, now)).toEqual({ eligible: false });
    expect(await inviteCardState(db, studentId, now)).toEqual({ eligible: true, pending: [], canSend: true });
  });

  it("removes the invitation when the email can't be sent", async () => {
    const studentId = await teen();
    const res = await createInvite(db, studentId, PARENT_EMAIL, {
      appUrl: APP,
      now,
      send: async () => {
        throw new Error("provider down for rosa.parent@example.com");
      },
    });
    expect(res).toEqual({ ok: false, error: "send_failed" });
    expect(await db.select().from(schema.parentInvites)).toHaveLength(0);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "parent_invite.sent"))).toHaveLength(0);
  });

  it("lets only the student cancel their own waiting invitations", async () => {
    const studentId = await teen();
    const otherId = await teen("Bo", "bo@example.com");
    const { inviteId, token } = await invite(studentId);
    expect(await cancelInvite(db, otherId, inviteId)).toBe(false);
    expect(await cancelInvite(db, studentId, "not-a-uuid")).toBe(false);
    expect(await cancelInvite(db, studentId, inviteId)).toBe(true);
    expect(await findInvite(db, token, now)).toEqual({ status: "not_found" });
  });

  it("shows waiting invitations on the card and stops offering the form at the limit", async () => {
    const studentId = await teen();
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite(studentId, new Date(now.getTime() + i * 1000), `p${i}@example.com`);
    const state = await inviteCardState(db, studentId, now);
    expect(state.eligible && state.pending).toHaveLength(MAX_PENDING_INVITES);
    expect(state.eligible && state.canSend).toBe(false);
  });
});

describe("opening an invitation link", () => {
  it("finds a waiting invitation by its token and never by its hash", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    expect(await findInvite(db, token, now)).toMatchObject({ status: "pending", studentId, studentName: "Ana" });
    expect(await findInvite(db, hashToken(token), now)).toEqual({ status: "not_found" });
    expect(await findInvite(db, "nope", now)).toEqual({ status: "not_found" });
    expect(await findInvite(db, "x".repeat(500), now)).toEqual({ status: "not_found" });
  });

  it("expires after 14 days", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    const justBefore = new Date(now.getTime() + INVITE_TTL_DAYS * DAY - 1000);
    const after = new Date(now.getTime() + INVITE_TTL_DAYS * DAY);
    expect((await findInvite(db, token, justBefore)).status).toBe("pending");
    expect(await findInvite(db, token, after)).toEqual({ status: "expired" });

    const parentId = await parent();
    expect(await acceptInvite(db, token, parentId, after)).toEqual({ ok: false, error: "expired" });
    expect(await isLinkedParent(db, parentId, studentId)).toBe(false);
  });
});

describe("accepting an invitation", () => {
  it("links a signed-in parent, moves the student into their household and works only once", async () => {
    const studentId = await teen();
    const oldHousehold = await householdOf(studentId);
    const { token } = await invite(studentId);
    const parentId = await parent();

    const res = await acceptInvite(db, token, parentId, now);
    expect(res).toMatchObject({ ok: true, studentId, studentName: "Ana" });
    expect(await isLinkedParent(db, parentId, studentId)).toBe(true);
    expect(await householdOf(studentId)).toBe(await householdOf(parentId));
    expect(await db.select().from(schema.households).where(eq(schema.households.id, oldHousehold))).toHaveLength(0);

    const [row] = await db.select().from(schema.parentInvites);
    expect(row).toMatchObject({ acceptedByUserId: parentId });
    expect(row.acceptedAt?.getTime()).toBe(now.getTime());

    expect(await acceptInvite(db, token, parentId, now)).toEqual({ ok: false, error: "used" });
    expect(await findInvite(db, token, now)).toEqual({ status: "used", studentName: "Ana", acceptedByUserId: parentId });

    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "parent_invite.accepted"));
    expect(entry).toMatchObject({ actorUserId: parentId, subjectUserId: studentId });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/ana|rosa|@/i);
  });

  it("works for a parent who creates their account from the link", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    // The page shows the parent sign-up form; the new account then accepts.
    expect((await findInvite(db, token, now)).status).toBe("pending");
    const newParent = await parent("new.parent@example.com");
    expect((await acceptInvite(db, token, newParent, now)).ok).toBe(true);
    expect(await isLinkedParent(db, newParent, studentId)).toBe(true);
  });

  it("refuses anyone signed in who isn't a parent, and leaves the invitation usable", async () => {
    const studentId = await teen();
    const otherStudent = await teen("Bo", "bo@example.com");
    const { token } = await invite(studentId);
    expect(await acceptInvite(db, token, studentId, now)).toEqual({ ok: false, error: "not_parent" });
    expect(await acceptInvite(db, token, otherStudent, now)).toEqual({ ok: false, error: "not_parent" });
    expect((await findInvite(db, token, now)).status).toBe("pending");
    expect(await db.select().from(schema.parentStudentLinks)).toHaveLength(0);
  });

  it("refuses unknown tokens and a hash passed as a token", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    const parentId = await parent();
    expect(await acceptInvite(db, "made-up", parentId, now)).toEqual({ ok: false, error: "not_found" });
    expect(await acceptInvite(db, hashToken(token), parentId, now)).toEqual({ ok: false, error: "not_found" });
  });

  it("lets only one of two parents accepting at once use the link", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    const [a, b] = [await parent("a@example.com"), await parent("b@example.com")];
    const results = await Promise.all([acceptInvite(db, token, a, now), acceptInvite(db, token, b, now)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(schema.parentStudentLinks)).toHaveLength(1);
  });

  it("cancels the student's other waiting invitations once one is accepted", async () => {
    const studentId = await teen();
    const first = await invite(studentId, now, "mom@example.com");
    const second = await invite(studentId, now, "dad@example.com");
    const mom = await parent("mom@example.com");
    expect((await acceptInvite(db, first.token, mom, now)).ok).toBe(true);
    expect(await findInvite(db, second.token, now)).toEqual({ status: "not_found" });
    expect(await inviteCardState(db, studentId, now)).toEqual({ eligible: false });
  });

  it("refuses a second parent when another is already linked", async () => {
    const studentId = await teen();
    const first = await invite(studentId, now, "mom@example.com");
    // An invitation from before another parent was linked is refused, not merged.
    const mom = await parent("mom@example.com");
    await db.insert(schema.parentStudentLinks).values({ parentUserId: mom, studentUserId: studentId });
    const dad = await parent("dad@example.com");
    expect(await acceptInvite(db, first.token, dad, now)).toEqual({ ok: false, error: "student_has_parent" });
    expect(await isLinkedParent(db, dad, studentId)).toBe(false);
    expect((await findInvite(db, first.token, now)).status).toBe("pending");
  });

  it("is harmless when the parent is already linked (no second link, invitation used)", async () => {
    const studentId = await teen();
    const a = await invite(studentId, now, "mom@example.com");
    const mom = await parent("mom@example.com");
    await db.insert(schema.parentStudentLinks).values({ parentUserId: mom, studentUserId: studentId });
    expect((await acceptInvite(db, a.token, mom, now)).ok).toBe(true);
    expect(await db.select().from(schema.parentStudentLinks)).toHaveLength(1);
  });
});

describe("household merge", () => {
  async function setup() {
    const studentId = await teen();
    const parentId = await parent();
    const { token } = await invite(studentId);
    return { studentId, parentId, token, from: await householdOf(studentId), to: await householdOf(parentId) };
  }

  const grantsIn = (householdId: string) => db.select().from(schema.accessGrants).where(eq(schema.accessGrants.householdId, householdId));
  const billingIn = async (householdId: string) =>
    (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.householdId, householdId)))[0];

  it("moves grants that are still active; ended ones are deleted with the old household", async () => {
    const { studentId, parentId, token, from, to } = await setup();
    await db.insert(schema.accessGrants).values([
      { householdId: from, kind: "trial", startsAt: new Date(now.getTime() - 20 * DAY), endsAt: new Date(now.getTime() - 6 * DAY) },
      { householdId: from, kind: "free_access", grantedByUserId: studentId, endsAt: new Date(now.getTime() + 300 * DAY) },
      { householdId: from, kind: "comp", endsAt: null },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ moved: true, grantsMoved: 2, billing: "none", oldHouseholdDeleted: true });
    expect((await grantsIn(to)).map((g) => g.kind).sort()).toEqual(["comp", "free_access"]);
    expect(await db.select().from(schema.accessGrants)).toHaveLength(2);
  });

  it("moves the billing account when the parent's household has none", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values({ householdId: from, stripeCustomerId: "cus_teen", stripeSubscriptionId: "sub_teen", status: "active", plan: "monthly" });
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "moved", oldHouseholdDeleted: true });
    expect(await billingIn(to)).toMatchObject({ stripeCustomerId: "cus_teen", status: "active" });
  });

  it("keeps the parent's plan and parks the teen's ended one on the old household for cleanup", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", status: "canceled" },
      { householdId: to, stripeCustomerId: "cus_parent", stripeSubscriptionId: "sub_parent", status: "active" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "kept_parent", oldHouseholdDeleted: false });
    expect((await billingIn(to)).stripeCustomerId).toBe("cus_parent");
    // Nobody lives there any more, but the Stripe customer isn't lost.
    expect((await billingIn(from)).stripeCustomerId).toBe("cus_teen");
    expect(await db.select().from(schema.users).where(eq(schema.users.householdId, from))).toHaveLength(0);
  });

  it("swaps in the teen's live plan when the parent's has ended", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", stripeSubscriptionId: "sub_teen", status: "active", plan: "annual" },
      { householdId: to, stripeCustomerId: "cus_parent", status: "incomplete_expired" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "swapped", oldHouseholdDeleted: false });
    expect(await billingIn(to)).toMatchObject({ stripeCustomerId: "cus_teen", plan: "annual" });
    expect(await billingIn(from)).toMatchObject({ stripeCustomerId: "cus_parent" });
  });

  it("refuses, changing nothing, when both households have a plan that renews", async () => {
    const { studentId, parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", stripeSubscriptionId: "sub_teen", status: "active" },
      { householdId: to, stripeCustomerId: "cus_parent", stripeSubscriptionId: "sub_parent", status: "trialing" },
    ]);
    expect(await acceptInvite(db, token, parentId, now)).toEqual({ ok: false, error: "both_subscribed" });
    expect(await householdOf(studentId)).toBe(from);
    expect(await isLinkedParent(db, parentId, studentId)).toBe(false);
    expect((await findInvite(db, token, now)).status).toBe("pending");

    // Once the teen's plan is set to end, the parent's plan wins and the link goes through.
    await db.update(schema.billingAccounts).set({ cancelAtPeriodEnd: true }).where(eq(schema.billingAccounts.householdId, from));
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge.billing).toBe("kept_parent");
    expect(await householdOf(studentId)).toBe(to);
  });

  it("copies grants and leaves billing when others still live in the old household", async () => {
    // A parent set up two teens, then deleted their own account: the teens stay in that household.
    const firstParent = await parent("first@example.com");
    const make = async (username: string) => {
      const res = await createChildAccount(
        db,
        firstParent,
        { displayName: username, username, password: "correct horse battery", birthDate: "2010-01-01", grade: 10 },
        null,
        now,
      );
      if (!res.ok) throw new Error(res.error);
      return res.value.userId;
    };
    const [a, b] = [await make("teen_a"), await make("teen_b")];
    const shared = await householdOf(a);
    await deleteParentAccount(db, firstParent);
    await db.insert(schema.accessGrants).values({ householdId: shared, kind: "free_access", endsAt: new Date(now.getTime() + 100 * DAY) });
    await db.insert(schema.billingAccounts).values({ householdId: shared, stripeCustomerId: "cus_shared", status: "active" });

    const { token } = await invite(a);
    const newParent = await parent();
    const res = await acceptInvite(db, token, newParent, now);
    expect(res.ok && res.merge).toMatchObject({ moved: true, grantsMoved: 0, grantsCopied: 1, billing: "stayed", oldHouseholdDeleted: false });
    expect(await householdOf(a)).toBe(await householdOf(newParent));
    expect(await householdOf(b)).toBe(shared);
    expect(await grantsIn(shared)).toHaveLength(1);
    expect(await grantsIn(await householdOf(newParent))).toHaveLength(1);
    expect((await billingIn(shared)).stripeCustomerId).toBe("cus_shared");
  });

  it("gives a parent without a household a new one", async () => {
    const { studentId, parentId, token, to } = await setup();
    await db.update(schema.users).set({ householdId: null }).where(eq(schema.users.id, parentId));
    await db.delete(schema.households).where(eq(schema.households.id, to));
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok).toBe(true);
    const household = await householdOf(parentId);
    expect(household).toBeTruthy();
    expect(await householdOf(studentId)).toBe(household);
  });
});

describe("invitation data and privacy", () => {
  it("is exported without any address and deleted with the student", async () => {
    const studentId = await teen();
    await invite(studentId);
    const { token } = await invite(studentId, now, "dad@example.com");
    await acceptInvite(db, token, await parent(), now);
    await invite(await teen("Bo", "bo@example.com"));

    const exported = await exportParentInvites(db, studentId, now);
    // The first invitation was cancelled when the second was accepted.
    expect(exported).toEqual([{ createdAt: expect.any(Date), expiresAt: expect.any(Date), acceptedAt: now, status: "accepted" }]);
    expect(JSON.stringify(exported)).not.toMatch(/@|token/i);

    expect(await deleteStudent(db, studentId, studentId)).toBe(true);
    const left = await db.select().from(schema.parentInvites);
    expect(left).toHaveLength(1);
    expect(left[0].studentUserId).not.toBe(studentId);
  });

  it("shows a waiting and an expired invitation in the export", async () => {
    const studentId = await teen();
    await invite(studentId);
    await invite(studentId, new Date(now.getTime() - (INVITE_TTL_DAYS + 2) * DAY), "old@example.com");
    const statuses = (await exportParentInvites(db, studentId, now)).map((r) => r.status);
    expect(statuses).toEqual(["expired", "pending"]);
  });

  it("keeps the accepted record without the parent when the parent deletes their account", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId);
    const parentId = await parent();
    await acceptInvite(db, token, parentId, now);
    await deleteParentAccount(db, parentId);
    const [row] = await db.select().from(schema.parentInvites);
    expect(row.acceptedByUserId).toBeNull();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, studentId)))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pages (server-rendered, with the signed-in user mocked). They use the real clock, so the
// invitations here are sent "now".
// ---------------------------------------------------------------------------

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

async function signIn(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  page.user = { id: u.id, role: u.role, displayName: u.displayName, username: u.username, householdId: u.householdId, parentManaged: u.parentManaged, grade: u.grade };
}

function invitePage(token: string, searchParams: Record<string, string> = {}) {
  return render(InvitePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(searchParams) } as PageProps<"/invite/[token]">));
}

describe("the invitation page", () => {
  it("explains the invitation and offers a parent sign-up that comes back here", async () => {
    const { token } = await invite(await teen(), new Date());
    const html = await invitePage(token);
    expect(text(html)).toContain("Ana invited you to College Compass");
    expect(text(html)).toContain("Conversations with the AI counselor stay private to Ana");
    expect(text(html)).toContain("Export or delete Ana's account");
    expect(html).toContain(`name="next" value="/invite/${token}"`);
    expect(html).toContain(`href="/login?next=${encodeURIComponent(`/invite/${token}`)}"`);
    expect(html).not.toContain("Accept and link");
  });

  it("shows a signed-in parent the Accept button", async () => {
    const { token } = await invite(await teen(), new Date());
    await signIn(await parent());
    const html = await invitePage(token);
    expect(text(html)).toContain("Accept and link");
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).not.toContain('name="password"');
  });

  it("explains a refused double subscription", async () => {
    const { token } = await invite(await teen(), new Date());
    await signIn(await parent());
    expect(text(await invitePage(token, { error: "both_subscribed" }))).toContain("You and Ana each pay for College Compass");
    expect(text(await invitePage(token, { error: "made-up" }))).not.toContain("each pay");
  });

  it("asks anyone else to sign out, and offers nothing to accept", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId, new Date());
    await signIn(studentId);
    const html = await invitePage(token);
    expect(text(html)).toContain("This invitation is for a parent or guardian");
    expect(text(html)).toContain("You're signed in as Ana, a student account");
    expect(text(html)).toContain("Sign out");
    expect(html).not.toContain("Accept and link");
  });

  it("tells a linked parent they're already linked", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId, new Date());
    const parentId = await parent();
    await signIn(parentId);
    expect((await acceptInvite(db, token, parentId)).ok).toBe(true);
    expect(text(await invitePage(token))).toContain("You're already linked");
    await signIn(await parent("other@example.com"));
    expect(text(await invitePage(token))).toContain("This invitation was already used");
  });

  it("is friendly about expired and unknown links", async () => {
    const { token } = await invite(await teen(), new Date(Date.now() - (INVITE_TTL_DAYS + 1) * DAY));
    expect(text(await invitePage(token))).toContain("This invitation has expired");
    expect(text(await invitePage("not-a-real-token"))).toContain("We couldn't find this invitation");
  });
});

describe("the invite card", () => {
  it("offers the form to a teen with no parent", async () => {
    await signIn(await teen());
    const html = await render(InviteParentCard());
    expect(text(html)).toContain("Invite a parent or guardian");
    expect(text(html)).toContain("They can't read your chats with the AI counselor");
    expect(html).toContain('name="parentEmail"');
  });

  it("lists invitations sent, each with Cancel, and hides the form at the limit", async () => {
    const studentId = await teen();
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite(studentId, new Date(), `p${i}@example.com`);
    await signIn(studentId);
    const html = await render(InviteParentCard());
    expect(text(html)).toContain("Invitations sent");
    expect(html.match(/name="inviteId"/g)).toHaveLength(MAX_PENDING_INVITES);
    expect(html).not.toContain('name="parentEmail"');
    expect(text(html)).toContain("Cancel one to send another");
  });

  it("renders nothing once a parent is linked", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId, new Date());
    await acceptInvite(db, token, await parent());
    await signIn(studentId);
    expect(await render(InviteParentCard())).toBe("");
  });
});
