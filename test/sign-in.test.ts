import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "@/app/actions/auth";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { createAdminUser } from "@/lib/admin/create-admin";
import { LOGIN_LIMITS, beginSignIn, signInSucceeded } from "@/lib/auth/login-limit";
import { ADMIN_SESSION_TTL_MS, FIXED_SESSION_PREFIX, validateSession } from "@/lib/auth/sessions";
import { proxy } from "@/proxy";

// Signing in, driven through the real action with the database, cookies and client IP mocked.

const state = vi.hoisted(() => ({
  db: null as unknown,
  ip: "hashed-203.0.113.9",
  jar: new Map<string, { value: string; maxAge?: number }>(),
}));
const { Redirect } = vi.hoisted(() => ({
  Redirect: class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => void state.jar.set(name, { value, maxAge: options.maxAge }),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "203.0.113.9", clientIpKey: async () => state.ip }));

const PASSWORD = "correct horse battery";
const TOO_MANY = { message: "Too many sign-in attempts. Please wait 15 minutes and try again." };
const NO_MATCH = { message: "That email/username and password don't match." };
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.ip = "hashed-203.0.113.9";
  state.jar.clear();
});

async function teen(email = "ana@example.com") {
  const res = await registerStudent(db, { displayName: "Ana", email, password: PASSWORD, birthDate: "2010-05-01", grade: 10 });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

/** Submits the sign-in form; a redirect means the sign-in worked. */
async function signIn(identifier: string, password = PASSWORD) {
  const form = new FormData();
  form.set("identifier", identifier);
  form.set("password", password);
  return loginAction(undefined, form).then(
    (value) => value,
    (e: unknown) => {
      if (e instanceof Redirect) return { redirect: e.url };
      throw e;
    },
  );
}

describe("sign-in limits", () => {
  it("lets a family sign in and out as often as they like: correct sign-ins never count", async () => {
    await teen();
    for (let i = 0; i < LOGIN_LIMITS.account + 5; i++) {
      expect(await signIn("Ana@Example.com")).toEqual({ redirect: "/dashboard" });
    }
  });

  it("counts wrong passwords, and once over the limit refuses even the right one", async () => {
    await teen();
    for (let i = 0; i < LOGIN_LIMITS.account - 1; i++) expect(await signIn("ana@example.com", "wrong password")).toEqual(NO_MATCH);
    // A correct sign-in in between neither counts nor wipes the wrong ones.
    expect(await signIn("ana@example.com")).toEqual({ redirect: "/dashboard" });
    expect(await signIn("ana@example.com", "wrong password")).toEqual(NO_MATCH);
    expect(await signIn("ana@example.com")).toEqual(TOO_MANY);
    // Other accounts are unaffected.
    await teen("bo@example.com");
    expect(await signIn("bo@example.com")).toEqual({ redirect: "/dashboard" });
  });

  it("opens again once the 15 minutes have passed", async () => {
    const t0 = new Date("2026-09-24T12:00:00Z");
    for (let i = 0; i < LOGIN_LIMITS.account; i++) expect(await beginSignIn(db, "ana@example.com", "ip", t0)).toBe(true);
    expect(await beginSignIn(db, "ana@example.com", "ip", t0)).toBe(false);
    expect(await beginSignIn(db, "ana@example.com", "ip", new Date(t0.getTime() + LOGIN_LIMITS.windowMs + 1000))).toBe(true);
  });

  it("gives back only the attempt of a correct password", async () => {
    const t0 = new Date("2026-09-24T12:00:00Z");
    for (let i = 0; i < 3 * LOGIN_LIMITS.account; i++) {
      expect(await beginSignIn(db, "ana@example.com", "ip", t0)).toBe(true);
      await signInSucceeded(db, "ana@example.com");
    }
  });

  it("keeps the per-network limit, correct passwords included", async () => {
    await teen();
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) await beginSignIn(db, `someone${i}@example.com`, state.ip);
    expect(await signIn("ana@example.com")).toEqual(TOO_MANY);
    state.ip = "hashed-198.51.100.7";
    expect(await signIn("ana@example.com")).toEqual({ redirect: "/dashboard" });
  });
});

describe("the session cookie", () => {
  it("lasts 30 days for families, and the proxy renews it", async () => {
    await teen();
    await signIn("ana@example.com");
    const cookie = state.jar.get("cc_session")!;
    expect(cookie.maxAge).toBe(30 * 24 * 60 * 60);
    expect(cookie.value.startsWith(FIXED_SESSION_PREFIX)).toBe(false);

    const res = proxy(new NextRequest("http://localhost/dashboard", { headers: { cookie: `cc_session=${cookie.value}` } }));
    expect(res.cookies.get("cc_session")?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("ends with a staff session's 12 hours, and the proxy never extends it", async () => {
    const admin = await createAdminUser(db, { email: "staff@example.org", displayName: "Staff", password: "a-very-long-staff-password" });
    if (!admin.ok) throw new Error(admin.error);
    expect(await signIn("staff@example.org", "a-very-long-staff-password")).toEqual({ redirect: "/admin" });
    const cookie = state.jar.get("cc_session")!;
    expect(cookie.value.startsWith(FIXED_SESSION_PREFIX)).toBe(true);
    expect(Math.abs(cookie.maxAge! - ADMIN_SESSION_TTL_MS / 1000)).toBeLessThanOrEqual(5);
    expect((await validateSession(db, cookie.value))?.user.role).toBe("admin");

    for (const path of ["/admin", "/", "/careers"]) {
      const res = proxy(new NextRequest(`http://localhost${path}`, { headers: { cookie: `cc_session=${cookie.value}` } }));
      expect(res.cookies.get("cc_session")).toBeUndefined();
    }
  });
});
