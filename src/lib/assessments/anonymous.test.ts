import { describe, expect, it } from "vitest";
import {
  MAX_SAVED_ASSESSMENT_LENGTH,
  SAVED_ASSESSMENT_STORAGE_KEY,
  answeredCount,
  emptySavedAssessment,
  isFinished,
  parseStoredAssessment,
  readSavedAssessment,
  removeSavedAssessment,
  serializeSavedAssessment,
  validateAreaScores,
  validateSavedAssessment,
  withAnswer,
  writeSavedAssessment,
} from "./anonymous";
import { INSTRUMENTS, INTEREST_ITEMS } from "./instruments";

const allAnswers = Object.fromEntries(INTEREST_ITEMS.map((i, n) => [i.id, (n % 5) + 1]));
const finished = { ...emptySavedAssessment(), answers: allAnswers };

function withoutKey<T extends Record<string, unknown>>(obj: T, key: string) {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("validateSavedAssessment (strict, for the server)", () => {
  it("accepts every item answered once, as JSON or as an object", () => {
    expect(validateSavedAssessment(serializeSavedAssessment(finished))).toEqual({ ok: true, answers: allAnswers });
    expect(validateSavedAssessment(finished)).toEqual({ ok: true, answers: allAnswers });
  });

  it("refuses unknown item ids", () => {
    expect(validateSavedAssessment({ ...finished, answers: { ...allAnswers, Z9: 3 } })).toEqual({ ok: false, error: "unknown_item" });
    // A personality item is a real id, but not one of the interest items.
    expect(validateSavedAssessment({ ...finished, answers: { ...allAnswers, P1: 3 } })).toEqual({ ok: false, error: "unknown_item" });
    expect(validateSavedAssessment(`{"v":1,"instrument":"interests","version":"ipsf-1","answers":{"__proto__":3}}`)).toEqual({
      ok: false,
      error: "unknown_item",
    });
  });

  it("refuses missing items", () => {
    expect(validateSavedAssessment({ ...finished, answers: withoutKey(allAnswers, "C10") })).toEqual({ ok: false, error: "incomplete" });
    expect(validateSavedAssessment({ ...finished, answers: {} })).toEqual({ ok: false, error: "incomplete" });
  });

  it("refuses values that aren't whole numbers from 1 to 5", () => {
    for (const bad of [0, 6, 2.5, -1, "3", null, true, Number.NaN, [3], { value: 3 }]) {
      expect(validateSavedAssessment({ ...finished, answers: { ...allAnswers, R1: bad } }), String(bad)).toEqual({
        ok: false,
        error: "bad_value",
      });
    }
  });

  it("refuses answers to another version of the items", () => {
    expect(validateSavedAssessment({ ...finished, version: "ipsf-0" })).toEqual({ ok: false, error: "old_version" });
  });

  it("refuses anything that isn't exactly the saved format, including smuggled scores", () => {
    const cases: unknown[] = [
      undefined,
      null,
      "",
      "not json",
      "[]",
      42,
      [finished],
      allAnswers,
      { ...finished, scores: { areas: { R: 40 } } },
      { ...finished, v: 2 },
      { ...finished, instrument: "personality" },
      { ...finished, version: 1 },
      { ...finished, answers: [3, 3, 3] },
      { ...finished, answers: null },
      withoutKey(finished, "v"),
      JSON.stringify({ ...finished, padding: "x".repeat(MAX_SAVED_ASSESSMENT_LENGTH) }),
    ];
    for (const raw of cases) {
      expect(validateSavedAssessment(raw), JSON.stringify(raw)?.slice(0, 80)).toEqual({ ok: false, error: "invalid_format" });
    }
  });

  it("refuses an oversized string before parsing it", () => {
    const huge = serializeSavedAssessment(finished).replace("{", `{${" ".repeat(MAX_SAVED_ASSESSMENT_LENGTH)}`);
    expect(JSON.parse(huge)).toEqual(finished);
    expect(validateSavedAssessment(huge)).toEqual({ ok: false, error: "invalid_format" });
  });
});

describe("parseStoredAssessment (lenient, for showing progress)", () => {
  it("keeps valid answers and drops the rest", () => {
    const raw = JSON.stringify({ ...emptySavedAssessment(), answers: { R1: 4, I1: 9, Z9: 3, A1: "5", S1: 1 } });
    expect(parseStoredAssessment(raw)?.answers).toEqual({ R1: 4, S1: 1 });
  });

  it("forgets answers to an older version of the items, and anything unreadable", () => {
    expect(parseStoredAssessment(JSON.stringify({ ...finished, version: "ipsf-0" }))).toBeNull();
    for (const raw of [null, "", "{", "[]", '{"v":2}', JSON.stringify({ ...finished, answers: "x" })]) {
      expect(parseStoredAssessment(raw)).toBeNull();
    }
  });
});

describe("progress helpers", () => {
  it("builds up answers one at a time", () => {
    let saved = withAnswer(null, "R1", 4);
    expect(saved).toEqual({ v: 1, instrument: "interests", version: INSTRUMENTS.interests.version, answers: { R1: 4 } });
    saved = withAnswer(saved, "R1", 2);
    expect(saved.answers).toEqual({ R1: 2 });
    expect(answeredCount(saved)).toBe(1);
    expect(isFinished(saved)).toBe(false);
    expect(isFinished(finished)).toBe(true);
    expect(isFinished(null)).toBe(false);
    expect(isFinished(undefined)).toBe(false);
    expect(answeredCount(undefined)).toBe(0);
  });
});

describe("browser storage", () => {
  it("round-trips through storage and can be removed", () => {
    const storage = new MemoryStorage();
    expect(readSavedAssessment(storage)).toBeNull();
    expect(writeSavedAssessment(storage, finished)).toBe(true);
    expect(JSON.parse(storage.getItem(SAVED_ASSESSMENT_STORAGE_KEY)!)).toEqual(finished);
    expect(readSavedAssessment(storage)).toEqual(finished);
    removeSavedAssessment(storage);
    expect(readSavedAssessment(storage)).toBeNull();
  });

  it("keeps working when storage is missing or blocked", () => {
    expect(readSavedAssessment(null)).toBeNull();
    expect(writeSavedAssessment(null, finished)).toBe(false);
    expect(readSavedAssessment(blocked)).toBeNull();
    expect(writeSavedAssessment(blocked, finished)).toBe(false);
    expect(() => removeSavedAssessment(blocked)).not.toThrow();
    expect(() => removeSavedAssessment(null)).not.toThrow();
  });

  it("stores only the answers and the item version, never scores", () => {
    const stored = JSON.parse(serializeSavedAssessment({ ...finished, scores: { R: 40 } } as never));
    expect(Object.keys(stored).sort()).toEqual(["answers", "instrument", "v", "version"]);
  });
});

describe("validateAreaScores", () => {
  const scores = { R: 12, I: 40, A: 0, S: 25, E: 3, C: 7 };

  it("accepts the six areas as whole numbers from 0 to 40", () => {
    expect(validateAreaScores(scores)).toEqual(scores);
  });

  it("refuses anything else", () => {
    const cases: unknown[] = [
      undefined,
      null,
      "R12",
      [12, 40, 0, 25, 3, 7],
      withoutKey(scores, "C"),
      { ...scores, X: 1 },
      { ...scores, answers: allAnswers },
      { ...scores, R: -1 },
      { ...scores, R: 41 },
      { ...scores, R: 12.5 },
      { ...scores, R: "12" },
      { ...scores, R: null },
      { ...scores, R: Number.POSITIVE_INFINITY },
    ];
    for (const raw of cases) expect(validateAreaScores(raw), JSON.stringify(raw)).toBeNull();
  });
});
