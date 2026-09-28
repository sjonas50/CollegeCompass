import type { SchoolType, schools } from "@/db/schema";
import { normalizeState } from "../colleges/states";
import { displaySchoolName, schoolSearchText, titleCase } from "../schools/names";

// Row mappers for the two NCES school directories `npm run data:load` reads (see
// scripts/load-reference.ts). Each takes one CSV row keyed by the file's own column names and
// returns a `schools` record, or null to skip the row. Only schools that teach any of grades 7-12
// are kept: those are the ones our students attend.

type Row = Record<string, string | undefined>;
export type SchoolRecord = typeof schools.$inferInsert;

/** The files loaded, named as the `release` column records them. Update with the URLs in the loader. */
export const SCHOOL_RELEASES = { ccd: "CCD 2024-25", pss: "PSS 2023-24" } as const;

/** The grades our students are in; a school must teach at least one of them. */
const STUDENT_GRADES = [7, 8, 9, 10, 11, 12];

/** CCD UPDATED_STATUS values for schools that are running: open, new, added, changed boundary, reopened. */
const OPEN_STATUSES = new Set(["1", "3", "4", "5", "8"]);

const CCD_TYPES: Record<string, SchoolType> = { "1": "regular", "2": "special_ed", "3": "cte_center", "4": "alternative" };

/** CCD grade codes: "PK" -1, "KG" 0, "01"-"12". Ungraded, adult and missing codes give null. */
function ccdGrade(code: string | undefined): number | null {
  const c = code?.trim();
  if (c === "PK") return -1;
  if (c === "KG") return 0;
  const n = Number(c);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

const CCD_GRADE_FLAGS: [number, string][] = [
  [-1, "G_PK_OFFERED"],
  [0, "G_KG_OFFERED"],
  ...Array.from({ length: 12 }, (_, i): [number, string] => [i + 1, `G_${i + 1}_OFFERED`]),
];

/** "http://www.albertk12.org" as given; anything that isn't a plain web address is dropped. */
function website(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v || v.length > 200 || /\s/.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

/** A code the app knows (US_STATES), else the location's state: Bureau of Indian Education schools file under "BI". */
function stateOf(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const state = normalizeState(c);
    if (state) return state;
  }
  return null;
}

const clean = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || null;

/**
 * One school from the CCD school directory (ccd_sch_029), with `extra` from the school
 * characteristics file (ccd_sch_129) when it has the school. Keeps open schools teaching any of
 * grades 7-12; uses the grades-offered flags, not LEVEL, which files K-12 and 7-12 schools as
 * "Other" or "Secondary".
 */
export function parseCcdSchool(row: Row, extra?: { sharedTime?: string; virtual?: string }): SchoolRecord | null {
  const id = row.NCESSCH?.trim();
  const rawName = clean(row.SCH_NAME);
  const state = stateOf(row.ST, row.LSTATE);
  if (!id || !/^\d{12}$/.test(id) || !rawName || !state) return null;
  if (!OPEN_STATUSES.has(row.UPDATED_STATUS?.trim() ?? "")) return null;
  const grades = CCD_GRADE_FLAGS.filter(([, flag]) => row[flag]?.trim() === "Yes").map(([g]) => g);
  if (!grades.some((g) => STUDENT_GRADES.includes(g))) return null;

  const name = displaySchoolName(rawName);
  const rawCity = clean(row.LCITY);
  const city = rawCity && titleCase(rawCity);
  const leaName = clean(row.LEA_NAME);
  return {
    schoolRef: `nces:${id}`,
    source: "ccd",
    release: SCHOOL_RELEASES.ccd,
    name,
    city,
    state,
    leaId: clean(row.LEAID),
    leaName: leaName && displaySchoolName(leaName),
    gradeLow: ccdGrade(row.GSLO) ?? Math.min(...grades),
    gradeHigh: ccdGrade(row.GSHI) ?? Math.max(...grades),
    grades,
    schoolType: CCD_TYPES[row.SCH_TYPE?.trim() ?? ""] ?? "regular",
    charter: row.CHARTER_TEXT?.trim() === "Yes",
    virtual: ["FULLVIRTUAL", "FACEVIRTUAL"].includes(extra?.virtual?.trim() ?? ""),
    sharedTime: extra?.sharedTime?.trim() === "Yes",
    website: website(row.WEBSITE),
    searchText: schoolSearchText({ rawName, name, city: rawCity, district: leaName }),
  };
}

/**
 * PSS grade recodes (LOGR2024, HIGR2024): 1 ungraded, 2 pre-K, 3 kindergarten, 4 transitional
 * kindergarten, 5 transitional first grade, 6-17 grades 1-12.
 */
function pssGrade(code: string | undefined): number | null {
  const n = Number(code?.trim());
  if (!Number.isInteger(n) || n < 2 || n > 17) return null;
  if (n === 2) return -1;
  if (n <= 4) return 0;
  return n === 5 ? 1 : n - 5;
}

/** PSS "grade offered" flags (1 yes, 2 no): P145 pre-K, P155 kindergarten, then P185 (grade 1) to P295 (grade 12). */
const PSS_GRADE_FLAGS: [number, string][] = [
  [-1, "P145"],
  [0, "P155"],
  ...Array.from({ length: 12 }, (_, i): [number, string] => [i + 1, `P${185 + i * 10}`]),
];

/**
 * One school from the Private School Universe Survey public-use file. The file has only the
 * schools that answered the survey, so some private schools are missing ("My school isn't listed"
 * covers them). Most rows have only a mailing address; the location address wins when present.
 */
export function parsePssSchool(row: Row): SchoolRecord | null {
  const id = row.PPIN?.trim();
  const rawName = clean(row.PINST);
  const state = stateOf(row.PL_STABB, row.PSTABB);
  if (!id || !/^[A-Z0-9]{8}$/.test(id) || !rawName || !state) return null;
  const grades = PSS_GRADE_FLAGS.filter(([, flag]) => row[flag]?.trim() === "1").map(([g]) => g);
  if (!grades.some((g) => STUDENT_GRADES.includes(g))) return null;

  const name = displaySchoolName(rawName);
  const rawCity = clean(row.PL_STABB?.trim() ? row.PL_CIT : row.PCITY);
  return {
    schoolRef: `pss:${id}`,
    source: "pss",
    release: SCHOOL_RELEASES.pss,
    name,
    city: rawCity && titleCase(rawCity),
    state,
    leaId: null,
    leaName: null,
    gradeLow: pssGrade(row.LOGR2024) ?? Math.min(...grades),
    gradeHigh: pssGrade(row.HIGR2024) ?? Math.max(...grades),
    grades,
    schoolType: "private",
    charter: false,
    virtual: false,
    sharedTime: false,
    website: null,
    searchText: schoolSearchText({ rawName, name, city: rawCity }),
  };
}
