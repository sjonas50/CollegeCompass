import { INSTRUMENTS, INTEREST_ITEMS, PERSONALITY_ITEMS, RIASEC, type Riasec, isValidResponse } from "./instruments";
import { interestPattern, noLeadReason, strongAreasText } from "./interest-pattern";
import { type Responses, missingItems, scoreInterests } from "./scoring";

/**
 * The free interest quiz for visitors without an account (/try), and its optional strengths add-on
 * (/try/strengths: the Mini-IPIP, the same 20 statements as the signed-in personality activity).
 *
 * Privacy: a visitor's answers live only in their browser (localStorage, or in memory when storage
 * is blocked) until they create an account. Strengths are scored in the browser too. To find career
 * matches the browser sends only the six interest area scores, which the server doesn't keep. At
 * signup, or later from the dashboard, the saved answers are sent once, checked strictly here and
 * scored again on the server.
 *
 * Pure and safe to use in the browser: no database, no Node APIs.
 */

/** The activities a visitor can take without an account. */
export type FreeInstrument = "interests" | "personality";

/** Browser-only storage keys. */
export const SAVED_STORAGE_KEYS: Record<FreeInstrument, string> = { interests: "cc.freeInterests", personality: "cc.freeStrengths" };
export const SAVED_ASSESSMENT_STORAGE_KEY = SAVED_STORAGE_KEYS.interests;
export const SAVED_STRENGTHS_STORAGE_KEY = SAVED_STORAGE_KEYS.personality;
/** Form fields that carry the saved answers to the signup actions. */
export const SAVED_ASSESSMENT_FIELD = "savedAssessment";
export const SAVED_STRENGTHS_FIELD = "savedStrengths";
/** 60 answers serialize to about 700 characters; anything much larger isn't ours. */
export const MAX_SAVED_ASSESSMENT_LENGTH = 4096;

const FORMAT = 1;
const KEYS = ["answers", "instrument", "v", "version"];
const ITEMS: Record<FreeInstrument, readonly { id: string }[]> = { interests: INTEREST_ITEMS, personality: PERSONALITY_ITEMS };

/** What the browser keeps: the answers and the item set they belong to. Scores are never stored. */
export type SavedAnswers<I extends FreeInstrument = FreeInstrument> = {
  v: typeof FORMAT;
  instrument: I;
  /** INSTRUMENTS[instrument].version when the answers were given. */
  version: string;
  answers: Responses;
  /**
   * When the last answer was given (ms since 1970), so a shared device can say when the quiz was
   * taken ("finished yesterday"). Kept in the browser only: it's never sent to the server.
   */
  savedAt?: number;
  /**
   * Set once finishing these answers was counted (see countFreeFinishAction), so a reload or a second
   * press doesn't count it again. Kept in the browser only, and gone with the answers.
   */
  counted?: true;
};

/** The interest quiz's answers. */
export type SavedAssessment = SavedAnswers<"interests">;
/** The strengths add-on's answers. */
export type SavedStrengths = SavedAnswers<"personality">;

export function emptySaved<I extends FreeInstrument>(instrument: I): SavedAnswers<I> {
  return { v: FORMAT, instrument, version: INSTRUMENTS[instrument].version, answers: {} };
}

export function emptySavedAssessment(): SavedAssessment {
  return emptySaved("interests");
}

export function emptySavedStrengths(): SavedStrengths {
  return emptySaved("personality");
}

export function withSavedAnswer<I extends FreeInstrument>(
  instrument: I,
  saved: SavedAnswers<I> | null,
  itemId: string,
  value: number,
  now = Date.now(),
): SavedAnswers<I> {
  const base = saved ?? emptySaved(instrument);
  return { ...base, answers: { ...base.answers, [itemId]: value }, savedAt: now };
}

export function withAnswer(saved: SavedAssessment | null, itemId: string, value: number, now = Date.now()): SavedAssessment {
  return withSavedAnswer("interests", saved, itemId, value, now);
}

/** Every item answered: all 60 activities, or all 20 strengths statements. */
export function isComplete<T extends SavedAnswers>(saved: T | null | undefined): saved is T {
  return saved != null && missingItems(saved.instrument, saved.answers).length === 0;
}

/** All 60 activities rated. */
export function isFinished(saved: SavedAssessment | null | undefined): saved is SavedAssessment {
  return isComplete(saved);
}

export function answeredCount(saved: SavedAnswers | null | undefined): number {
  return saved ? ITEMS[saved.instrument].filter((i) => saved.answers[i.id] !== undefined).length : 0;
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

export type ValidatedAnswers = { ok: true; answers: Responses } | { ok: false; error: SavedAssessmentError };

/**
 * Strict check of saved answers sent by a browser (as the JSON string or the parsed object).
 * Accepts only the current version of the instrument's items, every item answered exactly once with
 * a whole number from 1 to 5, and nothing else: no scores, no extra fields.
 */
export function validateSaved(instrument: FreeInstrument, raw: unknown): ValidatedAnswers {
  const data = decode(raw);
  if (!isPlainObject(data)) return { ok: false, error: "invalid_format" };
  const keys = Object.keys(data).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return { ok: false, error: "invalid_format" };
  if (data.v !== FORMAT || data.instrument !== instrument || typeof data.version !== "string") {
    return { ok: false, error: "invalid_format" };
  }
  if (data.version !== INSTRUMENTS[instrument].version) return { ok: false, error: "old_version" };
  if (!isPlainObject(data.answers)) return { ok: false, error: "invalid_format" };

  const known = new Set<string>(INSTRUMENTS[instrument].itemIds);
  const entries = Object.entries(data.answers);
  if (entries.some(([itemId]) => !known.has(itemId))) return { ok: false, error: "unknown_item" };
  if (entries.some(([itemId, value]) => typeof value !== "number" || !isValidResponse(instrument, itemId, value))) {
    return { ok: false, error: "bad_value" };
  }
  const answers = Object.fromEntries(entries) as Responses;
  if (missingItems(instrument, answers).length > 0) return { ok: false, error: "incomplete" };
  return { ok: true, answers };
}

/** The strict check for the interest quiz (see validateSaved). */
export function validateSavedAssessment(raw: unknown): ValidatedAnswers {
  return validateSaved("interests", raw);
}

/** The strict check for the strengths add-on (see validateSaved). */
export function validateSavedStrengths(raw: unknown): ValidatedAnswers {
  return validateSaved("personality", raw);
}

/**
 * Lenient read of what this browser saved, for showing progress: keeps valid answers and drops
 * anything else. Answers to an older version of the items are dropped entirely.
 */
export function parseStored<I extends FreeInstrument>(instrument: I, raw: string | null | undefined): SavedAnswers<I> | null {
  if (!raw) return null;
  const data = decode(raw);
  if (!isPlainObject(data) || data.v !== FORMAT || data.instrument !== instrument) return null;
  if (data.version !== INSTRUMENTS[instrument].version || !isPlainObject(data.answers)) return null;
  const answers: Responses = {};
  for (const item of ITEMS[instrument]) {
    const value = data.answers[item.id];
    if (typeof value === "number" && isValidResponse(instrument, item.id, value)) answers[item.id] = value;
  }
  const { savedAt, counted } = data;
  const validTime = typeof savedAt === "number" && Number.isFinite(savedAt) && savedAt > 0;
  return { ...emptySaved(instrument), answers, ...(validTime && { savedAt }), ...(counted === true && { counted }) };
}

export function parseStoredAssessment(raw: string | null | undefined): SavedAssessment | null {
  return parseStored("interests", raw);
}

/**
 * The saved answers as sent to the server: exactly the fields validateSaved accepts. The
 * browser-only `savedAt` and `counted` are left out.
 */
export function serializeSavedAssessment(saved: SavedAnswers): string {
  const { v, instrument, version, answers } = saved;
  return JSON.stringify({ v, instrument, version, answers });
}

/** What goes in the browser's storage: the answers, when they were last changed, and whether they were counted. */
function storedForm(saved: SavedAnswers): string {
  const { v, instrument, version, answers, savedAt, counted } = saved;
  return JSON.stringify({ v, instrument, version, answers, savedAt, counted });
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Storage can be missing or throw (private browsing, blocked site data); treat that as "nothing saved". */
export function readSaved<I extends FreeInstrument>(instrument: I, storage: StorageLike | null): SavedAnswers<I> | null {
  try {
    return parseStored(instrument, storage?.getItem(SAVED_STORAGE_KEYS[instrument]));
  } catch {
    return null;
  }
}

/** Returns false when the browser wouldn't keep it; the quiz then carries on in memory. */
export function writeSaved(storage: StorageLike | null, saved: SavedAnswers): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVED_STORAGE_KEYS[saved.instrument], storedForm(saved));
    return true;
  } catch {
    return false;
  }
}

export function removeSaved(instrument: FreeInstrument, storage: StorageLike | null) {
  try {
    storage?.removeItem(SAVED_STORAGE_KEYS[instrument]);
  } catch {
    // Nothing to do: blocked storage never held anything.
  }
}

export function readSavedAssessment(storage: StorageLike | null): SavedAssessment | null {
  return readSaved("interests", storage);
}

export function writeSavedAssessment(storage: StorageLike | null, saved: SavedAssessment): boolean {
  return writeSaved(storage, saved);
}

export function removeSavedAssessment(storage: StorageLike | null) {
  removeSaved("interests", storage);
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

/**
 * The top interest areas of a finished quiz, in words: the top three, or more when areas are tied
 * for a place (see interestPattern). Null when no area stands out.
 */
export function topInterestsText(answers: Responses): string | null {
  return strongAreasText(scoreInterests(answers).areas);
}

/**
 * Describes a finished quiz saved in this browser without assuming whose it is, for shared family
 * or library computers: "Someone finished the free interest quiz on this device yesterday. Their
 * top interests were artistic, social and enterprising." With `strengths`, it says the strengths
 * add-on was finished too, since those answers go along with the quiz.
 */
export function describeSavedQuiz(saved: SavedAssessment, now = new Date(), { strengths = false } = {}): string {
  const when = savedWhen(saved.savedAt, now);
  const top = topInterestsText(saved.answers);
  return `Someone finished the free interest quiz on this device${when ? ` ${when}` : ""}. ${
    top ? `Their top interests were ${top}.` : `They ${noLeadReason(interestPattern(scoreInterests(saved.answers).areas))}.`
  }${strengths ? " They also answered the strengths questions." : ""}`;
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
