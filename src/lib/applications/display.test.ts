import { describe, expect, it } from "vitest";
import { compareAidOffer } from "./aid";
import { aidOfferLines, deadlineName, dueText, listMode, plural, scorecardPrice } from "./display";

describe("listMode", () => {
  it("collects ideas in grades 7–10 and applies in 11–12", () => {
    for (const g of [7, 8, 9, 10]) expect(listMode(g), String(g)).toEqual({ applying: false, showKeyDates: false, graduated: false });
    for (const g of [11, 12]) expect(listMode(g), String(g)).toEqual({ applying: true, showKeyDates: true, graduated: false });
  });

  it("keeps the tools but not this year's key dates for graduates and unknown grades", () => {
    expect(listMode(13)).toEqual({ applying: true, showKeyDates: false, graduated: true });
    expect(listMode(null)).toEqual({ applying: true, showKeyDates: false, graduated: false });
  });
});

describe("wording", () => {
  it("names deadlines", () => {
    expect(deadlineName("regular")).toBe("Regular deadline");
    expect(deadlineName("early_decision")).toBe("Early decision deadline");
    expect(deadlineName(null)).toBe("Deadline");
  });

  it("says when things are due", () => {
    expect(dueText(0)).toBe("Due today");
    expect(dueText(1)).toBe("Due tomorrow");
    expect(dueText(12)).toBe("Due in 12 days");
    expect(dueText(-1)).toBe("Was due yesterday");
    expect(dueText(-9)).toBe("Was due 9 days ago");
  });

  it("counts", () => {
    expect(plural(1, "aid offer")).toBe("1 aid offer");
    expect(plural(3, "aid offer")).toBe("3 aid offers");
  });
});

describe("aidOfferLines", () => {
  const value = (lines: ReturnType<typeof aidOfferLines>, key: string) => lines.find((l) => l.key === key);

  it("lists every amount and total in order", () => {
    const lines = aidOfferLines(compareAidOffer({ costOfAttendance: 30000, grants: 8000, scholarships: 4000, federalLoans: 5500, workStudy: 2500 }));
    expect(lines.map((l) => [l.key, l.value])).toEqual([
      ["costOfAttendance", "$30,000"],
      ["grants", "$8,000"],
      ["scholarships", "$4,000"],
      ["giftAid", "$12,000"],
      ["netPrice", "$18,000"],
      ["federalLoans", "$5,500"],
      ["parentLoans", "Not listed"],
      ["otherLoans", "Not listed"],
      ["workStudy", "$2,500"],
      ["paidNow", "$10,000"],
    ]);
    expect(lines.filter((l) => l.strong).map((l) => l.key)).toEqual(["giftAid", "netPrice", "paidNow"]);
  });

  it("explains a $0 net price when aid is more than the cost", () => {
    const net = value(aidOfferLines(compareAidOffer({ costOfAttendance: 10000, grants: 12000 })), "netPrice");
    expect(net).toMatchObject({ value: "$0", note: expect.stringContaining("more than the cost") });
  });

  it("asks for the cost instead of showing blanks", () => {
    const lines = aidOfferLines(compareAidOffer({ grants: 3000 }));
    expect(value(lines, "costOfAttendance")?.value).toBe("Not listed");
    expect(value(lines, "netPrice")).toMatchObject({ value: "Needs the total cost", note: "Add the total cost to see the net price." });
    expect(value(lines, "paidNow")?.value).toBe("Needs the total cost");
    expect(JSON.stringify(lines)).not.toMatch(/null|NaN|-\$|\$-/);
  });
});

describe("scorecardPrice", () => {
  it("formats the average net price", () => {
    expect(scorecardPrice({ found: true, avgNetPrice: 15234 })).toEqual({ amount: "$15,234", note: null });
  });

  it("shows $0 and explains when aid averaged more than the cost", () => {
    expect(scorecardPrice({ found: true, avgNetPrice: -1200 })).toEqual({ amount: "$0", note: "On average, aid here was more than the cost." });
  });

  it("explains missing or hidden numbers instead of showing blanks", () => {
    for (const s of [null, { found: false, avgNetPrice: null }, { found: true, avgNetPrice: null }]) {
      const price = scorecardPrice(s);
      expect(price.amount).toBeNull();
      expect(price.note).toBeTruthy();
      expect(price.note).not.toMatch(/null|NaN|PS/);
    }
  });
});
