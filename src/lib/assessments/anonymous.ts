import { INSTRUMENTS, INTEREST_ITEMS, RIASEC, RIASEC_INFO, type Riasec, isValidResponse } from "./instruments";
import { type Responses, missingItems, scoreInterests } from "./scoring";

/**
 * The free interest quiz for visitors without an account (/try).
 *
 * Privacy: a visitor's answers live only in their browser (localStorage, or in memory when storage
 * is blocked) until they create an account. To find career matches the browser sends only the six
 * area scores, which the server doesn't keep. At signup, or later from the dashboard, the saved
 * answers are sent once, checked strictly here and scored again on the server.
 *
 * Pure and safe to use in the browser: no database, no Node APIs.
 */

/** Browser-only storage key. */
export const SAVED_ASSESSMENT_STORAGE_KEY = "cc.freeInterests";
/** Form field that carries the saved answers to the signup action. */
export const SAVED_ASSESSMENT_FIELD = "savedAssessment";
/** 60 answers serialize to about 700 characters; anything much larger isn't ours. */
export const MAX_SAVED_ASSESSMENT_LENGTH = 4096;

const FORMAT = 1;
const INSTRUMENT = "interests";
const KEYS = ["answers", "instrument", "v", "version"];

/** What the browser keeps: the answers and the item set they belong to. Scores are never stored. */
export type SavedAssessment = {
  v: typeof FORMAT;
  instrument: typeof INSTRUMENT;
  /** INSTRUMENTS.interests.version when the answers were given. */
  version: string;
  answers: Responses;
  /**
   * When the last answer was given (ms since 1970), so a shared device can say when the quiz was
   * taken ("finished yesterday"). Kept in the browser only: it's never sent to the server.
   */
  savedAt?: number;
};

export function emptySavedAssessment(): SavedAssessment {
  return { v: FORMAT, instrument: INSTRUMENT, version: INSTRUMENTS.interests.version, answers: {} };
}

export function withAnswer(saved: SavedAssessment | null, itemId: string, value: number, now = Date.now()): SavedAssessment {
  const base = saved ?? emptySavedAssessment();
  return { ...base, answers: { ...base.answers, [itemId]: value }, savedAt: now };
}

/** All 60 activities rated. */
export function isFinished(saved: SavedAssessment | null | undefined): saved is SavedAssessment {
  return saved != null && missingItems("interests", saved.answers).length === 0;
}

export function answeredCount(saved: SavedAssessment | null | undefined): number {
  return saved ? INTEREST_ITEMS.filter((i) => saved.answers[i.id] !== undefined).length : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function decode(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  if (raw.length > MAX_SAVED_ASSESSMENT_LENGTH) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type SavedAssessmentError = "invalid_format" | "old_version" | "unknown_item" | "bad_value" | "incomplete";

/**
 * Strict check of saved answers sent by a browser (as the JSON string or the parsed object).
 * Accepts only the current version of the interest items, every item answered exactly once with
 * a whole number from 1 to 5, and nothing else: no scores, no extra fields.
 */
export function validateSavedAssessment(
  raw: unknown,
): { ok: true; answers: Responses } | { ok: false; error: SavedAssessmentError } {
  const data = decode(raw);
  if (!isPlainObject(data)) return { ok: false, error: "invalid_format" };
  const keys = Object.keys(data).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return { ok: false, error: "invalid_format" };
  if (data.v !== FORMAT || data.instrument !== INSTRUMENT || typeof data.version !== "string") {
    return { ok: false, error: "invalid_format" };
  }
  if (data.version !== INSTRUMENTS.interests.version) return { ok: false, error: "old_version" };
  if (!isPlainObject(data.answers)) return { ok: false, error: "invalid_format" };

  const known = new Set<string>(INSTRUMENTS.interests.itemIds);
  const entries = Object.entries(data.answers);
  if (entries.some(([itemId]) => !known.has(itemId))) return { ok: false, error: "unknown_item" };
  if (entries.some(([itemId, value]) => typeof value !== "number" || !isValidResponse("interests", itemId, value))) {
    return { ok: false, error: "bad_value" };
  }
  const answers = Object.fromEntries(entries) as Responses;
  if (missingItems("interests", answers).length > 0) return { ok: false, error: "incomplete" };
  return { ok: true, answers };
}

/**
 * Lenient read of what this browser saved, for showing progress: keeps valid answers and drops
 * anything else. Answers to an older version of the items are dropped entirely.
 */
export function parseStoredAssessment(raw: string | null | undefined): SavedAssessment | null {
  if (!raw) return null;
  const data = decode(raw);
  if (!isPlainObject(data) || data.v !== FORMAT || data.instrument !== INSTRUMENT) return null;
  if (data.version !== INSTRUMENTS.interests.version || !isPlainObject(data.answers)) return null;
  const answers: Responses = {};
  for (const item of INTEREST_ITEMS) {
    const value = data.answers[item.id];
    if (typeof value === "number" && isValidResponse("interests", item.id, value)) answers[item.id] = value;
  }
  const { savedAt } = data;
  const validTime = typeof savedAt === "number" && Number.isFinite(savedAt) && savedAt > 0;
  return { ...emptySavedAssessment(), answers, ...(validTime && { savedAt }) };
}

/**
 * The saved answers as sent to the server: exactly the fields validateSavedAssessment accepts. The
 * browser-only `savedAt` is left out.
 */
export function serializeSavedAssessment(saved: SavedAssessment): string {
  const { v, instrument, version, answers } = saved;
  return JSON.stringify({ v, instrument, version, answers });
}

/** What goes in the browser's storage: the answers, plus when they were last changed. */
function storedForm(saved: SavedAssessment): string {
  const { v, instrument, version, answers, savedAt } = saved;
  return JSON.stringify({ v, instrument, version, answers, savedAt });
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Storage can be missing or throw (private browsing, blocked site data); treat that as "nothing saved". */
export function readSavedAssessment(storage: StorageLike | null): SavedAssessment | null {
  try {
    return parseStoredAssessment(storage?.getItem(SAVED_ASSESSMENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Returns false when the browser wouldn't keep it; the quiz then carries on in memory. */
export function writeSavedAssessment(storage: StorageLike | null, saved: SavedAssessment): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVED_ASSESSMENT_STORAGE_KEY, storedForm(saved));
    return true;
  } catch {
    return false;
  }
}

export function removeSavedAssessment(storage: StorageLike | null) {
  try {
    storage?.removeItem(SAVED_ASSESSMENT_STORAGE_KEY);
  } catch {
    // Nothing to do: blocked storage never held anything.
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a saved quiz was last answered, in words: "today", "yesterday" or "on September 20" (in the
 * browser's time zone). Null when the browser didn't keep the time (quizzes saved before it did).
 */
export function savedWhen(savedAt: number | undefined, now = new Date()): string | null {
  if (savedAt === undefined) return null;
  const then = new Date(savedAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded, so a day with a daylight saving change still counts as one day.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const sameYear = then.getFullYear() === now.getFullYear();
  return `on ${then.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(!sameYear && { year: "numeric" }) })}`;
}

/** An interest code in words: "ASE" is "artistic, social and enterprising". */
export function interestAreasText(code: string): string {
  const names = code
    .split("")
    .filter((l): l is Riasec => l in RIASEC_INFO)
    .map((l) => RIASEC_INFO[l].name.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

/** The top three interest areas of a finished quiz, in words. */
export function topInterestsText(answers: Responses): string {
  return interestAreasText(scoreInterests(answers).code);
}

/**
 * Describes a finished quiz saved in this browser without assuming whose it is, for shared family
 * or library computers: "Someone finished the free interest quiz on this device yesterday. Their
 * top interests were artistic, social and enterprising."
 */
export function describeSavedQuiz(saved: SavedAssessment, now = new Date()): string {
  const when = savedWhen(saved.savedAt, now);
  return `Someone finished the free interest quiz on this device${when ? ` ${when}` : ""}. Their top interests were ${topInterestsText(saved.answers)}.`;
}

/** The most an area can score: ten items rated 0–4. */
export const MAX_AREA_SCORE = 40;

/**
 * Checks the six interest area scores a visitor's browser sends for matching: exactly the six
 * RIASEC keys, each a whole number from 0 to 40. Anything else (answers, extra fields) is refused.
 */
export function validateAreaScores(raw: unknown): Record<Riasec, number> | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== RIASEC.length || !RIASEC.every((a) => keys.includes(a))) return null;
  const out = {} as Record<Riasec, number>;
  for (const area of RIASEC) {
    const value = raw[area];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_AREA_SCORE) return null;
    out[area] = value;
  }
  return out;
}
