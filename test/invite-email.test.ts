import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { hashToken } from "@/lib/auth/tokens";
import type { Email } from "@/lib/email";
import {
  EMAIL_NAME_MAX,
  MAX_INVITES_PER_RECIPIENT_PER_DAY,
  createInvite,
  inviteEmail,
  inviteEmailName,
  inviteRecipientKey,
} from "@/lib/invites";

// The invitation email goes to someone who never signed up, from our domain, so nothing a student
// typed may turn it into spam: no links or odd characters in the name, and a daily cap per address.

const now = new Date("2026-09-24T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const LINK = "https://compass.example/invite/abc123";

describe("the student's name in the invitation email", () => {
  it("keeps plain names in any language", () => {
    for (const name of ["Ana", "Ana Sofía", "O'Brien", "D’Angelo", "Mary-Jane", "Zoë", "Nguyễn Văn An", "李小龙"]) {
      expect(inviteEmailName(name)).toBe(name.normalize("NFC"));
    }
    expect(inviteEmailName("  Ana \t Lu ")).toBe("Ana Lu");
  });

  it("refuses links, addresses, numbers, symbols and control characters", () => {
    for (const name of [
      "https://evil.example/claim-gift",
      "evil.example",
      "www.evil.example",
      "ana@example.com",
      "Call 555 0100",
      "Ana2",
      "Win $100",
      "Ana\r\nBcc: x@example.com",
      "Ana\u0000",
      "Ana‮evil",
      "Ana​evil",
      "--",
      "Ana  - Lu",
      "",
    ]) {
      expect(inviteEmailName(name), JSON.stringify(name)).toBeNull();
    }
  });

  it("caps its length", () => {
    expect(inviteEmailName("A".repeat(EMAIL_NAME_MAX))).toBe("A".repeat(EMAIL_NAME_MAX));
    expect(inviteEmailName("A".repeat(EMAIL_NAME_MAX + 1))).toBeNull();
  });
});

describe("the invitation email", () => {
  it("keeps the name out of the subject and shows a plain name in the body", () => {
    const email = inviteEmail("rosa@example.com", "Ana", LINK);
    expect(email.subject).toBe("A student invited you to College Compass");
    expect(email.text).toContain("Ana uses College Compass");
    expect(email.text).toContain(LINK);
  });

  it("says why the address is kept and when it's deleted", () => {
    expect(inviteEmail("rosa@example.com", "Ana", LINK).text).toContain(
      "We keep your email address only to show Ana where this invitation went. If nobody accepts it, we delete your address after the link expires. We won't write to you again about this.",
    );
    expect(inviteEmail("rosa@example.com", "https://evil.example", LINK).text).toContain("only to show the student where this invitation went");
  });

  it("says 'A student' instead of a name that could be a link or spam", () => {
    for (const name of ["https://evil.example/claim-gift", "Ana\r\nBcc: x@example.com", "x".repeat(40)]) {
      const email = inviteEmail("rosa@example.com", name, LINK);
      expect(email.subject).toBe("A student invited you to College Compass");
      expect(email.text).toContain("A student uses College Compass");
      expect(email.text).not.toMatch(/evil|Bcc|xxxx/);
      // The only link is ours.
      expect(email.text.match(/https?:\/\/\S+/g)).toEqual([LINK]);
      expect(email.text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    }
  });

  it("matches what a linked parent can do and what stays private", () => {
    const { text } = inviteEmail("rosa@example.com", "Ana", LINK);
    expect(text).toContain("see their progress and results: interest areas, strengths, top career matches, goals, roadmap, classes and college list");
    expect(text).toContain("change their grade and their weekly reminder emails");
    expect(text).toContain("manage your family's plan and billing");
    expect(text).toContain("download a copy of their data, or delete their account");
    expect(text).toContain("Their chats with the AI counselor stay private to them.");
    expect(text).toContain("leaves them out, along with the counselor's notes and any safety flags");
  });
});

describe("invitations to one address", () => {
  let db: Db;
  let sent: Email[];
  const send = async (email: Email) => void sent.push(email);

  beforeEach(async () => {
    db = await createTestDb();
    sent = [];
  });

  async function teen(i: number) {
    const res = await registerStudent(
      db,
      { displayName: `Teen`, email: `teen${i}@example.com`, password: "correct horse battery", birthDate: "2010-05-01", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    return res.value.userId;
  }

  it(`are capped at ${MAX_INVITES_PER_RECIPIENT_PER_DAY} a day, however many students send them`, async () => {
    // The same mailbox, written different ways.
    const variants = ["rosa.parent@example.com", "Rosa.Parent@Example.com", "rosa.parent+cc@example.com", " ROSA.PARENT@example.com "];
    const results = [];
    for (let i = 0; i < variants.length; i++) {
      results.push(await createInvite(db, await teen(i), variants[i], { appUrl: "https://compass.example", send, now }));
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, error: "rate_limited" });
    expect(sent).toHaveLength(MAX_INVITES_PER_RECIPIENT_PER_DAY);

    // Someone else can still be invited, and the address can be again the next day.
    const other = await teen(10);
    expect((await createInvite(db, other, "sam@example.com", { appUrl: "https://compass.example", send, now })).ok).toBe(true);
    const tomorrow = new Date(now.getTime() + DAY);
    expect((await createInvite(db, other, "rosa.parent@example.com", { appUrl: "https://compass.example", send, now: tomorrow })).ok).toBe(true);

    // Neither the address nor a plain hash of it is stored.
    const limits = JSON.stringify(await db.select().from(schema.rateLimits)).toLowerCase();
    expect(limits).not.toContain("rosa");
    expect(limits).not.toContain(hashToken("rosa.parent@example.com").toLowerCase());
  });

  it("uses a key that changes every day and ignores plus-tags and Gmail dots", () => {
    const key = inviteRecipientKey("rosa.parent@gmail.com", now);
    expect(inviteRecipientKey("RosaParent+school@googlemail.com", now)).toBe(key);
    expect(inviteRecipientKey("rosa.parent@gmail.com", new Date(now.getTime() + DAY))).not.toBe(key);
    expect(inviteRecipientKey("rosa.parent@example.com", now)).not.toBe(inviteRecipientKey("rosaparent@example.com", now));
    expect(key).not.toContain("rosa");
  });
});
