import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvitePage from "@/app/invite/[token]/page";
import ParentHome from "@/app/parent/page";
import PrivacyPage from "@/app/privacy/page";
import { InviteParentCard } from "@/components/invite-parent";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import type { Email } from "@/lib/email";
import { acceptInvite, createInvite } from "@/lib/invites";
import { exportStudentData } from "@/lib/privacy";

// What the parent page, the invite card and the invitation page promise about a linked parent
// has to match what exportStudentData actually hands over.

const page = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => page.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => page.user, getCurrentUser: async () => page.user }));

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  page.db = db;
});
afterEach(() => {
  page.user = null;
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => text(renderToStaticMarkup(await node));

async function signIn(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  page.user = { id: u.id, role: u.role, displayName: u.displayName, username: u.username, householdId: u.householdId, parentManaged: u.parentManaged, grade: u.grade };
}

async function family() {
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
  const teen = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    new Date(),
  );
  if (!parent.ok || !teen.ok) throw new Error();
  const rosa = parent.value.userId;
  const ana = teen.value.userId;
  const sent: Email[] = [];
  await createInvite(db, ana, "rosa@example.com", { appUrl: "https://compass.example", send: async (e) => void sent.push(e) });
  const token = /\/invite\/(\S+)/.exec(sent[0].text)![1];
  const accepted = await acceptInvite(db, token, rosa);
  if (!accepted.ok) throw new Error(accepted.error);

  const consent = await verifyParentConsent({ parentUserId: rosa, attested: true });
  const leo = await createChildAccount(
    db,
    rosa,
    { displayName: "Leo", username: "leo12", password: "correct horse battery", birthDate: "2014-03-01", grade: 7 },
    consent,
  );
  if (!leo.ok) throw new Error(leo.error);

  for (const userId of [ana, leo.value.userId]) {
    const [c] = await db.insert(schema.counselorConversations).values({ userId, title: "SECRET-TITLE" }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: c.id, role: "user", content: "SECRET-MESSAGE" });
  }
  return { rosa, ana, leo: leo.value.userId };
}

describe("privacy promises", () => {
  it("the parent page says what each child's download holds, and that's what it holds", async () => {
    const { rosa, ana, leo } = await family();
    await signIn(rosa);
    const t = await render(ParentHome({ searchParams: Promise.resolve({}) } as PageProps<"/parent">));

    expect(t).not.toContain("SECRET");
    expect(t).toContain("Chats with the AI counselor aren't shown on this page.");
    expect(t).toContain(
      "Ana owns this account, so their chats with the AI counselor stay private to them. The download leaves out those chats, the counselor's notes and any safety flags.",
    );
    expect(t).toContain(
      "You set up this account when Leo was under 13, so you have the right to review everything we collect from Leo. The download includes their chats with the AI counselor",
    );
    // Neither child's chats are promised as private to their parent across the board.
    expect(t).not.toContain("stay private to your child");

    expect(JSON.stringify(await exportStudentData(db, rosa, ana))).not.toContain("SECRET-MESSAGE");
    expect(JSON.stringify(await exportStudentData(db, rosa, leo))).toContain("SECRET-MESSAGE");
  });

  it("the invite card and the invitation page list what a linked parent can do", async () => {
    const teen = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date(),
    );
    if (!teen.ok) throw new Error();
    await signIn(teen.value.userId);
    const card = await render(InviteParentCard());
    for (const promise of [
      "see your progress: activities, goals, roadmap, classes and college list",
      "change your grade and your weekly reminder emails",
      "manage your family's plan and billing",
      "download a copy of your data, or delete your account",
      "They can't read your chats with the AI counselor. When they download your data, it leaves out your chats, what the counselor remembers about you, and any safety flags.",
    ]) {
      expect(card).toContain(promise);
    }

    const sent: Email[] = [];
    await createInvite(db, teen.value.userId, "rosa@example.com", { appUrl: "https://compass.example", send: async (e) => void sent.push(e) });
    const token = /\/invite\/(\S+)/.exec(sent[0].text)![1];
    page.user = null;
    const invite = await render(InvitePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) } as PageProps<"/invite/[token]">));
    for (const promise of [
      "See Ana's progress: activities, goals, roadmap, classes and college list",
      "Change Ana's grade and weekly reminder emails",
      "Manage your family's plan and billing",
      "Download a copy of Ana's data, or delete Ana's account",
      "your download of Ana's data leaves them out, along with the counselor's notes and any safety flags",
    ]) {
      expect(invite).toContain(promise);
    }
  });

  it("the privacy page says which data parents can download", async () => {
    const t = await render(PrivacyPage());
    expect(t).toContain("What a parent's download includes:");
    expect(t).toContain("including chats with our AI counselor. Parents have the right to review what we collect from a child under 13.");
    expect(t).toContain("It leaves out the teen's chats with our AI counselor, the counselor's notes, any safety flags");
  });
});
