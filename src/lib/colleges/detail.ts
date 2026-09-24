import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { type NetPriceByIncome, collegePrograms, colleges } from "@/db/schema";
import { cleanTitle } from "./format";
import {
  type CollegeSize,
  type Control,
  CREDENTIAL_LABELS,
  type Credential,
  MISSIONS,
  type Mission,
  asControl,
  asCredential,
  asDegree,
  sizeOf,
} from "./labels";

export type CollegeProgram = {
  /** 4-digit CIP family, e.g. "11.07". */
  cip4: string;
  title: string;
  /** Median earnings 4 years after finishing; null when too few graduates to report. */
  medianEarnings4yr: number | null;
  /** Median federal debt of graduates; null when too few graduates to report. */
  medianDebt: number | null;
};

export type ProgramGroup = {
  /** 1 certificate, 2 associate, 3 bachelor's. */
  credentialLevel: Credential;
  /** e.g. "Bachelor's degrees". */
  label: string;
  programs: CollegeProgram[];
};

export type CollegeDetail = {
  unitId: number;
  name: string;
  city: string | null;
  state: string | null;
  /** The college's website (http/https only). */
  url: string | null;
  /** The college's own net price calculator (http/https only). */
  netPriceCalculatorUrl: string | null;
  /** This college on the Department of Education's College Scorecard site. */
  scorecardUrl: string;
  /** 1 public, 2 private nonprofit, 3 private for-profit. */
  control: Control | null;
  /** The degree most students earn: 1 certificate, 2 associate, 3 bachelor's, 4 graduate. */
  predominantDegree: number | null;
  /** Highest degree offered, same codes. */
  highestDegree: number | null;
  enrollment: number | null;
  size: CollegeSize | null;
  /** Share of applicants admitted (0–1); null for open admission or not reported. */
  admissionRate: number | null;
  completionRate: number | null;
  medianEarnings10yr: number | null;
  /** Median federal debt of graduates. */
  medianDebt: number | null;
  /** Share of undergraduates with a Pell Grant (0–1). */
  pellShare: number | null;
  avgNetPrice: number | null;
  netPriceByIncome: NetPriceByIncome | null;
  costOfAttendance: number | null;
  tuitionInState: number | null;
  tuitionOutOfState: number | null;
  missions: Mission[];
  onlineOnly: boolean;
  /** Undergraduate programs, grouped by credential level (certificate first), sorted by title. */
  programs: ProgramGroup[];
};

/** UNITIDs are positive integers that fit the database's integer column. */
export function isUnitId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

/** A route parameter like "110635" → 110635; null for anything else. */
export function parseUnitId(param: string | null | undefined): number | null {
  if (!param || !/^\d{1,10}$/.test(param)) return null;
  const n = Number(param);
  return isUnitId(n) ? n : null;
}

export function scorecardUrl(unitId: number): string {
  return `https://collegescorecard.ed.gov/school/?${unitId}`;
}

/** Keeps only web links; adds https:// when the source left the scheme off. */
export function safeUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function getCollege(db: Db, unitId: number): Promise<CollegeDetail | null> {
  if (!isUnitId(unitId)) return null;
  const [row] = await db.select().from(colleges).where(eq(colleges.unitId, unitId));
  if (!row) return null;
  const programRows = await db
    .select({
      cip4: collegePrograms.cip4,
      title: collegePrograms.title,
      credentialLevel: collegePrograms.credentialLevel,
      medianEarnings4yr: collegePrograms.medianEarnings4yr,
      medianDebt: collegePrograms.medianDebt,
    })
    .from(collegePrograms)
    .where(eq(collegePrograms.unitId, unitId))
    .orderBy(asc(collegePrograms.credentialLevel), asc(collegePrograms.title));

  const groups = new Map<Credential, CollegeProgram[]>();
  for (const p of programRows) {
    const level = asCredential(p.credentialLevel);
    if (!level) continue;
    const list = groups.get(level) ?? [];
    list.push({ cip4: p.cip4, title: cleanTitle(p.title), medianEarnings4yr: p.medianEarnings4yr, medianDebt: p.medianDebt });
    groups.set(level, list);
  }
  const programs: ProgramGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([credentialLevel, list]) => ({
      credentialLevel,
      label: CREDENTIAL_LABELS[credentialLevel].many,
      programs: list.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" })),
    }));

  return {
    unitId: row.unitId,
    name: row.name,
    city: row.city,
    state: row.state,
    url: safeUrl(row.url),
    netPriceCalculatorUrl: safeUrl(row.netPriceCalculatorUrl),
    scorecardUrl: scorecardUrl(row.unitId),
    control: asControl(row.control),
    predominantDegree: asDegree(row.predominantDegree),
    highestDegree: asDegree(row.highestDegree),
    enrollment: row.enrollment,
    size: sizeOf(row.enrollment),
    admissionRate: row.admissionRate,
    completionRate: row.completionRate,
    medianEarnings10yr: row.medianEarnings10yr,
    medianDebt: row.medianDebt,
    pellShare: row.pellShare,
    avgNetPrice: row.avgNetPrice,
    netPriceByIncome: row.netPriceByIncome && Object.keys(row.netPriceByIncome).length ? row.netPriceByIncome : null,
    costOfAttendance: row.costOfAttendance,
    tuitionInState: row.tuitionInState,
    tuitionOutOfState: row.tuitionOutOfState,
    missions: MISSIONS.filter((m) => row[m]),
    onlineOnly: row.onlineOnly,
    programs,
  };
}
