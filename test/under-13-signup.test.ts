import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAgeAction, requestParentConsentAction } from "@/app/actions/auth";
import { createChildAction } from "@/app/actions/parent";
import ConsentPage from "@/app/parent/consent/[token]/page";
import { ParentEmailSent, StudentSignup } from "@/app/signup/student-signup";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { completeConsentRequest, createConsentRequest, findConsentRequest } from "@/lib/consent/requests";
import type { Email } from "@/lib/email";

// A child under 13 asking a parent to set up their account, and the parent's link, driven through
// the real actions and pages with the database, cookies, email and client IP mocked.

const state = vi.hoisted(() => ({
  db: null as unknown,
  ip: "hashed-203.0.113.9",
  user: null as SessionUser | null,
  jar: new Map<string, string>(),
  emails: [] as Email[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "203.0.113.9", clientIpKey: async () => state.ip }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmail: async (email: Email) => void state.emails.push(email),
}));
vi.mock("@/lib/auth/dal", async (original) => ({
  ...(await original<typeof import("@/lib/auth/dal")>()),
  getCurrentUser: async () => state.user,
  requireUser: async () => state.user,
}));

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.ip = "hashed-203.0.113.9";
  state.user = null;
  state.jar.clear();
  state.emails = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

function ask(parentEmail: string) {
  const form = new FormData();
  form.set("parentEmail", parentEmail);
  return requestParentConsentAction(undefined, form);
}

describe("asking a parent by email", () => {
  it("never says an email went out once an address has had its emails for the day", async () => {
    for (let i = 0; i < 3; i++) expect(await ask("rosa@example.com")).toEqual({ sent: true });
    expect(await ask("Rosa@Example.com")).toEqual({
      message:
        "We've already sent a few emails to that address today. Ask your parent to check their inbox and spam folder, or try again tomorrow.",
    });
    expect(state.emails).toHaveLength(3);
    expect(await db.select().from(schema.consentRequests)).toHaveLength(3);
    // Another address still works.
    expect(await ask("sam@example.com")).toEqual({ sent: true });
  });

  it("says so when too many were sent from the same network, without using up the address", async () => {
    for (let i = 0; i < 10; i++) expect(await ask(`parent${i}@example.com`)).toEqual({ sent: true });
    const limited = await ask("rosa@example.com");
    expect(limited).toEqual({
      message: "A lot of parent emails were just sent from here, so we can't send yours right now. Please try again in an hour.",
    });
    expect(state.emails.map((e) => e.to)).not.toContain("rosa@example.com");
    // From another network, the same address still gets all of its emails for the day.
    state.ip = "hashed-198.51.100.7";
    for (let i = 0; i < 3; i++) expect(await ask("rosa@example.com")).toEqual({ sent: true });
  });

  it("offers a way to sign in once the parent has set things up", () => {
    for (const html of [
      renderToStaticMarkup(createElement(StudentSignup, { startWithParentStep: true })),
      renderToStaticMarkup(createElement(ParentEmailSent, { delayed: false })),
    ]) {
      expect(text(html)).toContain("Got your username from your parent? Sign in");
      expect(html).toContain('href="/login"');
    }
    expect(text(renderToStaticMarkup(createElement(ParentEmailSent, { delayed: true })))).toContain("It may take a few minutes to arrive.");
  });
});

describe("the age check on the eve of a 13th birthday", () => {
  // 6:30 pm in Denver on September 24: already the 25th in UTC, still the 24th in every US time zone.
  const eve = new Date("2026-09-25T00:30:00Z");
  const born = { birthYear: "2013", birthMonth: "9", birthDay: "25" };

  it("sends the child to a parent, and no account is made without consent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eve);
    const form = new FormData();
    for (const [k, v] of Object.entries(born)) form.set(k, v);
    expect(await checkAgeAction(undefined, form)).toEqual({ step: "child" });

    const student = { displayName: "Leo", email: "leo@example.com", password: "correct horse battery", birthDate: "2013-09-25", grade: 8 };
    expect(await registerStudent(db, student, eve)).toEqual({ ok: false, error: "under_13" });

    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error(parent.error);
    const child = { displayName: "Leo", username: "leo13", password: "correct horse battery", birthDate: "2013-09-25", grade: 8 };
    expect(await createChildAccount(db, parent.value.userId, child, null, eve)).toEqual({ ok: false, error: "consent_required" });
    state.user = { id: parent.value.userId, role: "parent", displayName: "Rosa", username: null, householdId: null, parentManaged: false, grade: null };
    const childForm = new FormData();
    for (const [k, v] of Object.entries({ ...born, displayName: "Leo", username: "leo13", password: "correct horse battery", grade: "8" })) {
      childForm.set(k, v);
    }
    expect(await createChildAction(undefined, childForm)).toEqual({
      errors: { consent: ["We need your consent to create an account for a child under 13."] },
    });
  });

  it("lets them sign up themselves once their birthday has started everywhere in the US", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T11:00:00Z")); // midnight in American Samoa
    const form = new FormData();
    for (const [k, v] of Object.entries(born)) form.set(k, v);
    expect(await checkAgeAction(undefined, form)).toEqual({ step: "teen", birthDate: "2013-09-25" });
  });
});

describe("the parent's consent link", () => {
  const consentPage = async (token: string) =>
    text(renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ token }) } as PageProps<"/parent/consent/[token]">)));

  async function signedInParent() {
    const res = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!res.ok) throw new Error(res.error);
    state.user = { id: res.value.userId, role: "parent", displayName: "Rosa", username: null, householdId: null, parentManaged: false, grade: null };
  }

  it("asks a new parent to create their account first", async () => {
    const { token } = await createConsentRequest(db, "rosa@example.com");
    const page = await consentPage(token);
    expect(page).toContain("Your child asked to join College Compass");
    expect(page).toContain("Create parent account");
  });

  it("says setup is done once the link was used, and points to sign in or the parent page", async () => {
    const { token } = await createConsentRequest(db, "rosa@example.com");
    await completeConsentRequest(db, (await findConsentRequest(db, token))!.id);

    const html = renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ token }) } as PageProps<"/parent/consent/[token]">));
    expect(text(html)).toContain("This link was already used");
    expect(text(html)).toContain("Your child's account was set up with this link");
    expect(html).toContain('href="/login?next=/parent"');
    // Nothing to create a second account with, and nothing about the account or the parent.
    expect(html).not.toMatch(/name="(email|password|username)"/);
    expect(text(html)).not.toContain("rosa");

    await signedInParent();
    const signedIn = renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ token }) } as PageProps<"/parent/consent/[token]">));
    expect(text(signedIn)).toContain("Go to your parent page");
    expect(signedIn).toContain('href="/parent"');
    expect(signedIn).not.toMatch(/name="(username|password)"/);
  });

  it("treats an expired link and a made-up one alike, with a way forward", async () => {
    const { token } = await createConsentRequest(db, "rosa@example.com", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    for (const t of [token, "not-a-real-token"]) {
      const page = await consentPage(t);
      expect(page).toContain("This link has expired");
      expect(page).toContain("If you already set up your child's account, you'll find it on your parent page.");
      expect(page).toContain("Sign in");
      expect(page).toContain("Not set up yet? Ask your child to send a new link, or create a parent account and add them yourself.");
    }
    await signedInParent();
    expect(await consentPage(token)).toContain("Go to your parent page");
  });
});
