import type { Db } from "@/db";
import { collegePrograms, colleges } from "@/db/schema";

/** Test helpers: insert College Scorecard rows with sensible defaults. */

type CollegeRow = typeof colleges.$inferInsert;
type ProgramRow = typeof collegePrograms.$inferInsert;

export function collegeRow(over: Partial<CollegeRow> & Pick<CollegeRow, "unitId" | "name">): CollegeRow {
  return {
    city: "Springfield",
    state: "IL",
    url: "www.example.edu",
    control: 1,
    predominantDegree: 3,
    highestDegree: 4,
    enrollment: 8_000,
    admissionRate: 0.7,
    completionRate: 0.6,
    medianEarnings10yr: 50_000,
    avgNetPrice: 15_000,
    netPriceByIncome: { "0-30000": 9_000, "30001-48000": 11_000, "48001-75000": 14_000, "75001-110000": 18_000, "110001-plus": 21_000 },
    costOfAttendance: 28_000,
    tuitionInState: 10_000,
    tuitionOutOfState: 25_000,
    pellShare: 0.35,
    medianDebt: 19_000,
    netPriceCalculatorUrl: "npc.example.edu/calculator",
    ...over,
  };
}

export async function insertColleges(db: Db, rows: (Partial<CollegeRow> & Pick<CollegeRow, "unitId" | "name">)[]) {
  if (rows.length) await db.insert(colleges).values(rows.map(collegeRow));
}

export async function insertPrograms(db: Db, rows: (Partial<ProgramRow> & Pick<ProgramRow, "unitId" | "cip4">)[]) {
  if (rows.length) {
    await db.insert(collegePrograms).values(rows.map((r) => ({ title: `Program ${r.cip4}.`, credentialLevel: 3, ...r })));
  }
}
