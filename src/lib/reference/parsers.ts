import type { NetPriceByIncome } from "@/db/schema";
import { type WorkStyle, workStyleForElement } from "./work-styles";

/**
 * Pure row mappers for the public datasets we load. Each takes one CSV/sheet row keyed by the
 * source's own column names and returns a database record, or null to skip the row.
 */

type Row = Record<string, string | undefined>;

const RIASEC_BY_NAME = {
  Realistic: "R",
  Investigative: "I",
  Artistic: "A",
  Social: "S",
  Enterprising: "E",
  Conventional: "C",
} as const;

/** O*NET occupation_data.csv */
export function parseOccupation(row: Row) {
  const code = row["O*NET-SOC Code"]?.trim();
  const title = row.Title?.trim();
  if (!code || !title) return null;
  return { code, title, description: row.Description?.trim() ?? "" };
}

/** O*NET job_zones.csv → [code, zone] */
export function parseJobZone(row: Row): [string, number] | null {
  const code = row["O*NET-SOC Code"]?.trim();
  const zone = Number(row["Job Zone"]);
  if (!code || !Number.isInteger(zone) || zone < 1 || zone > 5) return null;
  return [code, zone];
}

/** O*NET career_interest_types.csv. Keeps only the six RIASEC scores (scale OI, 1–7). */
export function parseOccupationInterest(row: Row) {
  if (row["Scale ID"] !== "OI") return null;
  const interest = RIASEC_BY_NAME[row["Element Name"] as keyof typeof RIASEC_BY_NAME];
  const occupationCode = row["O*NET-SOC Code"]?.trim();
  const score = Number(row["Data Value"]);
  if (!interest || !occupationCode || !Number.isFinite(score)) return null;
  return { occupationCode, interest, score };
}

/**
 * The interest rows with `leads` set on each occupation's highest-scored area, and on each of them
 * when tied (Veterinarians are as Realistic as Investigative). An occupation missing any of the six
 * scores leads with none: matching skips it too. Browsing careers by interest area reads this.
 * Migration 0014 marks already-loaded data the same way.
 */
export function withLeadInterests<R extends { occupationCode: string; score: number }>(rows: R[]): (R & { leads: boolean })[] {
  const byCode = new Map<string, { count: number; top: number }>();
  for (const r of rows) {
    const seen = byCode.get(r.occupationCode) ?? { count: 0, top: -Infinity };
    byCode.set(r.occupationCode, { count: seen.count + 1, top: Math.max(seen.top, r.score) });
  }
  return rows.map((r) => {
    const occupation = byCode.get(r.occupationCode)!;
    return { ...r, leads: occupation.count === 6 && r.score === occupation.top };
  });
}

const WORK_VALUE_BY_NAME = {
  Achievement: "achievement",
  Independence: "independence",
  Recognition: "recognition",
  Relationships: "relationships",
  Support: "support",
  "Working Conditions": "working_conditions",
} as const;

/** O*NET 30.0 "Work Values.txt". Keeps the six extent scores (scale EX, 1–7). */
export function parseOccupationValue(row: Row) {
  if (row["Scale ID"] !== "EX") return null;
  const value = WORK_VALUE_BY_NAME[row["Element Name"] as keyof typeof WORK_VALUE_BY_NAME];
  const occupationCode = row["O*NET-SOC Code"]?.trim();
  const score = Number(row["Data Value"]);
  if (!value || !occupationCode || !Number.isFinite(score)) return null;
  return { occupationCode, value, score };
}

/**
 * O*NET 31.0 work_styles.csv: one rating on one scale, WI (Work Styles Impact, −3 to +3) or DR
 * (Distinctiveness Rank, 0–10, where 0 means not ranked). Rows for styles we don't know are skipped.
 * The whole file's Domain Source is "AI/Expert" (see src/lib/reference/work-styles.ts).
 */
export function parseWorkStyle(row: Row) {
  const occupationCode = row["O*NET-SOC Code"]?.trim();
  const style = workStyleForElement(row["Element ID"]);
  const scale = row["Scale ID"]?.trim();
  const value = num(row["Data Value"]);
  if (!occupationCode || !style || value === null) return null;
  if (scale === "WI" && value >= -3 && value <= 3) return { occupationCode, style, scale, value } as const;
  if (scale === "DR" && Number.isInteger(value) && value >= 0 && value <= 10) return { occupationCode, style, scale, value } as const;
  return null;
}

export type WorkStyleRating = NonNullable<ReturnType<typeof parseWorkStyle>>;

/**
 * Joins the two scales into one record per occupation and style. A style needs its impact (WI) to
 * be kept; a Distinctiveness Rank of 0 ("not ranked") becomes null.
 */
export function collectWorkStyles(ratings: Iterable<WorkStyleRating>) {
  const byKey = new Map<string, { occupationCode: string; style: WorkStyle; impact?: number; distinctiveRank: number | null }>();
  for (const r of ratings) {
    const key = `${r.occupationCode}|${r.style}`;
    const entry = byKey.get(key) ?? { occupationCode: r.occupationCode, style: r.style, distinctiveRank: null };
    if (r.scale === "WI") entry.impact = r.value;
    else entry.distinctiveRank = r.value > 0 ? r.value : null;
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .filter((e): e is typeof e & { impact: number } => e.impact !== undefined)
    .map(({ occupationCode, style, impact, distinctiveRank }) => ({ occupationCode, style, impact, distinctiveRank }));
}

/**
 * A CIP 2020 major from any row of the crosswalk's "CIP-SOC" sheet, including majors with no
 * matching occupation (so major search knows every major, like "Pre-Medicine/Pre-Medical
 * Studies"). Skips the "99.9999 NO MATCH" placeholder for occupations with no matching major.
 */
export function parseCipMajor(row: Row) {
  const cipCode = row.CIP2020Code?.trim();
  const title = row.CIP2020Title?.trim().replace(/\.$/, "");
  if (!cipCode || !/^\d{2}\.\d{4}$/.test(cipCode) || !title) return null;
  if (cipCode.startsWith("99.") || title.toUpperCase() === "NO MATCH") return null;
  return { cipCode, title };
}

/** NCES CIP2020–SOC2018 crosswalk, "CIP-SOC" sheet: one major–occupation link. */
export function parseCipSoc(row: Row) {
  const major = parseCipMajor(row);
  const socCode = row.SOC2018Code?.trim();
  if (!major) return null;
  // "99-9999" and blanks mark programs with no matching occupation.
  if (!socCode || !/^\d{2}-\d{4}$/.test(socCode) || socCode === "99-9999") return null;
  return { cipCode: major.cipCode, cipTitle: major.title, socCode };
}

/**
 * A number, or null when the value is missing. Scorecard files mark missing values "NA" (older
 * releases "NULL") and privacy-suppressed ones "PS" (older releases "PrivacySuppressed"); anything
 * else that isn't a plain number is treated as missing too.
 */
function num(value: string | undefined): number | null {
  const v = value?.trim();
  if (!v || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(value: string | undefined): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n);
}

/** Scorecard 0/1 flags. Anything but "1" (including "NA") is false. */
function flag(value: string | undefined) {
  return value?.trim() === "1";
}

/** "02139-4301" → "02139". Null unless it starts with a 5-digit ZIP. */
function zip5(value: string | undefined) {
  return value?.trim().match(/^(\d{5})(?:-?\d{4})?$/)?.[1] ?? null;
}

/**
 * Scorecard URLs often leave off the scheme ("www.aamu.edu/") or contain spaces. Adds https://
 * when there's no scheme and percent-encodes the rest; null if it still isn't a web address.
 */
function webUrl(value: string | undefined) {
  const raw = value?.trim();
  if (!raw || raw === "NA" || raw === "NULL") return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

const NET_PRICE_BANDS: [keyof NetPriceByIncome, string][] = [
  ["0-30000", "NPT41"],
  ["30001-48000", "NPT42"],
  ["48001-75000", "NPT43"],
  ["75001-110000", "NPT44"],
  ["110001-plus", "NPT45"],
];

/**
 * Net price columns come in four families. Per the Scorecard data dictionary, _PUB (public) and
 * _PRIV (private nonprofit and for-profit) cover every calendar type (for program-year and
 * continuous-enrollment schools they describe the largest program), while _PROG (program-year)
 * and _OTHER (other calendars) are discontinued and empty in current releases but filled in
 * older files. We read the school's own sector first, then the other sector (a school whose
 * control changed after the net price year reported under its old sector, e.g. the University of
 * Arizona Global Campus, public now but in the _PRIV columns), then _PROG, then _OTHER.
 */
function netPriceSuffixes(control: number | null) {
  return control === 1 ? ["PUB", "PRIV", "PROG", "OTHER"] : ["PRIV", "PUB", "PROG", "OTHER"];
}

function firstInt(row: Row, columns: string[]) {
  for (const column of columns) {
    const value = int(row[column]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * College Scorecard Most-Recent-Cohorts-Institution.csv. Keeps currently operating schools that
 * mainly award certificates, associate or bachelor's degrees, or graduate degrees (PREDDEG 1–4).
 *
 * Money is whole dollars and rates are 0–1 as published. Net prices can be negative when grants
 * exceed the cost of attendance; they're stored as published and never shown below $0.
 */
export function parseCollege(row: Row) {
  const unitId = int(row.UNITID);
  const name = row.INSTNM?.trim();
  const predominantDegree = int(row.PREDDEG);
  if (!unitId || !name || row.CURROPER?.trim() !== "1") return null;
  if (predominantDegree === null || predominantDegree < 1 || predominantDegree > 4) return null;

  const control = int(row.CONTROL);
  const suffixes = netPriceSuffixes(control);
  const netPriceByIncome: NetPriceByIncome = {};
  for (const [band, prefix] of NET_PRICE_BANDS) {
    const value = firstInt(row, suffixes.map((s) => `${prefix}_${s}`));
    if (value !== null) netPriceByIncome[band] = value;
  }

  return {
    unitId,
    name,
    city: row.CITY?.trim() || null,
    state: row.STABBR?.trim() || null,
    zip: zip5(row.ZIP),
    url: webUrl(row.INSTURL),
    netPriceCalculatorUrl: webUrl(row.NPCURL),
    control,
    predominantDegree,
    highestDegree: int(row.HIGHDEG),
    enrollment: int(row.UGDS),
    admissionRate: num(row.ADM_RATE),
    // The rate College Scorecard itself shows: two starting classes pooled, and suppressed ("PS")
    // when fewer than 30 students started. The single-year C150_4 / C150_L4 rates are published
    // for cohorts as small as one student, so they'd put 0% and 100% rates from a handful of
    // students at the top of "Highest graduation rate".
    completionRate: num(row.C150_4_POOLED_SUPP) ?? num(row.C150_L4_POOLED_SUPP),
    medianEarnings10yr: int(row.MD_EARN_WNE_P10),
    avgNetPrice: firstInt(row, suffixes.map((s) => `NPT4_${s}`)),
    netPriceByIncome: Object.keys(netPriceByIncome).length ? netPriceByIncome : null,
    // Academic-year schools report COSTT4_A; program-year schools COSTT4_P (largest program).
    costOfAttendance: int(row.COSTT4_A) ?? int(row.COSTT4_P),
    tuitionInState: int(row.TUITIONFEE_IN),
    tuitionOutOfState: int(row.TUITIONFEE_OUT),
    pellShare: num(row.PCTPELL),
    medianDebt: int(row.GRAD_DEBT_MDN),
    hbcu: flag(row.HBCU),
    hispanicServing: flag(row.HSI),
    tribal: flag(row.TRIBAL),
    onlineOnly: flag(row.DISTANCEONLY),
  };
}

export type CollegeRecord = NonNullable<ReturnType<typeof parseCollege>>;

/** Undergraduate credential levels in the field-of-study file: certificate, associate, bachelor's. */
const UNDERGRAD_CREDENTIAL_LEVELS = new Set([1, 2, 3]);

/**
 * College Scorecard Most-Recent-Cohorts-Field-of-Study.csv. Keeps undergraduate programs
 * (CREDLEV 1 certificate, 2 associate, 3 bachelor's) at schools with a numeric UNITID.
 * CIPCODE "0301" becomes cip4 "03.01"; CIPDESC "Forestry." becomes "Forestry".
 */
export function parseCollegeProgram(row: Row) {
  const rawUnitId = row.UNITID?.trim();
  if (!rawUnitId || !/^\d+$/.test(rawUnitId)) return null;
  const unitId = Number(rawUnitId);
  const credentialLevel = int(row.CREDLEV);
  if (!unitId || credentialLevel === null || !UNDERGRAD_CREDENTIAL_LEVELS.has(credentialLevel)) return null;

  let cip = row.CIPCODE?.trim() ?? "";
  if (/^\d{2}\.\d{2}$/.test(cip)) cip = cip.replace(".", "");
  // A spreadsheet round-trip can drop the leading zero ("301" for 03.01).
  if (/^\d{3}$/.test(cip)) cip = `0${cip}`;
  if (!/^\d{4}$/.test(cip)) return null;

  const title = row.CIPDESC?.trim().replace(/\.+$/, "").trim();
  if (!title) return null;

  return {
    unitId,
    cip4: `${cip.slice(0, 2)}.${cip.slice(2)}`,
    title,
    credentialLevel,
    // Median federal loan debt of graduates, borrowed at this school.
    medianDebt: int(row.DEBT_ALL_STGP_EVAL_MDN),
    medianEarnings4yr: int(row.EARN_MDN_4YR),
  };
}

export type CollegeProgramRecord = NonNullable<ReturnType<typeof parseCollegeProgram>>;

/**
 * Streams field-of-study rows into program records for the colleges we loaded (the table has a
 * foreign key to colleges). The first row wins for each (unitId, cip4, credentialLevel).
 */
export async function collectCollegePrograms(rows: Iterable<Row> | AsyncIterable<Row>, unitIds: ReadonlySet<number>) {
  const programs = new Map<string, CollegeProgramRecord>();
  for await (const row of rows) {
    const program = parseCollegeProgram(row);
    if (!program || !unitIds.has(program.unitId)) continue;
    const key = `${program.unitId}|${program.cip4}|${program.credentialLevel}`;
    if (!programs.has(key)) programs.set(key, program);
  }
  return [...programs.values()];
}

/** O*NET-SOC "15-1252.00" → SOC "15-1252", for joining with the CIP–SOC crosswalk. */
export function socFromOnetCode(onetCode: string) {
  return onetCode.slice(0, 7);
}
