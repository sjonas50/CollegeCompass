"use client";

import { useSyncExternalStore } from "react";
import {
  type FreeInstrument,
  SAVED_STORAGE_KEYS,
  type SavedAnswers,
  type SavedAssessment,
  type SavedStrengths,
  readSaved,
  removeSaved,
  withSavedAnswer,
  writeSaved,
} from "@/lib/assessments/anonymous";
import { forgetFreeMatches } from "./results/free-matches";

/*
 * The free quiz's answers in this browser, and those of its strengths add-on: localStorage when it
 * works, otherwise memory (they last until the tab closes). Nothing here is sent anywhere; the pages
 * decide what to send and when.
 */

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createStore<I extends FreeInstrument>(instrument: I) {
  const listeners = new Set<() => void>();
  // undefined until first read in the browser; null means nothing saved.
  let current: SavedAnswers<I> | null | undefined;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  // Keeps tabs in step: answering in one tab, or starting over, shows in the others.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SAVED_STORAGE_KEYS[instrument]) return;
    current = readSaved(instrument, browserStorage());
    emit();
  };

  const getSnapshot = (): SavedAnswers<I> | null => {
    if (current === undefined) current = readSaved(instrument, browserStorage());
    return current;
  };

  const save = (next: SavedAnswers<I>) => {
    current = next;
    // Still works for this visit when storage is blocked; it just won't be remembered.
    writeSaved(browserStorage(), current);
    emit();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot,
    record(itemId: string, value: number) {
      save(withSavedAnswer(instrument, getSnapshot(), itemId, value));
    },
    /** Marks these answers as counted; true only the first time, so a finish is counted once. */
    markCounted(): boolean {
      const saved = getSnapshot();
      if (!saved || saved.counted) return false;
      save({ ...saved, counted: true });
      return true;
    },
    forget() {
      current = null;
      removeSaved(instrument, browserStorage());
      emit();
    },
  };
}

const interests = createStore("interests");
const strengths = createStore("personality");
const stores = { interests, personality: strengths };

// The server never sees the answers. `undefined` tells components the browser hasn't been read yet.
const getServerSnapshot = () => undefined;

/** The saved answers for either activity, like useSavedAssessment. */
export function useSaved<I extends FreeInstrument>(instrument: I): SavedAnswers<I> | null | undefined {
  const store = stores[instrument] as ReturnType<typeof createStore<I>>;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

/** Saves one answer to either activity as soon as it's given. */
export function recordSavedAnswer(instrument: FreeInstrument, itemId: string, value: number) {
  stores[instrument].record(itemId, value);
}

/** The saved quiz: undefined while loading (and on the server), null when there is none. */
export function useSavedAssessment(): SavedAssessment | null | undefined {
  return useSyncExternalStore(interests.subscribe, interests.getSnapshot, getServerSnapshot);
}

/** The saved strengths answers, like useSavedAssessment. */
export function useSavedStrengths(): SavedStrengths | null | undefined {
  return useSyncExternalStore(strengths.subscribe, strengths.getSnapshot, getServerSnapshot);
}

/** The saved quiz outside React (e.g. in event handlers); null when there is none. */
export const currentSavedAssessment = interests.getSnapshot;
export const currentSavedStrengths = strengths.getSnapshot;

/** Saves one answer as soon as it's given, so a visitor can stop and pick up later. */
export const recordAnswer = interests.record;
export const recordStrengthsAnswer = strengths.record;

/**
 * Marks the finished quiz (or strengths) in this browser as counted. True only the first time for
 * these answers, so reloading or pressing "See my results" again never counts a finish twice.
 */
export function markFinishCounted(instrument: FreeInstrument): boolean {
  return stores[instrument].markCounted();
}

/**
 * Removes the saved quiz from this browser (start over, "not mine", or after it's in an account),
 * with its strengths answers, which belong to the same person, and the career matches found for it
 * in this tab.
 */
export function forgetSavedAssessment() {
  interests.forget();
  strengths.forget();
  forgetFreeMatches();
}

/** Removes only the strengths answers ("Answer them again"). */
export const forgetSavedStrengths = strengths.forget;
