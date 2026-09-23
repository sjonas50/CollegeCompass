import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db";
import { consumeRateLimit } from "@/lib/rate-limit";

describe("consumeRateLimit", () => {
  it("allows up to the limit per window, then resets", async () => {
    const db = await createTestDb();
    const t0 = new Date("2026-09-23T12:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(db, "login:x", 3, 60_000, t0));
    expect(results).toEqual([true, true, true, false]);

    const later = new Date(t0.getTime() + 61_000);
    expect(await consumeRateLimit(db, "login:x", 3, 60_000, later)).toBe(true);
    expect(await consumeRateLimit(db, "login:other", 3, 60_000, t0)).toBe(true);
  });
});
