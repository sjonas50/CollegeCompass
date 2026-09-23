import { and, asc, eq, ilike, not } from "drizzle-orm";
import type { Db } from "@/db";
import { cipSocLinks, majors, occupationInterests, occupations } from "@/db/schema";
import { RIASEC, type Riasec } from "./assessments/instruments";
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

export type CareerDetail = {
  code: string;
  title: string;
  description: string;
  jobZone: number | null;
  pathway: Pathway;
  interests: { area: Riasec; score: number }[];
  majors: { cipCode: string; title: string }[];
};

export async function getCareer(db: Db, code: string): Promise<CareerDetail | null> {
  const [occ] = await db.select().from(occupations).where(eq(occupations.code, code));
  if (!occ) return null;
  const [interests, related] = await Promise.all([
    db.select().from(occupationInterests).where(eq(occupationInterests.occupationCode, code)),
    db
      .select({ cipCode: majors.cipCode, title: majors.title })
      .from(cipSocLinks)
      .innerJoin(majors, eq(majors.cipCode, cipSocLinks.cipCode))
      .where(eq(cipSocLinks.socCode, socFromOnetCode(code)))
      .orderBy(asc(majors.title))
      .limit(15),
  ]);
  return {
    code: occ.code,
    title: occ.title,
    description: occ.description,
    jobZone: occ.jobZone,
    pathway: pathwayFor(occ.jobZone),
    interests: RIASEC.map((area) => ({ area, score: interests.find((i) => i.interest === area)?.score ?? 0 })).sort(
      (a, b) => b.score - a.score,
    ),
    majors: related,
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
