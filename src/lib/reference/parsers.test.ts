import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import {
  collectCollegePrograms,
  parseCipMajor,
  parseCipSoc,
  parseCollege,
  parseCollegeProgram,
  parseJobZone,
  parseOccupation,
  parseOccupationInterest,
  parseOccupationValue,
  parseWorkStyle,
  collectWorkStyles,
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

  it("keeps only work value extent scores", () => {
    const base = { "O*NET-SOC Code": "11-1011.00", Date: "06/2008" };
    expect(parseOccupationValue({ ...base, "Element Name": "Working Conditions", "Scale ID": "EX", "Data Value": "6.33" }))
      .toEqual({ occupationCode: "11-1011.00", value: "working_conditions", score: 6.33 });
    expect(parseOccupationValue({ ...base, "Element Name": "First Work Value High-Point", "Scale ID": "VH", "Data Value": "3.00" })).toBeNull();
  });

  describe("O*NET work styles", () => {
    // Rows from the real work_styles.csv (O*NET 31.0): Software Developers and Secondary School Teachers.
    const dev = { "O*NET-SOC Code": "15-1252.00", Title: "Software Developers", Date: "12/2025", "Domain Source": "AI/Expert" };
    const row = (elementId: string, elementName: string, scale: "WI" | "DR", value: string, base: Record<string, string> = dev) => ({
      ...base,
      "Element ID": elementId,
      "Element Name": elementName,
      "Scale ID": scale,
      "Scale Name": scale === "WI" ? "Work Styles Impact" : "Distinctiveness Rank",
      "Data Value": value,
    });

    it("reads both scales and keys styles by element ID", () => {
      expect(parseWorkStyle(row("1.D.1.a", "Innovation", "DR", "1.00"))).toEqual({
        occupationCode: "15-1252.00", style: "innovation", scale: "DR", value: 1,
      });
      expect(parseWorkStyle(row("1.D.1.a", "Innovation", "WI", "2.51"))).toEqual({
        occupationCode: "15-1252.00", style: "innovation", scale: "WI", value: 2.51,
      });
      // Humility can get in the way of some work (Chief Executives: −0.27).
      const ceo = { ...dev, "O*NET-SOC Code": "11-1011.00", Title: "Chief Executives" };
      expect(parseWorkStyle(row("1.D.2.a", "Humility", "WI", "-0.27", ceo))).toMatchObject({ style: "humility", value: -0.27 });
    });

    it("skips unknown styles, other scales and values out of range", () => {
      expect(parseWorkStyle(row("1.D.9.z", "Something New", "WI", "2.00"))).toBeNull();
      expect(parseWorkStyle({ ...row("1.D.1.a", "Innovation", "WI", "2.51"), "Scale ID": "IM" })).toBeNull();
      expect(parseWorkStyle(row("1.D.1.a", "Innovation", "WI", "4.10"))).toBeNull();
      expect(parseWorkStyle(row("1.D.1.a", "Innovation", "DR", "11.00"))).toBeNull();
      expect(parseWorkStyle(row("1.D.1.a", "Innovation", "DR", "n/a"))).toBeNull();
      expect(parseWorkStyle({ ...row("1.D.1.a", "Innovation", "WI", "2.51"), "O*NET-SOC Code": "" })).toBeNull();
    });

    it("joins the scales into one record per style, with rank 0 as not ranked, and loads them", async () => {
      const teacher = { ...dev, "O*NET-SOC Code": "25-2031.00", Title: "Secondary School Teachers, Except Special and Career/Technical Education" };
      const ratings = [
        row("1.D.1.a", "Innovation", "DR", "1.00"),
        row("1.D.1.a", "Innovation", "WI", "2.51"),
        row("1.D.1.d", "Tolerance for Ambiguity", "DR", "0.00"),
        row("1.D.1.d", "Tolerance for Ambiguity", "WI", "1.72"),
        row("1.D.4.a", "Stress Tolerance", "WI", "2.06", teacher),
        row("1.D.4.a", "Stress Tolerance", "DR", "6.00", teacher),
        // A rank with no impact isn't kept.
        row("1.D.2.c", "Empathy", "DR", "3.00", teacher),
      ]
        .map(parseWorkStyle)
        .filter((r) => r !== null);
      const styles = collectWorkStyles(ratings);
      expect(styles).toEqual([
        { occupationCode: "15-1252.00", style: "innovation", impact: 2.51, distinctiveRank: 1 },
        { occupationCode: "15-1252.00", style: "tolerance_for_ambiguity", impact: 1.72, distinctiveRank: null },
        { occupationCode: "25-2031.00", style: "stress_tolerance", impact: 2.06, distinctiveRank: 6 },
      ]);

      const db = await createTestDb();
      await db.insert(schema.occupations).values([
        { code: "15-1252.00", title: "Software Developers", description: "" },
        { code: "25-2031.00", title: "Secondary School Teachers", description: "" },
      ]);
      await db.insert(schema.occupationWorkStyles).values(styles);
      expect(await db.select().from(schema.occupationWorkStyles)).toEqual(
        expect.arrayContaining(styles.map((s) => ({ ...s, impact: expect.closeTo(s.impact, 4) }))),
      );
    });
  });

  it("parses the CIP–SOC crosswalk and skips unmatched rows", () => {
    expect(parseCipSoc({ CIP2020Code: "01.0000", CIP2020Title: "Agriculture, General.", SOC2018Code: "19-1011", SOC2018Title: "Animal Scientists" }))
      .toEqual({ cipCode: "01.0000", cipTitle: "Agriculture, General", socCode: "19-1011" });
    expect(parseCipSoc({ CIP2020Code: "01.0000", CIP2020Title: "Agriculture, General.", SOC2018Code: "99-9999" })).toBeNull();
    // Occupations with no matching major are listed under a "99.9999 NO MATCH" major.
    expect(parseCipSoc({ CIP2020Code: "99.9999", CIP2020Title: "NO MATCH", SOC2018Code: "27-1023", SOC2018Title: "Floral Designers" })).toBeNull();
  });

  it("keeps every real major for major search, even with no matching occupation, but not NO MATCH", () => {
    expect(parseCipMajor({ CIP2020Code: "51.1102", CIP2020Title: "Pre-Medicine/Pre-Medical Studies.", SOC2018Code: "99-9999", SOC2018Title: "NO MATCH" }))
      .toEqual({ cipCode: "51.1102", title: "Pre-Medicine/Pre-Medical Studies" });
    expect(parseCipMajor({ CIP2020Code: "48.0508", CIP2020Title: "Welding Technology/Welder.", SOC2018Code: "51-4121" }))
      .toEqual({ cipCode: "48.0508", title: "Welding Technology/Welder" });
    expect(parseCipMajor({ CIP2020Code: "99.9999", CIP2020Title: "NO MATCH", SOC2018Code: "25-3041", SOC2018Title: "Tutors" })).toBeNull();
    expect(parseCipMajor({ CIP2020Code: "5111", CIP2020Title: "Health/Medical Preparatory Programs." })).toBeNull();
  });

  it("parses Scorecard institutions with every column we keep (public HBCU)", () => {
    const college = parseCollege({
      UNITID: "100654", INSTNM: "Alabama A & M University", CITY: "Normal", STABBR: "AL", ZIP: "35762",
      INSTURL: "www.aamu.edu/", NPCURL: "www.aamu.edu/admissions-aid/tuition-fees/net-price-calculator.html",
      CONTROL: "1", PREDDEG: "3", HIGHDEG: "4", CURROPER: "1", UGDS: "6124", ADM_RATE: "0.5795", C150_4: "0.2403",
      C150_L4: "NA", C150_4_POOLED_SUPP: "0.2629", C150_L4_POOLED_SUPP: "NA", MD_EARN_WNE_P10: "40628", NPT4_PUB: "17621", NPT4_PRIV: "NA", NPT4_PROG: "NA", NPT4_OTHER: "NA",
      NPT41_PUB: "16500", NPT42_PUB: "16387", NPT43_PUB: "19622", NPT44_PUB: "21680", NPT45_PUB: "20364",
      NPT41_PRIV: "NA", COSTT4_A: "27153", COSTT4_P: "NA", TUITIONFEE_IN: "10024", TUITIONFEE_OUT: "18634",
      PCTPELL: "0.6298", GRAD_DEBT_MDN: "31000", HBCU: "1", HSI: "0", TRIBAL: "0", DISTANCEONLY: "0",
    });
    expect(college).toEqual({
      unitId: 100654, name: "Alabama A & M University", city: "Normal", state: "AL", zip: "35762",
      url: "https://www.aamu.edu/",
      netPriceCalculatorUrl: "https://www.aamu.edu/admissions-aid/tuition-fees/net-price-calculator.html",
      control: 1, predominantDegree: 3, highestDegree: 4, enrollment: 6124, admissionRate: 0.5795,
      completionRate: 0.2629, medianEarnings10yr: 40628, avgNetPrice: 17621,
      netPriceByIncome: {
        "0-30000": 16500, "30001-48000": 16387, "48001-75000": 19622, "75001-110000": 21680, "110001-plus": 20364,
      },
      costOfAttendance: 27153, tuitionInState: 10024, tuitionOutOfState: 18634, pellShare: 0.6298, medianDebt: 31000,
      hbcu: true, hispanicServing: false, tribal: false, onlineOnly: false,
    });
  });

  it("reads private net price columns for private nonprofit and for-profit schools", () => {
    // Berea College (private nonprofit) and University of Phoenix-Arizona (for-profit).
    const berea = parseCollege({
      UNITID: "156295", INSTNM: "Berea College", PREDDEG: "3", CURROPER: "1", CONTROL: "2", ZIP: "40404-2182",
      NPT4_PUB: "NA", NPT4_PRIV: "6106", NPT41_PUB: "NA", NPT41_PRIV: "5428", NPT42_PRIV: "4598", NPT43_PRIV: "8132",
      NPT44_PRIV: "7570", NPT45_PRIV: "13700", COSTT4_A: "60718", COSTT4_P: "NA",
    });
    expect(berea).toMatchObject({
      control: 2, zip: "40404", avgNetPrice: 6106, costOfAttendance: 60718,
      netPriceByIncome: { "0-30000": 5428, "30001-48000": 4598, "48001-75000": 8132, "75001-110000": 7570, "110001-plus": 13700 },
    });
    const phoenix = parseCollege({
      UNITID: "484613", INSTNM: "University of Phoenix-Arizona", PREDDEG: "3", CURROPER: "1", CONTROL: "3",
      NPT4_PRIV: "13520", NPT41_PRIV: "12776", NPT45_PRIV: "19150", GRAD_DEBT_MDN: "31553",
    });
    expect(phoenix).toMatchObject({
      control: 3, avgNetPrice: 13520, netPriceByIncome: { "0-30000": 12776, "110001-plus": 19150 }, medianDebt: 31553,
    });
  });

  it("gives program-year trade schools a net price and their program-year cost", () => {
    // Tennessee College of Applied Technology-Murfreesboro: public, program-year calendar.
    const tcat = parseCollege({
      UNITID: "221102", INSTNM: "Tennessee College of Applied Technology-Murfreesboro", STABBR: "TN", ZIP: "37129-3311",
      CONTROL: "1", PREDDEG: "1", HIGHDEG: "1", CURROPER: "1", UGDS: "709", C150_4: "NA", C150_L4: "0.7615",
      C150_4_POOLED_SUPP: "NA", C150_L4_POOLED_SUPP: "0.7525",
      NPT4_PUB: "6631", NPT4_PRIV: "NA", NPT41_PUB: "1020", NPT42_PUB: "2270", NPT43_PUB: "8579", NPT44_PUB: "NA",
      NPT45_PUB: "NA", COSTT4_A: "NA", COSTT4_P: "12415", TUITIONFEE_IN: "NA", TUITIONFEE_OUT: "NA", GRAD_DEBT_MDN: "PS",
    });
    expect(tcat).toMatchObject({
      zip: "37129", predominantDegree: 1, completionRate: 0.7525, avgNetPrice: 6631,
      netPriceByIncome: { "0-30000": 1020, "30001-48000": 2270, "48001-75000": 8579 },
      costOfAttendance: 12415, tuitionInState: null, tuitionOutOfState: null, medianDebt: null,
    });
  });

  it("uses the pooled graduation rate, which College Scorecard leaves out for fewer than 30 students", () => {
    // ABCO Technology: the single-year rate is 100% from a starting class of 2 students.
    const abco = parseCollege({
      UNITID: "485500", INSTNM: "ABCO Technology", CITY: "Los Angeles", PREDDEG: "1", CONTROL: "3", CURROPER: "1",
      C150_4: "NA", C150_L4: "1", C150_4_POOLED_SUPP: "NA", C150_L4_POOLED_SUPP: "PS", D150_L4: "2", D150_L4_POOLED: "15",
    });
    expect(abco?.completionRate).toBeNull();
    // Austin Community College District reports under the four-year columns.
    const acc = parseCollege({
      UNITID: "222992", INSTNM: "Austin Community College District", PREDDEG: "2", CONTROL: "1", CURROPER: "1",
      C150_4: "0.202", C150_L4: "NA", C150_4_POOLED_SUPP: "0.1913", C150_L4_POOLED_SUPP: "NA",
    });
    expect(acc?.completionRate).toBe(0.1913);
  });

  it("falls back to program-year and other-calendar net price columns (older releases)", () => {
    const base = { UNITID: "3", INSTNM: "Trade School", PREDDEG: "1", CURROPER: "1", CONTROL: "3", NPT4_PUB: "NA", NPT4_PRIV: "NA" };
    expect(parseCollege({ ...base, NPT4_PROG: "15000", NPT4_OTHER: "16000", NPT41_PROG: "NULL", NPT41_OTHER: "14000" }))
      .toMatchObject({ avgNetPrice: 15000, netPriceByIncome: { "0-30000": 14000 } });
    expect(parseCollege({ ...base, NPT4_PROG: "NA", NPT4_OTHER: "16000" })).toMatchObject({ avgNetPrice: 16000, netPriceByIncome: null });
  });

  it("uses the other sector's columns when a school changed control after reporting", () => {
    // The University of Arizona Global Campus is public now but reported net price as a private school.
    const uagc = parseCollege({
      UNITID: "154022", INSTNM: "The University of Arizona Global Campus", PREDDEG: "3", CURROPER: "1", CONTROL: "1",
      NPT4_PUB: "NA", NPT4_PRIV: "31266", NPT41_PUB: "NA", NPT41_PRIV: "31009",
    });
    expect(uagc).toMatchObject({ avgNetPrice: 31266, netPriceByIncome: { "0-30000": 31009 } });
    // The school's own sector always wins when both are filled.
    expect(parseCollege({ UNITID: "4", INSTNM: "Public U", PREDDEG: "3", CURROPER: "1", CONTROL: "1", NPT4_PUB: "9000", NPT4_PRIV: "20000" }))
      .toMatchObject({ avgNetPrice: 9000 });
  });

  it("treats PS, NA, NULL, blanks and non-numbers as missing, and keeps negative net prices as published", () => {
    const college = parseCollege({
      UNITID: "180212", INSTNM: "Fort Peck Community College", PREDDEG: "2", CURROPER: "1", CONTROL: "1", TRIBAL: "1",
      ZIP: "59255-0398", NPT4_PUB: "400", NPT41_PUB: "-144", NPT42_PUB: "PS", NPT43_PUB: "PrivacySuppressed",
      NPT44_PUB: "NULL", NPT45_PUB: "", UGDS: "n/a", MD_EARN_WNE_P10: "0x10", GRAD_DEBT_MDN: "PS", PCTPELL: " ",
      HBCU: "NA", HSI: "NA", DISTANCEONLY: "",
    });
    expect(college).toMatchObject({
      avgNetPrice: 400, netPriceByIncome: { "0-30000": -144 }, enrollment: null, medianEarnings10yr: null,
      medianDebt: null, pellShare: null, tribal: true, hbcu: false, hispanicServing: false, onlineOnly: false,
    });
    expect(college?.netPriceByIncome).toEqual({ "0-30000": -144 });
  });

  it("keeps 5-digit ZIPs and drops malformed ones", () => {
    const zipOf = (ZIP: string | undefined) => parseCollege({ UNITID: "5", INSTNM: "Z", PREDDEG: "3", CURROPER: "1", ZIP })?.zip;
    expect(zipOf("02139-4301")).toBe("02139");
    expect(zipOf("49946-0000")).toBe("49946");
    expect(zipOf("021394301")).toBe("02139");
    expect(zipOf("2139")).toBeNull();
    expect(zipOf("NA")).toBeNull();
    expect(zipOf(undefined)).toBeNull();
  });

  it("normalizes college and net price calculator URLs to full web addresses", () => {
    const urls = (INSTURL: string | undefined, NPCURL: string | undefined) => {
      const c = parseCollege({ UNITID: "6", INSTNM: "U", PREDDEG: "3", CURROPER: "1", INSTURL, NPCURL });
      return [c?.url, c?.netPriceCalculatorUrl];
    };
    expect(urls("www.alasu.edu/", "tcc.ruffalonl.com/Alabama State University/Freshman-Students")).toEqual([
      "https://www.alasu.edu/",
      "https://tcc.ruffalonl.com/Alabama%20State%20University/Freshman-Students",
    ]);
    expect(urls("https://www.berea.edu/", "https://berea.studentaidcalculator.com/survey.aspx")).toEqual([
      "https://www.berea.edu/",
      "https://berea.studentaidcalculator.com/survey.aspx",
    ]);
    expect(urls("HTTP://Example.EDU/Aid", " http://example.edu/npc ")).toEqual(["http://example.edu/Aid", "http://example.edu/npc"]);
    expect(urls("NA", "")).toEqual([null, null]);
    expect(urls("not a url", "javascript:alert(1)")).toEqual([null, null]);
  });

  it("skips closed schools and schools that aren't degree or certificate granting", () => {
    expect(parseCollege({ UNITID: "1", INSTNM: "Closed U", PREDDEG: "3", CURROPER: "0" })).toBeNull();
    expect(parseCollege({ UNITID: "1", INSTNM: "Unclassified", PREDDEG: "0", CURROPER: "1" })).toBeNull();
    expect(parseCollege({ UNITID: "NA", INSTNM: "No id", PREDDEG: "3", CURROPER: "1" })).toBeNull();
  });

  describe("field of study", () => {
    const tcatHvac = {
      UNITID: "221102", OPEID6: "021035", INSTNM: "Tennessee College of Applied Technology-Murfreesboro", CONTROL: "Public",
      MAIN: "1", CIPCODE: "4702",
      CIPDESC: "Heating, Air Conditioning, Ventilation and Refrigeration Maintenance Technology/Technician (HAC, HACR, HVAC, HVACR).",
      CREDLEV: "1", CREDDESC: "Undergraduate Certificate or Diploma", DEBT_ALL_STGP_EVAL_MDN: "PS", EARN_MDN_4YR: "47422",
    };
    const phoenixNursing = {
      UNITID: "484613", INSTNM: "University of Phoenix-Arizona", CIPCODE: "5138",
      CIPDESC: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.",
      DEBT_ALL_STGP_EVAL_MDN: "15273", EARN_MDN_4YR: "109844",
    };

    it("parses undergraduate programs", () => {
      expect(parseCollegeProgram(tcatHvac)).toEqual({
        unitId: 221102, cip4: "47.02",
        title: "Heating, Air Conditioning, Ventilation and Refrigeration Maintenance Technology/Technician (HAC, HACR, HVAC, HVACR)",
        credentialLevel: 1, medianDebt: null, medianEarnings4yr: 47422,
      });
      expect(parseCollegeProgram({ ...phoenixNursing, CREDLEV: "3", CREDDESC: "Bachelor's Degree" })).toEqual({
        unitId: 484613, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing",
        credentialLevel: 3, medianDebt: 15273, medianEarnings4yr: 109844,
      });
      expect(parseCollegeProgram({ UNITID: "180647", CIPCODE: "0305", CIPDESC: "Forestry.", CREDLEV: "2", DEBT_ALL_STGP_EVAL_MDN: "NA", EARN_MDN_4YR: "PS" }))
        .toEqual({ unitId: 180647, cip4: "03.05", title: "Forestry", credentialLevel: 2, medianDebt: null, medianEarnings4yr: null });
    });

    it("skips graduate credentials, unknown levels and rows without a numeric UNITID", () => {
      for (const CREDLEV of ["4", "5", "6", "7", "8", "99", "", "NA"]) expect(parseCollegeProgram({ ...phoenixNursing, CREDLEV })).toBeNull();
      expect(parseCollegeProgram({ ...tcatHvac, UNITID: "NA", INSTNM: "Marlboro College" })).toBeNull();
      expect(parseCollegeProgram({ ...tcatHvac, UNITID: "" })).toBeNull();
      expect(parseCollegeProgram({ ...tcatHvac, UNITID: "22110x" })).toBeNull();
    });

    it("normalizes CIP codes and skips rows without one", () => {
      expect(parseCollegeProgram({ ...tcatHvac, CIPCODE: "301" })?.cip4).toBe("03.01");
      expect(parseCollegeProgram({ ...tcatHvac, CIPCODE: "47.02" })?.cip4).toBe("47.02");
      expect(parseCollegeProgram({ ...tcatHvac, CIPCODE: "NA" })).toBeNull();
      expect(parseCollegeProgram({ ...tcatHvac, CIPCODE: "470201" })).toBeNull();
      expect(parseCollegeProgram({ ...tcatHvac, CIPDESC: " . " })).toBeNull();
    });

    it("collects programs for loaded colleges only, first row wins for duplicates", async () => {
      async function* rows() {
        yield tcatHvac;
        yield { ...tcatHvac, EARN_MDN_4YR: "1" }; // duplicate (unitId, cip4, level)
        yield { ...tcatHvac, CREDLEV: "2" }; // same program, different credential
        yield { ...phoenixNursing, CREDLEV: "3" }; // college not loaded
        yield { ...tcatHvac, UNITID: "NA" };
        yield { ...tcatHvac, CREDLEV: "5" };
      }
      const programs = await collectCollegePrograms(rows(), new Set([221102]));
      expect(programs.map((p) => [p.unitId, p.cip4, p.credentialLevel, p.medianEarnings4yr])).toEqual([
        [221102, "47.02", 1, 47422],
        [221102, "47.02", 2, 47422],
      ]);
      expect(await collectCollegePrograms([tcatHvac], new Set())).toEqual([]);
    });

    it("produces rows the colleges and college_programs tables accept and return unchanged", async () => {
      const db = await createTestDb();
      const college = parseCollege({
        UNITID: "221102", INSTNM: "Tennessee College of Applied Technology-Murfreesboro", CONTROL: "1", PREDDEG: "1",
        CURROPER: "1", ZIP: "37129-3311", C150_L4_POOLED_SUPP: "0.7525", PCTPELL: "0.4919", NPT4_PUB: "6631", NPT41_PUB: "1020", COSTT4_P: "12415",
      })!;
      const programs = await collectCollegePrograms([tcatHvac, { ...tcatHvac, CIPCODE: "5139", CIPDESC: "Practical Nursing." }], new Set([college.unitId]));
      await db.insert(schema.colleges).values([college]);
      await db.insert(schema.collegePrograms).values(programs);

      const [stored] = await db.select().from(schema.colleges);
      expect(stored).toMatchObject({ ...college, completionRate: expect.closeTo(0.7525, 4), pellShare: expect.closeTo(0.4919, 4) });
      expect(await db.select().from(schema.collegePrograms)).toEqual(expect.arrayContaining(programs));

      // Reloading deletes programs before colleges, as scripts/load-reference.ts does.
      await db.delete(schema.collegePrograms);
      await db.delete(schema.colleges);
      expect(await db.select().from(schema.colleges)).toEqual([]);
    });
  });

  it("maps O*NET codes to SOC codes", () => {
    expect(socFromOnetCode("15-1252.00")).toBe("15-1252");
  });
});
