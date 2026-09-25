import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStudentAction } from "@/app/actions/auth";
import { createChildAction } from "@/app/actions/parent";
import { ChildAccountForm } from "@/app/parent/child-account-form";
import { StudentSignup } from "@/app/signup/student-signup";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent } from "@/lib/accounts";
import {
  SAVED_ASSESSMENT_FIELD,
  SAVED_STRENGTHS_FIELD,
  type SavedAssessment,
  type SavedStrengths,
  emptySavedAssessment,
  emptySavedStrengths,
  serializeSavedAssessment,
} from "@/lib/assessments/anonymous";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { latestResult } from "@/lib/assessments/service";
import type { FormState } from "@/lib/forms";
import { loadOccupationProfiles } from "@/lib/matching/service";
import { addSavedStrengths } from "./saved-results-import";

// The "add my quiz results" box on the two account forms, through validation errors. React resets a
// form after its action, so the box must show, and send, what the person last chose. Each form is
// rendered as it would be after the reset, and what a browser would send from it goes to the real
// action.

const BIRTH_DATE = "2010-05-01";

const state = vi.hoisted(() => ({
  db: null as unknown,
  parent: null as unknown,
  saved: null as SavedAssessment | null,
  strengths: null as SavedStrengths | null,
  // What the form's last action returned, and what was sent with it (useFormAction's values).
  result: undefined as FormState,
  values: {} as Record<string, string>,
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
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "203.0.113.9", clientIpKey: async () => "hashed-203.0.113.9" }));
vi.mock("@/lib/auth/cookies", () => ({
  hasUnder13Gate: async () => false,
  setUnder13Gate: async () => {},
  setSessionCookie: async () => {},
  clearSessionCookie: async () => {},
  readSessionToken: async () => null,
}));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.parent, getCurrentUser: async () => state.parent }));
vi.mock("@/app/try/saved-store", () => ({
  useSavedAssessment: () => state.saved,
  useSavedStrengths: () => state.strengths,
  forgetSavedAssessment: () => {},
}));
// Signup's birthday step is done (a teen); the account forms get their last result and values.
vi.mock("@/components/use-form-action", () => ({
  useFormAction: (action: { name: string }) =>
    action.name === "checkAgeAction"
      ? [{ step: "teen", birthDate: BIRTH_DATE }, () => {}, false, {}]
      : [state.result, () => {}, false, state.values],
}));

let db: Db;
const interests = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "E" ? 5 : i.area === "C" ? 4 : 2]));
const strengths = Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 4]));

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.saved = { ...emptySavedAssessment(), answers: interests, savedAt: Date.now() };
  state.strengths = { ...emptySavedStrengths(), answers: strengths, savedAt: Date.now() };
  state.result = undefined;
  state.values = {};
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

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attrsOf = (attrs: string): Record<string, string> =>
  Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], unescape(m[2] ?? "")]));

/** What a browser sends from the form as rendered: named inputs, ticked boxes and selected options. */
function formEntries(html: string): Map<string, string> {
  const form = /<form[\s\S]*<\/form>/.exec(html)![0];
  const entries = new Map<string, string>();
  for (const [, raw] of form.matchAll(/<input ([^>]*?)\/?>/g)) {
    const attrs = attrsOf(raw);
    if (!attrs.name || (attrs.type === "checkbox" && !("checked" in attrs))) continue;
    entries.set(attrs.name, attrs.value ?? (attrs.type === "checkbox" ? "on" : ""));
  }
  for (const [, raw, options] of form.matchAll(/<select ([^>]*)>([\s\S]*?)<\/select>/g)) {
    const selected = /<option ([^>]*\bselected=""[^>]*)>/.exec(options);
    entries.set(attrsOf(raw).name, selected ? attrsOf(selected[1]).value : "");
  }
  return entries;
}

/** The quiz box, which must be the form's only field for the quiz. */
function quizBox(html: string) {
  const fields = [...html.matchAll(/<input ([^>]*?)\/?>/g)]
    .map((m) => attrsOf(m[1]))
    .filter((a) => a.name === SAVED_ASSESSMENT_FIELD || a.name === SAVED_STRENGTHS_FIELD);
  expect(fields).toHaveLength(1);
  expect(fields[0]).toMatchObject({ type: "checkbox", name: SAVED_ASSESSMENT_FIELD });
  return { ticked: "checked" in fields[0], value: fields[0].value };
}

/** The form as sent after the person's edits (null clears a field, as unticking does). */
function send(html: string, edits: Record<string, string | null>) {
  const entries = formEntries(html);
  for (const [name, value] of Object.entries(edits)) {
    if (value === null) entries.delete(name);
    else entries.set(name, value);
  }
  const formData = new FormData();
  for (const [name, value] of entries) formData.set(name, value);
  // What the box's formdata listener does as the form is submitted.
  addSavedStrengths(formData, serializeSavedAssessment(state.strengths!));
  return formData;
}

async function submit(action: (prev: FormState, formData: FormData) => Promise<FormState>, formData: FormData) {
  try {
    const result = await action(undefined, formData);
    // useFormAction keeps what was sent, except passwords.
    state.result = result;
    state.values = Object.fromEntries([...formData].filter(([k, v]) => typeof v === "string" && !/password/i.test(k))) as Record<string, string>;
    return { result };
  } catch (error) {
    if (error instanceof Redirect) return { redirect: error.url };
    throw error;
  }
}

type Flow = {
  render: () => string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  details: Record<string, string>;
  /** Where each landing goes, with the quiz added or not. */
  landing: { imported: string; not: string };
  newUser: () => Promise<string>;
};

/**
 * Sets the box to each of `choices` in turn, each time sending a password that's too short, then
 * fixes the password without touching the box and sends the form again.
 */
async function run(flow: Flow, startsTicked: boolean, choices: boolean[]) {
  let html = flow.render();
  expect(quizBox(html).ticked).toBe(startsTicked);
  for (const choice of choices) {
    const { value } = quizBox(html);
    const sent = send(html, { ...flow.details, password: "short", [SAVED_ASSESSMENT_FIELD]: choice ? value : null });
    const failed = await submit(flow.action, sent);
    expect(failed.result?.errors?.password).toBeDefined();
    // After React's reset, the box shows what was just chosen.
    html = flow.render();
    expect(quizBox(html).ticked).toBe(choice);
  }
  const last = choices.at(-1)!;
  const resent = send(html, { password: "correct horse battery" });
  expect(resent.has(SAVED_ASSESSMENT_FIELD)).toBe(last);
  expect(resent.has(SAVED_STRENGTHS_FIELD)).toBe(last);
  expect(await submit(flow.action, resent)).toEqual({ redirect: last ? flow.landing.imported : flow.landing.not });
  const userId = await flow.newUser();
  expect(Boolean(await latestResult(db, userId, "interests"))).toBe(last);
  expect(Boolean(await latestResult(db, userId, "personality"))).toBe(last);
}

const student = (savingQuiz: boolean): Flow => ({
  render: () => renderToStaticMarkup(createElement(StudentSignup, { startWithParentStep: false, savingQuiz })),
  action: registerStudentAction,
  details: { displayName: "Sam", email: "sam@example.com", grade: "10" },
  landing: { imported: "/try/saved", not: "/dashboard" },
  newUser: async () => (await db.select().from(schema.users))[0].id,
});

async function child(): Promise<Flow> {
  const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
  if (!parent.ok) throw new Error(parent.error);
  state.parent = { id: parent.value.userId, role: "parent" };
  return {
    render: () => renderToStaticMarkup(createElement(ChildAccountForm, {})),
    action: createChildAction,
    // 15, so no consent step.
    details: { displayName: "Kit", birthMonth: "3", birthDay: "1", birthYear: "2011", grade: "10", username: "kit2011" },
    landing: { imported: "/try/saved", not: "/parent?added=1" },
    newUser: async () => (await db.select().from(schema.users)).find((u) => u.role === "student")!.id,
  };
}

describe("the quiz box through a validation error", () => {
  it("student signup: tick, error, resubmit adds the quiz", async () => {
    await run(student(false), false, [true]);
  });

  it("student signup from 'Save my results': untick, error, resubmit leaves it out", async () => {
    await run(student(true), true, [false]);
  });

  it("student signup: tick, error, untick, error, resubmit leaves it out", async () => {
    await run(student(false), false, [true, false]);
  });

  it("add-child form: tick, error, resubmit adds the quiz", async () => {
    await run(await child(), false, [true]);
  });

  it("add-child form: tick, error, untick, error, resubmit leaves it out", async () => {
    await run(await child(), false, [true, false]);
  });
});
