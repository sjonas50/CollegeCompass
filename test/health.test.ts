import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb } from "@/db";

const state = vi.hoisted(() => ({ getDb: null as null | (() => Promise<Db>) }));
vi.mock("@/db", async (original) => ({
  ...(await original<typeof import("@/db")>()),
  getDb: () => state.getDb!(),
}));

const { GET } = await import("@/app/api/health/route");

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A database whose queries fail (or never answer) the way a broken connection would. */
function brokenDb(execute: () => Promise<unknown>) {
  return { execute } as unknown as Db;
}

const SECRET = "postgres://app:hunter2@db.internal:5432/college_compass";

describe("GET /api/health", () => {
  it("says ok after the database answers, and is never cached", async () => {
    const db = await createTestDb();
    const execute = vi.spyOn(db, "execute");
    state.getDb = async () => db;

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(execute).toHaveBeenCalledOnce();
    expect(logs).toEqual([]);
  });

  it("returns only {ok:false} with 503 when the database can't be reached", async () => {
    state.getDb = async () => {
      throw new Error(`connect ECONNREFUSED ${SECRET}`);
    };

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.text()).toBe(JSON.stringify({ ok: false }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(logs).toEqual(["[health] database check failed: Error"]);
  });

  it("returns 503 when the query fails", async () => {
    const error = Object.assign(new Error(`relation missing in ${SECRET}`), { name: "PostgresError" });
    state.getDb = async () => brokenDb(() => Promise.reject(error));

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(logs.join("\n")).not.toContain("hunter2");
    expect(logs).toEqual(["[health] database check failed: PostgresError"]);
  });

  it("returns 503 after 5 seconds when the database never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    state.getDb = async () => brokenDb(() => new Promise(() => {}));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(logs).toEqual(["[health] database check failed: TimeoutError"]);
  });
});
