import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent, registerStudent } from "@/lib/accounts";
import type { SessionUser } from "@/lib/auth/sessions";
import { PARENT_COPY_NOTE } from "@/lib/privacy";
import { GET } from "./route";

// The export download: the signed-in user is the requester, so a linked parent gets the parent's
// copy of a teen's data and the teen gets all of it.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => state.user }));

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  state.user = null;
});

const signIn = (id: string, role: SessionUser["role"]) => {
  state.user = { id, role, displayName: "x", username: null, householdId: null, parentManaged: false, grade: null };
};
const get = (id: string) =>
  GET(new Request(`http://localhost/api/parent/children/${id}/export`), {
    params: Promise.resolve({ id }),
  } as RouteContext<"/api/parent/children/[id]/export">);

async function teenWithParent() {
  const teen = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    new Date("2026-09-24T15:00:00Z"),
  );
  const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
  if (!teen.ok || !parent.ok) throw new Error();
  await db.insert(schema.parentStudentLinks).values({ parentUserId: parent.value.userId, studentUserId: teen.value.userId });
  await db.insert(schema.counselorMemory).values({ userId: teen.value.userId, notes: ["SECRET-MEMORY"] });
  return { teen: teen.value.userId, parent: parent.value.userId };
}

describe("GET /api/parent/children/[id]/export", () => {
  it("gives a linked parent the parent's copy as a download", async () => {
    const { teen, parent } = await teenWithParent();
    signIn(parent, "parent");
    const res = await get(teen);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="college-compass-export-${teen}.json"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ notIncluded: PARENT_COPY_NOTE, profile: { displayName: "Ana" } });
    expect(body).not.toContain("SECRET");
  });

  it("gives the teen all of their own data", async () => {
    const { teen } = await teenWithParent();
    signIn(teen, "student");
    const body = await (await get(teen)).json();
    expect(body).toMatchObject({ counselorMemory: ["SECRET-MEMORY"] });
    expect(body).not.toHaveProperty("notIncluded");
  });

  it("needs a signed-in user and answers not found for anything else", async () => {
    const { teen } = await teenWithParent();
    expect((await get(teen)).status).toBe(401);

    const stranger = await registerParent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery" });
    if (!stranger.ok) throw new Error();
    signIn(stranger.value.userId, "parent");
    expect((await get(teen)).status).toBe(404);
    // Not an id at all: a plain 404, not a database error.
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await get("../../etc")).status).toBe(404);
  });
});
