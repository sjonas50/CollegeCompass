import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { SCHOOL_RELEASES, parseCcdSchool, parsePssSchool } from "./schools";

// Rows copied from the real NCES files: CCD 2024-25 school directory (ccd_sch_029) with its
// characteristics file (ccd_sch_129), and the PSS 2023-24 public-use file.

const NO_GRADES = Object.fromEntries(["PK", "KG", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].map((g) => [`G_${g}_OFFERED`, "No"]));
const offered = (...grades: (number | "PK" | "KG")[]) => Object.fromEntries(grades.map((g) => [`G_${g}_OFFERED`, "Yes"]));

const plano = {
  NCESSCH: "483510003969",
  SCH_NAME: "PLANO SR H S",
  LEA_NAME: "PLANO ISD",
  LEAID: "4835100",
  ST: "TX",
  LSTATE: "TX",
  LCITY: "PLANO",
  WEBSITE: "http://www.pisd.edu",
  UPDATED_STATUS: "1",
  SCH_TYPE: "1",
  CHARTER_TEXT: "No",
  GSLO: "11",
  GSHI: "12",
  ...NO_GRADES,
  ...offered(11, 12),
};

const herriman = {
  NCESSCH: "490042001338",
  SCH_NAME: "Herriman High",
  LEA_NAME: "Jordan District",
  LEAID: "4900420",
  ST: "UT",
  LSTATE: "UT",
  LCITY: "HERRIMAN",
  WEBSITE: "http://www.herrimanhigh.org/",
  UPDATED_STATUS: "1",
  SCH_TYPE: "1",
  CHARTER_TEXT: "No",
  GSLO: "10",
  GSHI: "12",
  ...NO_GRADES,
  ...offered(10, 11, 12),
};

describe("parseCcdSchool", () => {
  it("keeps an open public school teaching grades 7-12, with a readable name and search words", () => {
    expect(parseCcdSchool(plano, { sharedTime: "Missing", virtual: "MISSING" })).toEqual({
      schoolRef: "nces:483510003969",
      source: "ccd",
      release: SCHOOL_RELEASES.ccd,
      name: "Plano Senior High School",
      city: "Plano",
      state: "TX",
      leaId: "4835100",
      leaName: "Plano ISD",
      gradeLow: 11,
      gradeHigh: 12,
      grades: [11, 12],
      schoolType: "regular",
      charter: false,
      virtual: false,
      sharedTime: false,
      website: "http://www.pisd.edu",
      searchText: "plano sr h s senior high school isd",
    });
    // Utah high schools often start at grade 10.
    expect(parseCcdSchool(herriman, { sharedTime: "No", virtual: "NOTVIRTUAL" })).toMatchObject({
      name: "Herriman High",
      city: "Herriman",
      leaName: "Jordan District",
      gradeLow: 10,
      gradeHigh: 12,
      grades: [10, 11, 12],
    });
  });

  it("marks charters, alternative schools, CTE centers, shared-time and online schools", () => {
    const porVida = {
      ...plano,
      NCESSCH: "480000407173",
      SCH_NAME: "POR VIDA ACADEMY CHARTER H S",
      LEA_NAME: "POR VIDA ACADEMY",
      LCITY: "SAN ANTONIO",
      SCH_TYPE: "4",
      CHARTER_TEXT: "Yes",
      GSLO: "09",
      ...offered(9, 10),
    };
    expect(parseCcdSchool(porVida)).toMatchObject({ name: "Por Vida Academy Charter High School", schoolType: "alternative", charter: true });
    const cte = { ...herriman, NCESSCH: "470009000003", SCH_NAME: "Anderson County Career Technical Center", ST: "TN", SCH_TYPE: "3", WEBSITE: "" };
    expect(parseCcdSchool(cte, { sharedTime: "No" })).toMatchObject({ schoolType: "cte_center", website: null, state: "TN" });
    expect(parseCcdSchool(herriman, { sharedTime: "Yes" })?.sharedTime).toBe(true);
    expect(parseCcdSchool({ ...herriman, SCH_NAME: "East Shore Online" }, { virtual: "FULLVIRTUAL" })?.virtual).toBe(true);
    expect(parseCcdSchool(herriman, { virtual: "SUPPVIRTUAL" })?.virtual).toBe(false);
  });

  it("files Bureau of Indian Education schools under the state they're in", () => {
    const flandreau = { ...herriman, NCESSCH: "590002700084", SCH_NAME: "Flandreau Indian Boarding School", ST: "BI", LSTATE: "SD", LCITY: "Flandreau" };
    expect(parseCcdSchool(flandreau)?.state).toBe("SD");
  });

  it("skips closed or future schools, schools without grades 7-12, and bad ids", () => {
    expect(parseCcdSchool({ ...plano, UPDATED_STATUS: "2" })).toBeNull();
    expect(parseCcdSchool({ ...plano, UPDATED_STATUS: "7" })).toBeNull();
    const aspermontEl = { ...plano, SCH_NAME: "ASPERMONT EL", GSLO: "PK", GSHI: "05", ...NO_GRADES, ...offered("PK", "KG", 1, 2, 3, 4, 5) };
    expect(parseCcdSchool(aspermontEl)).toBeNull();
    expect(parseCcdSchool({ ...plano, NCESSCH: "12345" })).toBeNull();
    expect(parseCcdSchool({ ...plano, ST: "ZZ", LSTATE: "" })).toBeNull();
  });

  it("reads pre-K and kindergarten grade codes, and falls back to the grade flags", () => {
    const k12 = { ...plano, GSLO: "PK", GSHI: "12", ...offered("PK", "KG", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) };
    expect(parseCcdSchool(k12)).toMatchObject({ gradeLow: -1, gradeHigh: 12 });
    expect(parseCcdSchool({ ...plano, GSLO: "M", GSHI: "N" })).toMatchObject({ gradeLow: 11, gradeHigh: 12 });
  });
});

// PSS: P145 pre-K, P155 kindergarten, P185-P295 grades 1-12 (1 yes, 2 no).
const pssGrades = (...grades: number[]) =>
  Object.fromEntries([["P145", -1], ["P155", 0], ...Array.from({ length: 12 }, (_, i) => [`P${185 + i * 10}`, i + 1])].map(([col, g]) => [col, grades.includes(g as number) ? "1" : "2"]));

const cristoRey = {
  PPIN: "A2370015",
  PINST: "HOLY FAMILY CRISTO REY CATHOLIC HIGH SCHOOL",
  PCITY: "BIRMINGHAM",
  PSTABB: "AL",
  PZIP: "35205",
  PL_CIT: "",
  PL_STABB: "",
  LOGR2024: "14",
  HIGR2024: "17",
  ...pssGrades(9, 10, 11, 12),
};

describe("parsePssSchool", () => {
  it("keeps a private school teaching grades 7-12", () => {
    expect(parsePssSchool(cristoRey)).toEqual({
      schoolRef: "pss:A2370015",
      source: "pss",
      release: SCHOOL_RELEASES.pss,
      name: "Holy Family Cristo Rey Catholic High School",
      city: "Birmingham",
      state: "AL",
      leaId: null,
      leaName: null,
      gradeLow: 9,
      gradeHigh: 12,
      grades: [9, 10, 11, 12],
      schoolType: "private",
      charter: false,
      virtual: false,
      sharedTime: false,
      website: null,
      searchText: "holy family cristo rey catholic high school birmingham",
    });
  });

  it("prefers the location address, and reads the grade recodes", () => {
    const redMountain = {
      ...cristoRey,
      PPIN: "A2370036",
      PINST: "RED MTN COMMUNITY SCHOOL",
      PL_CIT: "BIRMINGHAM",
      PL_STABB: "AL",
      PCITY: "HOMEWOOD",
      LOGR2024: "2",
      HIGR2024: "17",
      ...pssGrades(-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    };
    expect(parsePssSchool(redMountain)).toMatchObject({ city: "Birmingham", gradeLow: -1, gradeHigh: 12 });
    expect(parsePssSchool({ ...cristoRey, LOGR2024: "3", HIGR2024: "13", ...pssGrades(0, 1, 2, 3, 4, 5, 6, 7, 8) })).toMatchObject({ gradeLow: 0, gradeHigh: 8 });
  });

  it("skips schools that stop before 7th grade, and bad ids or states", () => {
    expect(parsePssSchool({ ...cristoRey, LOGR2024: "3", HIGR2024: "11", ...pssGrades(0, 1, 2, 3, 4, 5, 6) })).toBeNull();
    expect(parsePssSchool({ ...cristoRey, PPIN: "x" })).toBeNull();
    expect(parsePssSchool({ ...cristoRey, PSTABB: "" })).toBeNull();
  });
});

describe("the schools table", () => {
  it("takes the parsed rows as they are", async () => {
    const db = await createTestDb();
    const rows = [parseCcdSchool(plano)!, parseCcdSchool(herriman)!, parsePssSchool(cristoRey)!];
    await db.insert(schema.schools).values(rows);
    expect(await db.select().from(schema.schools)).toHaveLength(3);
  });
});
