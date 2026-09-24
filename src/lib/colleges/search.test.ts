import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import {
  CollegeSearchFiltersSchema,
  MAJOR_CHOICE_LIMIT,
  type MajorQueryResult,
  PAGE_SIZE,
  collegeSearchHref,
  findPrograms,
  majorsForCip6,
  offeredFamilies,
  parseCollegeSearchParams,
  programTitle,
  resolveMajorQuery,
  searchColleges,
} from "./search";
import { insertColleges, insertMajorSearchData, insertPrograms } from "./test-fixtures";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const names = async (filters: Parameters<typeof searchColleges>[1]) =>
  (await searchColleges(db, filters)).results.map((r) => r.name);

describe("searchColleges filters", () => {
  beforeEach(async () => {
    await insertColleges(db, [
      { unitId: 1, name: "Lakeside State University", state: "TX", control: 1, enrollment: 22_000, predominantDegree: 3 },
      { unitId: 2, name: "Hill Country College", city: "Austin", state: "TX", control: 1, enrollment: 4_999, predominantDegree: 2 },
      { unitId: 3, name: "Riverbend University", state: "CA", control: 2, enrollment: 5_000, predominantDegree: 3, hbcu: true },
      { unitId: 4, name: "Canyon Technical Institute", state: "AZ", control: 3, enrollment: 15_000, predominantDegree: 1 },
      { unitId: 5, name: "Mesa Community College", state: "AZ", control: 1, enrollment: 15_001, predominantDegree: 2, hispanicServing: true },
      { unitId: 6, name: "Prairie Tribal College", state: "ND", control: 1, enrollment: null, predominantDegree: 2, tribal: true },
      { unitId: 7, name: "Anywhere Online University", state: "UT", control: 2, enrollment: 40_000, onlineOnly: true },
      { unitId: 8, name: "Summit School of Medicine", state: "TX", control: 2, enrollment: null, predominantDegree: 4 },
      { unitId: 9, name: "100% Real_College", state: "NY", control: 2, enrollment: 1_200 },
    ]);
    await insertPrograms(db, [
      { unitId: 1, cip4: "11.07", title: "Computer Science.", credentialLevel: 3 },
      { unitId: 2, cip4: "11.07", title: "Computer Science.", credentialLevel: 2 },
      { unitId: 2, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.", credentialLevel: 2 },
      { unitId: 3, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.", credentialLevel: 3 },
      { unitId: 4, cip4: "51.39", title: "Practical Nursing, Vocational Nursing and Nursing Assistants.", credentialLevel: 1 },
      { unitId: 7, cip4: "11.07", title: "Computer Science.", credentialLevel: 3 },
    ]);
  });

  it("with no filters lists every college by name, leaving out online-only and graduate-only schools", async () => {
    const res = await searchColleges(db);
    expect(res.total).toBe(7);
    expect(res.results.map((r) => r.unitId)).toEqual([9, 4, 2, 1, 5, 6, 3]);
  });

  it("matches the name case-insensitively, by every word typed, with wildcards escaped", async () => {
    expect(await names({ q: "UNIVERSITY" })).toEqual(["Lakeside State University", "Riverbend University"]);
    expect(await names({ q: "  state   lakeside " })).toEqual(["Lakeside State University"]);
    expect(await names({ q: "100%" })).toEqual(["100% Real_College"]);
    expect(await names({ q: "l_ke" })).toEqual([]);
    expect(await names({ q: "%" })).toEqual(["100% Real_College"]);
  });

  it("matches each word in the name box against the college's name or its city", async () => {
    expect(await names({ q: "Austin" })).toEqual(["Hill Country College"]);
    expect(await names({ q: "country austin" })).toEqual(["Hill Country College"]);
    expect(await names({ q: "lakeside austin" })).toEqual([]);
  });

  it("filters by state, accepting lowercase and rejecting unknown codes", async () => {
    expect(await names({ state: "TX" })).toEqual(["Hill Country College", "Lakeside State University"]);
    expect(await names({ state: "az" })).toEqual(["Canyon Technical Institute", "Mesa Community College"]);
    expect(await names({ state: "ZZ" })).toEqual([]);
  });

  it("filters by major, including online-only colleges only when asked", async () => {
    expect(await names({ major: "11.07" })).toEqual(["Hill Country College", "Lakeside State University"]);
    expect(await names({ major: "11.07", includeOnlineOnly: true })).toEqual([
      "Anywhere Online University",
      "Hill Country College",
      "Lakeside State University",
    ]);
    expect(await names({ major: "99.99" })).toEqual([]);
    expect(await names({ major: "not-a-cip" })).toEqual([]);
  });

  it("with a major, filters by the credential level offered in that major", async () => {
    expect(await names({ major: "11.07", credential: 2 })).toEqual(["Hill Country College"]);
    expect(await names({ major: "11.07", credential: 3 })).toEqual(["Lakeside State University"]);
    expect(await names({ major: "51.38", credential: 3 })).toEqual(["Riverbend University"]);
    expect(await names({ major: "11.07", credential: 1 })).toEqual([]);
  });

  it("without a major, filters credential by the degree most students earn", async () => {
    expect(await names({ credential: 1 })).toEqual(["Canyon Technical Institute"]);
    expect(await names({ credential: 2 })).toEqual(["Hill Country College", "Mesa Community College", "Prairie Tribal College"]);
    expect(await names({ credential: 3 })).toEqual(["100% Real_College", "Lakeside State University", "Riverbend University"]);
  });

  it("filters by public, private nonprofit and for-profit", async () => {
    expect(await names({ control: 1 })).toEqual([
      "Hill Country College",
      "Lakeside State University",
      "Mesa Community College",
      "Prairie Tribal College",
    ]);
    expect(await names({ control: 2 })).toEqual(["100% Real_College", "Riverbend University"]);
    expect(await names({ control: 3 })).toEqual(["Canyon Technical Institute"]);
  });

  it("filters by size at the 5,000 and 15,000 boundaries, leaving out unknown enrollment", async () => {
    expect(await names({ size: "small" })).toEqual(["100% Real_College", "Hill Country College"]);
    expect(await names({ size: "medium" })).toEqual(["Canyon Technical Institute", "Riverbend University"]);
    expect(await names({ size: "large" })).toEqual(["Lakeside State University", "Mesa Community College"]);
  });

  it("filters by mission, showing colleges with any checked mission", async () => {
    expect(await names({ hbcu: true })).toEqual(["Riverbend University"]);
    expect(await names({ hispanicServing: true })).toEqual(["Mesa Community College"]);
    expect(await names({ tribal: true })).toEqual(["Prairie Tribal College"]);
    expect(await names({ hbcu: true, tribal: true })).toEqual(["Prairie Tribal College", "Riverbend University"]);
    expect(await names({ hbcu: false })).toHaveLength(7);
  });

  it("combines filters", async () => {
    expect(await names({ state: "TX", control: 1, size: "large", major: "11.07", credential: 3 })).toEqual(["Lakeside State University"]);
    expect(await names({ state: "CA", q: "lakeside" })).toEqual([]);
  });

  it("returns compact, JSON-safe rows", async () => {
    const [row] = (await searchColleges(db, { q: "riverbend" })).results;
    expect(row).toEqual({
      unitId: 3,
      name: "Riverbend University",
      city: "Springfield",
      state: "CA",
      control: 2,
      enrollment: 5_000,
      size: "medium",
      predominantDegree: 3,
      avgNetPrice: 15_000,
      netPriceByIncome: { "0-30000": 9_000, "30001-48000": 11_000, "48001-75000": 14_000, "75001-110000": 18_000, "110001-plus": 21_000 },
      costOfAttendance: 28_000,
      completionRate: expect.closeTo(0.6, 5),
      medianEarnings10yr: 50_000,
      missions: ["hbcu"],
      onlineOnly: false,
    });
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });
});

describe("searchColleges sorting", () => {
  beforeEach(async () => {
    await insertColleges(db, [
      { unitId: 1, name: "Alpha College", avgNetPrice: 20_000, completionRate: 0.5, medianEarnings10yr: 40_000 },
      { unitId: 2, name: "beta college", avgNetPrice: null, completionRate: null, medianEarnings10yr: null },
      { unitId: 3, name: "Gamma College", avgNetPrice: -500, completionRate: 0.9, medianEarnings10yr: 70_000 },
      { unitId: 4, name: "Delta College", avgNetPrice: 12_000, completionRate: 0.7, medianEarnings10yr: 70_000 },
    ]);
  });

  it("sorts by name, ignoring case", async () => {
    expect(await names({})).toEqual(["Alpha College", "beta college", "Delta College", "Gamma College"]);
    expect(await names({ sort: "name" })).toEqual(["Alpha College", "beta college", "Delta College", "Gamma College"]);
  });

  it("sorts by lowest average net price with missing prices last", async () => {
    expect(await names({ sort: "net_price" })).toEqual(["Gamma College", "Delta College", "Alpha College", "beta college"]);
  });

  it("sorts by highest graduation rate with missing rates last", async () => {
    expect(await names({ sort: "completion" })).toEqual(["Gamma College", "Delta College", "Alpha College", "beta college"]);
  });

  it("sorts by highest earnings with missing earnings last and ties by name", async () => {
    expect(await names({ sort: "earnings" })).toEqual(["Delta College", "Gamma College", "Alpha College", "beta college"]);
  });
});

describe("searchColleges pagination", () => {
  beforeEach(async () => {
    await insertColleges(
      db,
      Array.from({ length: 45 }, (_, i) => ({ unitId: 1000 + i, name: `College ${String(i + 1).padStart(2, "0")}` })),
    );
  });

  it("returns 20 per page with the total", async () => {
    const first = await searchColleges(db, {});
    expect(first).toMatchObject({ total: 45, page: 1, pageSize: PAGE_SIZE });
    expect(first.results).toHaveLength(20);
    expect(first.results[0].name).toBe("College 01");

    const second = await searchColleges(db, { page: 2 });
    expect(second.results.map((r) => r.name).slice(0, 2)).toEqual(["College 21", "College 22"]);

    const third = await searchColleges(db, { page: 3 });
    expect(third.page).toBe(3);
    expect(third.results.map((r) => r.name)).toEqual(["College 41", "College 42", "College 43", "College 44", "College 45"]);
  });

  it("clamps pages past the end to the last page, and bad pages to the first", async () => {
    expect((await searchColleges(db, { page: 99 })).page).toBe(3);
    expect((await searchColleges(db, { page: 0 })).page).toBe(1);
    expect((await searchColleges(db, { page: -4 })).page).toBe(1);
    expect((await searchColleges(db, { page: 2.7 })).page).toBe(2);
  });

  it("reports page 1 of nothing when nothing matches", async () => {
    expect(await searchColleges(db, { q: "zzz", page: 4 })).toEqual({ total: 0, page: 1, pageSize: PAGE_SIZE, results: [] });
  });
});

describe("majors", () => {
  // How many colleges offer each family, scaled down from the real June 2026 data (e.g. 51.38
  // Registered Nursing at 2,178 colleges, 51.16 "Nursing" at 8).
  const OFFERED_BY = {
    "51.38": 22, "51.39": 13, "51.16": 1, "51.11": 5, "01.06": 3, "48.05": 10, "15.06": 6, "47.06": 10, "14.42": 1,
    "46.03": 7, "51.06": 8, "50.04": 13, "50.05": 11, "11.10": 12, "11.01": 16, "11.07": 10, "43.01": 19, "22.03": 7,
    "22.00": 3, "22.01": 1, "51.12": 1, "51.09": 17, "51.22": 7, "51.07": 18, "16.09": 10, "13.12": 18, "14.19": 4,
    "42.01": 17, "40.05": 9,
  };
  const cip4s = (r: MajorQueryResult) => (r.kind === "choices" ? r.choices.map((c) => c.cip4) : r.kind === "match" ? [r.major.cip4] : []);

  beforeEach(async () => {
    await insertMajorSearchData(db, OFFERED_BY);
  });

  it("never sends a graduate profession to an undergraduate family that merely lists it", async () => {
    // 51.0912 Physician Assistant is a master's program; family 51.09 is EMT, radiology and the like.
    const pa = await resolveMajorQuery(db, "physician assistant");
    expect(cip4s(pa)).toEqual(["51.11"]);
    expect(pa).toMatchObject({ kind: "match", major: { includes: "Pre-Physician Assistant" } });
  });

  it("treats short words as whole words", async () => {
    // "ai" is a synonym; a plain short word like "art" must not match "Artificial Intelligence".
    expect(cip4s(await resolveMajorQuery(db, "art"))).not.toContain("11.01");
  });

  it("finds trades by their everyday names through the 6-digit majors colleges file them under", async () => {
    expect(await resolveMajorQuery(db, "welding")).toEqual({
      kind: "choices",
      choices: [
        { cip4: "48.05", title: "Precision Metal Working", colleges: 10, includes: "Welding Technology/Welder" },
        { cip4: "15.06", title: "Industrial Production Technologies/Technicians", colleges: 6, includes: "Welding Engineering Technology/Technician" },
      ],
      more: false,
    });
    expect(await resolveMajorQuery(db, "Welders")).toEqual({
      kind: "match",
      major: { cip4: "48.05", title: "Precision Metal Working", colleges: 10, includes: "Welding Technology/Welder" },
    });
    expect(await resolveMajorQuery(db, "electrician")).toMatchObject({ kind: "match", major: { cip4: "46.03", includes: "Electrician" } });
    expect(await resolveMajorQuery(db, "dental hygiene")).toMatchObject({ kind: "match", major: { cip4: "51.06", includes: "Dental Hygiene/Hygienist" } });
    expect(await resolveMajorQuery(db, "graphic design")).toMatchObject({ kind: "match", major: { cip4: "50.04", includes: "Graphic Design" } });
    expect(await resolveMajorQuery(db, "video game design")).toMatchObject({ kind: "match", major: { cip4: "50.04" } });
    // get_career hands the counselor full 6-digit titles.
    expect(await resolveMajorQuery(db, "Welding Technology/Welder")).toMatchObject({ kind: "match", major: { cip4: "48.05" } });
  });

  it("asks between the nursing families most colleges offer instead of picking the little-used 'Nursing' family", async () => {
    const nursing = await resolveMajorQuery(db, "nursing");
    expect(nursing.kind).toBe("choices");
    expect(cip4s(nursing).slice(0, 2)).toEqual(["51.38", "51.39"]);
    expect(cip4s(nursing)).toContain("51.16");
    // "nurse" is a whole word: no "Plant Nursery Operations and Management".
    const nurse = await resolveMajorQuery(db, "nurse");
    expect(cip4s(nurse).slice(0, 2)).toEqual(["51.38", "51.39"]);
    expect(cip4s(nurse)).not.toContain("01.06");
    expect(await resolveMajorQuery(db, "RN")).toMatchObject({ kind: "match", major: { cip4: "51.38" } });
    expect(await resolveMajorQuery(db, "LPN")).toMatchObject({ kind: "match", major: { cip4: "51.39" } });
  });

  it("matches the start of words, so 'IT' isn't 'Literatures' and 'auto' isn't 'Automation'", async () => {
    expect(await resolveMajorQuery(db, "IT")).toMatchObject({ kind: "match", major: { cip4: "11.01", includes: "Information Technology" } });
    const auto = await resolveMajorQuery(db, "auto");
    expect(cip4s(auto)).toEqual(["47.06"]);
    expect(await resolveMajorQuery(db, "auto mechanic")).toMatchObject({
      kind: "match",
      major: { cip4: "47.06", includes: "Automobile/Automotive Mechanics Technology/Technician" },
    });
    expect(cip4s(await resolveMajorQuery(db, "weld"))).toEqual(["48.05", "15.06"]);
  });

  it("understands everyday words for majors", async () => {
    expect(await resolveMajorQuery(db, "theater")).toMatchObject({ kind: "match", major: { cip4: "50.05" } });
    expect(cip4s(await resolveMajorQuery(db, "cybersecurity"))).toEqual(["11.10"]);
    // "pre med" is "Pre-Medicine", not "Community Health and Preventive Medicine".
    for (const words of ["doctor", "pre-med", "premed"]) {
      expect(await resolveMajorQuery(db, words)).toMatchObject({ kind: "match", major: { cip4: "51.11", includes: "Pre-Medicine/Pre-Medical Studies" } });
    }
    expect(cip4s(await resolveMajorQuery(db, "medicine"))[0]).toBe("51.11");
    // "law" can mean paralegal work, pre-law, law school or police work ("Criminal
    // Justice/Law Enforcement Administration" only mentions law in passing, so it comes last).
    expect(cip4s(await resolveMajorQuery(db, "law"))).toEqual(["22.03", "22.00", "22.01", "43.01"]);
    expect(cip4s(await resolveMajorQuery(db, "lawyer"))).toEqual(["22.03", "22.00"]);
  });

  it("goes straight to an exact title only when no other match is offered at more colleges", async () => {
    expect(await resolveMajorQuery(db, "psychology")).toEqual({
      kind: "match",
      major: { cip4: "42.01", title: "Psychology, General", colleges: 17 },
    });
    // More colleges file computer science under 11.01 than under 11.07 "Computer Science".
    expect(await resolveMajorQuery(db, "Computer   Science")).toEqual({
      kind: "choices",
      choices: [
        { cip4: "11.01", title: "Computer and Information Sciences, General", colleges: 16 },
        { cip4: "11.07", title: "Computer Science", colleges: 10 },
      ],
      more: false,
    });
    expect(await resolveMajorQuery(db, "chemistry")).toMatchObject({ kind: "match", major: { cip4: "40.05" } });
  });

  it("lists families whose own title matches before ones that only mention the words in passing", async () => {
    // 13.12 (teacher education) has a "STEM Educational Methods" major and more colleges, but
    // "Mechanical Engineering" is about engineering.
    expect(await findPrograms(db, "engineering")).toEqual([
      { cip4: "14.19", title: "Mechanical Engineering", colleges: 4 },
      { cip4: "14.42", title: "Mechatronics, Robotics, and Automation Engineering", colleges: 1 },
      {
        cip4: "13.12",
        title: "Teacher Education and Professional Development, Specific Levels and Methods",
        colleges: 18,
        includes: "Science, Technology, Engineering, and Mathematics (STEM) Educational Methods",
      },
      { cip4: "15.06", title: "Industrial Production Technologies/Technicians", colleges: 6, includes: "Welding Engineering Technology/Technician" },
    ]);
  });

  it("counts only colleges the search lists, and leaves out residencies and families no listed college offers", async () => {
    await insertColleges(db, [
      { unitId: 1, name: "Anywhere Online University", onlineOnly: true },
      { unitId: 2, name: "Summit School of Medicine", predominantDegree: 4 },
    ]);
    await insertPrograms(db, [
      { unitId: 1, cip4: "48.05", title: "Precision Metal Working." },
      { unitId: 2, cip4: "51.12", title: "Medicine." },
      { unitId: 2, cip4: "60.07", title: "Nurse Practitioner Residency/Fellowship Programs." },
      { unitId: 1, cip4: "30.99", title: "Multi/Interdisciplinary Studies, Other." },
    ]);
    expect((await findPrograms(db, "welding"))[0]).toMatchObject({ cip4: "48.05", colleges: 10 });
    expect(await findPrograms(db, "multi interdisciplinary")).toEqual([]);
    expect(cip4s(await resolveMajorQuery(db, "nurse practitioner"))).not.toContain("60.07");
    expect(await offeredFamilies(db, ["48.05", "51.12", "30.99", "99.99", "junk"])).toEqual(
      new Map([
        ["48.05", { title: "Precision Metal Working", colleges: 10 }],
        ["51.12", { title: "Medicine", colleges: 1 }],
      ]),
    );
  });

  it("finds nothing for unknown words, filler words or too little text", async () => {
    for (const text of ["astronomy", "", " ", "x", "degree program", "zzz"]) {
      expect(await resolveMajorQuery(db, text)).toEqual({ kind: "none" });
    }
  });

  it("caps the list of choices", async () => {
    await insertColleges(db, [{ unitId: 3, name: "C" }]);
    await insertPrograms(
      db,
      Array.from({ length: 12 }, (_, i) => ({ unitId: 3, cip4: `30.${String(i + 10)}`, title: `Applied Science Topic ${String.fromCharCode(65 + i)}.` })),
    );
    const science = await resolveMajorQuery(db, "applied science");
    expect(science.kind).toBe("choices");
    if (science.kind !== "choices") return;
    expect(science.more).toBe(true);
    expect(science.choices).toHaveLength(MAJOR_CHOICE_LIMIT);
    expect(science.choices[0].title).toBe("Applied Science Topic A");
  });

  it("looks up a major's title", async () => {
    expect(await programTitle(db, "11.07")).toBe("Computer Science");
    expect(await programTitle(db, "40.02")).toBeNull();
    expect(await programTitle(db, "junk")).toBeNull();
  });

  it("turns a 6-digit major into the 4-digit family colleges report", () => {
    expect(majorsForCip6("11.0701")).toBe("11.07");
    expect(majorsForCip6("51.3801")).toBe("51.38");
    expect(majorsForCip6("11.07")).toBe("11.07");
    expect(majorsForCip6("1107")).toBeNull();
    expect(majorsForCip6("")).toBeNull();
  });
});

describe("search params", () => {
  it("parses valid params and drops invalid ones without errors", () => {
    expect(
      parseCollegeSearchParams({
        q: "  state ",
        state: "tx",
        major: "11.07",
        credential: "3",
        control: "2",
        size: "large",
        hbcu: "1",
        hsi: "on",
        tribal: "true",
        online: "1",
        sort: "net_price",
        page: "3",
        mq: "ignored when a major is chosen",
      }),
    ).toEqual({
      filters: {
        q: "state",
        state: "TX",
        major: "11.07",
        credential: 3,
        control: 2,
        size: "large",
        hbcu: true,
        hispanicServing: true,
        tribal: true,
        includeOnlineOnly: true,
        sort: "net_price",
        page: 3,
      },
      majorQuery: null,
    });

    expect(
      parseCollegeSearchParams({
        state: "Texas",
        major: "11.0701",
        credential: "4",
        control: "public",
        size: "huge",
        hbcu: "0",
        sort: "cheapest",
        page: "-2",
        mq: ["nursing", "welding"],
      }),
    ).toEqual({ filters: {}, majorQuery: "nursing" });
    expect(parseCollegeSearchParams({ page: "abc", sort: "name", q: "   " })).toEqual({ filters: {}, majorQuery: null });
  });

  it("never reads income from the URL", () => {
    const { filters } = parseCollegeSearchParams({ income: "0-30000", band: "0-30000" });
    expect(filters).toEqual({});
  });

  it("builds links that leave out defaults and round-trip", () => {
    expect(collegeSearchHref({})).toBe("/colleges");
    expect(collegeSearchHref({ sort: "name", page: 1 })).toBe("/colleges");
    const filters = {
      q: "state university",
      state: "TX",
      major: "11.07",
      credential: 3,
      control: 1,
      size: "medium",
      hbcu: true,
      hispanicServing: true,
      tribal: true,
      includeOnlineOnly: true,
      sort: "earnings",
      page: 2,
    } as const;
    const href = collegeSearchHref(filters);
    expect(href).toBe(
      "/colleges?q=state+university&state=TX&major=11.07&credential=3&control=1&size=medium&hbcu=1&hsi=1&tribal=1&online=1&sort=earnings&page=2",
    );
    const params = Object.fromEntries(new URL(href, "https://x.test").searchParams);
    expect(parseCollegeSearchParams(params).filters).toEqual(filters);
  });

  it("validates AI tool input with the filter schema", () => {
    expect(CollegeSearchFiltersSchema.safeParse({ major: "11.07", credential: 2, size: "small" }).success).toBe(true);
    expect(CollegeSearchFiltersSchema.safeParse({ credential: 4 }).success).toBe(false);
    expect(CollegeSearchFiltersSchema.safeParse({ major: "11.0701" }).success).toBe(false);
    expect(CollegeSearchFiltersSchema.safeParse({ sort: "cheap" }).success).toBe(false);
  });
});
