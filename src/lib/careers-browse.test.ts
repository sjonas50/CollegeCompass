import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { RIASEC, type Riasec } from "./assessments/instruments";
import { AREA_BROWSE_NAMES, browseHref, parseBrowseArea, parseBrowseLevel } from "./career-areas";
import { browseCareers, careerCountsByArea } from "./careers-browse";
import { withLeadInterests } from "./reference/parsers";

let db: Db;

/** Careers with interest scores; leading areas marked as `npm run data:load` marks them. */
async function load(careers: [code: string, title: string, jobZone: number | null, scores: Partial<Record<Riasec, number>>][]) {
  await db.insert(schema.occupations).values(careers.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
  const rows = careers.flatMap(([code, , , scores]) =>
    Object.keys(scores).length ? RIASEC.map((interest) => ({ occupationCode: code, interest, score: scores[interest] ?? 1 })) : [],
  );
  await db.insert(schema.occupationInterests).values(withLeadInterests(rows));
}

beforeEach(async () => {
  db = await createTestDb();
  await load([
    ["47-2031.00", "Carpenters", 2, { R: 7, C: 3 }],
    ["49-3023.00", "Automotive Service Technicians and Mechanics", 3, { R: 7, I: 4 }],
    ["17-2141.00", "Mechanical Engineers", 4, { R: 6, I: 6.5 }],
    ["29-1131.00", "Veterinarians", 5, { R: 5.98, I: 5.98 }],
    ["35-3011.00", "Bartenders", 2, { E: 5, S: 4.5, R: 4 }],
    ["39-3011.00", "Gambling Dealers", 2, { E: 5, S: 4, C: 4.5 }],
    ["25-1123.00", "English Language and Literature Teachers, Postsecondary", 5, { S: 6, A: 5 }],
    ["25-1011.00", "Business Teachers, Postsecondary", 5, { S: 6, E: 5 }],
    ["21-1012.00", "Educational, Guidance, and Career Advisors", 5, { S: 7 }],
    ["39-9011.00", "Childcare Workers", 2, { S: 7, A: 3 }],
    ["47-4099.00", "Construction and Related Workers, All Other", 2, { R: 7 }],
    ["47-5099.00", "Extraction Workers, All Other", null, {}],
  ]);
});

const titles = (result: { results: { title: string }[] }) => result.results.map((r) => r.title);

describe("browsing careers by interest area", () => {
  it("lists the careers that lead with an area, A to Z, ties in each area, catch-alls left out", async () => {
    const hands = await browseCareers(db, "R");
    expect(titles(hands)).toEqual(["Automotive Service Technicians and Mechanics", "Carpenters", "Veterinarians"]);
    expect(hands).toMatchObject({ area: "R", level: null, all: 3, total: 3, page: 1, collegeTeachingLast: false });
    // Veterinarians are as Investigative as Realistic, so they're in both.
    expect(titles(await browseCareers(db, "I"))).toEqual(["Mechanical Engineers", "Veterinarians"]);
    expect(titles(await browseCareers(db, "A"))).toEqual([]);
  });

  it("lists careers never shown as matches: browsing finds every career", async () => {
    expect(titles(await browseCareers(db, "E"))).toEqual(["Bartenders", "Gambling Dealers"]);
  });

  it("puts college teaching jobs after the others", async () => {
    const helping = await browseCareers(db, "S");
    expect(titles(helping)).toEqual([
      "Childcare Workers",
      "Educational, Guidance, and Career Advisors",
      "Business Teachers, Postsecondary",
      "English Language and Literature Teachers, Postsecondary",
    ]);
    expect(helping.collegeTeachingLast).toBe(true);
  });

  it("counts careers at each level and shows one level", async () => {
    const helping = await browseCareers(db, "S", { level: 5 });
    expect(helping.levels).toEqual([
      { level: 2, count: 1 },
      { level: 5, count: 3 },
    ]);
    expect(helping).toMatchObject({ level: 5, all: 4, total: 3 });
    expect(titles(helping)[0]).toBe("Educational, Guidance, and Career Advisors");

    const none = await browseCareers(db, "S", { level: 3 });
    expect(none).toMatchObject({ level: 3, all: 4, total: 0, results: [], collegeTeachingLast: false });
  });

  it("pages through the list, and a page past the end shows the last one", async () => {
    const first = await browseCareers(db, "S", { pageSize: 3 });
    expect(first).toMatchObject({ page: 1, total: 4, pageSize: 3 });
    expect(titles(first)).toHaveLength(3);
    const last = await browseCareers(db, "S", { page: 9, pageSize: 3 });
    expect(last.page).toBe(2);
    expect(titles(last)).toEqual(["English Language and Literature Teachers, Postsecondary"]);
    expect((await browseCareers(db, "S", { page: Number.NaN, pageSize: 3 })).page).toBe(1);
  });

  it("counts the careers in every area", async () => {
    expect(await careerCountsByArea(db)).toEqual({ R: 3, I: 2, A: 0, S: 4, E: 2, C: 0 });
  });
});

describe("browse links", () => {
  it("read the area and level from the address, ignoring anything else", () => {
    expect(parseBrowseArea("R")).toBe("R");
    expect(parseBrowseArea(" s ")).toBe("S");
    expect(parseBrowseArea("X")).toBeNull();
    expect(parseBrowseArea("RI")).toBeNull();
    expect(parseBrowseArea(["R"])).toBeNull();
    expect(parseBrowseArea(undefined)).toBeNull();
    expect(parseBrowseLevel("4")).toBe(4);
    expect(parseBrowseLevel("0")).toBeNull();
    expect(parseBrowseLevel("6")).toBeNull();
    expect(parseBrowseLevel("2.5")).toBeNull();
    expect(parseBrowseLevel("constructor")).toBeNull();
    expect(parseBrowseLevel(undefined)).toBeNull();
  });

  it("keep the level and page, and land below the search box", () => {
    expect(browseHref("R")).toBe("/careers?area=R#results");
    expect(browseHref("S", { level: 5, page: 2, to: "list" })).toBe("/careers?area=S&level=5&page=2#list");
    expect(browseHref("S", { level: null, page: 1, to: "levels" })).toBe("/careers?area=S#levels");
  });

  it("name every area plainly", () => {
    expect(AREA_BROWSE_NAMES.R).toBe("Building and fixing things");
    for (const area of RIASEC) expect(AREA_BROWSE_NAMES[area].length).toBeLessThanOrEqual(30);
  });
});
