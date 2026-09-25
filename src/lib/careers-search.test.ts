import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { occupations } from "@/db/schema";
import { searchCareers } from "./careers";
import { CAREER_GROUPS, CAREER_PAGE_SIZE, CAREER_SYNONYMS, findCareers } from "./careers-search";

let db: Db;

// Real O*NET 30.x codes and titles, including ones the old substring search matched by mistake.
const CAREERS: [code: string, title: string][] = [
  ["27-2011.00", "Actors"],
  ["29-1011.00", "Chiropractors"],
  ["13-1074.00", "Farm Labor Contractors"],
  ["53-3032.00", "Heavy and Tractor-Trailer Truck Drivers"],
  ["53-2011.00", "Airline Pilots, Copilots, and Flight Engineers"],
  ["43-9081.00", "Proofreaders and Copy Markers"],
  ["33-3051.00", "Police and Sheriff's Patrol Officers"],
  ["33-3052.00", "Transit and Railroad Police"],
  ["43-5032.00", "Dispatchers, Except Police, Fire, and Ambulance"],
  ["29-1141.00", "Registered Nurses"],
  ["29-1171.00", "Nurse Practitioners"],
  ["29-2061.00", "Licensed Practical and Licensed Vocational Nurses"],
  ["45-2092.00", "Farmworkers and Laborers, Crop, Nursery, and Greenhouse"],
  ["29-1222.00", "Physicians, Pathologists"],
  ["29-1215.00", "Family Medicine Physicians"],
  ["29-1221.00", "Pediatricians, General"],
  ["29-1223.00", "Psychiatrists"],
  ["29-1243.00", "Pediatric Surgeons"],
  ["29-1242.00", "Orthopedic Surgeons, Except Pediatric"],
  ["29-1071.00", "Physician Assistants"],
  ["29-1291.00", "Acupuncturists"],
  ["29-1299.01", "Naturopathic Physicians"],
  ["29-1131.00", "Veterinarians"],
  ["29-2056.00", "Veterinary Technologists and Technicians"],
  ["15-1252.00", "Software Developers"],
  ["15-1251.00", "Computer Programmers"],
  ["15-1254.00", "Web Developers"],
  ["15-1232.00", "Computer User Support Specialists"],
  ["15-1212.00", "Information Security Analysts"],
  ["11-3021.00", "Computer and Information Systems Managers"],
  ["51-9161.00", "Computer Numerically Controlled Tool Operators"],
  ["23-1011.00", "Lawyers"],
  ["29-1021.00", "Dentists, General"],
  ["43-6014.00", "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive"],
  ["17-2051.00", "Civil Engineers"],
  ["25-1032.00", "Engineering Teachers, Postsecondary"],
  ["25-2031.00", "Secondary School Teachers, Except Special and Career/Technical Education"],
  ["25-2022.00", "Middle School Teachers, Except Special and Career/Technical Education"],
  ["25-2058.00", "Special Education Teachers, Secondary School"],
  ["25-1052.00", "Chemistry Teachers, Postsecondary"],
  ["27-1011.00", "Art Directors"],
  ["27-1012.00", "Craft Artists"],
  ["25-1121.00", "Art, Drama, and Music Teachers, Postsecondary"],
  ["17-1021.00", "Cartographers and Photogrammetrists"],
  ["29-1249.00", "Surgeons, All Other"],
];

/** Every O*NET 30.x title with "Teachers" in it, except the "All Other" ones. */
const TEACHERS: [code: string, title: string][] = [
  ["25-1041.00", "Agricultural Sciences Teachers, Postsecondary"],
  ["25-1061.00", "Anthropology and Archeology Teachers, Postsecondary"],
  ["25-1031.00", "Architecture Teachers, Postsecondary"],
  ["25-1062.00", "Area, Ethnic, and Cultural Studies Teachers, Postsecondary"],
  ["25-1121.00", "Art, Drama, and Music Teachers, Postsecondary"],
  ["25-1051.00", "Atmospheric, Earth, Marine, and Space Sciences Teachers, Postsecondary"],
  ["25-1042.00", "Biological Science Teachers, Postsecondary"],
  ["25-1011.00", "Business Teachers, Postsecondary"],
  ["25-2023.00", "Career/Technical Education Teachers, Middle School"],
  ["25-1194.00", "Career/Technical Education Teachers, Postsecondary"],
  ["25-2032.00", "Career/Technical Education Teachers, Secondary School"],
  ["25-1052.00", "Chemistry Teachers, Postsecondary"],
  ["25-1122.00", "Communications Teachers, Postsecondary"],
  ["25-1021.00", "Computer Science Teachers, Postsecondary"],
  ["25-1111.00", "Criminal Justice and Law Enforcement Teachers, Postsecondary"],
  ["25-1063.00", "Economics Teachers, Postsecondary"],
  ["25-1081.00", "Education Teachers, Postsecondary"],
  ["25-2021.00", "Elementary School Teachers, Except Special Education"],
  ["25-1032.00", "Engineering Teachers, Postsecondary"],
  ["25-1123.00", "English Language and Literature Teachers, Postsecondary"],
  ["25-1053.00", "Environmental Science Teachers, Postsecondary"],
  ["25-1192.00", "Family and Consumer Sciences Teachers, Postsecondary"],
  ["25-1124.00", "Foreign Language and Literature Teachers, Postsecondary"],
  ["25-1043.00", "Forestry and Conservation Science Teachers, Postsecondary"],
  ["25-1064.00", "Geography Teachers, Postsecondary"],
  ["25-1071.00", "Health Specialties Teachers, Postsecondary"],
  ["25-1125.00", "History Teachers, Postsecondary"],
  ["25-2012.00", "Kindergarten Teachers, Except Special Education"],
  ["25-1112.00", "Law Teachers, Postsecondary"],
  ["25-1082.00", "Library Science Teachers, Postsecondary"],
  ["25-1022.00", "Mathematical Science Teachers, Postsecondary"],
  ["25-2022.00", "Middle School Teachers, Except Special and Career/Technical Education"],
  ["25-1072.00", "Nursing Instructors and Teachers, Postsecondary"],
  ["25-1126.00", "Philosophy and Religion Teachers, Postsecondary"],
  ["25-1054.00", "Physics Teachers, Postsecondary"],
  ["25-1065.00", "Political Science Teachers, Postsecondary"],
  ["25-2011.00", "Preschool Teachers, Except Special Education"],
  ["25-1066.00", "Psychology Teachers, Postsecondary"],
  ["25-1193.00", "Recreation and Fitness Studies Teachers, Postsecondary"],
  ["25-2031.00", "Secondary School Teachers, Except Special and Career/Technical Education"],
  ["25-3021.00", "Self-Enrichment Teachers"],
  ["25-1113.00", "Social Work Teachers, Postsecondary"],
  ["25-1067.00", "Sociology Teachers, Postsecondary"],
  ["25-2056.00", "Special Education Teachers, Elementary School"],
  ["25-2055.00", "Special Education Teachers, Kindergarten"],
  ["25-2057.00", "Special Education Teachers, Middle School"],
  ["25-2051.00", "Special Education Teachers, Preschool"],
  ["25-2058.00", "Special Education Teachers, Secondary School"],
  ["25-3031.00", "Substitute Teachers, Short-Term"],
];

const insertCareers = (to: Db, careers: [code: string, title: string][]) =>
  to.insert(occupations).values(careers.map(([code, title]) => ({ code, title, description: "What the work is.", jobZone: 3 })));

beforeEach(async () => {
  db = await createTestDb();
  await insertCareers(db, CAREERS);
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
    expect(await titles("pediatric")).toEqual(["Pediatric Surgeons", "Pediatricians, General"]);
  });

  it("understands everyday words", async () => {
    // Physicians and surgeons by code (29-121x to 29-124x), whatever the title: not Physician
    // Assistants, Acupuncturists or Naturopathic Physicians.
    expect(await titles("doctor")).toEqual([
      "Family Medicine Physicians",
      "Orthopedic Surgeons, Except Pediatric",
      "Pediatric Surgeons",
      "Pediatricians, General",
      "Physicians, Pathologists",
      "Psychiatrists",
    ]);
    expect(await titles("doctors")).toEqual(await titles("doctor"));
    expect(await titles("family doctor")).toEqual(["Family Medicine Physicians"]);
    // Computer occupations (15-12xx) and their managers, not Computer Numerically Controlled Tool Operators.
    expect(await titles("IT")).toEqual([
      "Computer and Information Systems Managers",
      "Computer Programmers",
      "Computer User Support Specialists",
      "Information Security Analysts",
      "Software Developers",
      "Web Developers",
    ]);
    for (const words of ["software engineer", "software engineers"]) expect(await titles(words)).toEqual(["Software Developers"]);
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

  it("finds a synonym's two words only next to each other", async () => {
    // A made-up title with "school" and "secondary" apart.
    await insertCareers(db, [["99-0001.00", "School Psychologists, Secondary Prevention"]]);
    expect(await titles("high school")).toEqual(["Secondary School Teachers, Except Special and Career/Technical Education", "Special Education Teachers, Secondary School"]);
  });

  it("reads words that are also JavaScript object properties as ordinary words", async () => {
    // Before: "constructor" was read as a group of codes, so "home constructor" threw on Home Health Aides.
    await insertCareers(db, [
      ["31-1121.00", "Home Health Aides"],
      ["47-2061.00", "Construction Laborers"],
    ]);
    for (const query of ["home constructor", "constructor", "constructors", "home toString", "__proto__", "construction __proto__"]) {
      expect(await findCareers(db, query), query).toEqual({ total: 0, page: 1, pageSize: CAREER_PAGE_SIZE, results: [] });
    }
    // A made-up title with the word.
    await insertCareers(db, [["99-0002.00", "Home Constructors"]]);
    expect(await titles("home constructor")).toEqual(["Home Constructors"]);
    expect(await titles("constructors")).toEqual(["Home Constructors"]);
  });

  it("keeps the everyday-word lists small, lowercase and singular", () => {
    expect(Object.keys(CAREER_SYNONYMS).length + Object.keys(CAREER_GROUPS).length).toBeLessThanOrEqual(20);
    for (const [key, terms] of Object.entries(CAREER_SYNONYMS)) {
      expect(key, key).toMatch(/^[a-z]+( [a-z]+)?$/);
      expect(terms.length, key).toBeGreaterThan(0);
      for (const term of terms) expect(term, key).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
    for (const [key, codes] of Object.entries(CAREER_GROUPS)) {
      expect(key, key).toMatch(/^[a-z]+$/);
      expect(CAREER_SYNONYMS, key).not.toHaveProperty(key);
      for (const code of codes) expect(code, key).toMatch(/^\d{2}-\d{1,4}$/);
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
    expect(await titles("middle school teacher")).toEqual(["Middle School Teachers, Except Special and Career/Technical Education"]);
  });

  it("puts college teaching jobs after the others in a tier", async () => {
    expect(await titles("teacher")).toEqual([
      "Middle School Teachers, Except Special and Career/Technical Education",
      "Secondary School Teachers, Except Special and Career/Technical Education",
      "Special Education Teachers, Secondary School",
      "Art, Drama, and Music Teachers, Postsecondary",
      "Chemistry Teachers, Postsecondary",
      "Engineering Teachers, Postsecondary",
    ]);

    // With every real O*NET teacher title (30.x), school teachers are on the first page.
    const all = await createTestDb();
    await insertCareers(all, TEACHERS);
    const first = await findCareers(all, "teacher");
    expect(first.total).toBe(TEACHERS.length);
    const firstPage = first.results.map((r) => r.title);
    for (const title of [
      "Elementary School Teachers, Except Special Education",
      "Middle School Teachers, Except Special and Career/Technical Education",
      "Secondary School Teachers, Except Special and Career/Technical Education",
    ]) {
      expect(firstPage).toContain(title);
    }
    // The 14 school and other teachers, then the college ones.
    const school = TEACHERS.filter(([, title]) => !title.endsWith(", Postsecondary"));
    expect(school).toHaveLength(14);
    expect(firstPage.slice(0, school.length).sort()).toEqual(school.map(([, title]) => title).sort());
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
