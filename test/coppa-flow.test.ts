import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteChildAction } from "@/app/actions/parent";
import { type Db, createTestDb, schema } from "@/db";
import {
  authenticate,
  createChildAccount,
  listChildren,
  registerParent,
  registerStudent,
} from "@/lib/accounts";
import { createSession, validateSession } from "@/lib/auth/sessions";
import {
  completeConsentRequest,
  consentLinkStatus,
  createConsentRequest,
  findConsentRequest,
  sweepExpiredConsentRequests,
} from "@/lib/consent/requests";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { deleteParentAccount, deleteStudent, exportStudentData } from "@/lib/privacy";

const today = new Date("2026-09-23T12:00:00Z");
const TWELVE_YEAR_OLD = "2014-03-01";
const FIFTEEN_YEAR_OLD = "2011-01-15";

// The parent's delete form posts to deleteChildAction, which reads these.
const action = vi.hoisted(() => ({ db: null as unknown, parentId: "" }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => action.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => ({ id: action.parentId, role: "parent" }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  action.db = db;
});

async function makeParent(email = "parent@example.com") {
  const res = await registerParent(db, {
    displayName: "Maria",
    email,
    password: "correct horse battery",
  });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

describe("under-13 signup via parental consent", () => {
  it("refuses self-signup for a child under 13", async () => {
    const res = await registerStudent(
      db,
      {
        displayName: "Leo",
        email: "leo@example.com",
        password: "correct horse battery",
        birthDate: TWELVE_YEAR_OLD,
        grade: 7,
      },
      today,
    );
    expect(res).toEqual({ ok: false, error: "under_13" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });

  it("stores only the parent email until consent, then creates the child and forgets the email", async () => {
    const { token } = await createConsentRequest(db, "Parent@Example.com", today);
    const [stored] = await db.select().from(schema.consentRequests);
    expect(stored.parentEmail).toBe("parent@example.com");
    expect(stored.tokenHash).not.toBe(token);

    const request = await findConsentRequest(db, token, today);
    expect(request?.parentEmail).toBe("parent@example.com");

    const parentId = await makeParent();
    const withoutConsent = await createChildAccount(
      db,
      parentId,
      { displayName: "Leo", username: "leo7", password: "correct horse battery", birthDate: TWELVE_YEAR_OLD, grade: 7 },
      null,
      today,
    );
    expect(withoutConsent).toEqual({ ok: false, error: "consent_required" });

    const consent = await verifyParentConsent({ parentUserId: parentId, attested: true });
    expect(consent).not.toBeNull();
    const child = await createChildAccount(
      db,
      parentId,
      { displayName: "Leo", username: "leo7", password: "correct horse battery", birthDate: TWELVE_YEAR_OLD, grade: 7 },
      consent,
      today,
    );
    if (!child.ok) throw new Error(child.error);
    await completeConsentRequest(db, request!.id);

    // The email is gone at once; the link now says it was used, and can't set up a second child.
    const rows = await db.select().from(schema.consentRequests);
    expect(rows.map((r) => r.parentEmail)).toEqual([""]);
    expect(await consentLinkStatus(db, token, today)).toBe("used");
    expect(await findConsentRequest(db, token, today)).toBeNull();
    const [record] = await db.select().from(schema.consentRecords);
    expect(record).toMatchObject({ parentUserId: parentId, studentUserId: child.value.userId, method: "dev_attestation" });

    const [childRow] = await db.select().from(schema.users).where(eq(schema.users.id, child.value.userId));
    expect(childRow).toMatchObject({ email: null, username: "leo7", parentManaged: true });

    expect(await authenticate(db, { identifier: "leo7", password: "correct horse battery" })).toEqual({
      userId: child.value.userId,
    });
  });

  it("deletes the parent email when consent isn't completed in time", async () => {
    const { token } = await createConsentRequest(db, "parent@example.com", today);
    const eightDaysLater = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await findConsentRequest(db, token, eightDaysLater)).toBeNull();
    expect(await consentLinkStatus(db, token, eightDaysLater)).toBe("unavailable");
    expect(await sweepExpiredConsentRequests(db, eightDaysLater)).toBe(1);
    expect(await db.select().from(schema.consentRequests)).toHaveLength(0);
  });

  it("keeps a used link's row, without the email, only until the link would have expired", async () => {
    const used = await createConsentRequest(db, "parent@example.com", today);
    await completeConsentRequest(db, (await findConsentRequest(db, used.token, today))!.id);
    await createConsentRequest(db, "other.parent@example.com", today);
    const eightDaysLater = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);
    // Only the request that was never finished counts as expired.
    expect(await sweepExpiredConsentRequests(db, eightDaysLater)).toBe(1);
    expect(await db.select().from(schema.consentRequests)).toHaveLength(0);
    const [expired] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "consent.request_expired"));
    expect(expired.metadata).toEqual({ count: 1 });
    expect(await consentLinkStatus(db, used.token, eightDaysLater)).toBe("unavailable");
  });
});

describe("parent controls", () => {
  async function parentWithChild() {
    const parentId = await makeParent();
    const consent = await verifyParentConsent({ parentUserId: parentId, attested: true });
    const child = await createChildAccount(
      db,
      parentId,
      { displayName: "Leo", username: "leo7", password: "correct horse battery", birthDate: TWELVE_YEAR_OLD, grade: 7 },
      consent,
      today,
    );
    if (!child.ok) throw new Error(child.error);
    return { parentId, childId: child.value.userId };
  }

  it("lets a parent export their child's data without secrets", async () => {
    const { parentId, childId } = await parentWithChild();
    const data = await exportStudentData(db, parentId, childId);
    expect(data?.profile.displayName).toBe("Leo");
    expect(data?.consentRecords).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/argon2|password/i);
  });

  it("blocks export and deletion by unrelated adults", async () => {
    const { childId } = await parentWithChild();
    const stranger = await makeParent("stranger@example.com");
    expect(await exportStudentData(db, stranger, childId)).toBeNull();
    expect(await deleteStudent(db, stranger, childId)).toBe(false);
  });

  it("never tells a parent an account was deleted when nothing was", async () => {
    const { parentId, childId } = await parentWithChild();
    const stranger = await makeParent("stranger@example.com");
    const submit = async (asParent: string) => {
      action.parentId = asParent;
      const form = new FormData();
      form.set("studentId", childId);
      form.set("confirm", "on");
      return deleteChildAction(form).catch((e: { url?: string }) => e.url);
    };
    // Another family's child (a tampered form): nothing is deleted, and nothing about the child is said.
    expect(await submit(stranger)).toBe("/parent?not-deleted=1");
    expect(await listChildren(db, parentId)).toHaveLength(1);
    expect(await submit(parentId)).toBe("/parent?deleted=1");
    // Sent again from a second tab: already gone.
    expect(await submit(parentId)).toBe("/parent?not-deleted=1");
  });

  it("gives the same neutral notice for a tampered form whose id isn't an account id", async () => {
    const { parentId, childId } = await parentWithChild();
    action.parentId = parentId;
    const submit = (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      return deleteChildAction(form).catch((e: { url?: string }) => e.url);
    };
    for (const studentId of ["not-a-uuid", "", "../../admin", `${parentId}x`]) {
      expect(await submit({ studentId, confirm: "on" })).toBe("/parent?not-deleted=1");
      // Never put in a URL, even when the box isn't ticked.
      expect(await submit({ studentId })).toBe("/parent?not-deleted=1");
    }
    expect(await submit({ confirm: "on" })).toBe("/parent?not-deleted=1");
    expect(await listChildren(db, parentId)).toHaveLength(1);
    // A real id still asks for the box first.
    expect(await submit({ studentId: childId })).toBe(`/parent/children/${childId}/delete?confirm=required`);
  });

  it("deletes everything tied to the child", async () => {
    const { parentId, childId } = await parentWithChild();
    await createSession(db, childId);
    await db.insert(schema.aiUsage).values({ userId: childId, feature: "counselor", model: "m", inputTokens: 1, outputTokens: 1, costMicros: 1 });
    await db.insert(schema.safetyEvents).values({ userId: childId, category: "distress", severity: "low", sources: ["rules"], excerpt: "x" });

    expect(await deleteStudent(db, parentId, childId)).toBe(true);

    expect(await db.select().from(schema.users).where(eq(schema.users.id, childId))).toHaveLength(0);
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
    // AI usage (token counts and cost, no content) stays for spend history, unlinked from the child.
    expect((await db.select().from(schema.aiUsage)).map((u) => u.userId)).toEqual([null]);
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(0);
    expect(await db.select().from(schema.parentStudentLinks)).toHaveLength(0);
    const [record] = await db.select().from(schema.consentRecords);
    expect(record.studentUserId).toBeNull();
    const audits = await db.select().from(schema.auditLog);
    expect(audits.every((a) => a.subjectUserId !== childId)).toBe(true);
  });

  it("deleting a parent removes their under-13 children but only unlinks teens", async () => {
    const { parentId, childId } = await parentWithChild();
    const teen = await createChildAccount(
      db,
      parentId,
      { displayName: "Ana", username: "ana15", password: "correct horse battery", birthDate: FIFTEEN_YEAR_OLD, grade: 10 },
      null,
      today,
    );
    if (!teen.ok) throw new Error(teen.error);
    expect(await listChildren(db, parentId)).toHaveLength(2);
    const base = { category: "self_harm" as const, severity: "high" as const, sources: ["rules"], excerpt: "test" };
    const [childEvent] = await db.insert(schema.safetyEvents).values({ ...base, userId: childId }).returning();
    await db.insert(schema.safetyEvents).values({ ...base, userId: teen.value.userId });

    expect(await deleteParentAccount(db, parentId)).toEqual({ childrenDeleted: 1 });
    const remaining = await db.select({ id: schema.users.id }).from(schema.users);
    expect(remaining.map((r) => r.id)).toEqual([teen.value.userId]);
    expect(remaining.map((r) => r.id)).not.toContain(childId);
    // The deleted child's unreviewed event is noted for staff review numbers; the teen's is still live.
    const noted = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "safety.deleted_unreviewed"));
    expect(noted.map((a) => a.metadata)).toEqual([{ eventId: childEvent.id, severity: "high", flaggedAt: childEvent.createdAt.toISOString() }]);
  });
});

describe("accounts and sessions", () => {
  it("rejects duplicate emails regardless of case", async () => {
    await makeParent("Parent@Example.com");
    const res = await registerParent(db, { displayName: "X", email: "parent@example.com", password: "correct horse battery" });
    expect(res).toEqual({ ok: false, error: "email_taken" });
  });

  it("rejects a wrong password and unknown accounts", async () => {
    await makeParent();
    expect(await authenticate(db, { identifier: "parent@example.com", password: "wrong password!" })).toBeNull();
    expect(await authenticate(db, { identifier: "nobody@example.com", password: "whatever" })).toBeNull();
  });

  it("validates, renews and expires sessions", async () => {
    const parentId = await makeParent();
    const { token } = await createSession(db, parentId, today);
    const valid = await validateSession(db, token, today);
    expect(valid?.user.id).toBe(parentId);

    const tenDaysLater = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
    const renewed = await validateSession(db, token, tenDaysLater);
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(tenDaysLater.getTime() + 13 * 24 * 60 * 60 * 1000);

    const muchLater = new Date(tenDaysLater.getTime() + 15 * 24 * 60 * 60 * 1000);
    expect(await validateSession(db, token, muchLater)).toBeNull();
    expect(await validateSession(db, "forged-token", today)).toBeNull();
  });
});
