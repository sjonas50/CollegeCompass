import { describe, expect, it } from "vitest";
import {
  INCOME_BANDS,
  INCOME_BAND_STORAGE_KEY,
  incomeBandLabel,
  isIncomeBand,
  netPriceForBand,
  netPriceHeadline,
  netPriceRange,
  netPriceRows,
  readStoredBand,
  storeBand,
} from "./income";

const prices = { "0-30000": 6_500, "30001-48000": 8_200, "48001-75000": 12_000, "75001-110000": 19_500, "110001-plus": 24_000 };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("income bands", () => {
  it("are the five Scorecard bands with plain labels, in income order", () => {
    expect(INCOME_BANDS.map((b) => b.key)).toEqual(["0-30000", "30001-48000", "48001-75000", "75001-110000", "110001-plus"]);
    expect(INCOME_BANDS.map((b) => b.label)).toEqual([
      "$0–$30,000",
      "$30,001–$48,000",
      "$48,001–$75,000",
      "$75,001–$110,000",
      "$110,001 or more",
    ]);
    expect(incomeBandLabel("30001-48000")).toBe("$30,001–$48,000");
  });

  it("recognizes only real band keys", () => {
    expect(isIncomeBand("48001-75000")).toBe(true);
    expect(isIncomeBand("48000")).toBe(false);
    expect(isIncomeBand(null)).toBe(false);
    expect(isIncomeBand(3)).toBe(false);
  });

  it("reads one band's price and every band's row", () => {
    expect(netPriceForBand(prices, "30001-48000")).toBe(8_200);
    expect(netPriceForBand({ "0-30000": 100 }, "110001-plus")).toBeNull();
    expect(netPriceForBand(null, "0-30000")).toBeNull();
    const rows = netPriceRows({ "0-30000": 4_000, "110001-plus": 30_000 });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.netPrice)).toEqual([4_000, null, null, null, 30_000]);
    expect(rows[1]).toEqual({ band: "30001-48000", label: "$30,001–$48,000", netPrice: null });
  });

  it("finds the range across reported bands", () => {
    expect(netPriceRange(prices)).toEqual({ low: 6_500, high: 24_000 });
    expect(netPriceRange({ "48001-75000": 9_000 })).toEqual({ low: 9_000, high: 9_000 });
    expect(netPriceRange({})).toBeNull();
    expect(netPriceRange(null)).toBeNull();
  });
});

describe("net price headline", () => {
  it("names the chosen band's price", () => {
    expect(netPriceHeadline(prices, "30001-48000")).toEqual({
      kind: "band",
      text: "For families earning $30,001–$48,000, students paid about $8,200 a year after grants.",
      aidExceedsCost: false,
    });
  });

  it("shows $0, never a negative price, when aid was more than the cost", () => {
    const headline = netPriceHeadline({ "0-30000": -1_850 }, "0-30000");
    expect(headline).toMatchObject({ kind: "band", aidExceedsCost: true });
    expect(headline?.text).toContain("about $0 a year");
    expect(headline?.text).not.toContain("-");
  });

  it("explains a missing band price in plain words", () => {
    const headline = netPriceHeadline({ "0-30000": 5_000 }, "110001-plus");
    expect(headline?.kind).toBe("band-missing");
    expect(headline?.text).toBe(
      "No price is reported here for families earning $110,001 or more, usually because too few students in that range got federal aid.",
    );
  });

  it("gives the range across bands without a choice", () => {
    expect(netPriceHeadline(prices, null)).toEqual({
      kind: "range",
      text: "After grants, students paid about $6,500 to $24,000 a year, depending on family income.",
    });
    expect(netPriceHeadline({ "0-30000": -300, "30001-48000": 2_000 }, null)?.text).toContain("about $0 to $2,000");
    expect(netPriceHeadline({ "0-30000": 7_000 }, null)?.text).toBe("After grants, students paid about $7,000 a year.");
    expect(netPriceHeadline(null, null)).toBeNull();
  });

  it("says the price is for in-state students at public colleges", () => {
    expect(netPriceHeadline(prices, "0-30000", { inState: true })?.text).toBe(
      "For families earning $0–$30,000, in-state students paid about $6,500 a year after grants.",
    );
    expect(netPriceHeadline(prices, null, { inState: true })?.text).toBe(
      "After grants, in-state students paid about $6,500 to $24,000 a year, depending on family income.",
    );
  });
});

describe("stored band (browser only)", () => {
  it("round-trips a chosen band and forgets it", () => {
    const storage = memoryStorage();
    expect(readStoredBand(storage)).toBeNull();
    expect(storeBand(storage, "75001-110000")).toBe(true);
    expect(storage.data.get(INCOME_BAND_STORAGE_KEY)).toBe("75001-110000");
    expect(readStoredBand(storage)).toBe("75001-110000");
    expect(storeBand(storage, null)).toBe(true);
    expect(readStoredBand(storage)).toBeNull();
  });

  it("ignores values that aren't a band", () => {
    expect(readStoredBand(memoryStorage({ [INCOME_BAND_STORAGE_KEY]: "52000" }))).toBeNull();
  });

  it("works without storage, or when storage throws", () => {
    expect(readStoredBand(undefined)).toBeNull();
    expect(readStoredBand(null)).toBeNull();
    expect(readStoredBand(throwing)).toBeNull();
    expect(storeBand(throwing, "0-30000")).toBe(false);
    expect(storeBand(null, "0-30000")).toBe(false);
  });
});
