import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { registerParent, registerStudent, setStudentGrade } from "@/lib/accounts";
import { currentGrade } from "@/lib/auth/age";
import { setRemindersEnabled } from "@/lib/reminders";

describe("student settings", () => {
  it("corrects a grade from the current school year and never touches parents", async () => {
    const db = await createTestDb();
    const s = await registerStudent(
      db,
      { displayName: "Ana", email: "a@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2025-09-01T12:00:00Z"),
    );
    const p = await registerParent(db, { displayName: "P", email: "p@example.com", password: "correct horse battery" });
    if (!s.ok || !p.ok) throw new Error();
    const today = new Date("2026-09-23T12:00:00Z");
    expect(await setStudentGrade(db, s.value.userId, 10, today)).toBe(true); // repeated 10th
    const [row] = await db.select().from(schema.users).where((await import("drizzle-orm")).eq(schema.users.id, s.value.userId));
    expect(currentGrade(row, today)).toBe(10);
    expect(await setStudentGrade(db, s.value.userId, 13, today)).toBe(false);
    expect(await setStudentGrade(db, p.value.userId, 9, today)).toBe(false);
    await setRemindersEnabled(db, s.value.userId, false);
    const [after] = await db.select().from(schema.users).where((await import("drizzle-orm")).eq(schema.users.id, s.value.userId));
    expect(after.remindersEnabled).toBe(false);
  });
});
