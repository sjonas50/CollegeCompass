import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS } from "@/lib/assessments/instruments";
import {
  completeAttempt,
  instrumentStatuses,
  latestResult,
  saveResponses,
  startOrResumeAttempt,
} from "@/lib/assessments/service";

const now = new Date("2026-09-23T12:00:00Z");
let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  const res = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
});

const allLike = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : 2]));

async function finishInterests(at = now) {
  const start = await startOrResumeAttempt(db, userId, "interests", at);
  if (!start.ok) throw new Error(start.error);
  expect((await saveResponses(db, userId, start.attempt.id, allLike)).ok).toBe(true);
  return { attemptId: start.attempt.id, result: await completeAttempt(db, userId, start.attempt.id, at) };
}

describe("assessment attempts", () => {
  it("resumes an unfinished attempt with its saved answers", async () => {
    const first = await startOrResumeAttempt(db, userId, "interests", now);
    if (!first.ok) throw new Error();
    await saveResponses(db, userId, first.attempt.id, { R1: 4, I1: 5 });
    const again = await startOrResumeAttempt(db, userId, "interests", now);
    expect(again).toMatchObject({ ok: true, attempt: { id: first.attempt.id, responses: { R1: 4, I1: 5 } } });
    expect((await instrumentStatuses(db, userId)).interests).toEqual({ state: "in_progress", answered: 2, total: 60 });
  });

  it("rejects unknown items, out-of-range values and other students' attempts", async () => {
    const start = await startOrResumeAttempt(db, userId, "interests", now);
    if (!start.ok) throw new Error();
    expect(await saveResponses(db, userId, start.attempt.id, { Z9: 3 })).toEqual({ ok: false, error: "invalid" });
    expect(await saveResponses(db, userId, start.attempt.id, { R1: 6 })).toEqual({ ok: false, error: "invalid" });
    const other = await registerStudent(
      db,
      { displayName: "Bo", email: "bo@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!other.ok) throw new Error();
    expect(await saveResponses(db, other.value.userId, start.attempt.id, { R1: 3 })).toEqual({ ok: false, error: "not_found" });
  });

  it("won't complete until every item is answered", async () => {
    const start = await startOrResumeAttempt(db, userId, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, { R1: 3 });
    const res = await completeAttempt(db, userId, start.attempt.id, now);
    expect(res).toMatchObject({ ok: false, error: "incomplete" });
  });

  it("scores on completion and blocks retakes for 90 days", async () => {
    const { result } = await finishInterests();
    expect(result).toEqual({ ok: true, instrument: "interests" });
    const latest = await latestResult(db, userId, "interests");
    expect(latest?.scores).toMatchObject({ areas: { I: 40, R: 10 }, code: "IRA" });

    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(await startOrResumeAttempt(db, userId, "interests", soon)).toMatchObject({ ok: false, error: "too_soon" });
    const later = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
    expect(await startOrResumeAttempt(db, userId, "interests", later)).toMatchObject({ ok: true });
  });

  it("can't change answers after completion", async () => {
    const { attemptId } = await finishInterests();
    expect(await saveResponses(db, userId, attemptId, { R1: 5 })).toEqual({ ok: false, error: "not_found" });
  });
});
