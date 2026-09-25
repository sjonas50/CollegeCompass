import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { schoolsByRef, searchSchools } from "./search";
import { SCHOOLS, insertSchools, school } from "./test-fixtures";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await insertSchools(db);
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("searchSchools", () => {
  it("finds a school by the start of its words, spelled as filed or as shown", async () => {
    // Both Plano senior highs have "sr" in their names; the one that starts with what was typed comes first.
    expect(names(await searchSchools(db, { state: "TX", query: "plano sr" }))).toEqual(["Plano Senior High School", "Plano East Senior High School"]);
    expect(names(await searchSchools(db, { state: "TX", query: "Plano Senior High" }))).toEqual(["Plano Senior High School", "Plano East Senior High School"]);
    expect(names(await searchSchools(db, { state: "tx", query: "plano east" }))).toEqual(["Plano East Senior High School"]);
    expect(names(await searchSchools(db, { state: "TX", query: "st marys" }))).toEqual(["St. Mary's Academy"]);
  });

  it("finds schools by city or district, within the state only", async () => {
    // Austin: a public and a private school.
    expect(names(await searchSchools(db, { state: "TX", query: "austin" })).sort()).toEqual(["Austin High School", "St. Mary's Academy"]);
    expect(names(await searchSchools(db, { state: "UT", query: "jordan" })).sort()).toEqual(["Copper Mountain Middle", "Herriman High"]);
    expect(await searchSchools(db, { state: "UT", query: "plano" })).toEqual([]);
  });

  it("describes each school with public facts only", async () => {
    const [found] = await searchSchools(db, { state: "TX", query: "st marys" });
    expect(found).toEqual({
      ref: "pss:A9999999",
      name: "St. Mary's Academy",
      city: "Austin",
      state: "TX",
      gradeLow: 0,
      gradeHigh: 12,
      kind: "private",
      virtual: false,
      careerCenter: false,
      district: null,
    });
  });

  it("lists career and technical centers after home schools, and keeps shared-time schools", async () => {
    // The directory marks regular high schools shared-time too (Science Hill High in Tennessee),
    // and some career and technical high schools are full-time, so both stay findable.
    const found = await searchSchools(db, { state: "TX", query: "plano" });
    expect(names(found)).toContain("Plano Shared Campus");
    expect(names(found).at(-1)).toBe("Plano Career Center");
    expect(found.at(-1)?.careerCenter).toBe(true);
    expect(found).toHaveLength(5);
  });

  it("puts names that start with what was typed first, then schools through 12th grade", async () => {
    await insertSchools(db, [school({ schoolRef: "nces:480000000010", name: "West Plano Prep", state: "TX", city: "Dallas" })]);
    const found = names(await searchSchools(db, { state: "TX", query: "plano" }));
    expect(found).toEqual([
      "Plano East Senior High School",
      "Plano Senior High School",
      "Plano Shared Campus",
      "Plano Middle School",
      "Plano Career Center",
      "West Plano Prep",
    ]);
  });

  it("returns nothing for an unknown state or nothing searchable, and never breaks on search syntax", async () => {
    expect(await searchSchools(db, { state: "ZZ", query: "plano" })).toEqual([]);
    expect(await searchSchools(db, { state: "TX", query: "  &|!  " })).toEqual([]);
    expect(names(await searchSchools(db, { state: "TX", query: "plano & !sr | :*" }))).toEqual(["Plano Senior High School", "Plano East Senior High School"]);
    expect(await searchSchools(db, { state: "TX", query: "'); drop table schools; --" })).toEqual([]);
    expect(await schoolsByRef(db, [SCHOOLS.alcoa.schoolRef])).toHaveProperty("size", 1);
  });

  it("stops at the limit", async () => {
    await insertSchools(
      db,
      Array.from({ length: 30 }, (_, i) => school({ schoolRef: `nces:4899990000${String(i).padStart(2, "0")}`, name: `Lakeview School ${i}`, state: "TX" })),
    );
    expect(await searchSchools(db, { state: "TX", query: "lakeview" })).toHaveLength(20);
    expect(await searchSchools(db, { state: "TX", query: "lakeview", limit: 5 })).toHaveLength(5);
  });
});

describe("schoolsByRef", () => {
  it("returns the schools still in the directory", async () => {
    const found = await schoolsByRef(db, [SCHOOLS.herriman.schoolRef, "nces:000000000000", SCHOOLS.herriman.schoolRef]);
    expect([...found.keys()]).toEqual([SCHOOLS.herriman.schoolRef]);
    expect(found.get(SCHOOLS.herriman.schoolRef)).toMatchObject({ name: "Herriman High", kind: "public", gradeLow: 10 });
    expect(await schoolsByRef(db, [])).toEqual(new Map());
  });
});
