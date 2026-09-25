import type { LetterGrade } from "@/lib/courses/catalog";
import type { SchoolGrade } from "../common";
import type { ByWhen } from "../engine-io";

// Small pure helpers the engine shares: letter grades, ordering, grade names and a stable hash.
// Nothing here reads a clock or randomness.

/** Points for comparing letters; P, W and I have none. */
const LETTER_RANK: Partial<Record<LetterGrade, number>> = {
  "A+": 12,
  A: 11,
  "A-": 10,
  "B+": 9,
  B: 8,
  "B-": 7,
  "C+": 6,
  C: 5,
  "C-": 4,
  "D+": 3,
  D: 2,
  "D-": 1,
  F: 0,
};

export function letterRank(letter: LetterGrade | null): number | null {
  if (letter === null) return null;
  return LETTER_RANK[letter] ?? null;
}

/** "B or better" (B- is below B). Unknown letters (null, P) return null. */
export function atLeast(letter: LetterGrade | null, min: LetterGrade): boolean | null {
  const have = letterRank(letter);
  const need = letterRank(min);
  if (have === null || need === null) return null;
  return have >= need;
}

/** F, W and I earn no credit ("Plans change. Here's what still fits."). */
export function earnsNoCredit(letter: LetterGrade | null): boolean {
  return letter === "F" || letter === "W" || letter === "I";
}

/** "9th", "10th" … every grade we plan takes "th". */
export function nth(grade: number): string {
  return `${grade}th`;
}

/** Sort key for "soonest first": a school year runs August to July. */
export function byWhenOrder(by: ByWhen): number {
  const month = by.point === "date" ? by.month : by.point === "start" ? 8 : 6;
  const schoolMonth = month >= 8 ? month - 8 : month + 4; // August = 0 … July = 11
  const day = by.point === "date" ? by.day : by.point === "start" ? 0 : 31;
  return by.grade * 1000 + schoolMonth * 40 + day;
}

export function gradeRange(from: number, to: number): SchoolGrade[] {
  const out: SchoolGrade[] = [];
  for (let g = Math.max(7, from); g <= Math.min(12, to); g++) out.push(g as SchoolGrade);
  return out;
}

/** JSON with sorted keys and no undefined values, so equal data always gives the same string. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A 64-bit FNV-1a hash as 16 hex characters. Not for security: a fingerprint that changes when
 * the input changes, computed without node:crypto so the engine stays a plain function.
 */
export function hash16(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
