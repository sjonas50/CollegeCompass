import type { NetPriceByIncome } from "@/db/schema";
import { formatDollars } from "./format";

/**
 * The five College Scorecard family-income bands for net price.
 *
 * Privacy: we never collect family income. A student's chosen band lives only in their browser
 * (localStorage) and is never sent to the server or put in a URL. Server pages render every band
 * and a client component highlights the chosen one.
 */
export type IncomeBand = keyof NetPriceByIncome;

export const INCOME_BANDS: readonly { key: IncomeBand; label: string }[] = [
  { key: "0-30000", label: "$0–$30,000" },
  { key: "30001-48000", label: "$30,001–$48,000" },
  { key: "48001-75000", label: "$48,001–$75,000" },
  { key: "75001-110000", label: "$75,001–$110,000" },
  { key: "110001-plus", label: "$110,001 or more" },
];

/** Browser-only storage key for the chosen band. */
export const INCOME_BAND_STORAGE_KEY = "cc.incomeBand";

export function isIncomeBand(value: unknown): value is IncomeBand {
  return typeof value === "string" && INCOME_BANDS.some((b) => b.key === value);
}

export function incomeBandLabel(band: IncomeBand): string {
  return INCOME_BANDS.find((b) => b.key === band)?.label ?? band;
}

function valueOf(byIncome: NetPriceByIncome | null | undefined, band: IncomeBand): number | null {
  const value = byIncome?.[band];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function netPriceForBand(byIncome: NetPriceByIncome | null | undefined, band: IncomeBand): number | null {
  return valueOf(byIncome, band);
}

/** One row per band, in income order, with null where the college reported nothing. */
export function netPriceRows(byIncome: NetPriceByIncome | null | undefined) {
  return INCOME_BANDS.map((b) => ({ band: b.key, label: b.label, netPrice: valueOf(byIncome, b.key) }));
}

/** Lowest and highest reported band prices (raw; may be negative), or null when none were reported. */
export function netPriceRange(byIncome: NetPriceByIncome | null | undefined): { low: number; high: number } | null {
  const values = netPriceRows(byIncome)
    .map((r) => r.netPrice)
    .filter((v): v is number => v !== null);
  if (!values.length) return null;
  return { low: Math.min(...values), high: Math.max(...values) };
}

export type NetPriceHeadline =
  | { kind: "band"; text: string; aidExceedsCost: boolean }
  | { kind: "band-missing"; text: string }
  | { kind: "range"; text: string };

/**
 * The sentence that headlines a college's net price. With a chosen band it names that band's
 * price; without one it gives the range across bands. Null when no band prices were reported.
 */
export function netPriceHeadline(byIncome: NetPriceByIncome | null | undefined, band: IncomeBand | null): NetPriceHeadline | null {
  if (band) {
    const value = valueOf(byIncome, band);
    const label = incomeBandLabel(band);
    if (value === null) {
      return {
        kind: "band-missing",
        text: `No price is reported here for families earning ${label}, usually because too few students in that range got federal aid.`,
      };
    }
    return {
      kind: "band",
      text: `For families earning ${label}, students paid about ${formatDollars(value)} a year after grants.`,
      aidExceedsCost: value < 0,
    };
  }
  const range = netPriceRange(byIncome);
  if (!range) return null;
  const low = formatDollars(range.low);
  const high = formatDollars(range.high);
  return {
    kind: "range",
    text:
      low === high
        ? `After grants, students paid about ${low} a year.`
        : `After grants, students paid about ${low} to ${high} a year, depending on family income.`,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The saved band, or null when there is none, it's invalid, or storage is unavailable. */
export function readStoredBand(storage: StorageLike | null | undefined): IncomeBand | null {
  try {
    const value = storage?.getItem(INCOME_BAND_STORAGE_KEY);
    return isIncomeBand(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves (or with null, forgets) the band. Returns false when storage is unavailable. */
export function storeBand(storage: StorageLike | null | undefined, band: IncomeBand | null): boolean {
  if (!storage) return false;
  try {
    if (band) storage.setItem(INCOME_BAND_STORAGE_KEY, band);
    else storage.removeItem(INCOME_BAND_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
