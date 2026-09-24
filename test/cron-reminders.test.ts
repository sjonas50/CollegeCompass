import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { registerStudent } from "@/lib/accounts";
import type { Email } from "@/lib/email";
import { weekStartOf } from "@/lib/steps";

// The weekly reminders cron route: it logs one line per run with counts only, so the logs (or a
// log drain) show how each run went without anyone's address in them.

const state = vi.hoisted(() => ({ db: null as unknown, send: null as null | ((email: Email) => Promise<void>) }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmail: (email: Email) => state.send!(email),
}));

const { GET } = await import("@/app/api/cron/weekly-reminders/route");

const SECRET = "a-long-enough-cron-secret";
let db: Db;
let logs: { level: string; line: string }[];

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  vi.stubEnv("CRON_SECRET", SECRET);
  resetEnvCache();
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push({ level, line: args.map(String).join(" ") }));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function teenWithStep(email: string) {
  const res = await registerStudent(db, {
    displayName: "Ana",
    email,
    password: "correct horse battery",
    birthDate: "2010-05-01",
    grade: 10,
  });
  if (!res.ok) throw new Error(res.error);
  await db.insert(schema.weeklySteps).values({ userId: res.value.userId, weekStart: weekStartOf(new Date()), text: "Visit a campus" });
}

const run = () => GET(new Request("https://compass.example/api/cron/weekly-reminders", { headers: { authorization: `Bearer ${SECRET}` } }));
const reminderLines = () => logs.filter((l) => l.line.startsWith("[reminders]"));

describe("GET /api/cron/weekly-reminders", () => {
  it("rejects a call without the cron secret", async () => {
    const res = await GET(new Request("https://compass.example/api/cron/weekly-reminders"));
    expect(res.status).toBe(401);
    expect(reminderLines()).toEqual([]);
  });

  it("logs one summary line with counts only, and returns the same counts", async () => {
    await teenWithStep("ana@example.com");
    await teenWithStep("bo@example.com");
    state.send = async () => {};

    const res = await run();
    expect(await res.json()).toEqual({ sent: 2, skipped: 0, failed: 0, uncertain: 0, more: false });
    expect(reminderLines()).toEqual([{ level: "info", line: "[reminders] run sent=2 skipped=0 failed=0 uncertain=0 more=false" }]);
  });

  it("warns when something is left for a re-run, still without any address", async () => {
    await teenWithStep("ana@example.com");
    await teenWithStep("bo@example.com");
    state.send = async (email) => {
      throw new Error(`provider down for ${email.to}`);
    };

    const res = await run();
    expect(await res.json()).toMatchObject({ sent: 0, failed: 2 });
    expect(reminderLines().filter((l) => l.line.startsWith("[reminders] run"))).toEqual([
      { level: "warn", line: "[reminders] run sent=0 skipped=0 failed=2 uncertain=0 more=false; run it again to send the rest" },
    ]);
    const everything = logs.map((l) => l.line).join("\n");
    expect(everything).not.toContain("ana@example.com");
    expect(everything).not.toContain("bo@example.com");
  });
});
