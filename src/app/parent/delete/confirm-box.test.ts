import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeleteChildPage from "@/app/parent/children/[id]/delete/page";
import DeleteParentPage from "@/app/parent/delete/page";
import { type Db, createTestDb } from "@/db";
import { createChildAccount, registerParent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";

// The "I understand" boxes on the parent's delete pages, rendered on the server.

const page = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => page.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => page.user, getCurrentUser: async () => page.user }));

let db: Db;
let childId: string;

beforeEach(async () => {
  db = await createTestDb();
  page.db = db;
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
  if (!parent.ok) throw new Error(parent.error);
  const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
  const child = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Kid", username: "kid8", password: "correct horse battery", birthDate: "2014-02-01", grade: 7 },
    consent,
  );
  if (!child.ok) throw new Error(child.error);
  childId = child.value.userId;
  page.user = { id: parent.value.userId, role: "parent", displayName: "Rosa", username: null, householdId: null, parentManaged: false, grade: null };
});

describe("delete confirmation boxes", () => {
  it("make the whole row, box and words, at least 44px tall", async () => {
    const pages = [
      await DeleteParentPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
      await DeleteChildPage({ params: Promise.resolve({ id: childId }), searchParams: Promise.resolve({}) }),
    ];
    for (const element of pages) {
      const html = renderToStaticMarkup(element);
      // The label wraps the box and its words, so tapping either ticks it.
      const [, label, box] = /<label class="([^"]*)"><input ([^>]*)\/><span>I understand/.exec(html) ?? [];
      expect(label.split(" ")).toContain("min-h-11");
      expect(box).toContain('name="confirm"');
      expect(box).toMatch(/class="[^"]*\bsize-5\b/);
      expect(html).toContain("bg-danger text-danger-foreground");
    }
  });
});
