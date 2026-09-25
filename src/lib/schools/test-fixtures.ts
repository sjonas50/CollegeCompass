import type { Db } from "@/db";
import { schools } from "@/db/schema";
import type { SchoolRecord } from "../reference/schools";
import { displaySchoolName, schoolSearchText } from "./names";

// Made-up schools shaped like the NCES rows (ids and names are real where noted), for tests.

type SchoolInput = Partial<SchoolRecord> & { schoolRef: string; name: string; state: string; rawName?: string };

export function school({ rawName, ...s }: SchoolInput): SchoolRecord {
  const raw = rawName ?? s.name;
  const name = displaySchoolName(s.name);
  const low = s.gradeLow ?? 9;
  const high = s.gradeHigh ?? 12;
  return {
    source: s.schoolRef.startsWith("pss:") ? "pss" : "ccd",
    release: "test",
    city: null,
    leaId: null,
    leaName: null,
    gradeLow: low,
    gradeHigh: high,
    grades: Array.from({ length: high - low + 1 }, (_, i) => low + i),
    schoolType: s.schoolRef.startsWith("pss:") ? "private" : "regular",
    charter: false,
    virtual: false,
    sharedTime: false,
    website: null,
    ...s,
    name,
    searchText: schoolSearchText({ rawName: raw, name, city: s.city, district: s.leaName }),
  };
}

/** Real NCES ids and names: Plano Senior High (TX, 11-12), Herriman High (UT, 10-12), Alcoa High (TN). */
export const SCHOOLS = {
  planoSenior: school({ schoolRef: "nces:483510003969", name: "PLANO SR H S", state: "TX", city: "Plano", leaName: "Plano ISD", gradeLow: 11 }),
  planoEast: school({ schoolRef: "nces:483510003970", name: "PLANO EAST SR H S", state: "TX", city: "Plano", leaName: "Plano ISD", gradeLow: 11 }),
  planoMiddle: school({ schoolRef: "nces:483510009999", name: "Plano Middle School", state: "TX", city: "Plano", leaName: "Plano ISD", gradeLow: 6, gradeHigh: 8 }),
  austinHigh: school({ schoolRef: "nces:480894000001", name: "AUSTIN H S", state: "TX", city: "Austin", leaName: "Austin ISD" }),
  texasPrivate: school({ schoolRef: "pss:A9999999", name: "ST. MARY'S ACADEMY", state: "TX", city: "Austin", gradeLow: 0 }),
  texasCte: school({ schoolRef: "nces:480000000003", name: "PLANO CAREER CENTER", state: "TX", city: "Plano", schoolType: "cte_center" }),
  texasSharedTime: school({ schoolRef: "nces:480000000004", name: "PLANO SHARED CAMPUS", state: "TX", city: "Plano", sharedTime: true }),
  herriman: school({ schoolRef: "nces:490042001338", name: "Herriman High", state: "UT", city: "Herriman", leaName: "Jordan District", gradeLow: 10 }),
  utahJunior: school({ schoolRef: "nces:490042009999", name: "Copper Mountain Middle", state: "UT", city: "Herriman", leaName: "Jordan District", gradeLow: 7, gradeHigh: 9 }),
  alcoa: school({ schoolRef: "nces:470006000235", name: "Alcoa High School", state: "TN", city: "Alcoa", leaName: "Alcoa" }),
} satisfies Record<string, SchoolRecord>;

export async function insertSchools(db: Db, rows: SchoolRecord[] = Object.values(SCHOOLS)) {
  await db.insert(schools).values(rows);
}
