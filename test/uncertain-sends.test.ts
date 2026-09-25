import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestParentConsentAction } from "@/app/actions/auth";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { findConsentRequest } from "@/lib/consent/requests";
import { type Email, EmailSendError } from "@/lib/email";
import { createInvite, findInvite, listPendingInvites } from "@/lib/invites";

// When Resend takes an email but answers too late, the email may still arrive. Its link must keep
// working (the consent request or invitation expires on its own), and the person is told it may
// take a few minutes. Only a definite failure takes the link back.

const state = vi.hoisted(() => ({
  db: null as unknown,
  send: null as null | ((email: Email) => Promise<void>),
  ipKey: "hashed-203.0.113.9",
}));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "203.0.113.9", clientIpKey: async () => state.ipKey }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmail: (email: Email) => state.send!(email),
}));

const now = new Date("2026-09-24T15:00:00Z");
const APP = "https://compass.example";
const PARENT_EMAIL = "rosa.parent@example.com";
const uncertain = () => new EmailSendError("resend", null, "timeout", true);
const refused = () => new EmailSendError("resend", 422, "validation_error");

let db: Db;
let emailed: Email[];
let logs: string[];

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.ipKey = "hashed-203.0.113.9";
  emailed = [];
  logs = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});

/** Sends through a provider that takes the email, then fails the way `error` says. */
function failingWith(error: () => Error) {
  state.send = async (email) => {
    emailed.push(email);
    throw error();
  };
  return async (email: Email) => state.send!(email);
}

function tokenIn(email: Email, path: string) {
  return new RegExp(`${path}/(\\S+)`).exec(email.text)![1];
}

describe("parent consent email (under-13 signup)", () => {
  const ask = () => {
    const form = new FormData();
    form.set("parentEmail", PARENT_EMAIL);
    return requestParentConsentAction(undefined, form);
  };

  it("keeps the request and says the email may be delayed when Resend didn't answer in time", async () => {
    failingWith(uncertain);
    expect(await ask()).toEqual({ sent: true, delayed: true });

    const token = tokenIn(emailed[0], "/parent/consent");
    expect(await findConsentRequest(db, token)).toMatchObject({ parentEmail: PARENT_EMAIL });
    // The log line says what happened without the address.
    expect(logs.join("\n")).toContain("[consent] email may be delayed");
    expect(logs.join("\n")).not.toContain(PARENT_EMAIL);
  });

  it("cancels the request and asks to try again when the email definitely didn't go out", async () => {
    failingWith(refused);
    expect(await ask()).toEqual({ message: "We couldn't send the email right now. Please try again in a few minutes." });
    expect(await db.select().from(schema.consentRequests)).toHaveLength(0);
  });

  it("doesn't count an email the provider failed to send against the address or the network", async () => {
    // Failures on the provider's side (or a bad key), none of them about this email: more of them
    // than the address (3 a day) or the network (10 an hour) would allow.
    const providerFailures = [
      new EmailSendError("resend", 500, "application_error"),
      new EmailSendError("resend", 503, "service_unavailable"),
      new EmailSendError("resend", null, "network_error"),
      new EmailSendError("resend", null, "timeout"),
      new EmailSendError("resend", 429, "rate_limit_exceeded"),
      new EmailSendError("resend", 429, "daily_quota_exceeded"),
      new EmailSendError("resend", null, "missing_api_key"),
      new EmailSendError("resend", 401, "missing_api_key"),
      new EmailSendError("resend", 401, "restricted_api_key"),
      new EmailSendError("resend", 403, "invalid_api_key"),
      new EmailSendError("resend", 403, "suspended_api_key"),
      new Error("unexpected"),
    ];
    for (const error of providerFailures) {
      failingWith(() => error);
      expect(await ask()).toEqual({ message: "We couldn't send the email right now. Please try again in a few minutes." });
    }
    state.send = async (email) => void emailed.push(email);
    expect(await ask()).toEqual({ sent: true });
    expect(await db.select().from(schema.consentRequests)).toHaveLength(1);
  });

  it("counts an email Resend refused against the network, but not against the address", async () => {
    failingWith(refused);
    // The network allows 10 an hour, and a refused email still uses one up.
    for (let i = 0; i < 10; i++) {
      expect(await ask()).toEqual({ message: "We couldn't send the email right now. Please try again in a few minutes." });
    }
    expect(await ask()).toEqual({
      message: "A lot of parent emails were just sent from here, so we can't send yours right now. Please try again in an hour.",
    });
    expect(emailed).toHaveLength(10);

    // The address (3 a day) got its tries back: from another network, its email goes out.
    state.ipKey = "hashed-198.51.100.7";
    state.send = async (email) => void emailed.push(email);
    expect(await ask()).toEqual({ sent: true });
    expect(await db.select().from(schema.consentRequests)).toHaveLength(1);
  });

  it("still counts an email that may be delayed", async () => {
    failingWith(uncertain);
    for (let i = 0; i < 3; i++) expect(await ask()).toEqual({ sent: true, delayed: true });
    expect(await ask()).toMatchObject({ message: expect.stringContaining("We've already sent a few emails to that address today.") });
  });

  it("says sent when the email went out", async () => {
    state.send = async (email) => void emailed.push(email);
    expect(await ask()).toEqual({ sent: true });
    expect(await db.select().from(schema.consentRequests)).toHaveLength(1);
  });
});

describe("parent invitation email (teens who signed up on their own)", () => {
  async function teen() {
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    return res.value.userId;
  }

  it("keeps the invitation working when Resend may still deliver the email", async () => {
    const studentId = await teen();
    const res = await createInvite(db, studentId, PARENT_EMAIL, { appUrl: APP, now, send: failingWith(uncertain) });
    expect(res).toMatchObject({ ok: true, delayed: true });

    const token = tokenIn(emailed[0], "/invite");
    expect(await findInvite(db, token, now)).toMatchObject({ status: "pending", studentId });
    expect(await listPendingInvites(db, studentId, now)).toHaveLength(1);
  });

  it("removes the invitation when Resend refused the email outright", async () => {
    const studentId = await teen();
    const res = await createInvite(db, studentId, PARENT_EMAIL, { appUrl: APP, now, send: failingWith(refused) });
    expect(res).toEqual({ ok: false, error: "send_failed" });
    expect(await findInvite(db, tokenIn(emailed[0], "/invite"), now)).toEqual({ status: "not_found" });
  });

  it("doesn't mark a normal send as delayed", async () => {
    const studentId = await teen();
    const res = await createInvite(db, studentId, PARENT_EMAIL, { appUrl: APP, now, send: async () => {} });
    expect(res.ok && "delayed" in res).toBe(false);
  });
});
