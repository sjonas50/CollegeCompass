import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStudentAction } from "@/app/actions/auth";
import { StudentSignup } from "@/app/signup/student-signup";
import { type Db, createTestDb, schema } from "@/db";
import { SAVED_ASSESSMENT_FIELD, emptySavedAssessment, serializeSavedAssessment } from "@/lib/assessments/anonymous";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { scoreInterests } from "@/lib/assessments/scoring";
import { latestResult } from "@/lib/assessments/service";
import { loadOccupationProfiles } from "@/lib/matching/service";

// Student signup bringing in a free quiz saved in the browser, driven as a hand-made POST would be.

const state = vi.hoisted(() => ({ db: null as unknown, under13: false, cookie: null as string | null }));
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
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "203.0.113.9" }));
vi.mock("@/lib/auth/cookies", () => ({
  hasUnder13Gate: async () => state.under13,
  setUnder13Gate: async () => {
    state.under13 = true;
  },
  setSessionCookie: async (token: string) => {
    state.cookie = token;
  },
  clearSessionCookie: async () => {},
  readSessionToken: async () => state.cookie,
}));

let db: Db;
const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "E" ? 5 : i.area === "C" ? 4 : 2]));
const saved = serializeSavedAssessment({ ...emptySavedAssessment(), answers });

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.under13 = false;
  state.cookie = null;
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["11-1021.00", "General and Operations Managers", 4, { E: 7, C: 5 }],
    ["43-3031.00", "Bookkeeping, Accounting, and Auditing Clerks", 3, { C: 7, E: 2 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await loadOccupationProfiles(db, { fresh: true });
});

function signupForm(extra: Record<string, string> = {}, birthDate = "2010-05-01") {
  const fd = new FormData();
  const fields = { displayName: "Sam", email: "sam@example.com", password: "correct horse battery", birthDate, grade: "11", ...extra };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function submit(fd: FormData) {
  const outcome = await registerStudentAction(undefined, fd).then(
    (value) => ({ value }),
    (e: unknown) => {
      if (e instanceof Redirect) return { redirect: e.url };
      throw e;
    },
  );
  return outcome as { value?: unknown; redirect?: string };
}

async function onlyStudent() {
  const [user] = await db.select().from(schema.users);
  return user;
}

describe("signup with a saved free quiz", () => {
  it("creates the account with the quiz scored on the server, then clears the browser's copy", async () => {
    expect(await submit(signupForm({ [SAVED_ASSESSMENT_FIELD]: saved }))).toEqual({ redirect: "/try/saved" });
    const student = await onlyStudent();
    expect(state.cookie).toBeTruthy();
    const result = await latestResult(db, student.id, "interests");
    expect(result?.scores).toEqual(scoreInterests(answers));
    const responses = await db
      .select()
      .from(schema.assessmentResponses)
      .where(eq(schema.assessmentResponses.attemptId, result!.attemptId));
    expect(responses).toHaveLength(INTEREST_ITEMS.length);
    const [run] = await db.select().from(schema.matchRuns);
    expect(run).toMatchObject({ userId: student.id, interestsAttemptId: result!.attemptId });
    const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(audit).toMatchObject({ actorUserId: student.id, metadata: { instrument: "interests", via: "signup" } });
  });

  it("works as before without a saved quiz", async () => {
    expect(await submit(signupForm())).toEqual({ redirect: "/dashboard" });
    expect(await onlyStudent()).toBeTruthy();
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
  });

  it("still creates the account when the saved answers don't check out, without importing them", async () => {
    const tampered = JSON.stringify({ ...JSON.parse(saved), scores: { areas: { E: 40 } } });
    for (const [i, bad] of [tampered, "not json", serializeSavedAssessment({ ...emptySavedAssessment(), answers: { R1: 3 } })].entries()) {
      expect(await submit(signupForm({ [SAVED_ASSESSMENT_FIELD]: bad, email: `sam${i}@example.com` }))).toEqual({ redirect: "/dashboard" });
    }
    expect(await db.select().from(schema.users)).toHaveLength(3);
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"))).toHaveLength(0);
  });

  it("never creates an account, or imports anything, for an under-13", async () => {
    expect(await submit(signupForm({ [SAVED_ASSESSMENT_FIELD]: saved }, "2015-02-01"))).toEqual({
      value: { message: "Please ask a parent to set up your account." },
    });
    expect(await submit(signupForm({ [SAVED_ASSESSMENT_FIELD]: saved }))).toEqual({
      value: { message: "Please ask a parent to set up your account." },
    });
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
  });

  it("asks the neutral birthday question first, before any email field", () => {
    const html = renderToStaticMarkup(createElement(StudentSignup, { startWithParentStep: false }));
    expect(html).toContain('name="birthMonth"');
    expect(html).not.toMatch(/type="email"|name="email"|name="parentEmail"/);
    // The saved quiz is read from the browser, never rendered on the server.
    expect(html).not.toContain(SAVED_ASSESSMENT_FIELD);
  });
});
