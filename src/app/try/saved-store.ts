"use client";

import { useSyncExternalStore } from "react";
import {
  SAVED_ASSESSMENT_STORAGE_KEY,
  type SavedAssessment,
  readSavedAssessment,
  removeSavedAssessment,
  withAnswer,
  writeSavedAssessment,
} from "@/lib/assessments/anonymous";
import { forgetFreeMatches } from "./results/free-matches";

/*
 * The free quiz's answers in this browser: localStorage when it works, otherwise memory (they last
 * until the tab closes). Nothing here is sent anywhere; the pages decide what to send and when.
 */

const listeners = new Set<() => void>();
// undefined until first read in the browser; null means nothing saved.
let current: SavedAssessment | null | undefined;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

// Keeps tabs in step: answering in one tab, or starting over, shows in the others.
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_ASSESSMENT_STORAGE_KEY) return;
  current = readSavedAssessment(browserStorage());
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): SavedAssessment | null {
  if (current === undefined) current = readSavedAssessment(browserStorage());
  return current;
}

// The server never sees the answers. `undefined` tells components the browser hasn't been read yet.
const getServerSnapshot = () => undefined;

/** The saved quiz: undefined while loading (and on the server), null when there is none. */
export function useSavedAssessment(): SavedAssessment | null | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The saved quiz outside React (e.g. in event handlers); null when there is none. */
export const currentSavedAssessment = getSnapshot;

/** Saves one answer as soon as it's given, so a visitor can stop and pick up later. */
export function recordAnswer(itemId: string, value: number) {
  current = withAnswer(getSnapshot(), itemId, value);
  // Still works for this visit when storage is blocked; it just won't be remembered.
  writeSavedAssessment(browserStorage(), current);
  emit();
}

/**
 * Removes the saved quiz from this browser (start over, "not mine", or after it's in an account),
 * and the career matches found for it in this tab.
 */
export function forgetSavedAssessment() {
  current = null;
  removeSavedAssessment(browserStorage());
  forgetFreeMatches();
  emit();
}
