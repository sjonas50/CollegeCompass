import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { type SchoolType, schools } from "@/db/schema";
import { normalizeState } from "../colleges/states";
import { type SchoolKind, schoolSearchQuery, searchWords } from "./names";

// Finding a school in the NCES directory (the `schools` table, see scripts/load-reference.ts).
// Searches are by name, city or district within one state, and are never logged: what a family
// types can name their child's school.

/** A school as the pickers show it. Public directory facts only; nothing about any student. */
export type SchoolOption = {
  ref: string;
  name: string;
  city: string | null;
  state: string;
  gradeLow: number | null;
  gradeHigh: number | null;
  kind: SchoolKind;
  virtual: boolean;
  /** A career and technical center (most students there attend another school too). */
  careerCenter: boolean;
  district: string | null;
};

export const SCHOOL_SEARCH_LIMIT = 20;
export const SCHOOL_QUERY_MAX = 100;
/** Searches per person per window (POST /api/schools/search): plenty for typing, too few to scrape the directory. */
export const SCHOOL_SEARCH_RATE = { count: 300, windowMs: 10 * 60_000 };

const optionColumns = {
  ref: schools.schoolRef,
  name: schools.name,
  city: schools.city,
  state: schools.state,
  gradeLow: schools.gradeLow,
  gradeHigh: schools.gradeHigh,
  schoolType: schools.schoolType,
  charter: schools.charter,
  virtual: schools.virtual,
  district: schools.leaName,
};

type OptionRow = Omit<SchoolOption, "kind" | "careerCenter"> & { schoolType: SchoolType; charter: boolean };

function toOption({ schoolType, charter, ...row }: OptionRow): SchoolOption {
  return { ...row, kind: schoolType === "private" ? "private" : charter ? "charter" : "public", careerCenter: schoolType === "cte_center" };
}

/**
 * Schools in `state` whose name, city or district has words starting with each word typed
 * ("plano sr", "katy", "st mary"). Names that start with what was typed come first, then schools
 * other than career and technical centers (usually a place to take some classes, though some are
 * full-time high schools), then schools that go through 12th grade, then by name. Shared-time
 * schools stay in: the directory marks regular high schools that way too (Science Hill High in
 * Tennessee). Uses the text-search index on `search_text` and the state index.
 */
export async function searchSchools(db: Db, input: { state: string; query: string; limit?: number }): Promise<SchoolOption[]> {
  const state = normalizeState(input.state);
  const tsquery = schoolSearchQuery(input.query.slice(0, SCHOOL_QUERY_MAX));
  if (!state || !tsquery) return [];
  const typed = searchWords(input.query.slice(0, SCHOOL_QUERY_MAX));
  const rows = await db
    .select(optionColumns)
    .from(schools)
    .where(
      and(
        eq(schools.state, state),
        sql`to_tsvector('simple', ${schools.searchText}) @@ to_tsquery('simple', ${tsquery})`,
      ),
    )
    .orderBy(
      // The name as filed starts the search text; the name as shown may differ ("Senior" for "SR").
      sql`(${schools.searchText} like ${`${typed}%`} or lower(${schools.name}) like ${`${typed}%`}) desc`,
      sql`(${schools.schoolType} = 'cte_center') asc`,
      sql`(coalesce(${schools.gradeHigh}, 0) = 12) desc`,
      asc(sql`lower(${schools.name})`),
      asc(schools.schoolRef),
    )
    .limit(Math.min(input.limit ?? SCHOOL_SEARCH_LIMIT, 50));
  return rows.map(toOption);
}

/** The schools with these refs that are still in the directory, by ref. */
export async function schoolsByRef(db: Db, refs: readonly string[]): Promise<Map<string, SchoolOption>> {
  const wanted = [...new Set(refs)].filter(Boolean);
  if (!wanted.length) return new Map();
  const rows = await db.select(optionColumns).from(schools).where(inArray(schools.schoolRef, wanted));
  return new Map(rows.map((r) => [r.ref, toOption(r)]));
}
