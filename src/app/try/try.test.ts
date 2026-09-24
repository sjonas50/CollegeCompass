import { eq } from "drizzle-orm";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freeMatchesAction, importSavedResultsAction } from "@/app/actions/try";
import Home from "@/app/page";
import TryPage from "@/app/try/page";
import TryResultsPage from "@/app/try/results/page";
import SavedPage from "@/app/try/saved/page";
import { SavedQuizField, SavedResultsImport } from "@/components/saved-results-import";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { emptySavedAssessment, serializeSavedAssessment } from "@/lib/assessments/anonymous";
import { FREE_MATCH_RATE_LIMIT, importSavedAssessment } from "@/lib/assessments/import";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { scoreInterests } from "@/lib/assessments/scoring";
import type { SessionUser } from "@/lib/auth/sessions";
import { loadOccupationProfiles } from "@/lib/matching/service";

// The free quiz's public actions and pages, driven directly as a hand-made request would.

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown, ip: "203.0.113.7" }));
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
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => state.ip }));
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: async () => state.user,
  homePathFor: (u: SessionUser) => (u.role === "parent" ? "/parent" : "/dashboard"),
  requireUser: vi.fn(async (roles?: string[]) => {
    const user = state.user as SessionUser | null;
    if (!user) throw new Redirect("/login");
    if (roles && !roles.includes(user.role)) throw new Redirect("/parent");
    return user;
  }),
}));

let db: Db;
const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "A" ? 5 : i.area === "S" ? 4 : 1]));
const saved = serializeSavedAssessment({ ...emptySavedAssessment(), answers });
const areas = scoreInterests(answers).areas;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.user = null;
  state.ip = "203.0.113.7";
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["27-1024.00", "Graphic Designers", 4, { A: 7, E: 3 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ["39-5012.00", "Hairdressers, Hairstylists, and Cosmetologists", 2, { A: 5, S: 5, E: 4 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await loadOccupationProfiles(db, { fresh: true });
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

async function signInStudent() {
  const res = await registerStudent(db, {
    displayName: "Sam",
    email: "sam@example.com",
    password: "correct horse battery",
    birthDate: "2010-05-01",
    grade: 11,
  });
  if (!res.ok) throw new Error(res.error);
  const user: SessionUser = {
    id: res.value.userId,
    role: "student",
    displayName: "Sam",
    username: null,
    householdId: null,
    parentManaged: false,
    grade: 11,
  };
  state.user = user;
  return user;
}

async function redirectOf(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Redirect)) throw err ?? new Error("did not redirect");
  return err.url;
}

const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

describe("freeMatchesAction", () => {
  it("returns careers for six area scores", async () => {
    const res = await freeMatchesAction(areas);
    expect(res).toMatchObject({ ok: true, code: scoreInterests(answers).code });
    if (res.ok) expect(res.careers.map((c) => c.title)).toEqual(expect.arrayContaining(["Graphic Designers", "Secondary School Teachers"]));
  });

  it("refuses the item answers, or anything but the six scores", async () => {
    for (const bad of [answers, { ...areas, answers }, { ...areas, R: "1" }, [1, 2, 3, 4, 5, 6], undefined]) {
      expect(await freeMatchesAction(bad)).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("limits requests per visitor, keyed without their address", async () => {
    for (let i = 0; i < FREE_MATCH_RATE_LIMIT.limit; i++) await freeMatchesAction(areas);
    expect(await freeMatchesAction(areas)).toEqual({ ok: false, error: "rate_limited" });
    state.ip = "198.51.100.23";
    expect((await freeMatchesAction(areas)).ok).toBe(true);
    const keys = (await db.select().from(schema.rateLimits)).map((r) => r.key);
    expect(keys).toHaveLength(2);
    expect(keys.join(" ")).not.toMatch(/203\.0\.113\.7|198\.51\.100\.23/);
    // Nothing else is written for a visitor.
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
    expect(await db.select().from(schema.auditLog)).toHaveLength(0);
  });
});

describe("importSavedResultsAction", () => {
  it("needs a signed-in student", async () => {
    expect(await redirectOf(importSavedResultsAction(saved))).toBe("/login");
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
  });

  it("brings saved answers into the student's own account, once", async () => {
    const student = await signInStudent();
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    const [attempt] = await db.select().from(schema.assessmentAttempts);
    expect(attempt).toMatchObject({ userId: student.id, instrument: "interests" });
    expect(await db.select().from(schema.matchRuns)).toHaveLength(1);
    const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(audit.metadata).toEqual({ instrument: "interests", via: "dashboard" });

    expect(await importSavedResultsAction(saved)).toMatchObject({ ok: false, error: "already_done" });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
  });

  it("refuses tampered answers", async () => {
    await signInStudent();
    const tampered = serializeSavedAssessment({ ...emptySavedAssessment(), answers: { ...answers, R1: 9 } });
    expect(await importSavedResultsAction(tampered)).toMatchObject({ ok: false, error: "invalid" });
    expect(await importSavedResultsAction({ answers })).toMatchObject({ ok: false, error: "invalid" });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
  });
});

describe("free quiz pages", () => {
  it("shows the licensed items verbatim with the O*NET attribution, and no trackers", async () => {
    const html = await render(TryPage());
    for (const item of INTEREST_ITEMS.slice(0, 6)) expect(html).toContain(item.text);
    expect(html).toContain("O*NET Career Exploration Tools");
    expect(html).toContain("CC BY-ND 4.0");
    expect(html).not.toMatch(/<script|<img|<iframe/i);
    // No email (or any other) field: the answers are radio buttons that never leave the browser.
    expect(html).not.toMatch(/type="email"|<form/i);
  });

  it("sends signed-in students to the same quiz in their account", async () => {
    await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => TryPage()))).toBe("/discover/interests");
  });

  it("renders results in the browser only: the server never sees the answers", async () => {
    const html = await render(TryResultsPage());
    expect(text(html)).toContain("Loading your results");
    expect(html).toContain("O*NET Database");
  });

  it("clears the browser's copy only for a student whose account holds results", async () => {
    expect(await redirectOf(Promise.resolve().then(() => SavedPage()))).toBe("/try/results");
    const student = await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => SavedPage()))).toBe("/dashboard");
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    expect(state.user).toBe(student);
    expect(text(await render(SavedPage()))).toContain("Your quiz results are saved to your account.");
  });

  it("clears it for a parent only once one of their children holds results", async () => {
    const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    state.user = { id: parent.value.userId, role: "parent", displayName: "Maria", username: null, householdId: null, parentManaged: false, grade: null };
    expect(await redirectOf(Promise.resolve().then(() => SavedPage()))).toBe("/parent?added=1");
    const child = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo15", password: "correct horse battery", birthDate: "2010-05-01", grade: 11 },
      null,
    );
    if (!child.ok) throw new Error(child.error);
    expect(await redirectOf(Promise.resolve().then(() => SavedPage()))).toBe("/parent?added=1");
    await importSavedAssessment(db, parent.value.userId, child.value.userId, saved, { via: "parent" });
    const html = await render(SavedPage());
    expect(text(html)).toContain("The quiz results are saved to your child's account.");
    expect(html).toContain('href="/parent?added=1"');
  });

  it("offers the saved results import only in the browser", async () => {
    expect(renderToStaticMarkup(createElement(SavedResultsImport, { startedInterests: true }))).toBe("");
    expect(renderToStaticMarkup(createElement(SavedQuizField))).toBe("");
  });
});

describe("landing page", () => {
  it("leads with the free quiz, then signup and sign in, then the explorers", async () => {
    const html = await render(Home());
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs[0]).toBe("/try");
    expect(hrefs).toEqual(expect.arrayContaining(["/signup", "/signup/parent", "/login", "/colleges", "/aid"]));
    expect(hrefs.indexOf("/signup")).toBeLessThan(hrefs.indexOf("/colleges"));
    expect(text(html)).toContain("Find careers that fit you — free, no account needed");
  });

  it("sends signed-in users home", async () => {
    await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => Home()))).toBe("/dashboard");
  });
});
