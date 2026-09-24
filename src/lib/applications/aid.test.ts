import { describe, expect, it } from "vitest";
import type { AidOffer } from "@/db/schema";
import { OTHER_LOAN_WARNING, PARENT_LOAN_WARNING, compareAidOffer, formatDollars, hasAidOffer } from "./aid";

describe("compareAidOffer", () => {
  it("does the math for a typical offer", () => {
    const c = compareAidOffer({
      costOfAttendance: 30000,
      grants: 8000,
      scholarships: 4000,
      workStudy: 2500,
      federalLoans: 5500,
      parentLoans: 6000,
      otherLoans: 2000,
    });
    expect(c).toMatchObject({
      giftAid: 12000,
      netPrice: 18000,
      loans: 13500,
      paidNow: 2000,
      giftExceedsCost: false,
      hasParentLoans: true,
      hasOtherLoans: true,
      missing: [],
    });
    expect(c.warnings).toEqual([PARENT_LOAN_WARNING, OTHER_LOAN_WARNING]);
  });

  it("handles an offer of all zeros", () => {
    const c = compareAidOffer({ costOfAttendance: 0, grants: 0, scholarships: 0, workStudy: 0, federalLoans: 0, parentLoans: 0, otherLoans: 0 });
    expect(c).toMatchObject({ giftAid: 0, netPrice: 0, loans: 0, paidNow: 0, warnings: [], hasParentLoans: false, missing: [] });
  });

  it("treats blank amounts as zero and lists them", () => {
    const c = compareAidOffer({ costOfAttendance: 25000, grants: 6000 });
    expect(c).toMatchObject({ giftAid: 6000, netPrice: 19000, loans: 0, paidNow: 19000 });
    expect(c.missing).toEqual(["scholarships", "workStudy", "federalLoans", "parentLoans", "otherLoans"]);
  });

  it("can't give a net price without the total cost", () => {
    const c = compareAidOffer({ grants: 6000, federalLoans: 5500 });
    expect(c.costOfAttendance).toBeNull();
    expect(c.netPrice).toBeNull();
    expect(c.paidNow).toBeNull();
    expect(c.giftAid).toBe(6000);
    expect(c.missing).toContain("costOfAttendance");
  });

  it("never shows a negative price when grants and scholarships are more than the cost", () => {
    const c = compareAidOffer({ costOfAttendance: 20000, grants: 15000, scholarships: 10000, federalLoans: 3000 });
    expect(c.netPrice).toBe(0);
    expect(c.paidNow).toBe(0);
    expect(c.giftExceedsCost).toBe(true);
  });

  it("doesn't go below zero when loans and work-study cover more than the net price", () => {
    const c = compareAidOffer({ costOfAttendance: 20000, grants: 10000, federalLoans: 7000, workStudy: 5000 });
    expect(c.netPrice).toBe(10000);
    expect(c.paidNow).toBe(0);
  });

  it("flags parent and other loans only when there's an amount", () => {
    expect(compareAidOffer({ costOfAttendance: 1000, parentLoans: 0 }).hasParentLoans).toBe(false);
    expect(compareAidOffer({ costOfAttendance: 1000, parentLoans: 1 }).warnings).toEqual([PARENT_LOAN_WARNING]);
    expect(compareAidOffer({ costOfAttendance: 1000, otherLoans: 500 }).warnings).toEqual([OTHER_LOAN_WARNING]);
  });

  it("ignores bad stored values instead of producing NaN", () => {
    const junk = { costOfAttendance: 20000, grants: -500, scholarships: Number.NaN, federalLoans: "3000" } as unknown as AidOffer;
    const c = compareAidOffer(junk);
    expect(c.giftAid).toBe(0);
    expect(c.netPrice).toBe(20000);
    expect(c.federalLoans).toBe(0);
    expect(Object.values(c).some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });

  it("works without an offer", () => {
    expect(compareAidOffer(null)).toMatchObject({ netPrice: null, giftAid: 0, loans: 0, warnings: [] });
    expect(hasAidOffer(null)).toBe(false);
    expect(hasAidOffer({})).toBe(false);
    expect(hasAidOffer({ grants: 0 })).toBe(true);
  });
});

describe("formatDollars", () => {
  it("shows whole dollars with commas and never a negative", () => {
    expect(formatDollars(12345)).toBe("$12,345");
    expect(formatDollars(1234.6)).toBe("$1,235");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(-50)).toBe("$0");
    expect(formatDollars(Number.NaN)).toBe("$0");
    expect(formatDollars(200000)).toBe("$200,000");
  });
});
