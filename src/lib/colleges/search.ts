import {
  type SQL,
  type SQLWrapper,
  and,
  asc,
  count,
  countDistinct,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type NetPriceByIncome, collegePrograms, colleges, majors } from "@/db/schema";
import { cleanTitle } from "./format";
import { isGraduateProgram } from "./graduate";
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
  q: z.string().max(100).optional().describe("Words in the college's name or its city, e.g. 'state university' or 'Austin'"),
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
  // Each word typed in the name box is in the college's name or its city ("austin community").
  for (const word of words(filters.q)) where.push(or(ilike(colleges.name, `%${word}%`), ilike(colleges.city, `%${word}%`)));

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

// ---------------------------------------------------------------------------
// Majors: words a student types → 4-digit CIP families that colleges offer
// ---------------------------------------------------------------------------

/**
 * Colleges report programs by 4-digit CIP family, often under formal titles ("Precision Metal
 * Working" for welding). So we also search the 6-digit CIP titles ("Welding Technology/Welder")
 * and count each hit toward its family.
 */
export type ProgramMatch = {
  /** 4-digit CIP family, e.g. "48.05". */
  cip4: string;
  /** The family's title as colleges report it. */
  title: string;
  /** How many colleges we list (not graduate-only or online-only) offer it. */
  colleges: number;
  /** A major in this family that matched the words typed, when the family's own title didn't. */
  includes?: string;
};

/** Words that say nothing about which major, as in "welding program" or "degree in nursing". */
const FILLER_WORDS = new Set([
  "a", "an", "and", "the", "of", "in", "for", "to", "my", "want", "be", "become",
  "degree", "major", "program", "class", "course", "school", "college", "certificate", "certification",
  "training", "associate", "bachelor", "job", "career",
]);

/**
 * Everyday words and short forms → terms found in CIP titles. Keys are one or two typed words
 * (after plurals are trimmed). Each value lists alternative terms, any of which can match. A term
 * with several words must find them next to each other ("pre medic" matches "Pre-Medicine" but
 * not "Preventive Medicine"); a term ending in "$" must be a whole word ("nurse$" isn't "Nursery").
 */
const SYNONYMS: Record<string, string[]> = {
  nurse: ["nurse$", "nursing"],
  rn: ["registered nursing"],
  bsn: ["registered nursing"],
  lpn: ["practical nursing", "vocational nurse"],
  lvn: ["practical nursing", "vocational nurse"],
  cna: ["nursing assistant"],
  "nurse practitioner": ["registered nursing", "nursing practice"],
  theater: ["theatre", "theater"],
  bio: ["biology", "biological"],
  chem: ["chemistry"],
  auto: ["automotive", "automobile", "autobody"],
  automotive: ["automotive", "automobile", "autobody"],
  car: ["automotive", "automobile", "autobody"],
  mechanic: ["mechanics"],
  "medical assistant": ["medical assisting", "medical clinical assistant"],
  teaching: ["teacher", "teaching"],
  it: ["information technology"],
  cybersecurity: ["cyber", "computer and information systems security"],
  "cyber security": ["cyber", "computer and information systems security"],
  cs: ["computer science"],
  "comp sci": ["computer science"],
  coding: ["coding", "programming"],
  ai: ["artificial intelligence"],
  "video game": ["game"],
  gaming: ["game"],
  premed: ["pre medic"],
  "pre med": ["pre medic"],
  doctor: ["pre medic"],
  medicine: ["pre medic", "medicine"],
  law: ["law", "legal"],
  prelaw: ["pre law"],
  lawyer: ["pre law", "legal"],
  attorney: ["pre law", "legal"],
  // Graduate professions: the pre-professional track first, then related undergraduate programs.
  pharmacist: ["pre pharmacy", "pharmacy", "pharmaceutical"],
  "physical therapist": ["pre physical therapy", "physical therapy"],
  "occupational therapist": ["pre occupational therapy", "occupational therapy"],
  dentist: ["pre dentistry", "dental"],
  veterinarian: ["pre veterinary", "veterinary"],
  vet: ["pre veterinary", "veterinary"],
  psychologist: ["psychology"],
  firefighter: ["fire science", "fire fighting"],
  "police officer": ["police"],
  cdl: ["truck"],
  trucking: ["truck"],
  cooking: ["culinary", "cooking"],
  childcare: ["child care", "early childhood"],
  daycare: ["child care", "early childhood"],
  radiology: ["radiologic", "radiology", "radiography"],
  xray: ["radiologic", "radiography"],
  "x ray": ["radiologic", "radiography"],
  undecided: ["general studies", "liberal arts"],
};

/** Lowercase words without accents or punctuation: "Pre-Med" → ["pre", "med"]. */
function plainWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "nurses" → "nurse". Leaves words like "business", "physics" and "mechanics" alone. */
function singular(word: string): string {
  return word.length >= 4 && word.endsWith("s") && !/(ss|us|is|ics|ous)$/.test(word) ? word.slice(0, -1) : word;
}

type MajorQuery = {
  /** Alternatives, each a list of terms that must all match. */
  alternatives: string[][];
  /** Terms that came from SYNONYMS. */
  synonymTerms: Set<string>;
};

/**
 * What to look for in major titles. A typed word matches the start of any word in the title
 * ("weld" matches "Welding"; "it" doesn't match "Literature"), in any order. Everyday words are
 * swapped for the terms in SYNONYMS.
 */
function parseMajorQuery(text: string): MajorQuery {
  const typed = plainWords(text.slice(0, 100))
    .map(singular)
    .filter((w) => !FILLER_WORDS.has(w))
    .slice(0, 6);
  const segments: string[][] = [];
  const synonymTerms = new Set<string>();
  for (let i = 0; i < typed.length; i++) {
    const pair = SYNONYMS[`${typed[i]} ${typed[i + 1]}`];
    if (pair) i++;
    const options = pair ?? SYNONYMS[typed[i]];
    if (options) {
      segments.push(options);
      for (const term of options) synonymTerms.add(term);
    } else if (typed[i].length > 1) {
      // One-letter words (other than in synonyms like "x ray") would match almost every title.
      segments.push([typed[i]]);
    }
  }
  let alternatives: string[][] = segments.length ? [[]] : [];
  for (const options of segments) {
    alternatives = alternatives.flatMap((alt) => options.map((term) => [...alt, term])).slice(0, 16);
  }
  return { alternatives, synonymTerms };
}

/** Titles compared for an exact match: "Psychology, General." → "psychology". */
function simplify(title: string): string {
  return plainWords(title).join(" ").replace(/ general$/, "");
}

/**
 * A Postgres regex for one term. `\m` is the start of a word and `\M` the end; the words of a
 * phrase may be separated by spaces or punctuation ("fire fighting" matches "Fire-fighting").
 */
function termPattern(term: string): string {
  const words = term.replace(/\$$/, "").split(" ");
  // A short typed word is a whole word (plural allowed): "art" is Art or Arts, not Artificial
  // Intelligence, and "pa" isn't the start of every word beginning with those letters.
  if (!term.endsWith("$") && words.length === 1 && words[0].length <= 3) return `\\m${words[0]}s?\\M`;
  return `\\m${words.join("\\W+")}${term.endsWith("$") ? "\\M" : ""}`;
}

function titleMatches(column: SQLWrapper, alternatives: string[][]): SQL {
  return or(...alternatives.map((terms) => and(...terms.map((t) => sql`${column} ~* ${termPattern(t)}`)))) ?? sql`false`;
}

/** Colleges the search lists by default: not graduate-only and not online-only. */
const LISTED_COLLEGE = and(or(isNull(colleges.predominantDegree), lt(colleges.predominantDegree, 4)), eq(colleges.onlineOnly, false));

/**
 * The 4-digit CIP families that colleges we list offer, of those asked for, with the family's
 * title and how many of those colleges offer it. Families no listed college offers are left out.
 */
export async function offeredFamilies(db: Db, cip4s: Iterable<string>): Promise<Map<string, { title: string; colleges: number }>> {
  const wanted = [...new Set(cip4s)].filter((c) => CIP4_PATTERN.test(c));
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ cip4: collegePrograms.cip4, title: min(collegePrograms.title), colleges: countDistinct(collegePrograms.unitId) })
    .from(collegePrograms)
    .innerJoin(colleges, eq(colleges.unitId, collegePrograms.unitId))
    .where(and(LISTED_COLLEGE, inArray(collegePrograms.cip4, wanted)))
    .groupBy(collegePrograms.cip4);
  return new Map(rows.map((r) => [r.cip4, { title: cleanTitle(r.title ?? r.cip4), colleges: r.colleges }]));
}

/** CIP series 60 and 61 are residencies and fellowships, studied after a graduate degree. */
const RESIDENCY = /^6[01]\./;

type RankedMatch = ProgramMatch & { exact: boolean; strong: boolean };

async function rankPrograms(db: Db, text: string): Promise<RankedMatch[]> {
  if (text.trim().length < 2) return [];
  const { alternatives, synonymTerms } = parseMajorQuery(text);
  if (!alternatives.length) return [];

  // Families whose own title matches. (Matching the few hundred family titles, not every program
  // row, keeps this fast.)
  const familyTitles = db
    .select({ cip4: collegePrograms.cip4, title: min(collegePrograms.title).as("title") })
    .from(collegePrograms)
    .groupBy(collegePrograms.cip4)
    .as("family_titles");
  const titleHits = await db.select({ cip4: familyTitles.cip4 }).from(familyTitles).where(titleMatches(familyTitles.title, alternatives));
  const titleMatched = new Set(titleHits.map((r) => r.cip4));

  // 6-digit majors, lowest code first ("51.3801 Registered Nursing/Registered Nurse" before specialties).
  const specific = await db
    .select({ cipCode: majors.cipCode, title: majors.title })
    .from(majors)
    .where(titleMatches(majors.title, alternatives))
    .orderBy(asc(majors.cipCode));
  const byFamily = new Map<string, string[]>();
  // A graduate program ("Physician Assistant", "Physical Therapy/Therapist") doesn't make its
  // undergraduate family a match: those colleges don't train PAs or therapists.
  for (const m of specific.filter((m) => !isGraduateProgram(m.cipCode))) {
    const cip4 = majorsForCip6(m.cipCode);
    if (cip4) byFamily.set(cip4, [...(byFamily.get(cip4) ?? []), cleanTitle(m.title)]);
  }

  const offered = await offeredFamilies(db, [...titleMatched, ...byFamily.keys()]);
  const wanted = new Set([simplify(text), ...alternatives.map((terms) => simplify(terms.join(" ")))]);
  const leads = [...synonymTerms].map(simplify);
  return [...offered]
    .filter(([cip4]) => !RESIDENCY.test(cip4))
    .map(([cip4, { title, colleges: count }]): RankedMatch => {
      const specificTitles = byFamily.get(cip4) ?? [];
      const ownTitle = titleMatched.has(cip4);
      // A major whose title starts with a synonym's term ("Pre-Medicine/Pre-Medical Studies" for
      // "doctor") says more than one that has a typed word in passing ("Hyperbaric Medicine").
      const leading = specificTitles.find((t) => leads.some((lead) => simplify(t).startsWith(lead)));
      return {
        cip4,
        title,
        colleges: count,
        ...(ownTitle || !specificTitles.length ? {} : { includes: leading ?? specificTitles[0] }),
        exact: [title, ...specificTitles].some((t) => wanted.has(simplify(t))),
        strong: ownTitle || Boolean(leading),
      };
    })
    .sort(
      (a, b) =>
        Number(b.strong) - Number(a.strong) || b.colleges - a.colleges || a.title.localeCompare(b.title) || a.cip4.localeCompare(b.cip4),
    );
}

const toMatch = ({ exact: _exact, strong: _strong, ...match }: RankedMatch): ProgramMatch => match;

/**
 * Majors (4-digit CIP families) matching the words typed. A family matches when its own title or
 * one of its 6-digit majors' titles has every word. Families whose own title matches (or with a
 * major whose title starts with a synonym's term, like "Pre-Medicine" for "doctor") come first,
 * then the ones most colleges offer.
 */
export async function findPrograms(db: Db, text: string, limit = 10): Promise<ProgramMatch[]> {
  return (await rankPrograms(db, text)).slice(0, limit).map(toMatch);
}

/**
 * Like findPrograms, but only the strong matches (the family's own title matches, or a major's title
 * starts with a synonym) when there are any, for checking whether one college offers a major.
 */
export async function findStrongPrograms(db: Db, text: string, limit = 10): Promise<ProgramMatch[]> {
  const ranked = await rankPrograms(db, text);
  const strong = ranked.filter((m) => m.strong);
  return (strong.length ? strong : ranked).slice(0, limit).map(toMatch);
}

export type MajorQueryResult =
  | { kind: "match"; major: ProgramMatch }
  | { kind: "choices"; choices: ProgramMatch[]; more: boolean }
  | { kind: "none" };

/** How many majors to offer when typed words match several. */
export const MAJOR_CHOICE_LIMIT = 10;

/**
 * Turns words typed into the major field into one major, or a short list to pick from (see
 * findPrograms for the order). It picks one major only when nothing else matches, or when a title
 * is exactly what was typed and no other match is offered at more colleges. So "nursing" asks
 * between Registered Nursing and Practical Nursing instead of picking the little-used "Nursing"
 * family, but "psychology" goes straight to "Psychology, General".
 */
export async function resolveMajorQuery(db: Db, text: string): Promise<MajorQueryResult> {
  const ranked = await rankPrograms(db, text);
  if (!ranked.length) return { kind: "none" };
  const most = Math.max(...ranked.map((m) => m.colleges));
  const exact = ranked.find((m) => m.exact && m.colleges === most);
  if (ranked.length === 1 || exact) return { kind: "match", major: toMatch(exact ?? ranked[0]) };
  return { kind: "choices", choices: ranked.slice(0, MAJOR_CHOICE_LIMIT).map(toMatch), more: ranked.length > MAJOR_CHOICE_LIMIT };
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
