import type { FreeMatchesResult } from "@/lib/assessments/import";

/*
 * Career matches for the free quiz's results, kept for this browser tab. Every lookup counts toward
 * a limit shared by everyone on the same internet connection (a family, a classroom, a library), so
 * going to a career and back, or reloading, shows the matches already found instead of asking the
 * server again. Only successful lookups are kept, so "Try again" really does try again.
 *
 * The key is the six interest area scores ("R,I,A,S,E,C"); new answers mean new matches.
 */

export const FREE_MATCHES_STORAGE_KEY = "cc.freeMatches";

type Found = Extract<FreeMatchesResult, { ok: true }>;
type Entry = { key: string; result: Found };

// undefined until this tab's storage is read; null when nothing is kept.
let kept: Entry | null | undefined;
const pending = new Map<string, Promise<FreeMatchesResult>>();

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const { key, result } = value as Partial<Entry>;
  return typeof key === "string" && result?.ok === true && Array.isArray(result.careers) && typeof result.overview === "string";
}

function keptEntry(): Entry | null {
  if (kept === undefined) {
    try {
      const parsed: unknown = JSON.parse(tabStorage()?.getItem(FREE_MATCHES_STORAGE_KEY) ?? "null");
      kept = isEntry(parsed) ? parsed : null;
    } catch {
      kept = null;
    }
  }
  return kept;
}

function keep(entry: Entry) {
  kept = entry;
  try {
    tabStorage()?.setItem(FREE_MATCHES_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Blocked storage: this tab still remembers them until it's reloaded.
  }
}

/** Matches already found in this tab for these scores, or null. */
export function keptFreeMatches(areasKey: string): FreeMatchesResult | null {
  const entry = keptEntry();
  return entry?.key === areasKey ? entry.result : null;
}

/**
 * Matches for these scores: the ones already found in this tab, or one call to `lookup`. Calls made
 * while a lookup is on its way share it (React runs effects twice in development).
 */
export function loadFreeMatches(areasKey: string, lookup: () => Promise<FreeMatchesResult>): Promise<FreeMatchesResult> {
  const found = keptFreeMatches(areasKey);
  if (found) return Promise.resolve(found);
  const waiting = pending.get(areasKey);
  if (waiting) return waiting;
  const request: Promise<FreeMatchesResult> = lookup()
    .catch((): FreeMatchesResult => ({ ok: false, error: "unavailable" }))
    .then((result) => {
      // Not kept when the answers were forgotten while it was on its way.
      if (pending.get(areasKey) === request) {
        pending.delete(areasKey);
        if (result.ok) keep({ key: areasKey, result });
      }
      return result;
    });
  pending.set(areasKey, request);
  return request;
}

/** With the answers gone ("Take it again", or saved to an account), their matches go too. */
export function forgetFreeMatches() {
  kept = null;
  pending.clear();
  try {
    tabStorage()?.removeItem(FREE_MATCHES_STORAGE_KEY);
  } catch {
    // Nothing was kept.
  }
}

/** Says what actually happened when matches couldn't be shown. */
export function freeMatchesProblem(error: Extract<FreeMatchesResult, { ok: false }>["error"]): string {
  if (error === "rate_limited") {
    return "We've had a lot of career lookups from your internet connection in the last hour. This can happen on school or library Wi-Fi. Please try again in a little while. Your results are still saved on this device.";
  }
  return "We couldn't load career matches right now. Your results are still saved on this device, so please try again soon.";
}
