import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeleteMyAccountPage from "@/app/account/delete/page";
import { deleteMyAccountAction } from "@/app/actions/settings";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { createSession } from "@/lib/auth/sessions";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { DELETE_OWN_ACCOUNT_LIMIT, deleteOwnStudentAccount } from "@/lib/privacy";

// A teen deleting their own account: the rules in deleteOwnStudentAccount, then the page and action.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null, cleared: 0 }));

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
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/cookies", async (original) => ({
  ...(await original<typeof import("@/lib/auth/cookies")>()),
  clearSessionCookie: async () => void state.cleared++,
}));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async (roles?: string[]) => {
    const user = state.user;
    if (!user) throw new Redirect("/login");
    if (roles && !roles.includes(user.role)) throw new Redirect("/");
    return user;
  },
}));

const PASSWORD = "correct horse battery";
// A fixed day, so the under-13 child stays under 13 (as in coppa-flow.test.ts).
const today = new Date("2026-09-23T12:00:00Z");
const TWELVE_YEAR_OLD = "2014-03-01";
const FIFTEEN_YEAR_OLD = "2011-01-15";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.cleared = 0;
});
afterEach(() => {
  state.user = null;
});

async function soloTeen() {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: PASSWORD, birthDate: FIFTEEN_YEAR_OLD, grade: 10 },
    today,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parentWith(birthDate: string) {
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: PASSWORD });
  if (!parent.ok) throw new Error(parent.error);
  const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
  const child = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Leo", username: "leo1", password: PASSWORD, birthDate, grade: birthDate === TWELVE_YEAR_OLD ? 7 : 9 },
    consent,
    today,
  );
  if (!child.ok) throw new Error(child.error);
  return { parentId: parent.value.userId, childId: child.value.userId };
}

async function userRow(id: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return row;
}

async function signIn(id: string) {
  const u = await userRow(id);
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

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

describe("deleteOwnStudentAccount", () => {
  it("deletes a teen who signed up alone, with their household and sessions", async () => {
    const ana = await soloTeen();
    const { householdId } = await userRow(ana);
    await createSession(db, ana);

    expect(await deleteOwnStudentAccount(db, ana, PASSWORD, { stripe: null })).toEqual({ ok: true });
    expect(await userRow(ana)).toBeUndefined();
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
    expect(await db.select().from(schema.households).where(eq(schema.households.id, householdId!))).toHaveLength(0);
    // Audited without an actor: the student deleted their own account.
    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "student.deleted"));
    expect(entry).toMatchObject({ actorUserId: null, subjectUserId: null });
  });

  it("deletes a teen a parent set up at 13 or older, leaving the parent and their household", async () => {
    const { parentId, childId } = await parentWith(FIFTEEN_YEAR_OLD);
    expect((await userRow(childId)).parentManaged).toBe(false);

    expect(await deleteOwnStudentAccount(db, childId, PASSWORD, { stripe: null })).toEqual({ ok: true });
    expect(await userRow(childId)).toBeUndefined();
    const parent = await userRow(parentId);
    expect(parent).toBeDefined();
    expect(await db.select().from(schema.households).where(eq(schema.households.id, parent.householdId!))).toHaveLength(1);
    expect(await db.select().from(schema.parentStudentLinks)).toHaveLength(0);
  });

  it("refuses a child a parent set up under 13: the parent deletes it", async () => {
    const { childId } = await parentWith(TWELVE_YEAR_OLD);
    expect(await deleteOwnStudentAccount(db, childId, PASSWORD, { stripe: null })).toEqual({ ok: false, error: "parent_managed" });
    expect(await userRow(childId)).toBeDefined();
  });

  it("refuses a parent account", async () => {
    const { parentId } = await parentWith(FIFTEEN_YEAR_OLD);
    expect(await deleteOwnStudentAccount(db, parentId, PASSWORD, { stripe: null })).toEqual({ ok: false, error: "not_found" });
    expect(await userRow(parentId)).toBeDefined();
  });

  it("needs the right password, and limits tries", async () => {
    const ana = await soloTeen();
    const now = new Date("2026-09-24T12:00:00Z");
    expect(await deleteOwnStudentAccount(db, ana, "wrong password!", { stripe: null, now })).toEqual({ ok: false, error: "wrong_password" });
    for (let i = 1; i < DELETE_OWN_ACCOUNT_LIMIT.count; i++) await deleteOwnStudentAccount(db, ana, "wrong password!", { stripe: null, now });
    // Out of tries: even the right password waits for the window to pass.
    expect(await deleteOwnStudentAccount(db, ana, PASSWORD, { stripe: null, now })).toEqual({ ok: false, error: "rate_limited" });
    expect(await userRow(ana)).toBeDefined();

    const later = new Date(now.getTime() + DELETE_OWN_ACCOUNT_LIMIT.windowMs + 1);
    expect(await deleteOwnStudentAccount(db, ana, PASSWORD, { stripe: null, now: later })).toEqual({ ok: true });
  });
});

describe("/account/delete", () => {
  it("shows a teen what goes, a download first, and asks for their password", async () => {
    const ana = await soloTeen();
    await signIn(ana);
    const html = await render(DeleteMyAccountPage());
    const t = text(html);
    expect(t).toContain("Delete your account?");
    expect(t).toContain("It can't be undone.");
    expect(html).toContain(`href="/api/parent/children/${ana}/export"`);
    expect(html).toContain('type="password"');
    expect(t).toContain("Delete my account permanently");
  });

  it("sends a child a parent set up under 13 to that parent, with no form", async () => {
    const { childId } = await parentWith(TWELVE_YEAR_OLD);
    await signIn(childId);
    const html = await render(DeleteMyAccountPage());
    expect(text(html)).toContain("they're the one who can delete it");
    expect(html).not.toContain('type="password"');
  });

  it("sends a parent to the parent account deletion page", async () => {
    const { parentId } = await parentWith(FIFTEEN_YEAR_OLD);
    await signIn(parentId);
    expect(await redirectOf(Promise.resolve().then(() => DeleteMyAccountPage()))).toBe("/parent/delete");
  });
});

describe("deleteMyAccountAction", () => {
  it("keeps the account on a missing or wrong password", async () => {
    const ana = await soloTeen();
    await signIn(ana);
    expect(await deleteMyAccountAction(undefined, form({}))).toEqual({ errors: { password: ["Enter your password."] } });
    expect(await deleteMyAccountAction(undefined, form({ password: "wrong password!" }))).toEqual({
      errors: { password: ["That password isn't right."] },
    });
    expect(await userRow(ana)).toBeDefined();
    expect(state.cleared).toBe(0);
  });

  it("deletes the account, signs out and says so on the home page", async () => {
    const ana = await soloTeen();
    await signIn(ana);
    expect(await redirectOf(deleteMyAccountAction(undefined, form({ password: PASSWORD })))).toBe("/?account-deleted=1");
    expect(await userRow(ana)).toBeUndefined();
    expect(state.cleared).toBe(1);
  });

  it("tells a child a parent set up under 13 to ask that parent", async () => {
    const { childId } = await parentWith(TWELVE_YEAR_OLD);
    await signIn(childId);
    expect(await deleteMyAccountAction(undefined, form({ password: PASSWORD }))).toEqual({
      message: "Your parent or guardian set up this account, so they can delete it from their parent page.",
    });
    expect(await userRow(childId)).toBeDefined();
  });
});
