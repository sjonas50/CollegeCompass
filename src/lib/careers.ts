import { and, asc, eq, ilike, not, notLike } from "drizzle-orm";
import type { Db } from "@/db";
import { cipSocLinks, majors, occupationInterests, occupations } from "@/db/schema";
import { RIASEC, type Riasec } from "./assessments/instruments";
import { majorsForCip6, offeredFamilies } from "./colleges/search";
import { type Pathway, pathwayFor } from "./matching/match";
import { socFromOnetCode } from "./reference/parsers";

/** Plain-language O*NET Job Zones (31.0 merges zones 1 and 2). */
export const JOB_ZONE_INFO: Record<number, { label: string; detail: string }> = {
  1: { label: "Little preparation", detail: "Usually a high school diploma and on-the-job training." },
  2: { label: "Some preparation", detail: "Usually a high school diploma, plus up to a year of on-the-job training." },
  3: { label: "Medium preparation", detail: "Usually vocational training, an apprenticeship, or an associate degree." },
  4: { label: "Considerable preparation", detail: "Usually a bachelor's degree." },
  5: { label: "Extensive preparation", detail: "Usually a graduate degree, like a master's, law degree, or doctorate." },
};

/**
 * How a student can study a major:
 * - "colleges": colleges we list offer its 4-digit family (`cip4`) as an undergraduate program.
 * - "graduate": a graduate or professional program, studied after college (medicine, law, ...).
 * - "none": no college we list offers it as an undergraduate program.
 */
export type MajorPath = { kind: "colleges"; cip4: string; colleges: number } | { kind: "graduate" } | { kind: "none" };

export type CareerDetail = {
  code: string;
  title: string;
  description: string;
  jobZone: number | null;
  pathway: Pathway;
  interests: { area: Riasec; score: number }[];
  /**
   * Up to 15 related majors (no residencies): ones colleges offer first, most widely offered
   * first, then graduate programs, then majors no college we list offers.
   */
  majors: { cipCode: string; title: string }[];
  /** How each major in `majors` is studied, by its 6-digit CIP code. */
  majorPaths: Record<string, MajorPath>;
};

/** How many related majors a career shows. */
export const CAREER_MAJOR_LIMIT = 15;

/**
 * CIP codes (or code prefixes) of graduate and professional programs that students start after
 * college: doctors, dentists, vets, lawyers, pharmacists, optometrists, chiropractors, physician
 * assistants, physical and occupational therapists, audiologists and speech-language pathologists.
 */
const GRADUATE_PROGRAMS = [
  "01.80", "01.81", "22.01", "22.02", "51.01", "51.0202", "51.0203", "51.04", "51.05", "51.0912", "51.12", "51.14",
  "51.17", "51.2001", "51.2008", "51.2306", "51.2308",
];

export function isGraduateProgram(cipCode: string): boolean {
  return GRADUATE_PROGRAMS.some((prefix) => cipCode.startsWith(prefix));
}

export async function getCareer(db: Db, code: string): Promise<CareerDetail | null> {
  const [occ] = await db.select().from(occupations).where(eq(occupations.code, code));
  if (!occ) return null;
  const [interests, related] = await Promise.all([
    db.select().from(occupationInterests).where(eq(occupationInterests.occupationCode, code)),
    db
      .select({ cipCode: majors.cipCode, title: majors.title })
      .from(cipSocLinks)
      .innerJoin(majors, eq(majors.cipCode, cipSocLinks.cipCode))
      .where(
        and(
          eq(cipSocLinks.socCode, socFromOnetCode(code)),
          // Series 60 and 61 are residencies and fellowships; 99 is the crosswalk's "NO MATCH".
          notLike(majors.cipCode, "60.%"),
          notLike(majors.cipCode, "61.%"),
          notLike(majors.cipCode, "99.%"),
        ),
      ),
  ]);

  const offered = await offeredFamilies(db, related.map((m) => majorsForCip6(m.cipCode) ?? ""));
  const pathOf = (cipCode: string): MajorPath => {
    if (isGraduateProgram(cipCode)) return { kind: "graduate" };
    const cip4 = majorsForCip6(cipCode);
    const family = cip4 ? offered.get(cip4) : undefined;
    return cip4 && family ? { kind: "colleges", cip4, colleges: family.colleges } : { kind: "none" };
  };
  const rank = (path: MajorPath) => (path.kind === "colleges" ? 0 : path.kind === "graduate" ? 1 : 2);
  const colleges = (path: MajorPath) => (path.kind === "colleges" ? path.colleges : 0);
  const ranked = related
    .map((m) => ({ ...m, path: pathOf(m.cipCode) }))
    // Then by code, which puts a family's general major first: "51.3801 Registered
    // Nursing/Registered Nurse" before its specialties, "22.0101 Law" before "22.0211 Tax Law".
    .sort((a, b) => rank(a.path) - rank(b.path) || colleges(b.path) - colleges(a.path) || a.cipCode.localeCompare(b.cipCode))
    .slice(0, CAREER_MAJOR_LIMIT);

  return {
    code: occ.code,
    title: occ.title,
    description: occ.description,
    jobZone: occ.jobZone,
    pathway: pathwayFor(occ.jobZone),
    interests: RIASEC.map((area) => ({ area, score: interests.find((i) => i.interest === area)?.score ?? 0 })).sort(
      (a, b) => b.score - a.score,
    ),
    majors: ranked.map(({ cipCode, title }) => ({ cipCode, title })),
    majorPaths: Object.fromEntries(ranked.map((m) => [m.cipCode, m.path])),
  };
}

export async function searchCareers(db: Db, query: string, limit = 30) {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .select({ code: occupations.code, title: occupations.title, jobZone: occupations.jobZone })
    .from(occupations)
    .where(and(ilike(occupations.title, `%${escaped}%`), not(ilike(occupations.title, "%, All Other"))))
    .orderBy(asc(occupations.title))
    .limit(limit);
}
