import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setChildGradeAction, setMyGradeAction } from "@/app/actions/settings";
import { GradeSettingSelect, StudentSettings } from "@/components/student-settings";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, listChildren, registerParent, registerStudent } from "@/lib/accounts";
import { currentGrade } from "@/lib/auth/age";
import type { SessionUser } from "@/lib/auth/sessions";

// The settings grade forms, end to end: render the select, submit what a browser would send for
// it, and run the real server actions against an in-memory database.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { redirectTo: to });
  },
}));

const SENIOR_YEAR = new Date("2025-09-01T12:00:00Z");
const JUNE_15 = new Date("2026-06-15T12:00:00Z");
const PASSWORD = "correct horse battery";

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

function setClock(now: Date) {
  // Only Date: PGlite needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

type Option = { value: string; label: string; selected: boolean };

function options(html: string): Option[] {
  return [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, label]) => ({
    value: /value="([^"]*)"/.exec(attrs)?.[1] ?? label,
    label,
    selected: /\bselected=""/.test(attrs),
  }));
}

/** What a browser submits for an untouched form: the selected option, or else the first one. */
function untouched(html: string) {
  const opts = options(html);
  const grade = opts.find((o) => o.selected) ?? opts[0];
  const shownGrade = /name="shownGrade" value="([^"]*)"/.exec(html)?.[1];
  return { grade, shownGrade };
}

async function submit(action: (formData: FormData) => Promise<void>, fields: Record<string, string | undefined>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== undefined) formData.set(name, value);
  try {
    await action(formData);
  } catch (e) {
    if (!(e instanceof Error && "redirectTo" in e)) throw e;
  }
}

async function storedRow(db: Db, id: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return row;
}

async function signIn(db: Db, id: string, now: Date) {
  const row = await storedRow(db, id);
  state.user = {
    id: row.id,
    role: row.role,
    displayName: row.displayName,
    username: row.username,
    householdId: row.householdId,
    parentManaged: row.parentManaged,
    grade: currentGrade(row, now),
  };
  return state.user;
}

async function student(grade: number, registeredOn: Date) {
  const db = await createTestDb();
  state.db = db;
  const res = await registerStudent(
    db,
    { displayName: "Sam", email: "sam@example.com", password: PASSWORD, birthDate: "2008-03-01", grade },
    registeredOn,
  );
  if (!res.ok) throw new Error(res.error);
  return { db, id: res.value.userId };
}

async function parentWithChild(grade: number, createdOn: Date) {
  const db = await createTestDb();
  state.db = db;
  const parent = await registerParent(db, { displayName: "Pat", email: "pat@example.com", password: PASSWORD });
  if (!parent.ok) throw new Error(parent.error);
  const child = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Kid", username: "kid1", password: PASSWORD, birthDate: "2008-03-01", grade },
    null,
    createdOn,
  );
  if (!child.ok) throw new Error(child.error);
  return { db, parentId: parent.value.userId, childId: child.value.userId };
}

const renderSelect = (grade: number | null) => renderToStaticMarkup(createElement(GradeSettingSelect, { id: "g", grade }));

describe("GradeSettingSelect", () => {
  it("in June, keeps a senior who just finished 12th grade instead of showing 6th grade", () => {
    setClock(JUNE_15);
    const html = renderSelect(12);
    const opts = options(html);
    expect(opts.map((o) => o.value)).toEqual(["6", "7", "8", "9", "10", "11", ""]);
    expect(opts.filter((o) => o.selected)).toEqual([{ value: "", label: "12th grade", selected: true }]);
    expect(untouched(html)).toEqual({ grade: expect.objectContaining({ value: "" }), shownGrade: "12" });
  });

  it("shows graduates as finished and a missing grade as not set, both saving as no change", () => {
    setClock(new Date("2026-09-23T12:00:00Z"));
    expect(options(renderSelect(13)).filter((o) => o.selected)).toEqual([
      { value: "", label: "Finished high school", selected: true },
    ]);
    const unset = renderSelect(null);
    expect(options(unset)[0]).toEqual({ value: "", label: "Not set", selected: true });
    expect(untouched(unset).shownGrade).toBe("");
    setClock(JUNE_15);
    expect(untouched(renderSelect(14)).grade).toEqual({ value: "", label: "Finished high school", selected: true });
  });

  it("selects the current grade when it's an option, with no extra choice", () => {
    setClock(new Date("2026-09-23T12:00:00Z"));
    const opts = options(renderSelect(12));
    expect(opts.map((o) => o.value)).toEqual(["7", "8", "9", "10", "11", "12"]);
    expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(["12"]);
  });

  it("is in the student's own settings form along with the grade it shows", () => {
    setClock(JUNE_15);
    const html = renderToStaticMarkup(
      createElement(StudentSettings, { grade: 12, reminders: { kind: "self", enabled: true } }),
    );
    expect(untouched(html)).toEqual({ grade: expect.objectContaining({ value: "" }), shownGrade: "12" });
  });
});

describe("saving the grade form untouched", () => {
  it("in June, leaves a student who just finished 12th grade alone (was: saved as 6th grade)", async () => {
    const { db, id } = await student(12, SENIOR_YEAR);
    setClock(JUNE_15);
    const user = await signIn(db, id, JUNE_15);
    expect(user.grade).toBe(12);
    const { grade, shownGrade } = untouched(
      renderToStaticMarkup(createElement(StudentSettings, { grade: user.grade, reminders: { kind: "self", enabled: true } })),
    );
    await submit(setMyGradeAction, { grade: grade.value, shownGrade });
    const row = await storedRow(db, id);
    expect({ grade: row.grade, year: row.gradeSchoolYear }).toEqual({ grade: 12, year: 2025 });
    expect(currentGrade(row, new Date("2026-09-01T12:00:00Z"))).toBe(13);
  });

  it("in June, leaves a parent's child who just finished 12th grade alone", async () => {
    const { db, parentId, childId } = await parentWithChild(12, SENIOR_YEAR);
    setClock(JUNE_15);
    state.user = { id: parentId, role: "parent", displayName: "Pat", username: null, householdId: null, parentManaged: false, grade: null };
    const [child] = await listChildren(db, parentId, JUNE_15);
    expect(child.grade).toBe(12);
    const { grade, shownGrade } = untouched(renderSelect(child.grade));
    await submit(setChildGradeAction, { studentId: childId, grade: grade.value, shownGrade });
    const row = await storedRow(db, childId);
    expect({ grade: row.grade, year: row.gradeSchoolYear }).toEqual({ grade: 12, year: 2025 });
  });

  it("never holds a student back when the page was loaded July 31 and saved August 1", async () => {
    const { db, id } = await student(10, SENIOR_YEAR);
    const july31 = new Date("2026-07-31T23:00:00Z");
    setClock(july31);
    const shown = untouched(renderSelect((await signIn(db, id, july31)).grade));
    expect(shown.grade.value).toBe("10");
    const aug1 = new Date("2026-08-01T01:00:00Z");
    setClock(aug1);
    expect((await signIn(db, id, aug1)).grade).toBe(11);
    await submit(setMyGradeAction, { grade: shown.grade.value, shownGrade: shown.shownGrade });
    expect(currentGrade(await storedRow(db, id), aug1)).toBe(11);
  });

  it("stores a grade picked on July 31 and saved August 1 against the year the question asked about", async () => {
    const { db, id } = await student(10, SENIOR_YEAR);
    const july31 = new Date("2026-07-31T23:00:00Z");
    setClock(july31);
    const html = renderSelect((await signIn(db, id, july31)).grade);
    const gradeYear = /name="gradeYear" value="([^"]*)"/.exec(html)?.[1];
    expect(gradeYear).toBe("2025");
    // "Grade you just finished": actually 11th, not 10th.
    const aug1 = new Date("2026-08-01T00:10:00Z");
    setClock(aug1);
    await signIn(db, id, aug1);
    await submit(setMyGradeAction, { grade: "11", shownGrade: "10", gradeYear });
    const row = await storedRow(db, id);
    expect({ grade: row.grade, year: row.gradeSchoolYear }).toEqual({ grade: 11, year: 2025 });
    expect(currentGrade(row, aug1)).toBe(12);
  });

  it("does the same for a parent, and refuses a form from an older school year", async () => {
    const { db, parentId, childId } = await parentWithChild(9, SENIOR_YEAR);
    const aug1 = new Date("2026-08-01T00:10:00Z");
    setClock(aug1);
    state.user = { ...(await signIn(db, parentId, aug1)), role: "parent" };
    await submit(setChildGradeAction, { studentId: childId, grade: "10", shownGrade: "9", gradeYear: "2025" });
    expect(currentGrade(await storedRow(db, childId), aug1)).toBe(11);
    await submit(setChildGradeAction, { studentId: childId, grade: "8", shownGrade: "11", gradeYear: "2023" });
    expect(currentGrade(await storedRow(db, childId), aug1)).toBe(11);
  });

  it("still saves a grade the student actually picked", async () => {
    const { db, id } = await student(12, SENIOR_YEAR);
    setClock(JUNE_15);
    await signIn(db, id, JUNE_15);
    await submit(setMyGradeAction, { grade: "11", shownGrade: "12" });
    const row = await storedRow(db, id);
    expect({ grade: row.grade, year: row.gradeSchoolYear }).toEqual({ grade: 11, year: 2025 });
  });

  it("ignores an empty value and a value equal to the grade shown, for parents too", async () => {
    const { db, parentId, childId } = await parentWithChild(9, SENIOR_YEAR);
    const now = new Date("2026-09-23T12:00:00Z");
    setClock(now);
    state.user = { id: parentId, role: "parent", displayName: "Pat", username: null, householdId: null, parentManaged: false, grade: null };
    await submit(setChildGradeAction, { studentId: childId, grade: "", shownGrade: "10" });
    await submit(setChildGradeAction, { studentId: childId, grade: "9", shownGrade: "9" }); // stale page from last year
    expect(await storedRow(db, childId)).toMatchObject({ grade: 9, gradeSchoolYear: 2025 });
    await submit(setChildGradeAction, { studentId: childId, grade: "9", shownGrade: "10" }); // picked: repeating 9th
    expect(await storedRow(db, childId)).toMatchObject({ grade: 9, gradeSchoolYear: 2026 });
  });
});
