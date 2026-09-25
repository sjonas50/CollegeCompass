import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelParentInviteAction } from "@/app/actions/invites";
import InvitePage from "@/app/invite/[token]/page";
import { inviteAction, inviteNotice } from "@/app/invite/invite-parent-form";
import { InviteParentCard } from "@/components/invite-parent";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { createChildAccount, isLinkedParent, registerParent, registerStudent } from "@/lib/accounts";
import { openBillingPortal, startCheckout } from "@/lib/billing/checkout";
import { type FakeStripeRequest, fakeStripe } from "@/lib/billing/fake-stripe";
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
import { deleteEmptyHousehold, deleteParentAccount, deleteStudent } from "@/lib/privacy";

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
vi.mock("next/cache", () => ({ refresh: () => {} }));

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  page.db = db;
});

afterEach(() => {
  page.user = null;
  vi.unstubAllEnvs();
  resetEnvCache();
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
    expect(sent[0].subject).toBe("A student invited you to College Compass");
    expect(sent[0].text).toContain("Ana uses College Compass");
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

  it("keeps line breaks in a display name out of the email", () => {
    const email = inviteEmail("a@example.com", "Ana\r\nBcc: x@example.com", "https://x");
    expect(email.subject).toBe("A student invited you to College Compass");
    expect(email.text).not.toContain("Bcc");
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

  it("carries a teen's running trial into the parent's household", async () => {
    const { parentId, token, from, to } = await setup();
    const trial = (await grantsIn(from)).find((g) => g.kind === "trial");
    expect(trial).toBeTruthy();
    await acceptInvite(db, token, parentId, now);
    expect((await grantsIn(to)).map((g) => g.id)).toContain(trial!.id);
  });

  it("moves grants that are still active; ended ones are deleted with the old household", async () => {
    const { studentId, parentId, token, from, to } = await setup();
    // Only the grants below (not the trials registration created).
    await db.delete(schema.accessGrants);
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

  /** Stripe that makes customers and Checkout sessions, sets plans to end and deletes customers. */
  function stripeAccount() {
    let customers = 0;
    return fakeStripe((req: FakeStripeRequest) => {
      if (req.method === "POST" && req.path === "/v1/customers") return { body: { id: `cus_${++customers}`, object: "customer" } };
      if (req.method === "POST" && req.path === "/v1/checkout/sessions") {
        return { body: { id: "cs_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_1" } };
      }
      const sub = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(req.path);
      if (req.method === "POST" && sub) return { body: { id: sub[1], object: "subscription", status: "active", cancel_at_period_end: true } };
      if (req.method === "DELETE" && req.path.startsWith("/v1/customers/")) {
        return { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } };
      }
      return undefined;
    });
  }
  const calls = (requests: FakeStripeRequest[]) => requests.map((r) => `${r.method} ${r.path}`);

  it("never hands a parent's Stripe customer to the next parent who links the teen", async () => {
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
    vi.stubEnv("APP_URL", APP);
    resetEnvCache();
    const { stripe, requests } = stripeAccount();

    // Ana links Rosa, and Rosa pays.
    const ana = await teen();
    const rosa = await parent();
    const first = await invite(ana);
    expect((await acceptInvite(db, first.token, rosa, now)).ok).toBe(true);
    expect(await startCheckout(db, stripe, rosa, "monthly")).toMatchObject({ ok: true });
    const paidUntil = new Date(now.getTime() + 20 * DAY);
    // What the webhook records once Rosa finishes Checkout.
    await db.update(schema.billingAccounts).set({ stripeSubscriptionId: "sub_rosa", status: "active", plan: "monthly", currentPeriodEnd: paidUntil });

    // Rosa deletes her account. Ana stays, and the plan ends with the period Rosa paid for.
    await deleteParentAccount(db, rosa, { stripe });
    const oldHousehold = await householdOf(ana);
    expect(await billingIn(oldHousehold)).toMatchObject({ stripeCustomerId: "cus_1", payerUserId: null, cancelAtPeriodEnd: true });

    // Ana invites Sam, who accepts.
    const sam = await parent("sam@example.com");
    const second = await invite(ana, now, "sam@example.com");
    const res = await acceptInvite(db, second.token, sam, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "parked", paidUntil, parkedHouseholdId: oldHousehold, oldHouseholdDeleted: false });
    const samHousehold = await householdOf(sam);
    expect(await householdOf(ana)).toBe(samHousehold);
    expect(await billingIn(samHousehold)).toBeUndefined();
    // Ana keeps the time Rosa already paid for.
    expect(await grantsIn(samHousehold)).toContainEqual(expect.objectContaining({ kind: "comp", endsAt: paidUntil }));

    // Sam never reaches Rosa's card or receipts, and his own Checkout gets his own customer.
    expect(await openBillingPortal(db, stripe, sam)).toEqual({ ok: false, error: "no_customer" });
    expect(await startCheckout(db, stripe, sam, "monthly")).toMatchObject({ ok: true });
    expect(requests.filter((r) => r.path === "/v1/checkout/sessions").map((r) => r.form.get("customer"))).toEqual(["cus_1", "cus_2"]);
    expect(await billingIn(samHousehold)).toMatchObject({ stripeCustomerId: "cus_2", payerUserId: sam });

    // The accept action then closes the old household, which deletes Rosa's customer.
    expect(await deleteEmptyHousehold(db, oldHousehold, { stripe })).toBe(true);
    expect(calls(requests)).toContain("DELETE /v1/customers/cus_1");
    expect(calls(requests)).not.toContain("DELETE /v1/customers/cus_2");
  });

  it("moves a billing account only when the accepting parent is the one who pays through it", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values({
      householdId: from,
      stripeCustomerId: "cus_own",
      payerUserId: parentId,
      stripeSubscriptionId: "sub_own",
      status: "active",
      plan: "monthly",
      currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
    });
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "moved", oldHouseholdDeleted: true });
    expect(res.ok && res.merge.paidUntil).toBeUndefined();
    expect(await billingIn(to)).toMatchObject({ stripeCustomerId: "cus_own", status: "active" });
  });

  it("keeps the parent's plan and parks the teen's ended one on the old household for cleanup", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", status: "canceled" },
      { householdId: to, stripeCustomerId: "cus_parent", payerUserId: parentId, stripeSubscriptionId: "sub_parent", status: "active" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "parked", oldHouseholdDeleted: false });
    expect(res.ok && res.merge.paidUntil).toBeUndefined();
    expect((await billingIn(to)).stripeCustomerId).toBe("cus_parent");
    // Nobody lives there any more, but the Stripe customer isn't lost.
    expect((await billingIn(from)).stripeCustomerId).toBe("cus_teen");
    expect(await db.select().from(schema.users).where(eq(schema.users.householdId, from))).toHaveLength(0);
    // The accept action hands it to the household cleanup, which closes the Stripe customer.
    expect(res.ok && res.merge.parkedHouseholdId).toBe(from);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteEmptyHousehold(db, from, { stripe: null })).toBe(true);
    expect(await billingIn(from)).toBeUndefined();
    errors.mockRestore();
  });

  it("leaves someone else's live plan behind even when the parent has none going, carrying its paid time", async () => {
    const { studentId, parentId, token, from, to } = await setup();
    const paidUntil = new Date(now.getTime() + 200 * DAY);
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", stripeSubscriptionId: "sub_teen", status: "active", plan: "annual", currentPeriodEnd: paidUntil },
      { householdId: to, stripeCustomerId: "cus_parent", payerUserId: parentId, status: "incomplete_expired" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "parked", paidUntil, parkedHouseholdId: from });
    expect(await billingIn(to)).toMatchObject({ stripeCustomerId: "cus_parent" });
    expect(await billingIn(from)).toMatchObject({ stripeCustomerId: "cus_teen" });
    expect(await grantsIn(to)).toContainEqual(expect.objectContaining({ kind: "comp", startsAt: now, endsAt: paidUntil, grantedByUserId: null }));
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "parent_invite.accepted");
    expect(audit?.metadata).toMatchObject({ billing: "parked", paidTimeCarried: true });
    expect(await householdOf(studentId)).toBe(to);
  });

  it("swaps plans only between two of the accepting parent's own accounts", async () => {
    const { parentId, token, from, to } = await setup();
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_live", payerUserId: parentId, stripeSubscriptionId: "sub_live", status: "active", plan: "annual" },
      { householdId: to, stripeCustomerId: "cus_old", payerUserId: parentId, status: "incomplete_expired" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "swapped", parkedHouseholdId: from });
    expect(await billingIn(to)).toMatchObject({ stripeCustomerId: "cus_live", plan: "annual" });
    expect(await billingIn(from)).toMatchObject({ stripeCustomerId: "cus_old" });
  });

  it("links even when both households have a plan that renews: the teen's old one is left behind and ended", async () => {
    // The plan of a parent who deleted their account, still renewing because Stripe couldn't be
    // reached then. Nobody can manage it (teens can't reach billing), so it never blocks linking.
    const { studentId, parentId, token, from, to } = await setup();
    const paidUntil = new Date(now.getTime() + 10 * DAY);
    await db.insert(schema.billingAccounts).values([
      { householdId: from, stripeCustomerId: "cus_teen", stripeSubscriptionId: "sub_teen", status: "active", currentPeriodEnd: paidUntil },
      { householdId: to, stripeCustomerId: "cus_parent", payerUserId: parentId, stripeSubscriptionId: "sub_parent", status: "trialing" },
    ]);
    const res = await acceptInvite(db, token, parentId, now);
    expect(res.ok && res.merge).toMatchObject({ billing: "parked", paidUntil, parkedHouseholdId: from });
    expect(await householdOf(studentId)).toBe(to);
    expect(await isLinkedParent(db, parentId, studentId)).toBe(true);
    expect((await billingIn(to)).stripeCustomerId).toBe("cus_parent");

    // The accept action closes the old household: deleting its customer ends that plan.
    const { stripe, requests } = stripeAccount();
    expect(await deleteEmptyHousehold(db, from, { stripe })).toBe(true);
    expect(calls(requests)).toEqual(["DELETE /v1/customers/cus_teen"]);
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
    await db.delete(schema.accessGrants);
    await db.insert(schema.accessGrants).values({ householdId: shared, kind: "free_access", endsAt: new Date(now.getTime() + 100 * DAY) });
    await db.insert(schema.billingAccounts).values({ householdId: shared, stripeCustomerId: "cus_shared", status: "active" });

    const { token } = await invite(a);
    const newParent = await parent();
    const res = await acceptInvite(db, token, newParent, now);
    expect(res.ok && res.merge).toMatchObject({ moved: true, grantsMoved: 0, grantsCopied: 1, billing: "stayed", oldHouseholdDeleted: false });
    expect(await householdOf(a)).toBe(await householdOf(newParent));
    expect(await householdOf(b)).toBe(shared);
    expect(await grantsIn(shared)).toHaveLength(1);
    // The new parent's own trial, plus the copied free access.
    expect((await grantsIn(await householdOf(newParent))).map((g) => g.kind).sort()).toEqual(["free_access", "trial"]);
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
    expect(text(html)).toContain("Download a copy of Ana's data, or delete Ana's account");
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

  it("shows nothing extra for an unknown error code", async () => {
    const { token } = await invite(await teen(), new Date());
    await signIn(await parent());
    expect(text(await invitePage(token, { error: "made-up" }))).not.toContain("already linked");
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
    expect(html.match(/<button type="button"[^>]*>Cancel<span class="sr-only"> the invitation sent/g)).toHaveLength(MAX_PENDING_INVITES);
    // Cancel asks first: nothing on the card posts an invitation id until the student confirms.
    expect(html).not.toContain('name="inviteId"');
    expect(html).not.toContain('name="parentEmail"');
    expect(text(html)).toContain("Cancel one to send another");
    // After a cancel takes its row away, focus goes to the list's heading (or the status line).
    expect(html).toMatch(/<h3 id="invites-waiting" tabindex="-1"[^>]*>Invitations sent<\/h3>/);
    expect(html).toMatch(/<div tabindex="-1"[^>]*><div aria-live="polite"><\/div><\/div>/);
  });

  it("sends a cancel form to cancelParentInviteAction and the email form to sendParentInviteAction", async () => {
    const studentId = await teen();
    const { inviteId, token } = await invite(studentId, new Date());
    await signIn(studentId);
    const cancel = new FormData();
    cancel.set("inviteId", inviteId);
    expect(await inviteAction(undefined, cancel)).toEqual({ cancelled: true });
    expect(await findInvite(db, token)).toEqual({ status: "not_found" });

    const send = new FormData();
    send.set("parentEmail", "not an email");
    expect(await inviteAction({ cancelled: true }, send)).toMatchObject({ errors: { parentEmail: [expect.any(String)] } });
  });

  it("confirms a cancellation in place of the sent notice, and never twice", async () => {
    const studentId = await teen();
    const { inviteId, token } = await invite(studentId, new Date());
    await signIn(studentId);
    const form = new FormData();
    form.set("inviteId", inviteId);
    // The card had just sent an invitation; the cancel shares its state, so that notice goes.
    const sentState = { sent: true } as const;
    expect(inviteNotice(sentState)).toBe("Invitation sent. Ask them to check their email, including the spam folder.");
    const cancelled = await cancelParentInviteAction(sentState, form);
    expect(cancelled).toEqual({ cancelled: true });
    expect(inviteNotice(cancelled)).toBe("Invitation cancelled. The link in that email won't work anymore.");
    expect(await findInvite(db, token)).toEqual({ status: "not_found" });

    // From a second tab: nothing left to cancel, so no success notice.
    const again = await cancelParentInviteAction(cancelled, form);
    expect(again).toEqual({ message: "That invitation was already used or cancelled." });
    expect(inviteNotice(again)).toBeNull();
  });

  it("renders nothing once a parent is linked", async () => {
    const studentId = await teen();
    const { token } = await invite(studentId, new Date());
    await acceptInvite(db, token, await parent());
    await signIn(studentId);
    expect(await render(InviteParentCard())).toBe("");
  });
});
