import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { consumeRateLimit, refundRateLimit } from "@/lib/rate-limit";

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

describe("refundRateLimit", () => {
  it("gives back one hit, never below zero, and keeps the window", async () => {
    const db = await createTestDb();
    const t0 = new Date("2026-09-23T12:00:00Z");
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, "k", 3, 60_000, t0);
    await refundRateLimit(db, "k");
    expect(await consumeRateLimit(db, "k", 3, 60_000, t0)).toBe(true);
    expect(await consumeRateLimit(db, "k", 3, 60_000, t0)).toBe(false);

    for (let i = 0; i < 10; i++) await refundRateLimit(db, "k");
    const [row] = await db.select().from(schema.rateLimits);
    expect(row).toMatchObject({ key: "k", count: 0, windowStart: t0 });
    // A key that was never counted is left alone.
    await refundRateLimit(db, "never");
    expect(await db.select().from(schema.rateLimits)).toHaveLength(1);
  });
});
