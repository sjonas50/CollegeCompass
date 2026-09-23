import type { NetPriceByIncome } from "@/db/schema";

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

/** NCES CIP2020–SOC2018 crosswalk, "CIP-SOC" sheet. */
export function parseCipSoc(row: Row) {
  const cipCode = row.CIP2020Code?.trim();
  const cipTitle = row.CIP2020Title?.trim().replace(/\.$/, "");
  const socCode = row.SOC2018Code?.trim();
  if (!cipCode || !/^\d{2}\.\d{4}$/.test(cipCode) || !cipTitle) return null;
  // "99-9999" and blanks mark programs with no matching occupation.
  if (!socCode || !/^\d{2}-\d{4}$/.test(socCode) || socCode === "99-9999") return null;
  return { cipCode, cipTitle, socCode };
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "" || value === "NULL" || value === "PrivacySuppressed") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function int(value: string | undefined): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n);
}

/**
 * College Scorecard Most-Recent-Cohorts-Institution.csv. Keeps currently operating schools that
 * mainly award certificates, associate or bachelor's degrees, or graduate degrees (PREDDEG 1–4).
 */
export function parseCollege(row: Row) {
  const unitId = int(row.UNITID);
  const name = row.INSTNM?.trim();
  const predominantDegree = int(row.PREDDEG);
  if (!unitId || !name || row.CURROPER !== "1") return null;
  if (predominantDegree === null || predominantDegree < 1 || predominantDegree > 4) return null;

  const control = int(row.CONTROL);
  const sector = control === 1 ? "PUB" : "PRIV";
  const bands: [keyof NetPriceByIncome, string][] = [
    ["0-30000", `NPT41_${sector}`],
    ["30001-48000", `NPT42_${sector}`],
    ["48001-75000", `NPT43_${sector}`],
    ["75001-110000", `NPT44_${sector}`],
    ["110001-plus", `NPT45_${sector}`],
  ];
  const netPriceByIncome: NetPriceByIncome = {};
  for (const [band, column] of bands) {
    const value = int(row[column]);
    if (value !== null) netPriceByIncome[band] = value;
  }

  const url = row.INSTURL?.trim();
  return {
    unitId,
    name,
    city: row.CITY?.trim() || null,
    state: row.STABBR?.trim() || null,
    url: url ? (url.startsWith("http") ? url : `https://${url}`) : null,
    control,
    admissionRate: num(row.ADM_RATE),
    completionRate: num(row.C150_4) ?? num(row.C150_L4),
    medianEarnings10yr: int(row.MD_EARN_WNE_P10),
    avgNetPrice: int(row[`NPT4_${sector}`]),
    netPriceByIncome: Object.keys(netPriceByIncome).length ? netPriceByIncome : null,
  };
}

/** O*NET-SOC "15-1252.00" → SOC "15-1252", for joining with the CIP–SOC crosswalk. */
export function socFromOnetCode(onetCode: string) {
  return onetCode.slice(0, 7);
}
