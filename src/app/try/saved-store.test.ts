import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_ASSESSMENT_STORAGE_KEY, SAVED_STRENGTHS_STORAGE_KEY } from "@/lib/assessments/anonymous";

// The browser store behind the free quiz, with a stand-in `window`.

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

const events = { addEventListener() {}, removeEventListener() {} };

async function freshStore() {
  vi.resetModules();
  return import("./saved-store");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saved quiz store", () => {
  it("saves each answer in localStorage as it's given, and forgets them all", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { ...events, localStorage: storage });
    const store = await freshStore();
    expect(store.currentSavedAssessment()).toBeNull();

    store.recordAnswer("R1", 4);
    store.recordAnswer("I1", 5);
    expect(JSON.parse(storage.getItem(SAVED_ASSESSMENT_STORAGE_KEY)!).answers).toEqual({ R1: 4, I1: 5 });

    // A reload picks up where the visitor left off.
    const reloaded = await freshStore();
    expect(reloaded.currentSavedAssessment()?.answers).toEqual({ R1: 4, I1: 5 });

    reloaded.forgetSavedAssessment();
    expect(storage.getItem(SAVED_ASSESSMENT_STORAGE_KEY)).toBeNull();
    expect(reloaded.currentSavedAssessment()).toBeNull();
  });

  it("keeps the strengths answers apart, and forgets them with the quiz", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { ...events, localStorage: storage, sessionStorage: new MemoryStorage() });
    const store = await freshStore();
    store.recordAnswer("R1", 4);
    store.recordStrengthsAnswer("P1", 5);
    expect(JSON.parse(storage.getItem(SAVED_ASSESSMENT_STORAGE_KEY)!).answers).toEqual({ R1: 4 });
    expect(JSON.parse(storage.getItem(SAVED_STRENGTHS_STORAGE_KEY)!).answers).toEqual({ P1: 5 });

    // "Answer them again" forgets only the strengths.
    store.forgetSavedStrengths();
    expect(store.currentSavedStrengths()).toBeNull();
    expect(store.currentSavedAssessment()?.answers).toEqual({ R1: 4 });

    // Starting the quiz over (or saving it to an account) forgets both: they're the same person's.
    store.recordStrengthsAnswer("P1", 5);
    store.forgetSavedAssessment();
    expect(storage.getItem(SAVED_ASSESSMENT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SAVED_STRENGTHS_STORAGE_KEY)).toBeNull();
  });

  it("counts a finish once for the same answers, even after a reload, and again after starting over", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { ...events, localStorage: storage, sessionStorage: new MemoryStorage() });
    const store = await freshStore();
    expect(store.markFinishCounted("interests")).toBe(false); // nothing saved yet
    store.recordAnswer("R1", 4);
    expect(store.markFinishCounted("interests")).toBe(true);
    expect(store.markFinishCounted("interests")).toBe(false);

    const reloaded = await freshStore();
    expect(reloaded.markFinishCounted("interests")).toBe(false);
    // The strengths are counted on their own.
    reloaded.recordStrengthsAnswer("P1", 2);
    expect(reloaded.markFinishCounted("personality")).toBe(true);

    reloaded.forgetSavedAssessment();
    reloaded.recordAnswer("R1", 2);
    expect(reloaded.markFinishCounted("interests")).toBe(true);
  });

  it("keeps answers in memory when the browser blocks storage", async () => {
    vi.stubGlobal("window", {
      ...events,
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    const store = await freshStore();
    expect(store.currentSavedAssessment()).toBeNull();
    expect(() => store.recordAnswer("R1", 3)).not.toThrow();
    expect(store.currentSavedAssessment()?.answers).toEqual({ R1: 3 });
    expect(() => store.forgetSavedAssessment()).not.toThrow();
    expect(store.currentSavedAssessment()).toBeNull();
  });
});
