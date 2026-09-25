import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { registerStudent } from "../accounts";
import { addNorthStar } from "../goals";
import { cipRoutingRules } from "./content";
import { fixtureCipRouting } from "./fixtures";
import { northStarFamilyTargets } from "./north-stars";
import { familiesForMajors, familyTargetsForCareers } from "./routing";

const rules = fixtureCipRouting().rules;
const majors = (...codes: string[]) => codes.map((cipCode) => ({ cipCode }));

describe("familiesForMajors", () => {
  it("counts each family by how many majors route there, ties in first-seen order", () => {
    expect(familiesForMajors(majors("14.0801", "11.0701", "11.0104", "14.0901", "15.0303"), rules)).toEqual([
      { familyId: "engineering", cip6: ["14.0801", "14.0901"] },
      { familyId: "computer_data_science", cip6: ["11.0701", "11.0104"] },
      { familyId: "engineering_tech", cip6: ["15.0303"] },
    ]);
  });

  it("skips majors no rule matches and counts a repeated major once", () => {
    expect(familiesForMajors(majors("24.0101", "51.3801", "51.3801"), rules)).toEqual([{ familyId: "nursing", cip6: ["51.3801"] }]);
    expect(familiesForMajors([], rules)).toEqual([]);
  });
});

describe("familyTargetsForCareers", () => {
  it("takes each career's strongest family in order, once, at most three", () => {
    const careers = [
      { title: "Registered Nurses", majors: majors("51.3801", "51.3818") },
      { title: "Software Developers", majors: majors("11.0701", "14.0901") },
      { title: "Nurse Practitioners", majors: majors("51.3805") },
      { title: "Historians", majors: majors("54.0101") },
      { title: "Civil Engineers", majors: majors("14.0801") },
      { title: "Welders", majors: majors("15.0303") },
    ];
    expect(familyTargetsForCareers(careers, rules)).toEqual([
      { familyId: "nursing", source: "north_star", cip6: "51.3801", because: "Registered Nurses" },
      { familyId: "computer_data_science", source: "north_star", cip6: "11.0701", because: "Software Developers" },
      { familyId: "engineering", source: "north_star", cip6: "14.0801", because: "Civil Engineers" },
    ]);
  });

  it("uses the reviewed routing rules (pre-nursing is nursing, EMS is public safety)", () => {
    const targets = familyTargetsForCareers(
      [
        { title: "Registered Nurses", majors: majors("51.1105") },
        { title: "Paramedics", majors: majors("51.0904") },
      ],
      cipRoutingRules(),
    );
    expect(targets.map((t) => t.familyId)).toEqual(["nursing", "public_safety"]);
  });
});

describe("northStarFamilyTargets", () => {
  it("routes the student's north stars through the crosswalk, skipping careers missing from reference data", async () => {
    const db = await createTestDb();
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2026-09-23T12:00:00Z"),
    );
    if (!res.ok) throw new Error(res.error);
    const userId = res.value.userId;
    await db.insert(schema.occupations).values([
      { code: "29-1141.00", title: "Registered Nurses", description: "Care for patients.", jobZone: 3 },
      { code: "17-2051.00", title: "Civil Engineers", description: "Design things.", jobZone: 4 },
    ]);
    await db.insert(schema.majors).values([
      { cipCode: "51.3801", title: "Registered Nursing" },
      { cipCode: "14.0801", title: "Civil Engineering, General" },
    ]);
    await db.insert(schema.cipSocLinks).values([
      { cipCode: "51.3801", socCode: "29-1141" },
      { cipCode: "14.0801", socCode: "17-2051" },
    ]);

    expect(await northStarFamilyTargets(db, userId)).toEqual([]);
    await addNorthStar(db, userId, "29-1141.00");
    await addNorthStar(db, userId, "17-2051.00");
    expect(await northStarFamilyTargets(db, userId)).toEqual([
      { familyId: "nursing", source: "north_star", cip6: "51.3801", because: "Registered Nurses" },
      { familyId: "engineering", source: "north_star", cip6: "14.0801", because: "Civil Engineers" },
    ]);
  });
});
