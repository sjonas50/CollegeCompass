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

// Software Developers (15-1252) as getCareer returns it from the reference data (NCES CIP-SOC
// crosswalk, College Scorecard field-of-study release of 2026-06-10): its 15 related majors and how
// many listed colleges offer each one's 4-digit family.
const SOFTWARE_DEVELOPERS = {
  title: "Software Developers",
  majors: majors(
    "11.0102", "11.0103", "11.0104", "11.0701", "11.0804", "11.0201", "11.0202", "11.0203",
    "11.0204", "11.0205", "11.0902", "11.0401", "14.0901", "14.0903", "15.1204",
  ),
  majorPaths: Object.fromEntries(
    (
      [
        ["11.0102", 1599], ["11.0103", 1599], ["11.0104", 1599], ["11.0701", 1032], ["11.0804", 727],
        ["11.0201", 641], ["11.0202", 641], ["11.0203", 641], ["11.0204", 641], ["11.0205", 641],
        ["11.0902", 641], ["11.0401", 422], ["14.0901", 408], ["14.0903", 408], ["15.1204", 287],
      ] as const
    ).map(([cip, colleges]) => [cip, { kind: "colleges", cip4: cip.slice(0, 5), colleges }]),
  ),
};

describe("routing by how widely a career's majors are offered (Software Developers → computer science, design §5.13)", () => {
  it("counts majors by the colleges that offer them, so 8 narrow IT majors don't outweigh computer science", () => {
    const [top] = familyTargetsForCareers([SOFTWARE_DEVELOPERS], cipRoutingRules());
    expect(top).toMatchObject({ familyId: "computer_data_science", because: "Software Developers" });
    // By count alone the IT family has more majors (8 to 5).
    expect(familiesForMajors(SOFTWARE_DEVELOPERS.majors, cipRoutingRules()).map((f) => [f.familyId, f.cip6.length])).toEqual([
      ["it_cybersecurity", 8],
      ["computer_data_science", 5],
      ["engineering", 2],
    ]);
  });

  it("keeps a career whose widely offered majors are IT in IT (Information Security Analysts)", () => {
    const career = {
      title: "Information Security Analysts",
      majors: majors("51.0723", "11.0103", "11.1001", "11.1002", "11.1003", "11.1005", "11.0701", "11.0901", "43.0403"),
      majorPaths: Object.fromEntries(
        (
          [
            ["51.0723", 1839], ["11.0103", 1599], ["11.1001", 1163], ["11.1002", 1163], ["11.1003", 1163],
            ["11.1005", 1163], ["11.0701", 1032], ["11.0901", 641], ["43.0403", 436],
          ] as const
        ).map(([cip, colleges]) => [cip, { kind: "colleges", cip4: cip.slice(0, 5), colleges }]),
      ),
    };
    expect(familyTargetsForCareers([career], cipRoutingRules())[0]?.familyId).toBe("it_cybersecurity");
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
