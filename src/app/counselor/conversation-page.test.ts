import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { insertColleges } from "@/lib/colleges/test-fixtures";
import { appendMessage, createConversation } from "@/lib/counselor/conversations";
import ConversationPage from "./[id]/page";

// A saved conversation, server-rendered with the student and database mocked: its college and
// career links are named after their pages, however the counselor wrote them.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("@/lib/access/guard", () => ({ accessFor: async () => ({ full: true }) }));

/** The text of each link to a college or career page. */
const pageLinks = (html: string) =>
  [...html.matchAll(/<a\b[^>]*href="(\/(?:colleges|careers)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => [href, inner]);

beforeEach(async () => {
  const db = await createTestDb();
  state.db = db;
  await insertColleges(db, [
    { unitId: 204796, name: "Ohio State University-Main Campus", city: "Columbus", state: "OH" },
    { unitId: 204024, name: "Miami University-Oxford", city: "Oxford", state: "OH" },
  ]);
  await db.insert(schema.occupations).values({ code: "29-1141.00", title: "Registered Nurses", jobZone: 3, description: "Assess patient needs." });
  const res = await registerStudent(db, {
    displayName: "Sam",
    email: "sam@example.com",
    password: "correct horse battery",
    birthDate: "2010-05-01",
    grade: 10,
  });
  if (!res.ok) throw new Error(res.error);
  state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

describe("/counselor/[id]", () => {
  it("names each college and career link after its page", async () => {
    const db = state.db!;
    const conv = await createConversation(db, state.user!.id, "Which colleges in Ohio have good nursing programs?");
    await appendMessage(db, conv.id, { role: "user", content: "Which colleges in Ohio have good nursing programs? /colleges/204024" });
    await appendMessage(db, conv.id, {
      role: "assistant",
      content: [
        "A few to look at:",
        "- Ohio State University, Columbus — net price averages about $17,300, and 88% of students finish. /colleges/204796",
        "- Miami University, Oxford — about $21,000 a year. /colleges/204024",
        "",
        "Nursing is at /careers/29-1141.00. An old link: /colleges/1.",
      ].join("\n"),
    });
    const html = renderToStaticMarkup((await ConversationPage({ params: Promise.resolve({ id: conv.id }), searchParams: Promise.resolve({}) })) as ReactNode);
    expect(pageLinks(html)).toEqual([
      ["/colleges/204796", "Ohio State University-Main Campus"],
      ["/colleges/204024", "Miami University-Oxford"],
      ["/careers/29-1141.00", "Registered Nurses"],
      // A college we don't have keeps the generic name.
      ["/colleges/1", "college page"],
    ]);
  });
});
