import type { Db } from "@/db";
import { collegePrograms, colleges, majors } from "@/db/schema";

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

/** 4-digit CIP family titles exactly as College Scorecard's field-of-study file has them (CIPDESC). */
export const FAMILY_TITLES: Record<string, string> = {
  "01.06": "Applied Horticulture and Horticultural Business Services.",
  "11.01": "Computer and Information Sciences, General.",
  "11.07": "Computer Science.",
  "11.10": "Computer/Information Technology Administration and Management.",
  "13.12": "Teacher Education and Professional Development, Specific Levels and Methods.",
  "14.19": "Mechanical Engineering.",
  "14.42": "Mechatronics, Robotics, and Automation Engineering.",
  "15.06": "Industrial Production Technologies/Technicians.",
  "16.09": "Romance Languages, Literatures, and Linguistics.",
  "22.00": "Non-Professional Legal Studies.",
  "22.01": "Law.",
  "22.03": "Legal Support Services.",
  "40.05": "Chemistry.",
  "42.01": "Psychology, General.",
  "43.01": "Criminal Justice and Corrections.",
  "46.03": "Electrical and Power Transmission Installers.",
  "47.06": "Vehicle Maintenance and Repair Technologies/Technicians.",
  "48.05": "Precision Metal Working.",
  "50.04": "Design and Applied Arts.",
  "50.05": "Drama/Theatre Arts and Stagecraft.",
  "51.06": "Dental Support Services and Allied Professions.",
  "51.07": "Health and Medical Administrative Services.",
  "51.09": "Allied Health Diagnostic, Intervention, and Treatment Professions.",
  "51.11": "Health/Medical Preparatory Programs.",
  "51.12": "Medicine.",
  "51.16": "Nursing.",
  "51.22": "Public Health.",
  "51.38": "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.",
  "51.39": "Practical Nursing, Vocational Nursing and Nursing Assistants.",
};

/** 6-digit CIP 2020 majors exactly as the NCES CIP–SOC crosswalk titles them (trailing period removed on load). */
export const MAJOR_TITLES: Record<string, string> = {
  "01.0606": "Plant Nursery Operations and Management",
  "11.0101": "Computer and Information Sciences, General",
  "11.0103": "Information Technology",
  "11.0701": "Computer Science",
  "11.1003": "Computer and Information Systems Security/Auditing/Information Assurance",
  "13.1213": "Science, Technology, Engineering, and Mathematics (STEM) Educational Methods",
  "14.1901": "Mechanical Engineering",
  "14.4201": "Mechatronics, Robotics, and Automation Engineering",
  "15.0614": "Welding Engineering Technology/Technician",
  "16.0905": "Spanish Language and Literature",
  "22.0001": "Pre-Law Studies",
  "22.0101": "Law",
  "22.0302": "Legal Assistant/Paralegal",
  "40.0501": "Chemistry, General",
  "43.0103": "Criminal Justice/Law Enforcement Administration",
  "46.0302": "Electrician",
  "47.0603": "Autobody/Collision and Repair Technology/Technician",
  "47.0604": "Automobile/Automotive Mechanics Technology/Technician",
  "48.0508": "Welding Technology/Welder",
  "50.0409": "Graphic Design",
  "50.0411": "Game and Interactive Media Design",
  "50.0501": "Drama and Dramatics/Theatre Arts, General",
  "51.0602": "Dental Hygiene/Hygienist",
  "51.0707": "Health Information/Medical Records Technology/Technician",
  "51.0912": "Physician Assistant",
  "51.0921": "Hyperbaric Medicine Technology/Technician",
  "51.1102": "Pre-Medicine/Pre-Medical Studies",
  "51.1201": "Medicine",
  "51.2208": "Community Health and Preventive Medicine",
  "51.3801": "Registered Nursing/Registered Nurse",
  "51.3808": "Nursing Science",
  "51.3901": "Licensed Practical/Vocational Nurse Training",
  "60.0701": "Nurse Practitioner Residency/Fellowship Program, General",
};

/**
 * Real-shaped reference data for major search: every 6-digit major in MAJOR_TITLES, and for each
 * family in `offeredBy`, that many colleges offering it (college N offers every family offered
 * by at least N colleges). Colleges get unit ids from `firstUnitId` up.
 */
export async function insertMajorSearchData(db: Db, offeredBy: Record<string, number>, firstUnitId = 9_000) {
  await db.insert(majors).values(Object.entries(MAJOR_TITLES).map(([cipCode, title]) => ({ cipCode, title })));
  const most = Math.max(0, ...Object.values(offeredBy));
  await insertColleges(db, Array.from({ length: most }, (_, i) => ({ unitId: firstUnitId + i, name: `Offering College ${i + 1}` })));
  await insertPrograms(
    db,
    Object.entries(offeredBy).flatMap(([cip4, count]) =>
      Array.from({ length: count }, (_, i) => ({ unitId: firstUnitId + i, cip4, title: FAMILY_TITLES[cip4] ?? `Program ${cip4}.` })),
    ),
  );
}
