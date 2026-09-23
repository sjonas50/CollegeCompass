import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";

describe("database", () => {
  it("applies migrations to a fresh in-memory database", async () => {
    const db = await createTestDb();
    const [household] = await db.insert(schema.households).values({}).returning();
    expect(household.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
