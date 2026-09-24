import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { getCollege, isUnitId, parseUnitId, safeUrl, scorecardUrl } from "./detail";
import { insertColleges, insertPrograms } from "./test-fixtures";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await insertColleges(db, [
    {
      unitId: 110635,
      name: "Lakeside State University",
      city: "Austin",
      state: "TX",
      url: "https://www.lakeside.edu/",
      netPriceCalculatorUrl: "lakeside.edu/npc",
      hbcu: true,
      tribal: true,
    },
    { unitId: 2, name: "Bare College", url: "javascript:alert(1)", netPriceCalculatorUrl: null, netPriceByIncome: {}, control: 9 },
  ]);
  await insertPrograms(db, [
    { unitId: 110635, cip4: "51.38", title: "Registered Nursing.", credentialLevel: 3, medianEarnings4yr: 72_000, medianDebt: 24_000 },
    { unitId: 110635, cip4: "11.07", title: "Computer Science.", credentialLevel: 3, medianEarnings4yr: null, medianDebt: null },
    { unitId: 110635, cip4: "51.38", title: "Registered Nursing.", credentialLevel: 2, medianEarnings4yr: 61_000, medianDebt: 12_000 },
    { unitId: 110635, cip4: "47.06", title: "Vehicle Maintenance and Repair Technologies.", credentialLevel: 1 },
    { unitId: 110635, cip4: "12.05", title: "Culinary Arts.", credentialLevel: 1 },
  ]);
});

describe("getCollege", () => {
  it("returns the college with its costs, outcomes and links", async () => {
    const college = await getCollege(db, 110635);
    expect(college).toMatchObject({
      unitId: 110635,
      name: "Lakeside State University",
      city: "Austin",
      state: "TX",
      url: "https://www.lakeside.edu/",
      netPriceCalculatorUrl: "https://lakeside.edu/npc",
      scorecardUrl: "https://collegescorecard.ed.gov/school/?110635",
      control: 1,
      predominantDegree: 3,
      highestDegree: 4,
      enrollment: 8_000,
      size: "medium",
      avgNetPrice: 15_000,
      costOfAttendance: 28_000,
      tuitionInState: 10_000,
      tuitionOutOfState: 25_000,
      medianEarnings10yr: 50_000,
      medianDebt: 19_000,
      missions: ["hbcu", "tribal"],
      onlineOnly: false,
    });
    expect(college?.netPriceByIncome?.["0-30000"]).toBe(9_000);
    expect(JSON.parse(JSON.stringify(college))).toEqual(college);
    // Nothing internal-only, like the raw mission flags or zip code.
    expect(Object.keys(college!)).not.toEqual(expect.arrayContaining(["zip"]));
    expect(college).not.toHaveProperty("hbcu");
  });

  it("groups programs by credential level, the college's main level first, sorted by title", async () => {
    const college = await getCollege(db, 110635);
    expect(college?.programs).toEqual([
      {
        credentialLevel: 3,
        label: "Bachelor's degrees",
        programs: [
          { cip4: "11.07", title: "Computer Science", medianEarnings4yr: null, medianDebt: null },
          { cip4: "51.38", title: "Registered Nursing", medianEarnings4yr: 72_000, medianDebt: 24_000 },
        ],
      },
      {
        credentialLevel: 2,
        label: "Associate degrees",
        programs: [{ cip4: "51.38", title: "Registered Nursing", medianEarnings4yr: 61_000, medianDebt: 12_000 }],
      },
      {
        credentialLevel: 1,
        label: "Certificates",
        programs: [
          { cip4: "12.05", title: "Culinary Arts", medianEarnings4yr: null, medianDebt: null },
          { cip4: "47.06", title: "Vehicle Maintenance and Repair Technologies", medianEarnings4yr: null, medianDebt: null },
        ],
      },
    ]);
  });

  it("leads with certificates at a college where most students earn one", async () => {
    await insertColleges(db, [{ unitId: 3, name: "Canyon Technical Institute", predominantDegree: 1 }]);
    await insertPrograms(db, [
      { unitId: 3, cip4: "51.38", title: "Registered Nursing.", credentialLevel: 2 },
      { unitId: 3, cip4: "48.05", title: "Precision Metal Working.", credentialLevel: 1 },
    ]);
    expect((await getCollege(db, 3))?.programs.map((g) => g.credentialLevel)).toEqual([1, 2]);
  });

  it("handles a college with no programs, bad links and missing data", async () => {
    const college = await getCollege(db, 2);
    expect(college).toMatchObject({
      name: "Bare College",
      url: null,
      netPriceCalculatorUrl: null,
      netPriceByIncome: null,
      control: null,
      programs: [],
      missions: [],
    });
  });

  it("returns null for unknown or impossible ids", async () => {
    expect(await getCollege(db, 999_999)).toBeNull();
    for (const id of [0, -5, 1.5, Number.NaN, 3_000_000_000]) expect(await getCollege(db, id)).toBeNull();
  });
});

describe("ids and links", () => {
  it("parses route ids", () => {
    expect(parseUnitId("110635")).toBe(110635);
    expect(parseUnitId("abc")).toBeNull();
    expect(parseUnitId("12abc")).toBeNull();
    expect(parseUnitId("0")).toBeNull();
    expect(parseUnitId("-3")).toBeNull();
    expect(parseUnitId("1e5")).toBeNull();
    expect(parseUnitId("99999999999")).toBeNull();
    expect(parseUnitId(undefined)).toBeNull();
    expect(isUnitId(2_147_483_647)).toBe(true);
    expect(isUnitId(2_147_483_648)).toBe(false);
  });

  it("keeps only web links and adds a missing https://", () => {
    expect(safeUrl("www.college.edu/npc")).toBe("https://www.college.edu/npc");
    expect(safeUrl("http://college.edu")).toBe("http://college.edu/");
    expect(safeUrl(" https://college.edu/a?b=1 ")).toBe("https://college.edu/a?b=1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("mailto:admissions@college.edu")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it("links to the college's College Scorecard page", () => {
    expect(scorecardUrl(110635)).toBe("https://collegescorecard.ed.gov/school/?110635");
  });
});
