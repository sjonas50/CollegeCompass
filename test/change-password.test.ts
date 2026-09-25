import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeMyPasswordAction } from "@/app/actions/settings";
import DashboardPage from "@/app/dashboard/page";
import { type Db, createTestDb, schema } from "@/db";
import { authenticate, createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { CHANGE_PASSWORD_LIMIT, changeOwnPassword } from "@/lib/auth/change-password";
import { type SessionUser, createSession, validateSession } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";

// A teen who owns their account changes its password from Settings. Every other device is signed out.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null, cookies: [] as string[] }));

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
vi.mock("@/lib/auth/cookies", async (original) => ({
  ...(await original<typeof import("@/lib/auth/cookies")>()),
  setSessionCookie: async (token: string) => void state.cookies.push(token),
}));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async (roles?: string[]) => {
    const user = state.user;
    if (!user) throw new Redirect("/login");
    if (roles && !roles.includes(user.role)) throw new Redirect("/");
    return user;
  },
  getCurrentUser: async () => state.user,
}));
vi.mock("@/components/weekly-steps", () => ({ WeeklyStepsCard: () => null }));
vi.mock("@/components/invite-parent", () => ({ InviteParentCard: () => null }));

const now = new Date("2026-09-24T15:00:00Z");
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.cookies = [];
});
afterEach(() => {
  state.user = null;
});

async function teen() {
  const res = await registerStudent(db, { displayName: "Ana", email: "ana@example.com", password: PASSWORD, birthDate: "2010-05-01", grade: 10 }, now);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function childUnder13() {
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: PASSWORD });
  if (!parent.ok) throw new Error(parent.error);
  const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
  const res = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Leo", username: "leo12", password: PASSWORD, birthDate: "2014-03-01", grade: 7 },
    consent,
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function signIn(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  state.user = { id: u.id, role: u.role, displayName: u.displayName, username: u.username, householdId: u.householdId, parentManaged: u.parentManaged, grade: u.grade };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const fields = (current = PASSWORD, next = NEW_PASSWORD, again = next) => form({ currentPassword: current, newPassword: next, confirmPassword: again });

async function redirectOf(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Redirect)) throw err ?? new Error("did not redirect");
  return err.url;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const dashboard = async () =>
  text(renderToStaticMarkup((await DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/dashboard">)) as ReactNode));

describe("changeOwnPassword", () => {
  it("changes the password and signs out every device", async () => {
    const ana = await teen();
    const laptop = await createSession(db, ana);
    expect(await changeOwnPassword(db, ana, { current: PASSWORD, next: NEW_PASSWORD }, now)).toEqual({ ok: true });
    expect(await validateSession(db, laptop.token)).toBeNull();
    expect(await authenticate(db, { identifier: "ana@example.com", password: PASSWORD })).toBeNull();
    expect(await authenticate(db, { identifier: "ana@example.com", password: NEW_PASSWORD })).toEqual({ userId: ana });
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "account.password_changed"));
    expect(audits).toEqual([expect.objectContaining({ actorUserId: ana, subjectUserId: null, metadata: null })]);
  });

  it("refuses a wrong or unchanged password, one that's too short, and a child a parent set up under 13", async () => {
    const ana = await teen();
    expect(await changeOwnPassword(db, ana, { current: "not my password", next: NEW_PASSWORD }, now)).toEqual({ ok: false, error: "wrong_password" });
    expect(await changeOwnPassword(db, ana, { current: PASSWORD, next: PASSWORD }, now)).toEqual({ ok: false, error: "same_password" });
    expect(await changeOwnPassword(db, ana, { current: PASSWORD, next: "short" }, now)).toEqual({ ok: false, error: "invalid_password" });
    const leo = await childUnder13();
    expect(await changeOwnPassword(db, leo, { current: PASSWORD, next: NEW_PASSWORD }, now)).toEqual({ ok: false, error: "parent_managed" });
    expect(await changeOwnPassword(db, "not-a-uuid", { current: PASSWORD, next: NEW_PASSWORD }, now)).toEqual({ ok: false, error: "not_found" });
    expect(await authenticate(db, { identifier: "ana@example.com", password: PASSWORD })).toEqual({ userId: ana });
    expect(await authenticate(db, { identifier: "leo12", password: PASSWORD })).toMatchObject({ userId: leo });
  });

  it("limits tries, like deleting an account", async () => {
    const ana = await teen();
    for (let i = 0; i < CHANGE_PASSWORD_LIMIT.count; i++) {
      expect(await changeOwnPassword(db, ana, { current: `guess number ${i}`, next: NEW_PASSWORD }, now)).toEqual({ ok: false, error: "wrong_password" });
    }
    expect(await changeOwnPassword(db, ana, { current: PASSWORD, next: NEW_PASSWORD }, now)).toEqual({ ok: false, error: "rate_limited" });
    const later = new Date(now.getTime() + CHANGE_PASSWORD_LIMIT.windowMs + 1);
    expect(await changeOwnPassword(db, ana, { current: PASSWORD, next: NEW_PASSWORD }, later)).toEqual({ ok: true });
  });
});

describe("changing the password in Settings", () => {
  it("is offered to a teen who owns their account, not to a child a parent set up under 13", async () => {
    await signIn(await teen());
    const html = await dashboard();
    expect(html).toContain("Change your password Changing it signs you out on every other device.");
    expect(html).toContain("New password At least 10 characters. Pick one you'll remember. If you forget it, we can't reset it for you.");

    await signIn(await childUnder13());
    expect(await dashboard()).not.toContain("Change your password");
  });

  it("the action saves it, keeps this device signed in and says so", async () => {
    const ana = await teen();
    const old = await createSession(db, ana);
    await signIn(ana);
    expect(await redirectOf(changeMyPasswordAction(undefined, fields()))).toBe("/dashboard?settings=password");
    expect(await validateSession(db, old.token)).toBeNull();
    expect(state.cookies).toHaveLength(1);
    expect((await validateSession(db, state.cookies[0]))?.user.id).toBe(ana);

    const html = text(
      renderToStaticMarkup(
        (await DashboardPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ settings: "password" }) } as PageProps<"/dashboard">)) as ReactNode,
      ),
    );
    expect(html).toContain("Your new password is set. We signed you out on every other device.");
  });

  it("the action says what to fix, and changes nothing", async () => {
    const ana = await teen();
    await signIn(ana);
    expect(await changeMyPasswordAction(undefined, fields("", NEW_PASSWORD))).toMatchObject({ errors: { currentPassword: ["Enter your password."] } });
    expect(await changeMyPasswordAction(undefined, fields(PASSWORD, NEW_PASSWORD, "something else entirely"))).toEqual({
      errors: { confirmPassword: ["The two new passwords don't match."] },
    });
    expect(await changeMyPasswordAction(undefined, fields(PASSWORD, PASSWORD))).toEqual({
      errors: { newPassword: ["Choose a password that's different from the one you have now."] },
    });
    expect(await changeMyPasswordAction(undefined, fields("not my password", NEW_PASSWORD))).toEqual({
      errors: { currentPassword: ["That password isn't right."] },
    });

    await signIn(await childUnder13());
    expect(await changeMyPasswordAction(undefined, fields())).toEqual({
      message: "Your parent or guardian set up your account and manages it, so you can't change its password here.",
    });
    expect(state.cookies).toEqual([]);
    expect(await authenticate(db, { identifier: "ana@example.com", password: PASSWORD })).toEqual({ userId: ana });
  });
});
