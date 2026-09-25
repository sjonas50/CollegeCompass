import { eq } from "drizzle-orm";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChildAction } from "@/app/actions/parent";
import { freeMatchesAction, importSavedResultsAction, removeImportedResultsAction } from "@/app/actions/try";
import Home from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import { FreeQuiz } from "@/app/try/free-quiz";
import TryPage from "@/app/try/page";
import { Results } from "@/app/try/results/free-results";
import TryResultsPage from "@/app/try/results/page";
import { type ResultsViewer, SaveResultsCard } from "@/app/try/results/save-card";
import { StrengthsCard } from "@/app/try/results/strengths-card";
import { resultsViewer } from "@/app/try/results/viewer";
import SavedPage from "@/app/try/saved/page";
import { removeImportQuestion } from "@/app/try/saved/remove-import";
import InstrumentPage from "@/app/discover/[instrument]/page";
import TryStrengthsPage from "@/app/try/strengths/page";
import { ImportCard, SavedQuizChoice, SavedQuizField, SavedResultsImport, addSavedStrengths } from "@/components/saved-results-import";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import {
  SAVED_ASSESSMENT_FIELD,
  SAVED_STRENGTHS_FIELD,
  emptySavedAssessment,
  emptySavedStrengths,
  serializeSavedAssessment,
} from "@/lib/assessments/anonymous";
import { displayTrait } from "@/lib/assessments/descriptions";
import { FREE_MATCH_RATE_LIMIT, importSavedAssessment } from "@/lib/assessments/import";
import { ACCURACY_SCALE, BIG_FIVE, INSTRUMENTS, INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { scoreInterests, scorePersonality } from "@/lib/assessments/scoring";
import { completeAttempt, latestResult, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
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

async function signInParent() {
  const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
  if (!parent.ok) throw new Error(parent.error);
  const user: SessionUser = {
    id: parent.value.userId,
    role: "parent",
    displayName: "Maria",
    username: null,
    householdId: null,
    parentManaged: false,
    grade: null,
  };
  state.user = user;
  return user;
}

function childForm(username: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  const fields = { displayName: "Leo", username, password: "correct horse battery", birthYear: "2010", birthMonth: "5", birthDay: "1", grade: "11", ...extra };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const savedPageProps = (search: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(search) });

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
    await signInParent();
    expect(text(await render(TryResultsPage()))).toContain("Loading your results");
  });

  it("clears the browser's copy only for a student whose account holds results", async () => {
    expect(await redirectOf(Promise.resolve().then(() => SavedPage(savedPageProps())))).toBe("/try/results");
    const student = await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => SavedPage(savedPageProps())))).toBe("/dashboard");
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    expect(state.user).toBe(student);
    const page = text(await render(SavedPage(savedPageProps())));
    expect(page).toContain("Your quiz results are saved to your account.");
    // The other four areas all scored 0, so none of them is named as a third top interest.
    expect(page).toContain("Your top interests are artistic and social.");
  });

  it.each([
    // Every answer "Not sure".
    ["the same", { R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 }, "You rated all six interest areas about the same."],
    // "Dislike" on the Conventional activities and "Strongly dislike" on the rest.
    ["below 'Not sure'", { C: 2 }, "You leaned toward disliking all six interest areas."],
  ])("says why no area stands out when every area was rated %s", async (_, byArea: Partial<Record<Riasec, number>>, line: string) => {
    await signInStudent();
    const quiz = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, byArea[i.area] ?? 1]));
    expect(await importSavedResultsAction(serializeSavedAssessment({ ...emptySavedAssessment(), answers: quiz }))).toEqual({ ok: true });
    const page = text(await render(SavedPage(savedPageProps())));
    expect(page).toContain(`Your quiz results are saved to your account. ${line}`);
    expect(page).not.toContain("Your top interests");
  });

  it("names only the areas that reached 'Not sure' as top interests", async () => {
    await signInStudent();
    // "Dislike" on every social activity: the code is "ASR", but Social isn't an interest.
    const quiz = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "A" ? 5 : i.area === "S" ? 2 : 1]));
    expect(await importSavedResultsAction(serializeSavedAssessment({ ...emptySavedAssessment(), answers: quiz }))).toEqual({ ok: true });
    const page = text(await render(SavedPage(savedPageProps())));
    expect(page).toContain("Your top interests are artistic.");
    expect(page).not.toMatch(/social|You leaned/);
  });

  it("lets a student take back someone else's quiz and take it themselves", async () => {
    // A sibling's quiz on a shared computer, added at signup.
    const student = await signInStudent();
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    const attempt = await latestResult(db, student.id, "interests");
    expect((await startOrResumeAttempt(db, student.id, "interests")).ok).toBe(false);

    const html = await render(SavedPage(savedPageProps()));
    expect(text(html)).toContain("Not your answers?");
    expect(html).toContain(`name="attemptId" value="${attempt!.attemptId}"`);

    const fd = new FormData();
    fd.set("attemptId", attempt!.attemptId);
    expect(await redirectOf(removeImportedResultsAction(fd))).toBe("/discover/interests");
    expect(await latestResult(db, student.id, "interests")).toBeNull();
    expect(await db.select().from(schema.matchRuns)).toHaveLength(0);
    expect((await startOrResumeAttempt(db, student.id, "interests")).ok).toBe(true);

    // Once it's gone (or for anyone else's attempt), there's nothing to remove.
    expect(await redirectOf(removeImportedResultsAction(fd))).toBe("/try/saved?undo=failed");
  });

  it("takes back the strengths imported with the quiz too, and says so wherever it's offered", async () => {
    const student = await signInStudent();
    const strengths = serializeSavedAssessment({ ...emptySavedStrengths(), answers: Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 4])) });
    expect(await importSavedResultsAction(saved, strengths)).toEqual({ ok: true });
    const attempt = await latestResult(db, student.id, "interests");
    expect(await latestResult(db, student.id, "personality")).not.toBeNull();
    const instrumentPage = async (instrument: string) =>
      text(await render(InstrumentPage({ params: Promise.resolve({ instrument }), searchParams: Promise.resolve({}) } as PageProps<"/discover/[instrument]">)));

    expect(text(await render(SavedPage(savedPageProps())))).toContain(
      "you can remove these results and strengths. Then you can take both yourself right away.",
    );
    expect(removeImportQuestion(true)).toBe("Remove these quiz results and strengths from your account? Then you can take both yourself.");
    expect(removeImportQuestion(false)).toBe("Remove these quiz results from your account? Then you can take the quiz yourself.");
    expect(await instrumentPage("interests")).toContain(
      "Not your answers? These results and strengths came from the free quiz on this device. You can remove both and take them yourself.",
    );
    const personality = await render(
      InstrumentPage({ params: Promise.resolve({ instrument: "personality" }), searchParams: Promise.resolve({}) } as PageProps<"/discover/[instrument]">),
    );
    expect(text(personality)).toContain(
      "Not your answers? These strengths came with the free quiz results from this device. You can remove both from your interests .",
    );
    expect(personality).toContain('href="/discover/interests"');

    const fd = new FormData();
    fd.set("attemptId", attempt!.attemptId);
    expect(await redirectOf(removeImportedResultsAction(fd))).toBe("/discover/interests");
    expect(await latestResult(db, student.id, "personality")).toBeNull();
    expect(await instrumentPage("personality")).not.toContain("Not your answers?");
  });

  it("points to nothing on the strengths page for strengths the student gave themself", async () => {
    const student = await signInStudent();
    const start = await startOrResumeAttempt(db, student.id, "personality", new Date(Date.now() - 600_000));
    if (!start.ok) throw new Error();
    await saveResponses(db, student.id, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])));
    expect((await completeAttempt(db, student.id, start.attempt.id)).ok).toBe(true);
    // The quiz imported alone: its undo doesn't touch these strengths.
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    const page = await render(
      InstrumentPage({ params: Promise.resolve({ instrument: "personality" }), searchParams: Promise.resolve({}) } as PageProps<"/discover/[instrument]">),
    );
    expect(text(page)).not.toContain("Not your answers?");
    expect(text(await render(SavedPage(savedPageProps())))).toContain("you can remove these results. Then you can take the quiz yourself right away.");
  });

  it("never offers to remove results the student gave in their account", async () => {
    const student = await signInStudent();
    const start = await startOrResumeAttempt(db, student.id, "interests", new Date(Date.now() - 600_000));
    if (!start.ok) throw new Error();
    await saveResponses(db, student.id, start.attempt.id, answers);
    expect((await completeAttempt(db, student.id, start.attempt.id)).ok).toBe(true);
    const html = await render(SavedPage(savedPageProps()));
    expect(text(html)).not.toContain("Not your answers?");
    const fd = new FormData();
    fd.set("attemptId", start.attempt.id);
    expect(await redirectOf(removeImportedResultsAction(fd))).toBe("/try/saved?undo=failed");
    expect(await latestResult(db, student.id, "interests")).not.toBeNull();
    expect(text(await render(SavedPage(savedPageProps({ undo: "failed" }))))).toContain("We couldn't remove those results");
  });

  it("clears it for a parent only once one of their children holds results", async () => {
    const parent = await signInParent();
    expect(await redirectOf(Promise.resolve().then(() => SavedPage(savedPageProps())))).toBe("/parent?added=1");
    const child = await createChildAccount(
      db,
      parent.id,
      { displayName: "Leo", username: "leo15", password: "correct horse battery", birthDate: "2010-05-01", grade: 11 },
      null,
    );
    if (!child.ok) throw new Error(child.error);
    expect(await redirectOf(Promise.resolve().then(() => SavedPage(savedPageProps())))).toBe("/parent?added=1");
    await importSavedAssessment(db, parent.id, child.value.userId, saved, { via: "parent" });
    const html = await render(SavedPage(savedPageProps()));
    expect(text(html)).toContain("The quiz results are saved to your child's account.");
    // The parent page still says the results were added.
    expect(html).toContain('href="/parent?added=1&amp;imported=1"');
  });

  it("offers the saved results import only in the browser", async () => {
    expect(renderToStaticMarkup(createElement(SavedResultsImport, { startedInterests: true }))).toBe("");
    expect(renderToStaticMarkup(createElement(SavedQuizField))).toBe("");
  });

  it("says the strengths from this device stay out when the account has its own strengths activity", () => {
    const finished = { ...emptySavedAssessment(), answers, savedAt: Date.now(), counted: true as const };
    const strengths = { ...emptySavedStrengths(), answers: Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 4])), savedAt: 1, counted: true as const };
    const card = (personality?: "not_started" | "in_progress" | "done") =>
      text(renderToStaticMarkup(createElement(ImportCard, { saved: finished, strengths, startedInterests: false, personality })));
    expect(card()).toContain("They also answered the strengths questions.");
    expect(card()).not.toContain("won't be added");
    // Started in the account: its answers are kept, and the student is told before adding anything.
    expect(card("in_progress")).toContain(
      "The strengths answers on this device won't be added, because you've started the strengths activity in your account. You can finish it there.",
    );
    expect(card("in_progress")).not.toContain("They also answered the strengths questions.");
    expect(card("done")).toContain("won't be added, because your account already has your strengths.");
    // Nothing to say without finished strengths on this device.
    expect(
      text(renderToStaticMarkup(createElement(ImportCard, { saved: finished, strengths: null, startedInterests: false, personality: "in_progress" }))),
    ).not.toContain("strengths");
  });
});

describe("a parent adding the free quiz to a new child", () => {
  it("clears the browser's copy afterwards, so the same answers can't go into a second child", async () => {
    await signInParent();
    // createChildAction goes through /try/saved, which clears the browser's copy.
    expect(await redirectOf(createChildAction(undefined, childForm("leo15", { [SAVED_ASSESSMENT_FIELD]: saved })))).toBe("/try/saved");
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
    const html = await render(SavedPage(savedPageProps()));
    expect(html).toContain('href="/parent?added=1&amp;imported=1"');

    // Without the box ticked, straight to the parent page (the browser keeps its copy).
    expect(await redirectOf(createChildAction(undefined, childForm("mia13")))).toBe("/parent?added=1");
    // A quiz that doesn't check out never blocks the new account.
    expect(await redirectOf(createChildAction(undefined, childForm("ava12", { [SAVED_ASSESSMENT_FIELD]: "{" })))).toBe("/parent?added=1");
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
  });
});

describe("keeping the free results", () => {
  const cardFor = (viewer: Parameters<typeof SaveResultsCard>[0]["viewer"]) =>
    renderToStaticMarkup(createElement(SaveResultsCard, { viewer }));
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  it("never sends someone who is signed in to student signup", async () => {
    expect(await resultsViewer(db, null)).toBe("visitor");
    const parent = await signInParent();
    expect(await resultsViewer(db, parent)).toBe("parent");
    const student = await signInStudent();
    expect(await resultsViewer(db, student)).toBe("student");
    expect(await importSavedResultsAction(saved)).toEqual({ ok: true });
    expect(await resultsViewer(db, student)).toBe("student_with_results");
    expect(await resultsViewer(db, { ...parent, role: "admin" })).toBe("other");

    for (const viewer of ["parent", "student", "student_with_results", "other"] as const) {
      expect(hrefs(cardFor(viewer)).filter((h) => h.startsWith("/signup"))).toEqual([]);
    }
  });

  it("offers a parent to add the results to their child's account", () => {
    const html = cardFor("parent");
    expect(hrefs(html)).toContain("/parent/children/new");
    expect(text(html)).toContain("They can sign in on this device and add the results from their dashboard.");
  });

  it("sends a signed-in student to their dashboard, where the results can be added", () => {
    expect(hrefs(cardFor("student"))).toContain("/dashboard");
    expect(hrefs(cardFor("student_with_results"))).toContain("/discover/results");
    expect(text(cardFor("student_with_results"))).toContain("these can't be added");
  });

  it("sends a visitor to signup with the quiz box ticked, and tells parents where to go", () => {
    const html = cardFor("visitor");
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/signup?from=quiz", "/login", "/signup/parent"]));
  });

  it("says what an account adds, the trial, free access, and how under-13s get one", () => {
    const html = renderToStaticMarkup(createElement(SaveResultsCard, { viewer: "visitor", trialDays: 14 }));
    const t = text(html);
    for (const line of [
      "Why each career fits you, in plain words",
      "Your strengths, from a 3-minute personality activity",
      "What matters to you in a job, to fine-tune your matches",
      "A grade-by-grade plan, with small steps each week",
      "An AI counselor that remembers your goals",
      "Try everything free for 14 days, with no card needed.",
      "If cost is a problem, your family can get free access.",
      "Under 13? A parent or guardian sets up your account",
    ]) {
      expect(t).toContain(line);
    }
    // Strengths already answered here come along instead.
    const withStrengths = text(renderToStaticMarkup(createElement(SaveResultsCard, { viewer: "visitor", strengths: true })));
    expect(withStrengths).toContain("Your strengths, saved with your results");
    expect(withStrengths).toContain("keep these results and strengths");
    // No trial is promised when there isn't one.
    expect(withStrengths).not.toMatch(/free for \d+ days/);
    expect(text(renderToStaticMarkup(createElement(SaveResultsCard, { viewer: "parent", strengths: true })))).toContain(
      "you can add these results and strengths when you set up their account",
    );
  });

  it("says whose quiz it might be, and leaves the box unticked unless the visitor asked to save it", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const finished = { ...emptySavedAssessment(), answers, savedAt: yesterday.getTime() };
    const unticked = renderToStaticMarkup(createElement(SavedQuizChoice, { saved: finished }));
    expect(text(unticked)).toContain(
      "Someone finished the free interest quiz on this device yesterday. Their top interests were artistic and social.",
    );
    expect(text(unticked)).toContain("Only add them if you took the quiz.");
    // The box is the quiz's only field, so unticked, nothing is sent.
    const box = (html: string) => {
      expect(html.match(/<input /g)).toHaveLength(1);
      return /<input type="checkbox"([^>]*)>/.exec(html)![1];
    };
    expect(box(unticked)).toContain(`name="${SAVED_ASSESSMENT_FIELD}"`);
    expect(unticked).not.toContain("checked");

    const ticked = renderToStaticMarkup(createElement(SavedQuizChoice, { saved: finished, defaultChecked: true }));
    expect(box(ticked)).toContain(`name="${SAVED_ASSESSMENT_FIELD}"`);
    expect(box(ticked)).toContain('checked=""');
    // Only the answers go with the form, never the time.
    const value = box(ticked).match(/ value="([^"]+)"/)![1].replaceAll("&quot;", '"');
    expect(JSON.parse(value)).not.toHaveProperty("savedAt");

    const forChild = text(renderToStaticMarkup(createElement(SavedQuizChoice, { saved: finished, forChild: true })));
    expect(forChild).toContain("My child took the free quiz on this device.");
    expect(forChild).toContain("Only add them if this child took the quiz.");
  });

  it("sends the strengths answers with the quiz when the box is ticked", () => {
    const finished = { ...emptySavedAssessment(), answers };
    const strengths = { ...emptySavedStrengths(), answers: Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 4])), savedAt: 1, counted: true as const };
    const ticked = renderToStaticMarkup(createElement(SavedQuizChoice, { saved: finished, strengths, defaultChecked: true }));
    expect(text(ticked)).toContain("They also answered the strengths questions.");
    // They're added as the form is submitted, and only when the quiz goes with it.
    expect(ticked).not.toContain(SAVED_STRENGTHS_FIELD);
    const withQuiz = new FormData();
    withQuiz.set(SAVED_ASSESSMENT_FIELD, serializeSavedAssessment(finished));
    addSavedStrengths(withQuiz, serializeSavedAssessment(strengths));
    expect(JSON.parse(String(withQuiz.get(SAVED_STRENGTHS_FIELD)))).toEqual({ v: 1, instrument: "personality", version: "mini-ipip-1", answers: strengths.answers });
    const withoutQuiz = new FormData();
    addSavedStrengths(withoutQuiz, serializeSavedAssessment(strengths));
    expect(withoutQuiz.has(SAVED_STRENGTHS_FIELD)).toBe(false);
  });
});

describe("the strengths add-on", () => {
  const strengthsAnswers = (value: number) => Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, value]));
  const card = (saved: Parameters<typeof StrengthsCard>[0]["saved"], viewer: ResultsViewer = "visitor") =>
    renderToStaticMarkup(createElement(StrengthsCard, { saved, viewer }));
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  it("is offered after the free results: 20 statements, about 3 minutes, answered in the browser", () => {
    const html = card(null);
    expect(text(html)).toContain("See your strengths too?");
    expect(text(html)).toContain("20 statements, about 3 minutes.");
    expect(text(html)).toContain("your answers stay in this browser");
    expect(hrefs(html)).toEqual(["/try/strengths"]);
    expect(html).toContain('id="strengths"');
    expect(text(card({ ...emptySavedStrengths(), answers: { P1: 3, P2: 4 } }))).toContain("You've answered 2 of 20. Keep going");
    // Nothing until the browser's copy is read.
    expect(card(undefined)).toBe("");
  });

  it("shows every strength in strengths words, never as a score", () => {
    for (const value of [1, 3, 5]) {
      const html = card({ ...emptySavedStrengths(), answers: strengthsAnswers(value) });
      const t = text(html);
      const { traits } = scorePersonality(strengthsAnswers(value));
      for (const trait of BIG_FIVE) {
        const { name, text: words } = displayTrait(trait, traits[trait]);
        expect(t).toContain(`${name}. ${words}`);
      }
      expect(t).toContain("not a label");
      expect(t).not.toMatch(/\d+ ?%|\bscore\b|\blow\b|\bhigh\b/i);
    }
  });

  it("asks the Mini-IPIP statements verbatim, on the accuracy scale, with nothing sent", async () => {
    const html = renderToStaticMarkup(
      createElement(FreeQuiz, { instrument: "personality", items: PERSONALITY_ITEMS.map(({ id, text }) => ({ id, text })), options: ACCURACY_SCALE }),
    );
    for (const item of PERSONALITY_ITEMS.slice(0, 5)) expect(html).toContain(item.text.replace(/'/g, "&#x27;"));
    for (const option of ACCURACY_SCALE) expect(html).toContain(option.label);
    expect(text(html)).toContain("How well does this describe you?");
    expect(html).not.toMatch(/<form|type="email"/i);

    const page = text(await render(TryStrengthsPage()));
    expect(page).toContain("20 statements, about 3 minutes.");
    expect(page).toContain("your answers stay in this browser until you choose to save them to an account");
  });

  it("sends signed-in students to the same statements in their account", async () => {
    await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => TryStrengthsPage()))).toBe("/discover/personality");
  });

  it("tells signed-in students their strengths answers are saved in their account, not the browser", () => {
    for (const saved of [null, { ...emptySavedStrengths(), answers: { P1: 3, P2: 4 } }]) {
      const html = card(saved, "student");
      expect(text(html)).toContain("See your strengths too?");
      expect(text(html)).toContain("Answer 20 statements in your account, about 3 minutes.");
      expect(INSTRUMENTS.personality.tagline).toContain("About 3 minutes.");
      expect(text(html)).toContain("Your answers are saved in your account.");
      expect(text(html)).not.toMatch(/browser|Keep going/);
      expect(hrefs(html)).toEqual(["/discover/personality"]);
    }
    // Their account already has interest results, and its own strengths activity.
    expect(card(null, "student_with_results")).toBe("");
    // Visitors and parents answer in the browser, as the card says.
    for (const viewer of ["visitor", "parent", "other"] as const) {
      expect(text(card(null, viewer))).toContain("your answers stay in this browser");
      expect(hrefs(card(null, viewer))).toEqual(["/try/strengths"]);
    }
    // Strengths already answered here are shown to anyone.
    const done = { ...emptySavedStrengths(), answers: strengthsAnswers(4) };
    for (const viewer of ["student", "student_with_results"] as const) expect(text(card(done, viewer))).toContain("Your strengths");

    const results = (viewer: ResultsViewer) => text(renderToStaticMarkup(createElement(Results, { answers, viewer })));
    for (const viewer of ["student", "student_with_results"] as const) {
      expect(results(viewer)).toContain(
        "Your quiz answers, and any strengths answers from before you signed in, are saved only in this browser.",
      );
    }
    expect(results("parent")).toContain("Your answers, including any strengths answers, are saved only in this browser.");
  });
});

describe("privacy promises about the free quiz", () => {
  it("say what stays in the browser, and that finishes are counted without knowing who", async () => {
    const privacy = text(renderToStaticMarkup(PrivacyPage()));
    expect(privacy).toContain(
      "your answers, including any answers to the optional strengths questions, stay in your browser, and your strengths are worked out there too.",
    );
    expect(privacy).toContain("We count how many people finish the quiz each day, without knowing who.");
    expect(text(await render(TryPage()))).toContain("We only count how many people finish, not who.");
    const results = text(renderToStaticMarkup(createElement(Results, { answers, viewer: "visitor" })));
    expect(results).toContain("Your answers, including any strengths answers, are saved only in this browser.");
    expect(results).toContain("We count how many people finish the quiz, but not who.");
  });
});

describe("landing page", () => {
  const home = (sp: Record<string, string> = {}) => Home({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) } as PageProps<"/">);
  const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  it("leads with student signup, then the parent path, and says what College Compass is", async () => {
    const html = await render(home());
    const hrefs = hrefsOf(html);
    expect(hrefs.slice(0, 2)).toEqual(["/signup", "/signup/parent"]);
    expect(hrefs).toEqual(expect.arrayContaining(["/login", "/careers", "/colleges", "/aid"]));
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(text(html)).toMatch(/Plan your path to college and career ?, one week at a time\./);
    expect(text(html)).toContain("AI guidance counselor");
    expect(text(html)).not.toContain("were deleted");
  });

  it("ends in the get-started section the header links to, with both signup paths and sign in", async () => {
    const html = await render(home());
    expect(html.match(/id="get-started"/g)).toHaveLength(1);
    const section = hrefsOf(html.slice(html.indexOf('id="get-started"')));
    expect(section).toEqual(expect.arrayContaining(["/signup", "/signup/parent", "/login"]));
    expect(section.indexOf("/signup")).toBeLessThan(section.indexOf("/signup/parent"));
  });

  it("offers the free quiz only as a secondary path, after both signup paths", async () => {
    const hrefs = hrefsOf(await render(home()));
    expect(hrefs.filter((h) => h === "/try")).toHaveLength(1);
    expect(hrefs.indexOf("/try")).toBeGreaterThan(hrefs.lastIndexOf("/signup/parent"));
  });

  it("links only to public pages that exist, or to its own sections", async () => {
    const html = await render(home());
    const pages = ["/signup", "/signup/parent", "/login", "/try", "/careers", "/colleges", "/aid", "/privacy", "/about/data"];
    for (const href of hrefsOf(html)) {
      if (href.startsWith("#")) expect(html, href).toContain(`id="${href.slice(1)}"`);
      else expect(pages, href).toContain(href);
    }
  });

  it("confirms a deleted account", async () => {
    expect(text(await render(home({ "account-deleted": "1" })))).toContain("Your account and everything in it were deleted.");
  });

  it("sends signed-in users home", async () => {
    await signInStudent();
    expect(await redirectOf(Promise.resolve().then(() => home()))).toBe("/dashboard");
    await signInParent();
    expect(await redirectOf(Promise.resolve().then(() => home()))).toBe("/parent");
  });
});
