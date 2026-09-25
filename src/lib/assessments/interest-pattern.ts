import { RIASEC, RIASEC_INFO, type Riasec } from "./instruments";

/**
 * What a student's six interest scores can honestly say. The interest code always has three
 * letters, with ties kept in RIASEC order so scoring is deterministic (see scoreInterests). The
 * results pages describe the scores with this instead, so a tie never reads as a real difference:
 *
 * - "flat": the six scores are about the same (every answer "Not sure", say), so no area stands
 *   out. Matching compares levels instead of shape for these profiles (see match.ts).
 * - "low": no area reaches "Not sure" on average: the student leaned toward disliking all six, so
 *   the least disliked area isn't a lead either ("Dislike" on one area and "Strongly dislike" on
 *   the rest). Only the words change: matching still ranks these profiles by shape.
 * - "code": the top three areas are clear. `ties` holds areas among them with the same score,
 *   whose order in the code means nothing.
 * - "tied": areas with the same score compete for the last places in the top three, so there is no
 *   one code. `standOut` are the areas above the tie (none when the tie is for first place).
 *
 * For "flat" and "low" no area stands out (see noAreaStandsOut).
 */
export type InterestPattern =
  | { kind: "flat" }
  | { kind: "low" }
  | { kind: "code"; code: string; ties: Riasec[][] }
  | { kind: "tied"; standOut: Riasec[]; tied: Riasec[] };

/** Out of 0–40 per area. Below this spread the scores are too even to rank areas (or careers by shape). */
export const FLAT_PROFILE_SD = 2;

/** An area's score when all ten of its activities are answered "Not sure" (2 of 0–4 each). */
export const NOT_SURE_AREA_SCORE = 20;

export function isFlatProfile(scores: number[]): boolean {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.map((s) => (s - mean) ** 2).reduce((a, b) => a + b, 0) / scores.length;
  return Math.sqrt(variance) < FLAT_PROFILE_SD;
}

export function interestPattern(areas: Record<Riasec, number>): InterestPattern {
  if (isFlatProfile(RIASEC.map((a) => areas[a]))) return { kind: "flat" };
  if (RIASEC.every((a) => areas[a] < NOT_SURE_AREA_SCORE)) return { kind: "low" };
  // Areas with the same score share a group, highest first (RIASEC order inside a group).
  const groups: Riasec[][] = [];
  for (const area of [...RIASEC].sort((a, b) => areas[b] - areas[a])) {
    const last = groups.at(-1);
    if (last && areas[last[0]] === areas[area]) last.push(area);
    else groups.push([area]);
  }
  const top: Riasec[][] = [];
  for (const group of groups) {
    const placed = top.flat().length;
    if (placed === 3) break;
    if (placed + group.length > 3) return { kind: "tied", standOut: top.flat(), tied: group };
    top.push(group);
  }
  return { kind: "code", code: top.flat().join(""), ties: top.filter((g) => g.length > 1) };
}

/** True when the scores point to no area: they're about the same, or no area was liked. */
export function noAreaStandsOut(pattern: InterestPattern): pattern is { kind: "flat" } | { kind: "low" } {
  return pattern.kind === "flat" || pattern.kind === "low";
}

/**
 * Why no area stands out, to follow "You" or "They": "rated all six interest areas about the same".
 * Null when areas do stand out.
 */
export function noLeadReason(pattern: InterestPattern): string | null {
  if (pattern.kind === "flat") return "rated all six interest areas about the same";
  if (pattern.kind === "low") return "leaned toward disliking all six interest areas";
  return null;
}

/**
 * The areas the results point to: the code's, or those above a tie (the tied areas when the tie is
 * for first place). None when no area stands out.
 */
export function strongAreas(pattern: InterestPattern): Riasec[] {
  if (noAreaStandsOut(pattern)) return [];
  if (pattern.kind === "tied") return pattern.standOut.length ? pattern.standOut : pattern.tied;
  return pattern.code.split("") as Riasec[];
}

/** The strong areas in words, "artistic, social and enterprising"; null when no area stands out. */
export function strongAreasText(areas: Record<Riasec, number>): string | null {
  const strong = strongAreas(interestPattern(areas));
  return strong.length ? areaNames(strong, { lower: true }) : null;
}

/** "Realistic", "Realistic and Investigative", "Realistic, Investigative and Artistic". */
export function areaNames(areas: Riasec[], { lower = false } = {}): string {
  const names = areas.map((a) => (lower ? RIASEC_INFO[a].name.toLowerCase() : RIASEC_INFO[a].name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

/** For a clear code with a tie inside it: "Realistic and Investigative are tied, so their order doesn't matter." */
export function codeTieText(pattern: InterestPattern): string | null {
  if (pattern.kind !== "code" || pattern.ties.length === 0) return null;
  return `${areaNames(pattern.ties[0])} are tied, so their order doesn't matter.`;
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

/**
 * For a tie over the last places: "Artistic and Social stand out. Enterprising and Conventional
 * are tied after them." (or "The other four areas are tied." when that's all of them), or
 * "Realistic, Investigative, Artistic and Social are tied for your top area."
 */
export function tiedAreasText(pattern: Extract<InterestPattern, { kind: "tied" }>): string {
  const { standOut, tied } = pattern;
  if (standOut.length === 0) return `${areaNames(tied)} are tied for your top area.`;
  const one = standOut.length === 1;
  const rest =
    standOut.length + tied.length === RIASEC.length
      ? `The other ${COUNT_WORDS[tied.length]} areas are tied.`
      : `${areaNames(tied)} are tied after ${one ? "it" : "them"}.`;
  return `${areaNames(standOut)} ${one ? "stands" : "stand"} out. ${rest}`;
}
