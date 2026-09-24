import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_ASSESSMENT_STORAGE_KEY } from "@/lib/assessments/anonymous";

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
