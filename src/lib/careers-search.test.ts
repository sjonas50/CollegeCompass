import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { occupations } from "@/db/schema";
import { searchCareers } from "./careers";
import { CAREER_PAGE_SIZE, CAREER_SYNONYMS, findCareers } from "./careers-search";

let db: Db;

// Real O*NET 30.x titles, including ones the old substring search matched by mistake.
const TITLES = [
  "Actors",
  "Chiropractors",
  "Farm Labor Contractors",
  "Heavy and Tractor-Trailer Truck Drivers",
  "Airline Pilots, Copilots, and Flight Engineers",
  "Proofreaders and Copy Markers",
  "Police and Sheriff's Patrol Officers",
  "Transit and Railroad Police",
  "Dispatchers, Except Police, Fire, and Ambulance",
  "Registered Nurses",
  "Nurse Practitioners",
  "Licensed Practical and Licensed Vocational Nurses",
  "Farmworkers and Laborers, Crop, Nursery, and Greenhouse",
  "Physicians, Pathologists",
  "Family Medicine Physicians",
  "Pediatric Surgeons",
  "Orthopedic Surgeons, Except Pediatric",
  "Veterinarians",
  "Veterinary Technologists and Technicians",
  "Software Developers",
  "Computer Programmers",
  "Lawyers",
  "Dentists, General",
  "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive",
  "Civil Engineers",
  "Engineering Teachers, Postsecondary",
  "Secondary School Teachers, Except Special and Career/Technical Education",
  "Middle School Teachers, Except Special and Career/Technical Education",
  "Special Education Teachers, Secondary School",
  "Chemistry Teachers, Postsecondary",
  "Art Directors",
  "Craft Artists",
  "Art, Drama, and Music Teachers, Postsecondary",
  "Cartographers and Photogrammetrists",
  "Surgeons, All Other",
];

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(occupations).values(
    TITLES.map((title, i) => ({ code: `99-${String(1000 + i)}.00`, title, description: "What the work is.", jobZone: 3 })),
  );
});

const titles = async (query: string) => (await findCareers(db, query, { pageSize: 50 })).results.map((r) => r.title);

describe("findCareers matching", () => {
  it("matches whole words, not letters inside other words", async () => {
    // Before: Chiropractors, Farm Labor Contractors and Tractor-Trailer drivers for "actor".
    expect(await titles("actor")).toEqual(["Actors"]);
    // Before: Copilots and Copy Markers for "cop" (now a synonym for police).
    expect(await titles("cop")).toEqual(["Police and Sheriff's Patrol Officers", "Transit and Railroad Police"]);
    expect(await titles("art")).not.toContain("Cartographers and Photogrammetrists");
    expect(await titles("eng")).toEqual([]);
  });

  it("finds plural and singular forms", async () => {
    expect(await titles("lawyer")).toEqual(["Lawyers"]);
    expect(await titles("Lawyers")).toEqual(["Lawyers"]);
    expect(await titles("secretary")).toEqual(["Secretaries and Administrative Assistants, Except Legal, Medical, and Executive"]);
    expect(await titles("nurses")).toEqual(["Nurse Practitioners", "Licensed Practical and Licensed Vocational Nurses", "Registered Nurses"]);
    expect(await titles("sheriff")).toEqual(["Police and Sheriff's Patrol Officers"]);
  });

  it("matches the start of longer words for 4 or more letters, after whole-word matches", async () => {
    expect(await titles("engin")).toEqual(["Airline Pilots, Copilots, and Flight Engineers", "Civil Engineers", "Engineering Teachers, Postsecondary"]);
    // "Nursery" starts with "nurse", so it comes after every nurse.
    expect((await titles("nurse")).at(-1)).toBe("Farmworkers and Laborers, Crop, Nursery, and Greenhouse");
  });

  it("ignores words after 'Except', which name what the career isn't", async () => {
    expect(await titles("police")).not.toContain("Dispatchers, Except Police, Fire, and Ambulance");
    expect(await titles("pediatric")).toEqual(["Pediatric Surgeons"]);
  });

  it("understands everyday words", async () => {
    expect(await titles("doctor")).toEqual(["Physicians, Pathologists", "Family Medicine Physicians", "Orthopedic Surgeons, Except Pediatric", "Pediatric Surgeons"]);
    expect(await titles("doctors")).toEqual(await titles("doctor"));
    expect(await titles("vet")).toEqual(["Veterinarians", "Veterinary Technologists and Technicians"]);
    expect(await titles("vet tech")).toEqual(["Veterinary Technologists and Technicians"]);
    for (const word of ["coder", "coding", "programmer"]) expect(await titles(word)).toEqual(["Software Developers", "Computer Programmers"]);
    expect(await titles("attorney")).toEqual(["Lawyers"]);
    expect(await titles("high school teacher")).toEqual([
      "Secondary School Teachers, Except Special and Career/Technical Education",
      "Special Education Teachers, Secondary School",
    ]);
    expect(await titles("art")).toEqual(["Art Directors", "Art, Drama, and Music Teachers, Postsecondary", "Craft Artists"]);
    expect(await titles("engineering")).toContain("Civil Engineers");
  });

  it("keeps the everyday-word list small, lowercase and singular", () => {
    expect(Object.keys(CAREER_SYNONYMS).length).toBeLessThanOrEqual(20);
    for (const [key, terms] of Object.entries(CAREER_SYNONYMS)) {
      expect(key, key).toMatch(/^[a-z]+( [a-z]+)?$/);
      expect(terms.length, key).toBeGreaterThan(0);
      for (const term of terms) expect(term, key).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
  });

  it("skips filler words and leaves out the catch-all 'All Other' titles", async () => {
    expect(await titles("I want to be a nurse")).toEqual(await titles("nurse"));
    expect(await titles("careers in art")).toEqual(await titles("art"));
    expect(await titles("surgeon")).not.toContain("Surgeons, All Other");
    for (const query of ["", "  ", "%", "a", "career"]) expect(await findCareers(db, query)).toEqual({ total: 0, page: 1, pageSize: CAREER_PAGE_SIZE, results: [] });
  });
});

describe("findCareers ranking", () => {
  it("puts exact titles first, then titles starting with the words, then titles with them in the middle", async () => {
    expect(await titles("nurse")).toEqual([
      "Nurse Practitioners",
      "Licensed Practical and Licensed Vocational Nurses",
      "Registered Nurses",
      "Farmworkers and Laborers, Crop, Nursery, and Greenhouse",
    ]);
    // "Dentists, General" is Dentists with a qualifier.
    expect(await titles("dentist")).toEqual(["Dentists, General"]);
    // "Art, Drama, and Music Teachers" is a list, not the career "Art".
    expect((await titles("teacher"))[0]).toBe("Art, Drama, and Music Teachers, Postsecondary");
    expect(await titles("middle school teacher")).toEqual(["Middle School Teachers, Except Special and Career/Technical Education"]);
  });

  it("lists the best matches when asked for a few (the counselor's search tool)", async () => {
    expect((await searchCareers(db, "nurse", 2)).map((c) => c.title)).toEqual(["Nurse Practitioners", "Licensed Practical and Licensed Vocational Nurses"]);
  });
});

describe("findCareers pages", () => {
  beforeEach(async () => {
    await db.insert(occupations).values(
      Array.from({ length: 30 }, (_, i) => ({
        code: `98-${String(1000 + i)}.00`,
        title: `Subject ${String(i + 1).padStart(2, "0")} Teachers, Postsecondary`,
        description: "What the work is.",
        jobZone: 5,
      })),
    );
  });

  it("counts every match and pages through all of them", async () => {
    // 30 here and 6 teacher titles above: the old search stopped at 30, A to Z.
    const first = await findCareers(db, "teacher");
    expect(first).toMatchObject({ total: 36, page: 1, pageSize: CAREER_PAGE_SIZE });
    expect(first.results).toHaveLength(CAREER_PAGE_SIZE);
    const second = await findCareers(db, "teacher", { page: 2 });
    expect(second.results).toHaveLength(36 - CAREER_PAGE_SIZE);
    const all = [...first.results, ...second.results].map((r) => r.title);
    expect(new Set(all).size).toBe(36);
    expect(all).toContain("Middle School Teachers, Except Special and Career/Technical Education");
  });

  it("clamps pages past the end to the last page, and bad pages to the first", async () => {
    expect((await findCareers(db, "teacher", { page: 9 })).page).toBe(2);
    expect((await findCareers(db, "teacher", { page: 0 })).page).toBe(1);
    expect((await findCareers(db, "teacher", { page: Number.NaN })).page).toBe(1);
  });
});
