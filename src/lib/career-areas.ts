import { RIASEC, type Riasec } from "./assessments/instruments";
import { JOB_ZONE_INFO } from "./job-zones";

/*
 * Links for browsing careers by interest area (/careers?area=R, see careers-browse.ts). No database
 * code, so client components can link here too.
 */

/** Plain names for the six interest areas, shown with their RIASEC names. */
export const AREA_BROWSE_NAMES: Record<Riasec, string> = {
  R: "Building and fixing things",
  I: "Science and solving problems",
  A: "Art, music and writing",
  S: "Helping and teaching people",
  E: "Leading and persuading",
  C: "Keeping things organized",
};

/** An interest area from a ?area= value ("R" or "r"), or null. */
export function parseBrowseArea(value: unknown): Riasec | null {
  if (typeof value !== "string") return null;
  const letter = value.trim().toUpperCase();
  return (RIASEC as readonly string[]).includes(letter) ? (letter as Riasec) : null;
}

/** A Job Zone from a ?level= value, or null for every level. */
export function parseBrowseLevel(value: unknown): number | null {
  const level = typeof value === "string" && /^\d$/.test(value.trim()) ? Number(value) : NaN;
  return Object.hasOwn(JOB_ZONE_INFO, level) ? level : null;
}

/**
 * A /careers browse link. It lands below the search box so phones don't open at the top: on the
 * area (#results), its preparation levels (#levels, for picking a level) or the list itself (#list,
 * for page links).
 */
export function browseHref(
  area: Riasec,
  { level = null, page = 1, to = "results" }: { level?: number | null; page?: number; to?: "results" | "levels" | "list" } = {},
): string {
  const params = new URLSearchParams({ area });
  if (level !== null) params.set("level", String(level));
  if (page > 1) params.set("page", String(page));
  return `/careers?${params}#${to}`;
}
