import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerParentAction, registerStudentAction } from "@/app/actions/auth";
import { createChildAction } from "@/app/actions/parent";
import { countFreeFinishAction, importSavedResultsAction } from "@/app/actions/try";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent, registerStudent } from "@/lib/accounts";
import {
  SAVED_ASSESSMENT_FIELD,
  SAVED_STRENGTHS_FIELD,
  emptySavedAssessment,
  emptySavedStrengths,
  serializeSavedAssessment,
} from "@/lib/assessments/anonymous";
import { FREE_FINISH_COUNT_LIMIT } from "@/lib/assessments/import";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { scorePersonality } from "@/lib/assessments/scoring";
import { latestResult } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { loadOccupationProfiles } from "@/lib/matching/service";

// The free quiz's way to an account, driven as hand-made requests would be: the strengths add-on
// travels with the quiz, and each step adds only to anonymous daily counts.

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown, ip: "203.0.113.7", cookie: null as string | null }));
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
vi.mock("@/lib/request", () => ({ clientIp: async () => state.ip, clientIpKey: async () => `hashed-${state.ip}` }));
vi.mock("@/lib/auth/cookies", () => ({
  hasUnder13Gate: async () => false,
  setUnder13Gate: async () => {},
  setSessionCookie: async (token: string) => {
    state.cookie = token;
  },
  clearSessionCookie: async () => {},
  readSessionToken: async () => state.cookie,
}));
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: async () => state.user,
  requireUser: async (roles?: string[]) => {
    const user = state.user as SessionUser | null;
    if (!user) throw new Redirect("/login");
    if (roles && !roles.includes(user.role)) throw new Redirect("/");
    return user;
  },
}));

let db: Db;
const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "A" ? 5 : i.area === "S" ? 4 : 1]));
const saved = serializeSavedAssessment({ ...emptySavedAssessment(), answers });
const strengthsAnswers = Object.fromEntries(PERSONALITY_ITEMS.map((i, n) => [i.id, (n % 5) + 1]));
const strengths = serializeSavedAssessment({ ...emptySavedStrengths(), answers: strengthsAnswers });

async function counts() {
  const rows = await db.select().from(schema.dailyCounts);
  return Object.fromEntries(rows.map((r) => [r.metric, r.count]));
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

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.user = null;
  state.cookie = null;
  state.ip = "203.0.113.7";
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["27-1024.00", "Graphic Designers", 4, { A: 7, E: 3 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: `${title} do things.` })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await loadOccupationProfiles(db, { fresh: true });
});

describe("counting free quiz finishes", () => {
  it("counts the quiz and the strengths add-on, and nothing else", async () => {
    await countFreeFinishAction("interests");
    await countFreeFinishAction("interests");
    await countFreeFinishAction("personality");
    for (const bad of ["values", "signup_student", { answers }, undefined]) await countFreeFinishAction(bad);
    expect(await counts()).toEqual({ free_quiz_finished: 2, free_strengths_finished: 1 });
    // Nothing about the visitor: no account, no answers, no address.
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
    expect(JSON.stringify(await db.select().from(schema.rateLimits))).not.toContain(state.ip);
  });

  it("limits how many one connection can add", async () => {
    for (let i = 0; i < FREE_FINISH_COUNT_LIMIT.limit + 5; i++) await countFreeFinishAction("interests");
    expect(await counts()).toEqual({ free_quiz_finished: FREE_FINISH_COUNT_LIMIT.limit });
    state.ip = "198.51.100.23";
    await countFreeFinishAction("interests");
    expect(await counts()).toEqual({ free_quiz_finished: FREE_FINISH_COUNT_LIMIT.limit + 1 });
  });
});

describe("student signup", () => {
  const signup = (extra: Record<string, string> = {}) =>
    registerStudentAction(
      undefined,
      form({ displayName: "Sam", email: `sam${Math.random()}@example.com`, password: "correct horse battery", birthDate: "2010-05-01", grade: "11", ...extra }),
    );

  it("brings the strengths along with the quiz, and counts a signup with the quiz", async () => {
    expect(await redirectOf(signup({ [SAVED_ASSESSMENT_FIELD]: saved, [SAVED_STRENGTHS_FIELD]: strengths }))).toBe("/try/saved");
    const [student] = await db.select().from(schema.users);
    expect((await latestResult(db, student.id, "personality"))?.scores).toEqual(scorePersonality(strengthsAnswers));
    expect(await counts()).toEqual({ signup_student: 1, signup_student_with_quiz: 1 });
  });

  it("counts a signup without the quiz, and never imports strengths on their own", async () => {
    state.cookie = null;
    expect(await redirectOf(signup({ [SAVED_STRENGTHS_FIELD]: strengths }))).toBe("/dashboard");
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
    state.cookie = null;
    // A quiz that doesn't check out isn't a signup with the quiz.
    expect(await redirectOf(signup({ [SAVED_ASSESSMENT_FIELD]: "{" }))).toBe("/dashboard");
    expect(await counts()).toEqual({ signup_student: 2 });
  });

  it("counts nothing for a signup that didn't happen", async () => {
    expect(await registerStudentAction(undefined, form({ displayName: "", email: "x", password: "short" }))).toHaveProperty("errors");
    expect(await counts()).toEqual({});
  });
});

describe("parent signup and adding a child", () => {
  it("counts a parent signup", async () => {
    const fd = form({ displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    expect(await redirectOf(registerParentAction(undefined, fd))).toBe("/parent");
    expect(await counts()).toEqual({ signup_parent: 1 });
  });

  it("brings the child's strengths along with the quiz, and counts the child added with the quiz", async () => {
    const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error(parent.error);
    state.user = { id: parent.value.userId, role: "parent", displayName: "Maria", username: null, householdId: null, parentManaged: false, grade: null };
    const child = (username: string, extra: Record<string, string> = {}) =>
      form({ displayName: "Leo", username, password: "correct horse battery", birthYear: "2010", birthMonth: "5", birthDay: "1", grade: "11", ...extra });

    expect(await redirectOf(createChildAction(undefined, child("leo15", { [SAVED_ASSESSMENT_FIELD]: saved, [SAVED_STRENGTHS_FIELD]: strengths })))).toBe(
      "/try/saved",
    );
    const [leo] = await db.select().from(schema.users).where(eq(schema.users.username, "leo15"));
    expect(await latestResult(db, leo.id, "interests")).not.toBeNull();
    expect((await latestResult(db, leo.id, "personality"))?.scores).toEqual(scorePersonality(strengthsAnswers));

    // Without the box ticked, nothing is imported or counted.
    expect(await redirectOf(createChildAction(undefined, child("mia13")))).toBe("/parent?added=1");
    expect(await counts()).toEqual({ child_added_with_quiz: 1 });
  });
});

describe("adding the quiz from the dashboard", () => {
  it("brings the strengths along too", async () => {
    const res = await registerStudent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 11 });
    if (!res.ok) throw new Error(res.error);
    state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 11 };
    expect(await importSavedResultsAction(saved, strengths)).toEqual({ ok: true });
    expect(await latestResult(db, res.value.userId, "personality")).not.toBeNull();
    // Adding from the dashboard isn't a signup.
    expect(await counts()).toEqual({});
  });
});
