import { type SQL, and, asc, count, eq, exists, gt, gte, ilike, isNull, lt, lte, min, or, sql } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type NetPriceByIncome, collegePrograms, colleges } from "@/db/schema";
import { cleanTitle } from "./format";
import {
  type CollegeSize,
  type Control,
  type Credential,
  MISSIONS,
  type Mission,
  SIZES,
  SIZE_LIMITS,
  asControl,
  asDegree,
  sizeOf,
} from "./labels";
import { normalizeState } from "./states";

export const PAGE_SIZE = 20;

export const SORTS = ["name", "net_price", "completion", "earnings"] as const;
export type CollegeSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<CollegeSort, string> = {
  name: "Name (A to Z)",
  net_price: "Lowest average net price",
  completion: "Highest graduation rate",
  earnings: "Highest earnings after college",
};

/** A 4-digit CIP family, like "11.07" (Computer Science). */
export const CIP4_PATTERN = /^\d{2}\.\d{2}$/;

const code123 = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/**
 * Search filters. Every field is optional; an empty object lists every college (except
 * online-only and graduate-only schools) by name. Also usable as an AI tool's input schema.
 */
export const CollegeSearchFiltersSchema = z.object({
  q: z.string().max(100).optional().describe("Part of the college's name, e.g. 'state university'"),
  state: z.string().regex(/^[A-Za-z]{2}$/).optional().describe("Two-letter state code, e.g. 'TX'"),
  major: z.string().regex(CIP4_PATTERN).optional().describe("4-digit CIP major family, e.g. '11.07' for Computer Science"),
  credential: code123
    .optional()
    .describe("1 certificate, 2 associate, 3 bachelor's. With a major: offers that major at this level. Without: most students earn this."),
  control: code123.optional().describe("1 public, 2 private nonprofit, 3 private for-profit"),
  size: z.enum(SIZES).optional().describe("Undergraduates: small < 5,000, medium 5,000–15,000, large > 15,000"),
  hbcu: z.boolean().optional().describe("Historically Black colleges and universities"),
  hispanicServing: z.boolean().optional().describe("Hispanic-serving institutions"),
  tribal: z.boolean().optional().describe("Tribal colleges and universities"),
  includeOnlineOnly: z.boolean().optional().describe("Include fully online colleges (left out by default)"),
  sort: z.enum(SORTS).optional().describe("Default 'name'. 'net_price' lowest first; 'completion' and 'earnings' highest first"),
  page: z.number().int().min(1).optional().describe(`1-based page of ${PAGE_SIZE} results`),
});
export type CollegeSearchFilters = z.infer<typeof CollegeSearchFiltersSchema>;

/** One search result: small, JSON-safe, and free of internal fields. */
export type CollegeSummary = {
  unitId: number;
  name: string;
  city: string | null;
  state: string | null;
  /** 1 public, 2 private nonprofit, 3 private for-profit. */
  control: Control | null;
  /** Undergraduate enrollment. */
  enrollment: number | null;
  size: CollegeSize | null;
  /** The degree most students earn: 1 certificate, 2 associate, 3 bachelor's, 4 graduate. */
  predominantDegree: number | null;
  /** Average yearly net price (after grants) for students who got federal aid. May be negative. */
  avgNetPrice: number | null;
  netPriceByIncome: NetPriceByIncome | null;
  /** Yearly cost of attendance before aid ("sticker price"). */
  costOfAttendance: number | null;
  /** Share (0–1) finishing within 150% of normal time. */
  completionRate: number | null;
  /** Median earnings 10 years after starting. */
  medianEarnings10yr: number | null;
  missions: Mission[];
  onlineOnly: boolean;
};

export type CollegeSearchResult = {
  total: number;
  /** The page actually returned (requests past the end get the last page). */
  page: number;
  pageSize: number;
  results: CollegeSummary[];
};

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Up to six words, each of which must appear somewhere in the text. */
function words(text: string | undefined) {
  return (text ?? "").trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 6).map(escapeLike);
}

function conditions(filters: CollegeSearchFilters): SQL[] {
  const where: (SQL | undefined)[] = [];
  for (const word of words(filters.q)) where.push(ilike(colleges.name, `%${word}%`));

  // Undergraduate options only: graduate-only schools are never a fit for grades 7–12.
  where.push(or(isNull(colleges.predominantDegree), lt(colleges.predominantDegree, 4)));
  if (!filters.includeOnlineOnly) where.push(eq(colleges.onlineOnly, false));

  if (filters.state !== undefined) {
    const state = normalizeState(filters.state);
    where.push(state ? eq(colleges.state, state) : sql`false`);
  }

  const major = filters.major && CIP4_PATTERN.test(filters.major) ? filters.major : null;
  if (filters.major !== undefined && !major) where.push(sql`false`);
  if (major) {
    where.push(
      exists(
        sql`(select 1 from ${collegePrograms} where ${and(
          eq(collegePrograms.unitId, colleges.unitId),
          eq(collegePrograms.cip4, major),
          filters.credential ? eq(collegePrograms.credentialLevel, filters.credential) : undefined,
        )})`,
      ),
    );
  } else if (filters.credential) {
    where.push(eq(colleges.predominantDegree, filters.credential));
  }

  if (filters.control) where.push(eq(colleges.control, filters.control));

  if (filters.size === "small") where.push(lt(colleges.enrollment, SIZE_LIMITS.mediumMin));
  if (filters.size === "medium") {
    where.push(gte(colleges.enrollment, SIZE_LIMITS.mediumMin), lte(colleges.enrollment, SIZE_LIMITS.mediumMax));
  }
  if (filters.size === "large") where.push(gt(colleges.enrollment, SIZE_LIMITS.mediumMax));

  // Mission checkboxes widen together: HBCU + Hispanic-serving shows colleges that are either.
  const missions = MISSIONS.filter((m) => filters[m]).map((m) => eq(colleges[m], true));
  if (missions.length) where.push(or(...missions));

  return where.filter((c): c is SQL => c !== undefined);
}

const byName = [asc(sql`lower(${colleges.name})`), asc(colleges.unitId)];
const ORDER: Record<CollegeSort, SQL[]> = {
  name: byName,
  net_price: [sql`${colleges.avgNetPrice} asc nulls last`, ...byName],
  completion: [sql`${colleges.completionRate} desc nulls last`, ...byName],
  earnings: [sql`${colleges.medianEarnings10yr} desc nulls last`, ...byName],
};

const summaryColumns = {
  unitId: colleges.unitId,
  name: colleges.name,
  city: colleges.city,
  state: colleges.state,
  control: colleges.control,
  enrollment: colleges.enrollment,
  predominantDegree: colleges.predominantDegree,
  avgNetPrice: colleges.avgNetPrice,
  netPriceByIncome: colleges.netPriceByIncome,
  costOfAttendance: colleges.costOfAttendance,
  completionRate: colleges.completionRate,
  medianEarnings10yr: colleges.medianEarnings10yr,
  hbcu: colleges.hbcu,
  hispanicServing: colleges.hispanicServing,
  tribal: colleges.tribal,
  onlineOnly: colleges.onlineOnly,
};

type SummaryRow = Omit<CollegeSummary, "control" | "size" | "predominantDegree" | "missions"> & {
  control: number | null;
  predominantDegree: number | null;
  hbcu: boolean;
  hispanicServing: boolean;
  tribal: boolean;
};

function toSummary(row: SummaryRow): CollegeSummary {
  const { hbcu: _h, hispanicServing: _hs, tribal: _t, ...rest } = row;
  return {
    ...rest,
    control: asControl(row.control),
    size: sizeOf(row.enrollment),
    predominantDegree: asDegree(row.predominantDegree),
    netPriceByIncome: row.netPriceByIncome && Object.keys(row.netPriceByIncome).length ? row.netPriceByIncome : null,
    missions: MISSIONS.filter((m) => row[m]),
  };
}

export async function searchColleges(db: Db, filters: CollegeSearchFilters = {}): Promise<CollegeSearchResult> {
  const where = and(...conditions(filters));
  const [{ total }] = await db.select({ total: count() }).from(colleges).where(where);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.isFinite(filters.page) ? Math.floor(filters.page as number) : 1;
  const page = Math.min(Math.max(1, requested), lastPage);
  const rows = await db
    .select(summaryColumns)
    .from(colleges)
    .where(where)
    .orderBy(...ORDER[filters.sort ?? "name"])
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { total, page, pageSize: PAGE_SIZE, results: rows.map(toSummary) };
}

export type ProgramMatch = { cip4: string; title: string };

/** Majors (4-digit CIP families) whose title contains every word typed, for picking a major. */
export async function findPrograms(db: Db, text: string, limit = 10): Promise<ProgramMatch[]> {
  const terms = words(text);
  if (!terms.length || text.trim().length < 2) return [];
  const title = min(collegePrograms.title);
  const rows = await db
    .select({ cip4: collegePrograms.cip4, title })
    .from(collegePrograms)
    .where(and(...terms.map((t) => ilike(collegePrograms.title, `%${t}%`))))
    .groupBy(collegePrograms.cip4)
    .orderBy(asc(title), asc(collegePrograms.cip4))
    .limit(limit);
  return rows.map((r) => ({ cip4: r.cip4, title: cleanTitle(r.title ?? r.cip4) }));
}

export type MajorQueryResult =
  | { kind: "match"; major: ProgramMatch }
  | { kind: "choices"; choices: ProgramMatch[]; more: boolean }
  | { kind: "none" };

/** How many majors to offer when typed words match several. */
export const MAJOR_CHOICE_LIMIT = 10;

const simplify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Turns words typed into the major field into one major, or a short list to pick from. One match,
 * or a title that is exactly what was typed, counts as a match. Choices whose title starts with
 * the typed words come first.
 */
export async function resolveMajorQuery(db: Db, text: string): Promise<MajorQueryResult> {
  const matches = await findPrograms(db, text, 50);
  if (!matches.length) return { kind: "none" };
  const typed = simplify(text);
  const exact = matches.find((m) => simplify(m.title) === typed);
  if (exact) return { kind: "match", major: exact };
  if (matches.length === 1) return { kind: "match", major: matches[0] };
  const starts = (m: ProgramMatch) => (simplify(m.title).startsWith(typed) ? 0 : 1);
  const ranked = [...matches].sort((a, b) => starts(a) - starts(b));
  return { kind: "choices", choices: ranked.slice(0, MAJOR_CHOICE_LIMIT), more: ranked.length > MAJOR_CHOICE_LIMIT };
}

/** The title colleges use for a 4-digit CIP family, or null when no college offers it. */
export async function programTitle(db: Db, cip4: string): Promise<string | null> {
  if (!CIP4_PATTERN.test(cip4)) return null;
  const [row] = await db
    .select({ title: min(collegePrograms.title) })
    .from(collegePrograms)
    .where(eq(collegePrograms.cip4, cip4));
  return row?.title ? cleanTitle(row.title) : null;
}

/**
 * The 4-digit CIP family to search colleges by for a 6-digit major from the careers crosswalk:
 * "11.0701" → "11.07". Accepts a 4-digit code as is. Null for anything else.
 */
export function majorsForCip6(cip6: string): string | null {
  const match = /^(\d{2})\.(\d{2})(\d{2})?$/.exec(cip6.trim());
  return match ? `${match[1]}.${match[2]}` : null;
}

// ---------------------------------------------------------------------------
// URL search params (/colleges?…)
// ---------------------------------------------------------------------------

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const flag = (value: string | string[] | undefined) => ["1", "true", "on", "yes"].includes(first(value)?.toLowerCase() ?? "");
const code = (value: string | string[] | undefined) => {
  const n = Number(first(value));
  return n === 1 || n === 2 || n === 3 ? n : undefined;
};

/** URL parameter names for the boolean filters. */
const FLAG_PARAMS = { hbcu: "hbcu", hispanicServing: "hsi", tribal: "tribal", includeOnlineOnly: "online" } as const;

/**
 * Reads /colleges search params leniently: anything invalid is dropped, never an error.
 * `majorQuery` is the free text typed into the major field (resolved to a CIP family by the page).
 */
export function parseCollegeSearchParams(params: Params): { filters: CollegeSearchFilters; majorQuery: string | null } {
  const filters: CollegeSearchFilters = {};
  const q = first(params.q)?.slice(0, 100);
  if (q) filters.q = q;
  const state = normalizeState(first(params.state));
  if (state) filters.state = state;
  const major = first(params.major);
  if (major && CIP4_PATTERN.test(major)) filters.major = major;
  const credential = code(params.credential);
  if (credential) filters.credential = credential as Credential;
  const control = code(params.control);
  if (control) filters.control = control as Control;
  const size = first(params.size);
  if (SIZES.includes(size as CollegeSize)) filters.size = size as CollegeSize;
  for (const [key, param] of Object.entries(FLAG_PARAMS) as [keyof typeof FLAG_PARAMS, string][]) {
    if (flag(params[param])) filters[key] = true;
  }
  const sort = first(params.sort);
  if (SORTS.includes(sort as CollegeSort) && sort !== "name") filters.sort = sort as CollegeSort;
  const page = Number(first(params.page));
  if (Number.isInteger(page) && page > 1) filters.page = Math.min(page, 10_000);
  const majorQuery = filters.major ? null : (first(params.mq)?.slice(0, 60) ?? null);
  return { filters, majorQuery };
}

/** A /colleges link for these filters, leaving out defaults. */
export function collegeSearchHref(filters: CollegeSearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.state) params.set("state", filters.state);
  if (filters.major) params.set("major", filters.major);
  if (filters.credential) params.set("credential", String(filters.credential));
  if (filters.control) params.set("control", String(filters.control));
  if (filters.size) params.set("size", filters.size);
  for (const [key, param] of Object.entries(FLAG_PARAMS) as [keyof typeof FLAG_PARAMS, string][]) {
    if (filters[key]) params.set(param, "1");
  }
  if (filters.sort && filters.sort !== "name") params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/colleges?${query}` : "/colleges";
}

/** URL parameter names used by the search form. */
export const SEARCH_PARAM_NAMES = { ...FLAG_PARAMS, majorQuery: "mq" } as const;
