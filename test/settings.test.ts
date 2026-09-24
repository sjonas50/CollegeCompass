import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setChildRemindersAction, setMyRemindersAction } from "@/app/actions/settings";
import { type Db, createTestDb, getDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent, setStudentGrade } from "@/lib/accounts";
import { currentGrade } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { setRemindersEnabled } from "@/lib/reminders";

// Server actions are public POST endpoints: drive them directly, as a hand-made request would.
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
vi.mock("@/lib/auth/dal", () => ({ requireUser: vi.fn() }));
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: vi.fn() }));

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
});

async function signInAs(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const user: SessionUser = { ...u, grade: u.grade };
  vi.mocked(requireUser).mockResolvedValue(user);
}

async function redirectOf(action: Promise<unknown>) {
  const err = await action.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Redirect)) throw err ?? new Error("the action did not redirect");
  return err.url;
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function remindersOf(userId: string) {
  const [u] = await db.select({ on: schema.users.remindersEnabled }).from(schema.users).where(eq(schema.users.id, userId));
  return u.on;
}

describe("student settings", () => {
  it("corrects a grade from the current school year and never touches parents", async () => {
    const s = await registerStudent(
      db,
      { displayName: "Ana", email: "a@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2025-09-01T12:00:00Z"),
    );
    const p = await registerParent(db, { displayName: "P", email: "p@example.com", password: "correct horse battery" });
    if (!s.ok || !p.ok) throw new Error();
    const today = new Date("2026-09-23T12:00:00Z");
    expect(await setStudentGrade(db, s.value.userId, 10, today)).toBe(true); // repeated 10th
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, s.value.userId));
    expect(currentGrade(row, today)).toBe(10);
    expect(await setStudentGrade(db, s.value.userId, 13, today)).toBe(false);
    expect(await setStudentGrade(db, p.value.userId, 9, today)).toBe(false);
    await setRemindersEnabled(db, s.value.userId, false);
    expect(await remindersOf(s.value.userId)).toBe(false);
  });

  it("lets a teen with their own email turn their reminders off and on", async () => {
    const s = await registerStudent(db, {
      displayName: "Ana",
      email: "a@example.com",
      password: "correct horse battery",
      birthDate: "2009-01-15",
      grade: 11,
    });
    if (!s.ok) throw new Error();
    await signInAs(s.value.userId);
    expect(await redirectOf(setMyRemindersAction(form({})))).toBe("/dashboard?settings=saved");
    expect(await remindersOf(s.value.userId)).toBe(false);
    expect(await redirectOf(setMyRemindersAction(form({ enabled: "on" })))).toBe("/dashboard?settings=saved");
    expect(await remindersOf(s.value.userId)).toBe(true);
  });

  it("won't let a child turn off reminders that go to their parent, but the parent still can", async () => {
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
    const leo = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo2014", password: "correct horse battery", birthDate: "2014-09-01", grade: 7 },
      consent,
    );
    const teo = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Teo", username: "teo2010", password: "correct horse battery", birthDate: "2010-03-01", grade: 11 },
      null,
    );
    if (!leo.ok || !teo.ok) throw new Error();

    // Under 13, and a parent-created teen with no email: both reminders go to Rosa.
    for (const child of [leo.value.userId, teo.value.userId]) {
      await signInAs(child);
      expect(await redirectOf(setMyRemindersAction(form({})))).toBe("/dashboard");
      expect(await remindersOf(child)).toBe(true);
    }

    await signInAs(parent.value.userId);
    expect(await redirectOf(setChildRemindersAction(form({ studentId: leo.value.userId })))).toBe("/parent?saved=1");
    expect(await remindersOf(leo.value.userId)).toBe(false);

    // Nor can the child turn them back on behind the parent's back.
    await signInAs(leo.value.userId);
    expect(await redirectOf(setMyRemindersAction(form({ enabled: "on" })))).toBe("/dashboard");
    expect(await remindersOf(leo.value.userId)).toBe(false);

    await signInAs(parent.value.userId);
    expect(await redirectOf(setChildRemindersAction(form({ studentId: leo.value.userId, reminders: "on" })))).toBe("/parent?saved=1");
    expect(await remindersOf(leo.value.userId)).toBe(true);
  });
});
