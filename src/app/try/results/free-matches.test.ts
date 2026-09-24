import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreeMatchesResult } from "@/lib/assessments/import";

// The free results page's career matches, kept per tab so re-showing the same results doesn't use
// up the lookups everyone on the same internet connection shares.

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

const found: FreeMatchesResult = {
  ok: true,
  code: "ASE",
  overview: "You like making things.",
  careers: [{ code: "27-1024.00", title: "Graphic Designers", pathway: "degree", fit: "Great fit", why: "Design." }],
};
const KEY = "5,10,38,30,20,5";

async function freshModule() {
  vi.resetModules();
  return import("./free-matches");
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("free matches for the results page", () => {
  it("asks the server once for the same results, even after going to a career and back or reloading", async () => {
    const lookup = vi.fn(async () => found);
    const page = await freshModule();
    expect(page.keptFreeMatches(KEY)).toBeNull();
    // Two effects at once (React runs them twice in development) share one lookup.
    const [a, b] = await Promise.all([page.loadFreeMatches(KEY, lookup), page.loadFreeMatches(KEY, lookup)]);
    expect(a).toEqual(found);
    expect(b).toEqual(found);
    // Back from /careers/[code]: the page mounts again.
    expect(await page.loadFreeMatches(KEY, lookup)).toEqual(found);
    expect(page.keptFreeMatches(KEY)).toEqual(found);
    expect(lookup).toHaveBeenCalledTimes(1);

    // A reload in the same tab.
    const reloaded = await freshModule();
    expect(reloaded.keptFreeMatches(KEY)).toEqual(found);
    expect(await reloaded.loadFreeMatches(KEY, lookup)).toEqual(found);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("looks up new results again, and never keeps a failed lookup", async () => {
    const page = await freshModule();
    const limited = vi.fn(async (): Promise<FreeMatchesResult> => ({ ok: false, error: "rate_limited" }));
    expect(await page.loadFreeMatches(KEY, limited)).toEqual({ ok: false, error: "rate_limited" });
    expect(page.keptFreeMatches(KEY)).toBeNull();
    const broken = vi.fn(async (): Promise<FreeMatchesResult> => {
      throw new Error("network");
    });
    expect(await page.loadFreeMatches(KEY, broken)).toEqual({ ok: false, error: "unavailable" });

    // "Try again" really tries again.
    const lookup = vi.fn(async () => found);
    expect(await page.loadFreeMatches(KEY, lookup)).toEqual(found);
    expect(lookup).toHaveBeenCalledTimes(1);
    // Different answers, different matches.
    expect(page.keptFreeMatches("1,1,1,1,1,1")).toBeNull();
    await page.loadFreeMatches("1,1,1,1,1,1", lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("forgets them with the answers", async () => {
    const page = await freshModule();
    await page.loadFreeMatches(KEY, async () => found);
    page.forgetFreeMatches();
    expect(page.keptFreeMatches(KEY)).toBeNull();
    expect(storage.data.size).toBe(0);
    expect((await freshModule()).keptFreeMatches(KEY)).toBeNull();
  });

  it("forgets them when the saved quiz is erased", async () => {
    vi.stubGlobal("window", { sessionStorage: storage, localStorage: new MemoryStorage(), addEventListener() {}, removeEventListener() {} });
    const page = await freshModule();
    await page.loadFreeMatches(KEY, async () => found);
    const store = await import("../saved-store");
    store.forgetSavedAssessment();
    expect(page.keptFreeMatches(KEY)).toBeNull();
  });

  it("still works when the browser blocks storage", async () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    const page = await freshModule();
    const lookup = vi.fn(async () => found);
    expect(await page.loadFreeMatches(KEY, lookup)).toEqual(found);
    expect(await page.loadFreeMatches(KEY, lookup)).toEqual(found);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(() => page.forgetFreeMatches()).not.toThrow();
  });

  it("says what happened when there are too many lookups from one connection", async () => {
    const { freeMatchesProblem } = await freshModule();
    expect(freeMatchesProblem("rate_limited")).toMatch(/lot of career lookups from your internet connection/);
    expect(freeMatchesProblem("rate_limited")).not.toMatch(/You've looked up/);
    expect(freeMatchesProblem("unavailable")).toMatch(/couldn't load career matches/);
  });
});
