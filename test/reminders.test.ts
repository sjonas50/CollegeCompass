import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { type Email, EmailSendError, type SendDeps, sendWithResend } from "@/lib/email";
import { deleteParentAccount } from "@/lib/privacy";
import {
  buildWeeklyReminders,
  claimReminder,
  markReminderSent,
  releaseReminder,
  reminderGoesToParent,
  reminderIdempotencyKey,
  reminderSettingFor,
  sendWeeklyReminders,
  setRemindersEnabled,
  weeklyReminderBatches,
} from "@/lib/reminders";
import { MILESTONES } from "@/lib/roadmap/milestones";

// The cron's first scheduled instant: Monday 13:00 UTC.
const now = new Date("2026-10-05T13:00:00Z");
const thisWeek = "2026-10-05";
const lastWeek = "2026-09-28";
const APP = "http://localhost:3000";
const MIN = 60_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function teen(grade = 12, email = "ana@example.com") {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email, password: "correct horse battery", birthDate: "2008-12-01", grade },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parentWithChild(birthDate: string, grade: number, parentEmail = "rosa@example.com") {
  const parent = await registerParent(db, { displayName: "Rosa", email: parentEmail, password: "correct horse battery" });
  if (!parent.ok) throw new Error();
  const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
  const child = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Leo", username: `leo${grade}${birthDate.slice(0, 4)}`, password: "correct horse battery", birthDate, grade },
    consent,
    new Date("2026-01-10T12:00:00Z"),
  );
  if (!child.ok) throw new Error(child.error);
  return { parentId: parent.value.userId, childId: child.value.userId };
}

describe("weekly reminders (Monday 13:00 UTC)", () => {
  it("looks back at last week's finished and open steps and ahead at timely milestones", async () => {
    const id = await teen(10);
    await db.insert(schema.weeklySteps).values([
      { userId: id, weekStart: lastWeek, text: "Visit a campus", status: "done" },
      { userId: id, weekStart: lastWeek, text: "Ask about PSAT", status: "open" },
    ]);
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("ana@example.com");
    expect(r.email.text).toContain("Last week you finished:\n- Visit a campus");
    expect(r.email.text).toContain("Still open from last week");
    expect(r.email.text).toContain("- Ask about PSAT");
    expect(r.weekStart).toBe(thisWeek);
  });

  it("skips students whose family has no access (the roadmap and steps are locked)", async () => {
    const id = await teen(12);
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Ask about dual enrollment" });
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(1);
    await db.delete(schema.accessGrants);
    await db.insert(schema.billingAccounts).values({
      householdId: (await db.select().from(schema.users))[0].householdId!,
      stripeCustomerId: "cus_x",
      status: "canceled",
    });
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
  });

  it("lists unsent college-list deadlines in the next two weeks", async () => {
    const id = await teen(12);
    await db.insert(schema.collegeList).values([
      { userId: id, name: "State University", deadline: "2026-10-15" },
      { userId: id, name: "Sent Already College", deadline: "2026-10-10", status: "applied" },
      { userId: id, name: "Far Away College", deadline: "2026-11-30" },
    ]);
    const [reminder] = await buildWeeklyReminders(db, APP, now);
    expect(reminder.email.text).toContain("Deadlines on your college list in the next two weeks:");
    expect(reminder.email.text).toContain("- State University: ");
    expect(reminder.email.text).not.toContain("Sent Already College");
    expect(reminder.email.text).not.toContain("Far Away College");
  });

  it("still sends graduates who track applications their list deadlines", async () => {
    const id = await teen(12);
    // Finished 12th grade last school year, like a gap-year applicant.
    await db.update(schema.users).set({ gradeSchoolYear: 2025 }).where(eq(schema.users.id, id));
    // The weekly roundup stops after high school...
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Email the admissions office" });
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);

    // ...but deadlines on their college list still come through.
    await db.insert(schema.collegeList).values({ userId: id, name: "Gap year: State U", deadline: "2026-10-15" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("ana@example.com");
    expect(r.email.text).toContain("Deadlines on your college list in the next two weeks:\n- Gap year: State U: October 15, 2026 (in 10 days)");
    expect(r.email.text).not.toContain("Email the admissions office");
    expect(r.email.text).not.toContain("Timely for you this month");
  });

  it("claims each send so a re-run never double-sends, and a released claim is retried", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: lastWeek, text: "Make an FSA ID" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(await claimReminder(db, r)).toBe(true);
    expect(await claimReminder(db, r)).toBe(false);
    await releaseReminder(db, r);
    expect(await claimReminder(db, r)).toBe(true);
  });

  it("skips students with nothing to do or reminders turned off", async () => {
    const id = await teen();
    // Mark every 12th-grade milestone timely in October as handled.
    const timely = MILESTONES.filter((m) => m.grade === 12 && m.months.includes(10));
    await db.insert(schema.studentMilestones).values(timely.map((m) => ({ userId: id, milestoneId: m.id, status: "done" as const })));
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Visit a campus" });
    await setRemindersEnabled(db, id, false);
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
  });

  it("sends an under-13 student's reminder to every linked parent, never to the child", async () => {
    const { childId } = await parentWithChild("2014-03-01", 7);
    const second = await registerParent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery" });
    if (!second.ok) throw new Error();
    await db.insert(schema.parentStudentLinks).values({ parentUserId: second.value.userId, studentUserId: childId });
    await db.insert(schema.weeklySteps).values({ userId: childId, weekStart: lastWeek, text: "Try the robotics club", status: "done" });
    const reminders = await buildWeeklyReminders(db, APP, now);
    expect(reminders.map((r) => r.email.to).sort()).toEqual(["rosa@example.com", "sam@example.com"]);
    expect(new Set(reminders.map((r) => r.recipientKey)).size).toBe(2);
    expect(reminders[0].email.subject).toBe("Leo's week in College Compass");
    expect(reminders[0].email.text).toContain("Last week Leo finished:");
  });

  it("keeps sending a parent-created account's reminders to the parent after the child turns 13", async () => {
    const { childId } = await parentWithChild("2013-06-01", 8); // 13 by October 2026, no email of their own
    await db.insert(schema.weeklySteps).values({ userId: childId, weekStart: thisWeek, text: "Pick an elective" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("rosa@example.com");
  });

  it("uses one recipient rule everywhere", () => {
    expect(reminderGoesToParent({ email: null, birthDate: "2008-01-01" }, now)).toBe(true);
    expect(reminderGoesToParent({ email: "k@example.com", birthDate: "2015-01-01" }, now)).toBe(true);
    expect(reminderGoesToParent({ email: "k@example.com", birthDate: "2008-01-01" }, now)).toBe(false);
  });

  it("never includes counselor conversations", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Ask about dual enrollment" });
    const [conv] = await db.insert(schema.counselorConversations).values({ userId: id }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: "SECRET-CHAT-CONTENT" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.text).not.toContain("SECRET-CHAT-CONTENT");
  });

  it("pages through students in batches", async () => {
    for (let i = 0; i < 3; i++) {
      const id = await teen(12, `s${i}@example.com`);
      await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: `Step ${i}` });
    }
    const sizes: number[] = [];
    const seen = new Set<string>();
    for await (const batch of weeklyReminderBatches(db, APP, now, 2)) {
      sizes.push(batch.length);
      for (const r of batch) seen.add(r.email.to);
    }
    expect(sizes).toEqual([2, 1]);
    expect(seen.size).toBe(3);
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(3);
  });
});

async function teensWithSteps(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await teen(12, `s${i}@example.com`);
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: `Step ${i}` });
    ids.push(id);
  }
  return ids;
}

/** Makes one student's writes to reminder_sends fail, the way a dropped connection would. */
async function failWritesFor(userId: string, op: "INSERT" | "UPDATE" | "DELETE") {
  const row = op === "DELETE" ? "OLD" : "NEW";
  const name = `fail_${op.toLowerCase()}`;
  await db.execute(
    sql.raw(`
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${row}.user_id = '${userId}' THEN RAISE EXCEPTION 'simulated database error'; END IF;
        RETURN ${row};
      END $$;
    `),
  );
  await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE ${op} ON reminder_sends FOR EACH ROW EXECUTE FUNCTION ${name}()`));
}

const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("reminder claims", () => {
  it("keeps a claim unsent until the send is marked, and re-claims it only once it is 15 minutes stale", async () => {
    const [id] = await teensWithSteps(1);
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.userId).toBe(id);
    expect(await claimReminder(db, r, now)).toBe(true);
    const [claim] = await db.select().from(schema.reminderSends);
    expect(claim.sentAt).toBeNull();
    expect(claim.claimedAt.getTime()).toBe(now.getTime());

    expect(await claimReminder(db, r, new Date(now.getTime() + 14 * MIN))).toBe(false);
    const later = new Date(now.getTime() + 16 * MIN);
    expect(await claimReminder(db, r, later)).toBe(true);
    await markReminderSent(db, r, later);
    const [sent] = await db.select().from(schema.reminderSends);
    expect(sent.sentAt?.getTime()).toBe(later.getTime());
    // A sent reminder is never claimed again, however old, and releasing never undoes a send.
    expect(await claimReminder(db, r, new Date(now.getTime() + 300 * MIN))).toBe(false);
    await releaseReminder(db, r);
    expect(await db.select().from(schema.reminderSends)).toHaveLength(1);
  });

  it("treats a legacy send with no recipient as already sent for that student and week", async () => {
    const [id] = await teensWithSteps(1);
    await db.insert(schema.reminderSends).values({ userId: id, weekStart: thisWeek, sentAt: new Date("2026-10-05T13:00:05Z") });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(await claimReminder(db, r, now)).toBe(false);
    const send = vi.fn(async (_: Email) => {});
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 0, skipped: 1, failed: 0, uncertain: 0, more: false });
    expect(send).not.toHaveBeenCalled();

    // Last week's legacy row doesn't block this week.
    await db.delete(schema.reminderSends);
    await db.insert(schema.reminderSends).values({ userId: id, weekStart: lastWeek, sentAt: new Date("2026-09-28T13:00:05Z") });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toMatchObject({ sent: 1 });
  });
});

describe("weekly reminder run", () => {
  it("sends each reminder once, marks it sent, and a later run the same day sends nothing new", async () => {
    await teensWithSteps(2);
    const send = vi.fn(async (_: Email) => {});
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 2, skipped: 0, failed: 0, uncertain: 0, more: false });
    const rows = await db.select().from(schema.reminderSends);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
    const later = new Date(now.getTime() + 60 * MIN);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toEqual({ sent: 0, skipped: 2, failed: 0, uncertain: 0, more: false });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops at its time budget, says more work remains, and a later run finishes the week", async () => {
    await teensWithSteps(5);
    const sentTo: string[] = [];
    const run = async (start: Date) => {
      let elapsed = 0;
      return sendWeeklyReminders(db, {
        appUrl: APP,
        now: start,
        clock: () => start.getTime() + elapsed,
        deadline: start.getTime() + 250_000,
        batchSize: 2,
        concurrency: 1,
        send: async (email) => {
          sentTo.push(email.to);
          elapsed += 100_000; // a slow provider: 100 s per email
        },
      });
    };
    expect(await run(now)).toEqual({ sent: 3, skipped: 0, failed: 0, uncertain: 0, more: true });
    expect(await run(new Date(now.getTime() + 60 * MIN))).toEqual({ sent: 2, skipped: 3, failed: 0, uncertain: 0, more: false });
    expect(sentTo.sort()).toEqual(["s0", "s1", "s2", "s3", "s4"].map((s) => `${s}@example.com`));
  });

  it("retries a claim left behind by a run that was killed mid-send, once it is stale", async () => {
    await teensWithSteps(1);
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(await claimReminder(db, r, now)).toBe(true); // the killed run got this far
    const send = vi.fn(async (_: Email) => {});
    const at = (minutes: number) => new Date(now.getTime() + minutes * MIN);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: at(5) })).toMatchObject({ sent: 0, skipped: 1 });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: at(60) })).toMatchObject({ sent: 1, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one recipient's claim hits a database error", async () => {
    const log = quietly();
    const [a] = await teensWithSteps(3);
    await failWritesFor(a, "INSERT");
    const send = vi.fn(async (_: Email) => {});
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 2, skipped: 0, failed: 1, uncertain: 0, more: false });
    expect(send.mock.calls.map(([e]) => e.to).sort()).toEqual(["s1@example.com", "s2@example.com"]);
    expect(log).toHaveBeenCalled();
  });

  it("keeps going when releasing a failed send hits a database error, and a later run retries it", async () => {
    quietly();
    const [, b] = await teensWithSteps(3);
    await failWritesFor(b, "DELETE");
    const send = vi.fn(async (email: Email) => {
      if (email.to === "s1@example.com") throw new Error("provider down");
    });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 2, skipped: 0, failed: 1, uncertain: 0, more: false });

    await db.execute(sql.raw("DROP TRIGGER fail_delete ON reminder_sends"));
    send.mockImplementation(async () => {});
    // The claim that couldn't be released goes stale, and the next hourly run sends it.
    const later = new Date(now.getTime() + 60 * MIN);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toEqual({ sent: 1, skipped: 2, failed: 0, uncertain: 0, more: false });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ to: "s1@example.com" }));
  });

  it("counts a send as sent when marking it fails, never releases it, and keeps going", async () => {
    quietly();
    const [a] = await teensWithSteps(2);
    await failWritesFor(a, "UPDATE");
    const send = vi.fn(async (_: Email) => {});
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 2, skipped: 0, failed: 0, uncertain: 0, more: false });
    expect(await db.select().from(schema.reminderSends)).toHaveLength(2);
  });
});

const RESEND = { apiKey: "re_test_key", from: "College Compass <hello@mail.example.org>" };
const resendJson = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A stand-in for Resend's API, as its docs describe it: at most 10 requests in any second (then
 * 429 with Retry-After: 1), and idempotency keys kept for the day. A repeated key gets the first
 * answer back, or 409 concurrent_idempotent_requests while the first is still going, or 409
 * invalid_idempotent_request with a different body. Like a real server, a request keeps going
 * after the caller stops waiting for it.
 */
function fakeResend(latencyMs: (request: number) => number = () => 5) {
  const starts: number[] = [];
  const delivered: string[] = [];
  const keys = new Map<string, { body: string; done: boolean }>();
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const now = performance.now();
    const request = starts.push(now) - 1;
    if (starts.filter((t) => t > now - 1000).length > 10) {
      return resendJson(429, { name: "rate_limit_exceeded" }, { "retry-after": "1" });
    }
    const key = new Headers(init?.headers).get("idempotency-key") ?? `none-${request}`;
    const body = String(init?.body);
    const seen = keys.get(key);
    if (seen) {
      if (seen.body !== body) return resendJson(409, { name: "invalid_idempotent_request" });
      return seen.done ? resendJson(200, { id: key }) : resendJson(409, { name: "concurrent_idempotent_requests" });
    }
    const entry = { body, done: false };
    keys.set(key, entry);
    const finished = pause(latencyMs(request)).then(() => {
      entry.done = true;
      delivered.push(JSON.parse(body).to[0]);
    });
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      void finished.then(() => resolve(resendJson(200, { id: key })));
    });
  }) as typeof globalThis.fetch;
  /** The most requests that started within any one second. */
  const busiestSecond = () => Math.max(0, ...starts.map((t) => starts.filter((u) => u >= t && u < t + 1000).length));
  return { fetch, starts, delivered, busiestSecond };
}

describe("sending pace and idempotency", () => {
  it("stays under Resend's limit of 10 requests a second, so no reminder is lost to a 429", async () => {
    await teensWithSteps(12);
    const resend = fakeResend();
    const send = (email: Email) => sendWithResend(email, RESEND, { fetch: resend.fetch });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 12, skipped: 0, failed: 0, uncertain: 0, more: false });
    expect(resend.delivered).toHaveLength(12);
    // 8 start a second by design. A pause in the test process can bunch a couple of starts
    // together, which Resend's limit of 10 still allows.
    expect(resend.busiestSecond()).toBeLessThanOrEqual(10);
    expect(resend.starts.at(-1)! - resend.starts[0]).toBeGreaterThanOrEqual(11 * 125 - 5);
  });

  it("gives every reminder a key of its own that stays the same on every run, with no id or address in it", async () => {
    const { parentId, childId } = await parentWithChild("2014-03-01", 7);
    const second = await registerParent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery" });
    if (!second.ok) throw new Error();
    await db.insert(schema.parentStudentLinks).values({ parentUserId: second.value.userId, studentUserId: childId });
    await db.insert(schema.weeklySteps).values({ userId: childId, weekStart: thisWeek, text: "Try the robotics club" });
    const keysBy = new Map<string, string[]>();
    const send = vi.fn(async (email: Email) => {
      keysBy.set(email.to, [...(keysBy.get(email.to) ?? []), email.idempotencyKey!]);
      throw new Error("provider down");
    });
    quietly();
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toMatchObject({ failed: 2 });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: new Date(now.getTime() + 60 * MIN) })).toMatchObject({ failed: 2 });

    const rosa = keysBy.get("rosa@example.com")!;
    const sam = keysBy.get("sam@example.com")!;
    expect(rosa).toHaveLength(2);
    expect(rosa[0]).toBe(rosa[1]);
    expect(sam[0]).toBe(sam[1]);
    expect(rosa[0]).not.toBe(sam[0]);
    const reminders = await buildWeeklyReminders(db, APP, now);
    expect(new Set(reminders.map(reminderIdempotencyKey))).toEqual(new Set([rosa[0], sam[0]]));
    for (const key of [rosa[0], sam[0]]) {
      expect(key).toMatch(/^cc-reminder-[0-9a-f]{64}$/);
      for (const secret of [childId, parentId, "rosa", "sam", thisWeek]) expect(key).not.toContain(secret);
    }
  });

  it("never sends a reminder twice when Resend takes it but answers too late", async () => {
    quietly();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await teensWithSteps(1);
    // The first request takes a second; each try gives up after 50 ms, and waits are 1/20 as long.
    const resend = fakeResend((request) => (request === 0 ? 1_000 : 5));
    const deps: SendDeps = { fetch: resend.fetch, timeoutMs: 50, sleep: (ms) => pause(ms / 20), limiter: async () => {} };
    const send = (email: Email) => sendWithResend(email, RESEND, deps);

    // Tries: a timeout, then "still in progress" twice. The email may have gone out.
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 0, skipped: 0, failed: 0, uncertain: 1, more: false });
    expect(await db.select().from(schema.reminderSends)).toHaveLength(0); // released for the next run
    while (resend.delivered.length === 0) await pause(20);

    // A re-run tries again with the same key, and Resend answers with the first send.
    const later = new Date(now.getTime() + 10 * MIN);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toEqual({ sent: 1, skipped: 0, failed: 0, uncertain: 0, more: false });
    expect(resend.delivered).toEqual(["s0@example.com"]);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toMatchObject({ sent: 0, skipped: 1 });
    expect(resend.delivered).toHaveLength(1);
  });

  it("counts a reminder as done when Resend already took it and its text has changed since", async () => {
    quietly();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [id] = await teensWithSteps(1);
    const resend = fakeResend((request) => (request === 0 ? 1_000 : 5));
    const deps: SendDeps = { fetch: resend.fetch, timeoutMs: 50, sleep: (ms) => pause(ms / 20), limiter: async () => {} };
    const send = vi.fn((email: Email) => sendWithResend(email, RESEND, deps));
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toMatchObject({ uncertain: 1 });
    while (resend.delivered.length === 0) await pause(20);

    // The student adds a step before the re-run, so the email's text is different now.
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Visit a campus" });
    const later = new Date(now.getTime() + 10 * MIN);
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toEqual({ sent: 0, skipped: 1, failed: 0, uncertain: 0, more: false });
    const [row] = await db.select().from(schema.reminderSends);
    expect(row.sentAt).not.toBeNull();

    send.mockClear();
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now: later })).toMatchObject({ skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(resend.delivered).toHaveLength(1);
  });

  it("releases an uncertain send and counts it apart from failures", async () => {
    quietly();
    await teensWithSteps(2);
    const send = vi.fn(async (email: Email) => {
      if (email.to === "s0@example.com") throw new EmailSendError("resend", null, "timeout", true);
      throw new EmailSendError("resend", 422, "validation_error");
    });
    expect(await sendWeeklyReminders(db, { appUrl: APP, send, now })).toEqual({ sent: 0, skipped: 0, failed: 1, uncertain: 1, more: false });
    expect(await db.select().from(schema.reminderSends)).toHaveLength(0);
  });
});

describe("where the dashboard says reminders go", () => {
  it("names the student's own inbox or the parent's, and whether the parent turned them off", async () => {
    const id = await teen();
    expect(await reminderSettingFor(db, id, now)).toEqual({ kind: "self", enabled: true });

    const { childId } = await parentWithChild("2014-09-01", 7);
    expect(await reminderSettingFor(db, childId, now)).toEqual({ kind: "parent", enabled: true });
    await setRemindersEnabled(db, childId, false);
    expect(await reminderSettingFor(db, childId, now)).toEqual({ kind: "parent", enabled: false });
  });

  it("doesn't claim reminders go to a parent once a parent-created teen has no parent left", async () => {
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    const created = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Teo", username: "teo2011", password: "correct horse battery", birthDate: "2011-01-01", grade: 10 },
      null,
      new Date("2026-01-10T12:00:00Z"),
    );
    if (!created.ok) throw new Error(created.error);
    const teo = created.value.userId;
    await db.insert(schema.weeklySteps).values({ userId: teo, weekStart: thisWeek, text: "Pick an elective" });
    expect(await reminderSettingFor(db, teo, now)).toEqual({ kind: "parent", enabled: true });

    await deleteParentAccount(db, parent.value.userId); // Teo owns his account, so he is only unlinked
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
    expect(await reminderSettingFor(db, teo, now)).toEqual({ kind: "none" });
  });
});
