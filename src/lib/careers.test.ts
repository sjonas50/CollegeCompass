import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { cipSocLinks, majors, occupations } from "@/db/schema";
import { CAREER_MAJOR_LIMIT, getCareer, isGraduateProgram } from "./careers";
import { insertColleges, insertPrograms } from "./colleges/test-fixtures";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function insertCareer(code: string, links: [string, string][]) {
  await db.insert(occupations).values({ code, title: "A Career", description: "What the work is.", jobZone: 5 });
  await db.insert(majors).values(links.map(([cipCode, title]) => ({ cipCode, title })));
  await db.insert(cipSocLinks).values(links.map(([cipCode]) => ({ cipCode, socCode: code.slice(0, 7) })));
}

/** College N offers every family offered by at least N colleges. */
async function offer(counts: Record<string, number>) {
  const most = Math.max(...Object.values(counts));
  await insertColleges(db, Array.from({ length: most }, (_, i) => ({ unitId: 100 + i, name: `College ${i}` })));
  await insertPrograms(
    db,
    Object.entries(counts).flatMap(([cip4, n]) => Array.from({ length: n }, (_, i) => ({ unitId: 100 + i, cip4 }))),
  );
}

describe("getCareer majors", () => {
  it("leaves out residencies and the crosswalk's NO MATCH, and ranks majors colleges offer first", async () => {
    // Real CIP 2020 titles linked to Physician Assistants (29-1071) and General Internal Medicine
    // Physicians (29-1216) in the NCES crosswalk.
    await insertCareer("29-1071.00", [
      ["60.0901", "Physician Assistant Residency/Fellowship Program, General"],
      ["61.0101", "Combined Medicine Residency/Fellowship Programs"],
      ["99.9999", "NO MATCH"],
      ["51.0912", "Physician Assistant"],
      ["26.0102", "Biomedical Sciences, General"],
      ["26.0101", "Biology/Biological Sciences, General"],
      ["51.1201", "Medicine"],
      ["30.4301", "Geobiology"],
    ]);
    await offer({ "26.01": 3, "51.09": 5, "51.12": 1 });

    const career = await getCareer(db, "29-1071.00");
    expect(career?.majors.map((m) => m.cipCode)).toEqual(["26.0101", "26.0102", "51.0912", "51.1201", "30.4301"]);
    expect(career?.majorPaths).toEqual({
      "26.0101": { kind: "colleges", cip4: "26.01", colleges: 3 },
      "26.0102": { kind: "colleges", cip4: "26.01", colleges: 3 },
      "51.0912": { kind: "graduate" },
      "51.1201": { kind: "graduate" },
      "30.4301": { kind: "none" },
    });
  });

  it("puts the most widely offered majors first and keeps at most 15", async () => {
    const links: [string, string][] = Array.from({ length: 20 }, (_, i) => [`52.${String(i + 10)}01`, `Major ${String.fromCharCode(65 + i)}`]);
    await insertCareer("11-1021.00", links);
    // 52.29 ("Major T", last by title) is offered at the most colleges.
    await offer({ "52.29": 4, "52.10": 2 });
    const career = await getCareer(db, "11-1021.00");
    expect(career?.majors).toHaveLength(CAREER_MAJOR_LIMIT);
    expect(career?.majors.slice(0, 3).map((m) => m.title)).toEqual(["Major T", "Major A", "Major B"]);
  });

  it("puts a family's general major before its specialties", async () => {
    // Registered Nurses (29-1141) links 16 majors in family 51.38; by title, the general one came 16th.
    const specialties = [
      "Adult Health Nurse/Nursing", "Clinical Nurse Leader", "Clinical Nurse Specialist", "Critical Care Nursing",
      "Emergency Room/Trauma Nursing", "Family Practice Nurse/Nursing", "Forensic Nursing", "Geriatric Nurse/Nursing",
      "Maternal/Child Health and Neonatal Nurse/Nursing", "Nursing Administration", "Nursing Practice", "Nursing Science",
      "Occupational and Environmental Health Nursing", "Palliative Care Nursing", "Pediatric Nurse/Nursing",
    ];
    await insertCareer("29-1141.00", [
      ...specialties.map((title, i): [string, string] => [`51.38${String(i + 2).padStart(2, "0")}`, title]),
      ["51.3801", "Registered Nursing/Registered Nurse"],
    ]);
    await offer({ "51.38": 2 });
    const career = await getCareer(db, "29-1141.00");
    expect(career?.majors[0]).toEqual({ cipCode: "51.3801", title: "Registered Nursing/Registered Nurse" });
  });

  it("knows graduate and professional programs", () => {
    for (const cip of ["51.1201", "51.1202", "22.0101", "01.8001", "51.0401", "51.0912", "51.2001", "51.2308"]) {
      expect(isGraduateProgram(cip), cip).toBe(true);
    }
    for (const cip of ["51.3801", "51.0801", "22.0302", "26.0101", "51.2003"]) expect(isGraduateProgram(cip), cip).toBe(false);
  });
});
