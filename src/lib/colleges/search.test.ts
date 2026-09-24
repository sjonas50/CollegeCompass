import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import {
  CollegeSearchFiltersSchema,
  PAGE_SIZE,
  collegeSearchHref,
  findPrograms,
  majorsForCip6,
  parseCollegeSearchParams,
  MAJOR_CHOICE_LIMIT,
  programTitle,
  resolveMajorQuery,
  searchColleges,
} from "./search";
import { insertColleges, insertPrograms } from "./test-fixtures";

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
      { unitId: 2, name: "Hill Country College", state: "TX", control: 1, enrollment: 4_999, predominantDegree: 2 },
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
  beforeEach(async () => {
    await insertColleges(db, [
      { unitId: 1, name: "A" },
      { unitId: 2, name: "B" },
    ]);
    await insertPrograms(db, [
      { unitId: 1, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing." },
      { unitId: 2, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.", credentialLevel: 2 },
      { unitId: 1, cip4: "51.39", title: "Practical Nursing, Vocational Nursing and Nursing Assistants.", credentialLevel: 1 },
      { unitId: 1, cip4: "11.07", title: "Computer Science." },
    ]);
  });

  it("finds majors by the words in their title, one per CIP family", async () => {
    expect(await findPrograms(db, "nursing")).toEqual([
      { cip4: "51.39", title: "Practical Nursing, Vocational Nursing and Nursing Assistants" },
      { cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing" },
    ]);
    expect(await findPrograms(db, "science COMPUTER")).toEqual([{ cip4: "11.07", title: "Computer Science" }]);
    expect(await findPrograms(db, "x")).toEqual([]);
    expect(await findPrograms(db, "   ")).toEqual([]);
    expect(await findPrograms(db, "astronomy")).toEqual([]);
  });

  it("resolves typed words to one major, a short list, or nothing", async () => {
    expect(await resolveMajorQuery(db, "computer")).toEqual({ kind: "match", major: { cip4: "11.07", title: "Computer Science" } });
    expect(await resolveMajorQuery(db, "nursing")).toEqual({
      kind: "choices",
      choices: [
        { cip4: "51.39", title: "Practical Nursing, Vocational Nursing and Nursing Assistants" },
        { cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing" },
      ],
      more: false,
    });
    expect(await resolveMajorQuery(db, "astronomy")).toEqual({ kind: "none" });
    expect(await resolveMajorQuery(db, "")).toEqual({ kind: "none" });
  });

  it("prefers an exact title, then titles that start with the words typed, and caps the list", async () => {
    await insertColleges(db, [{ unitId: 3, name: "C" }]);
    await insertPrograms(db, [
      { unitId: 3, cip4: "11.01", title: "Computer and Information Sciences, General." },
      { unitId: 3, cip4: "52.12", title: "Management Information Systems and Services." },
      { unitId: 3, cip4: "51.16", title: "Nursing Science." },
      ...Array.from({ length: 12 }, (_, i) => ({ unitId: 3, cip4: `30.${String(i + 10)}`, title: `Applied Science Topic ${String.fromCharCode(65 + i)}.` })),
    ]);
    // "computer science" also matches "Computer and Information Sciences", but one title is exact.
    expect(await resolveMajorQuery(db, "Computer   Science")).toEqual({ kind: "match", major: { cip4: "11.07", title: "Computer Science" } });

    const info = await resolveMajorQuery(db, "information");
    expect(info.kind === "choices" && info.choices.map((c) => c.cip4)).toEqual(["11.01", "52.12"]);
    const management = await resolveMajorQuery(db, "systems");
    expect(management).toMatchObject({ kind: "match", major: { cip4: "52.12" } });

    const science = await resolveMajorQuery(db, "science");
    expect(science.kind).toBe("choices");
    if (science.kind !== "choices") return;
    expect(science.more).toBe(true);
    expect(science.choices).toHaveLength(MAJOR_CHOICE_LIMIT);
    // Nothing starts with "science", so the list stays alphabetical.
    expect(science.choices[0].title).toBe("Applied Science Topic A");

    const nursing = await resolveMajorQuery(db, "nursing");
    expect(nursing.kind === "choices" && nursing.choices.map((c) => c.cip4)).toEqual(["51.16", "51.39", "51.38"]);
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
