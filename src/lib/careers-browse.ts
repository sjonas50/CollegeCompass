import { and, count, eq, not, ilike } from "drizzle-orm";
import type { Db } from "@/db";
import { occupationInterests, occupations } from "@/db/schema";
import { RIASEC, type Riasec } from "./assessments/instruments";
import { CAREER_PAGE_SIZE, type CareerHit } from "./careers-search";
import { isPostsecondaryTeacher } from "./matching/minors";

/**
 * Browsing careers by interest area (/careers?area=R): the careers whose O*NET interest profile
 * leads with that area (their highest score, or tied for it; see withLeadInterests), filtered by
 * how much preparation they usually need (O*NET Job Zone). The leading areas are worked out when
 * the reference data is loaded, and indexed, so a page is one small query. Names and links for the
 * areas are in career-areas.ts.
 */

export type CareerBrowseResult = {
  area: Riasec;
  /** The level shown (a Job Zone), or null for every level. */
  level: number | null;
  /** How many careers in the area need each level, for the levels that have any, easiest first. */
  levels: { level: number; count: number }[];
  /** Careers in the area at every level. */
  all: number;
  /** Careers in the area at the level shown. */
  total: number;
  /** The page actually returned (requests past the end get the last page). */
  page: number;
  pageSize: number;
  results: CareerHit[];
  /** Whether the careers at this level include college teaching jobs, which are listed last. */
  collegeTeachingLast: boolean;
};

/**
 * One page of the careers that lead with `area`, at `level` if given: A to Z, with college teaching
 * jobs last (O*NET has one per subject: 33 of Social's 129 careers). Leaves out O*NET's catch-all
 * "…, All Other" titles, as search does. Every other career is listed, including ones never shown
 * as matches (see src/lib/matching/minors.ts).
 */
export async function browseCareers(
  db: Db,
  area: Riasec,
  { level = null, page = 1, pageSize = CAREER_PAGE_SIZE }: { level?: number | null; page?: number; pageSize?: number } = {},
): Promise<CareerBrowseResult> {
  const careers = await db
    .select({ code: occupations.code, title: occupations.title, jobZone: occupations.jobZone })
    .from(occupationInterests)
    .innerJoin(occupations, eq(occupations.code, occupationInterests.occupationCode))
    .where(and(eq(occupationInterests.interest, area), eq(occupationInterests.leads, true), not(ilike(occupations.title, "%, All Other"))));

  const perLevel = new Map<number, number>();
  for (const c of careers) if (c.jobZone !== null) perLevel.set(c.jobZone, (perLevel.get(c.jobZone) ?? 0) + 1);
  const shown = careers
    .filter((c) => level === null || c.jobZone === level)
    .sort(
      (a, b) =>
        Number(isPostsecondaryTeacher(a.title)) - Number(isPostsecondaryTeacher(b.title)) || a.title.localeCompare(b.title) || a.code.localeCompare(b.code),
    );

  const lastPage = Math.max(1, Math.ceil(shown.length / pageSize));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, requested), lastPage);
  return {
    area,
    level,
    levels: [...perLevel].sort((a, b) => a[0] - b[0]).map(([zone, n]) => ({ level: zone, count: n })),
    all: careers.length,
    total: shown.length,
    page: current,
    pageSize,
    results: shown.slice((current - 1) * pageSize, current * pageSize),
    collegeTeachingLast: shown.some((c) => isPostsecondaryTeacher(c.title)),
  };
}

/** How many careers lead with each interest area (as browseCareers lists them). */
export async function careerCountsByArea(db: Db): Promise<Record<Riasec, number>> {
  const rows = await db
    .select({ area: occupationInterests.interest, careers: count() })
    .from(occupationInterests)
    .innerJoin(occupations, eq(occupations.code, occupationInterests.occupationCode))
    .where(and(eq(occupationInterests.leads, true), not(ilike(occupations.title, "%, All Other"))))
    .groupBy(occupationInterests.interest);
  const counts = Object.fromEntries(RIASEC.map((a) => [a, 0])) as Record<Riasec, number>;
  for (const r of rows) counts[r.area] = r.careers;
  return counts;
}
