import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS } from "./instruments";
import { completeAttempt, latestResult, resultOfAttempt, saveResponses, startOrResumeAttempt } from "./service";

let db: Db;

async function student(email: string) {
  const res = await registerStudent(db, { displayName: "Sam", email, password: "correct horse battery", birthDate: "2010-01-15", grade: 10 });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function interests(userId: string, { finish = true } = {}) {
  const start = await startOrResumeAttempt(db, userId, "interests");
  if (!start.ok) throw new Error();
  await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "A" ? 5 : 2])));
  if (finish) await completeAttempt(db, userId, start.attempt.id);
  return start.attempt.id;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("resultOfAttempt", () => {
  it("gives one of the student's own scored attempts, as latestResult does, and nothing else", async () => {
    const ana = await student("ana@example.com");
    const ben = await student("ben@example.com");
    const first = await interests(ana);
    expect(await resultOfAttempt(db, ana, "interests", first)).toEqual(await latestResult(db, ana, "interests"));

    // Still found once a later attempt is the latest.
    await db.update(schema.assessmentAttempts).set({ completedAt: new Date(Date.now() - 100 * 86_400_000) });
    const second = await interests(ana);
    expect((await latestResult(db, ana, "interests"))!.attemptId).toBe(second);
    expect((await resultOfAttempt(db, ana, "interests", first))!.attemptId).toBe(first);

    // Not another student's, not as another instrument, and not before it's scored.
    expect(await resultOfAttempt(db, ben, "interests", first)).toBeNull();
    expect(await resultOfAttempt(db, ana, "values", first)).toBeNull();
    expect(await resultOfAttempt(db, ben, "interests", await interests(ben, { finish: false }))).toBeNull();
  });
});
