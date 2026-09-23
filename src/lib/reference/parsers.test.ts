import { describe, expect, it } from "vitest";
import {
  parseCipSoc,
  parseCollege,
  parseJobZone,
  parseOccupation,
  parseOccupationInterest,
  socFromOnetCode,
} from "./parsers";

// Rows copied from the real O*NET 31.0, NCES CIP2020–SOC2018 and College Scorecard files.
describe("reference parsers", () => {
  it("parses O*NET occupations and job zones", () => {
    expect(parseOccupation({ "O*NET-SOC Code": "11-1011.00", Title: "Chief Executives", Description: "Determine policies." }))
      .toEqual({ code: "11-1011.00", title: "Chief Executives", description: "Determine policies." });
    expect(parseJobZone({ "O*NET-SOC Code": "11-1011.00", Title: "Chief Executives", "Job Zone": "5" })).toEqual(["11-1011.00", 5]);
    expect(parseJobZone({ "O*NET-SOC Code": "x", "Job Zone": "n/a" })).toBeNull();
  });

  it("keeps only RIASEC scores from career_interest_types", () => {
    const base = { "O*NET-SOC Code": "11-1011.00", Title: "Chief Executives", Date: "02/2026" };
    expect(
      parseOccupationInterest({ ...base, "Element ID": "1.B.1.e", "Element Name": "Enterprising", "Scale ID": "OI", "Data Value": "6.96" }),
    ).toEqual({ occupationCode: "11-1011.00", interest: "E", score: 6.96 });
    expect(
      parseOccupationInterest({ ...base, "Element ID": "1.B.1.g", "Element Name": "First Interest High-Point", "Scale ID": "IH", "Data Value": "5.00" }),
    ).toBeNull();
  });

  it("parses the CIP–SOC crosswalk and skips unmatched rows", () => {
    expect(parseCipSoc({ CIP2020Code: "01.0000", CIP2020Title: "Agriculture, General.", SOC2018Code: "19-1011", SOC2018Title: "Animal Scientists" }))
      .toEqual({ cipCode: "01.0000", cipTitle: "Agriculture, General", socCode: "19-1011" });
    expect(parseCipSoc({ CIP2020Code: "01.0000", CIP2020Title: "Agriculture, General.", SOC2018Code: "99-9999" })).toBeNull();
  });

  it("parses Scorecard institutions with net price by income", () => {
    const college = parseCollege({
      UNITID: "100654", INSTNM: "Alabama A & M University", CITY: "Normal", STABBR: "AL", INSTURL: "www.aamu.edu/",
      PREDDEG: "3", CONTROL: "1", CURROPER: "1", ADM_RATE: "0.6622", C150_4: "0.2807", C150_L4: "NULL",
      MD_EARN_WNE_P10: "36339", NPT4_PUB: "14982", NPT41_PUB: "14126", NPT42_PUB: "15634", NPT43_PUB: "PrivacySuppressed",
      NPT44_PUB: "NULL", NPT45_PUB: "18511",
    });
    expect(college).toEqual({
      unitId: 100654, name: "Alabama A & M University", city: "Normal", state: "AL", url: "https://www.aamu.edu/",
      control: 1, admissionRate: 0.6622, completionRate: 0.2807, medianEarnings10yr: 36339, avgNetPrice: 14982,
      netPriceByIncome: { "0-30000": 14126, "30001-48000": 15634, "110001-plus": 18511 },
    });
  });

  it("skips closed schools and uses private net price columns for private schools", () => {
    expect(parseCollege({ UNITID: "1", INSTNM: "Closed U", PREDDEG: "3", CURROPER: "0" })).toBeNull();
    const priv = parseCollege({ UNITID: "2", INSTNM: "Private C", PREDDEG: "3", CURROPER: "1", CONTROL: "2", NPT4_PRIV: "20000", NPT41_PRIV: "9000" });
    expect(priv).toMatchObject({ avgNetPrice: 20000, netPriceByIncome: { "0-30000": 9000 } });
  });

  it("maps O*NET codes to SOC codes", () => {
    expect(socFromOnetCode("15-1252.00")).toBe("15-1252");
  });
});
