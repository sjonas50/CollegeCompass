/**
 * Phase 3 exit check: our loaded College Scorecard data matches the live College Scorecard API
 * for a set of real schools of every kind. Compares institution fields (name, state, net price
 * overall and by family income, cost of attendance, tuition, completion rate, earnings, Pell
 * share, enrollment, and a few more) and, for three programs per school, the field-of-study
 * median earnings and median debt. Run after `npm run data:load`:
 *
 *   npm run data:check-scorecard             # reuses today's API response if there is one
 *   npm run data:check-scorecard -- --refresh
 *
 * Uses SCORECARD_API_KEY (free from https://api.data.gov/signup/) or the shared DEMO_KEY, which
 * allows only a handful of requests per hour. All schools are fetched in one request, requesting
 * only the fields compared here; the response is cached in .data/ for a day.
 *
 * Exits 1 on any mismatch. API field names come from the official data dictionary
 * (https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx): the
 * "developer-friendly name", prefixed with "latest." for time-varying fields.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { collegePrograms, colleges, type NetPriceByIncome } from "../src/db/schema";

type ApiResult = Record<string, unknown>;
type College = typeof colleges.$inferSelect;
type Program = typeof collegePrograms.$inferSelect;

const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
const CACHE_FILE = path.join(".data", "scorecard-api-check.json");
const CACHE_HOURS = 24;

/** Real schools covering every kind of college we show. `expect` confirms the pick against the API. */
const CASES: { unitId: number; kind: string; expect: (r: ApiResult) => boolean }[] = [
  { unitId: 204796, kind: "large public university", expect: (r) => r["school.ownership"] === 1 && Number(r["latest.student.size"]) > 30000 },
  { unitId: 156295, kind: "small private nonprofit college", expect: (r) => r["school.ownership"] === 2 && Number(r["latest.student.size"]) < 3000 },
  { unitId: 484613, kind: "for-profit university", expect: (r) => r["school.ownership"] === 3 },
  { unitId: 209746, kind: "community college", expect: (r) => r["school.ownership"] === 1 && r["school.degrees_awarded.predominant"] === 2 },
  {
    unitId: 221102,
    kind: "public program-year trade school (certificates)",
    expect: (r) => r["school.degrees_awarded.predominant"] === 1 && r["latest.cost.attendance.program_year"] != null,
  },
  {
    unitId: 486813,
    kind: "for-profit program-year certificate school",
    expect: (r) => r["school.ownership"] === 3 && r["latest.cost.attendance.program_year"] != null,
  },
  { unitId: 131520, kind: "HBCU", expect: (r) => r["school.minority_serving.historically_black"] === 1 },
  { unitId: 228796, kind: "Hispanic-serving institution", expect: (r) => r["school.minority_serving.hispanic"] === 1 },
  { unitId: 180647, kind: "tribal college", expect: (r) => r["school.minority_serving.tribal"] === 1 },
  { unitId: 433387, kind: "online-only university", expect: (r) => r["school.online_only"] === 1 },
  {
    unitId: 166683,
    kind: "highly selective college",
    expect: (r) => Number(r["latest.admissions.admission_rate.overall"]) < 0.1,
  },
  {
    unitId: 154022,
    kind: "public university that reported net price as a private school (control changed)",
    expect: (r) => r["school.ownership"] === 1 && r["latest.cost.avg_net_price.public"] == null && r["latest.cost.avg_net_price.private"] != null,
  },
];

const BANDS: (keyof NetPriceByIncome)[] = ["0-30000", "30001-48000", "48001-75000", "75001-110000", "110001-plus"];
// Net price families in the order we read them (see netPriceSuffixes in src/lib/reference/parsers.ts).
const AVG_NET_PRICE = { PUB: "public", PRIV: "private", PROG: "program_year", OTHER: "other_academic_year" } as const;
const NET_PRICE_BY_INCOME = { PUB: "public", PRIV: "private", PROG: "program_reporter", OTHER: "other_acad_calendar" } as const;
const PROGRAMS = "latest.programs.cip_4_digit";

const FIELDS = [
  "id",
  "school.name",
  "school.state",
  "school.zip",
  "school.ownership",
  "school.degrees_awarded.predominant",
  "school.minority_serving.historically_black",
  "school.minority_serving.hispanic",
  "school.minority_serving.tribal",
  "school.online_only",
  "latest.admissions.admission_rate.overall",
  ...Object.values(AVG_NET_PRICE).map((f) => `latest.cost.avg_net_price.${f}`),
  ...Object.values(NET_PRICE_BY_INCOME).flatMap((f) => BANDS.map((b) => `latest.cost.net_price.${f}.by_income_level.${b}`)),
  "latest.cost.attendance.academic_year",
  "latest.cost.attendance.program_year",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.completion.completion_rate_4yr_150nt",
  "latest.completion.completion_rate_less_than_4yr_150nt",
  "latest.earnings.10_yrs_after_entry.median",
  "latest.aid.pell_grant_rate",
  "latest.aid.median_debt.completers.overall",
  "latest.student.size",
  `${PROGRAMS}.code`,
  `${PROGRAMS}.title`,
  `${PROGRAMS}.credential.level`,
  `${PROGRAMS}.earnings.4_yr.overall_median_earnings`,
  `${PROGRAMS}.debt.staff_grad_plus.all.eval_inst.median`,
];

// ---------------------------------------------------------------------------
// Scorecard API
// ---------------------------------------------------------------------------

function requestUrl(ids: number[]) {
  const params = new URLSearchParams({ id: ids.join(","), per_page: "100", fields: FIELDS.join(",") });
  return `${API}?${params}`;
}

async function fetchResults(ids: number[]): Promise<ApiResult[]> {
  const key = process.env.SCORECARD_API_KEY || "DEMO_KEY";
  const res = await fetch(`${requestUrl(ids)}&api_key=${encodeURIComponent(key)}`);
  if (res.status === 429) {
    throw new Error(
      `College Scorecard API rate limit reached${key === "DEMO_KEY" ? " for DEMO_KEY (a few requests per hour)" : ""}. ` +
        "Try again later, or get a free key at https://api.data.gov/signup/ and set SCORECARD_API_KEY.",
    );
  }
  if (!res.ok) throw new Error(`College Scorecard API: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) console.log(`(API requests left this hour for this key: ${remaining})`);
  const body = (await res.json()) as { results?: ApiResult[] };
  return body.results ?? [];
}

type Cache = { url: string; fetchedAt: string; results: ApiResult[] };

/** One request for every school; any school it misses gets one request of its own. */
async function loadApiResults(refresh: boolean) {
  const ids = CASES.map((c) => c.unitId);
  const url = requestUrl(ids);
  if (!refresh && existsSync(CACHE_FILE)) {
    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Cache;
    const ageHours = (Date.now() - Date.parse(cache.fetchedAt)) / 3_600_000;
    if (cache.url === url && ageHours < CACHE_HOURS) {
      console.log(`Using the College Scorecard API response from ${cache.fetchedAt} (pass --refresh to fetch again).`);
      return cache.results;
    }
  }
  console.log(`Fetching ${ids.length} schools from the College Scorecard API…`);
  const results = await fetchResults(ids);
  const missing = ids.filter((id) => !results.some((r) => r.id === id));
  for (const id of missing) results.push(...(await fetchResults([id])));
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify({ url, fetchedAt: new Date().toISOString(), results } satisfies Cache));
  return results;
}

// ---------------------------------------------------------------------------
// What College Scorecard says, in our terms
// ---------------------------------------------------------------------------

const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The school's own sector first, then the other sector, then the discontinued program-year and other-calendar fields. */
function netPriceFamilies(ownership: unknown) {
  return ownership === 1 ? (["PUB", "PRIV", "PROG", "OTHER"] as const) : (["PRIV", "PUB", "PROG", "OTHER"] as const);
}

function firstNumber(r: ApiResult, fields: string[]) {
  for (const f of fields) {
    const v = numberOrNull(r[f]);
    if (v !== null) return v;
  }
  return null;
}

function apiNetPrice(r: ApiResult) {
  const families = netPriceFamilies(r["school.ownership"]);
  return {
    average: firstNumber(r, families.map((f) => `latest.cost.avg_net_price.${AVG_NET_PRICE[f]}`)),
    bands: Object.fromEntries(
      BANDS.map((b) => [b, firstNumber(r, families.map((f) => `latest.cost.net_price.${NET_PRICE_BY_INCOME[f]}.by_income_level.${b}`))]),
    ) as Record<keyof NetPriceByIncome, number | null>,
  };
}

type ApiProgram = { cip4: string; title: string; level: number; earnings: number | null; debt: number | null };

function apiPrograms(r: ApiResult): ApiProgram[] {
  const list = Array.isArray(r[PROGRAMS]) ? (r[PROGRAMS] as Record<string, unknown>[]) : [];
  const get = (o: unknown, keys: string[]) => keys.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
  return list.map((p) => {
    const code = String(p.code ?? "");
    return {
      cip4: `${code.slice(0, 2)}.${code.slice(2)}`,
      title: String(p.title ?? "").replace(/\.+$/, "").trim(),
      level: Number(get(p, ["credential", "level"])),
      earnings: numberOrNull(get(p, ["earnings", "4_yr", "overall_median_earnings"])),
      debt: numberOrNull(get(p, ["debt", "staff_grad_plus", "all", "eval_inst", "median"])),
    };
  });
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

type Kind = "text" | "money" | "count" | "rate" | "flag";
type Check = { field: string; ours: unknown; theirs: unknown; kind: Kind; ok: boolean };

function same(kind: Kind, ours: unknown, theirs: unknown) {
  if (ours == null || theirs == null) return ours == null && theirs == null;
  // Rates are stored as 32-bit reals; Scorecard publishes them to 4 decimal places.
  if (kind === "rate") return Math.abs(Number(ours) - Number(theirs)) < 0.00005;
  return ours === theirs;
}

function show(kind: Kind, v: unknown) {
  if (v == null) return "(none)";
  if (typeof v === "string") return v;
  if (kind === "money") return `${Number(v) < 0 ? "-" : ""}$${Math.abs(Number(v)).toLocaleString("en-US")}`;
  if (kind === "count") return Number(v).toLocaleString("en-US");
  if (kind === "rate") return Number(v).toFixed(4);
  return String(v);
}

/** Three programs to compare: those with the most published numbers first, bachelor's before shorter credentials. */
function pickPrograms(programs: Program[]) {
  const published = (p: Program) => Number(p.medianDebt !== null) + Number(p.medianEarnings4yr !== null);
  return [...programs]
    .sort((a, b) => published(b) - published(a) || b.credentialLevel - a.credentialLevel || a.cip4.localeCompare(b.cip4))
    .slice(0, 3);
}

function compareSchool(ours: College | undefined, programs: Program[], theirs: ApiResult | undefined, expect: (r: ApiResult) => boolean) {
  const checks: Check[] = [];
  const add = (field: string, kind: Kind, a: unknown, b: unknown) => checks.push({ field, kind, ours: a, theirs: b, ok: same(kind, a, b) });
  if (!ours || !theirs) {
    add("school found", "text", ours ? "yes" : "no (run npm run data:load)", theirs ? "yes" : "no");
    checks[0].ok = false;
    return checks;
  }
  checks.push({ field: "right kind of school", kind: "text", ours: "-", theirs: expect(theirs) ? "yes" : "no", ok: expect(theirs) });
  add("name", "text", ours.name, theirs["school.name"]);
  add("state", "text", ours.state, theirs["school.state"]);
  add("ZIP", "text", ours.zip, typeof theirs["school.zip"] === "string" ? theirs["school.zip"].slice(0, 5) : null);
  add("control", "count", ours.control, theirs["school.ownership"]);
  const np = apiNetPrice(theirs);
  add("avg net price", "money", ours.avgNetPrice, np.average);
  for (const b of BANDS) add(`net price ${b}`, "money", ours.netPriceByIncome?.[b] ?? null, np.bands[b]);
  add(
    "cost of attendance",
    "money",
    ours.costOfAttendance,
    numberOrNull(theirs["latest.cost.attendance.academic_year"]) ?? numberOrNull(theirs["latest.cost.attendance.program_year"]),
  );
  add("tuition in-state", "money", ours.tuitionInState, theirs["latest.cost.tuition.in_state"]);
  add("tuition out-of-state", "money", ours.tuitionOutOfState, theirs["latest.cost.tuition.out_of_state"]);
  add(
    "completion rate",
    "rate",
    ours.completionRate,
    numberOrNull(theirs["latest.completion.completion_rate_4yr_150nt"]) ??
      numberOrNull(theirs["latest.completion.completion_rate_less_than_4yr_150nt"]),
  );
  add("median earnings 10yr", "money", ours.medianEarnings10yr, theirs["latest.earnings.10_yrs_after_entry.median"]);
  add("Pell share", "rate", ours.pellShare, theirs["latest.aid.pell_grant_rate"]);
  add("undergrad enrollment", "count", ours.enrollment, theirs["latest.student.size"]);
  add("median debt (completers)", "money", ours.medianDebt, theirs["latest.aid.median_debt.completers.overall"]);
  add("admission rate", "rate", ours.admissionRate, theirs["latest.admissions.admission_rate.overall"]);
  add("HBCU", "flag", ours.hbcu, theirs["school.minority_serving.historically_black"] === 1);
  add("Hispanic-serving", "flag", ours.hispanicServing, theirs["school.minority_serving.hispanic"] === 1);
  add("tribal", "flag", ours.tribal, theirs["school.minority_serving.tribal"] === 1);
  add("online only", "flag", ours.onlineOnly, theirs["school.online_only"] === 1);

  const apiUndergrad = apiPrograms(theirs).filter((p) => p.level >= 1 && p.level <= 3);
  add("undergrad programs", "count", programs.length, apiUndergrad.length);
  for (const p of pickPrograms(programs)) {
    const label = `${p.cip4} level ${p.credentialLevel}`;
    const match = apiUndergrad.find((a) => a.cip4 === p.cip4 && a.level === p.credentialLevel);
    add(`${label} title`, "text", p.title, match?.title ?? null);
    add(`${label} earnings 4yr`, "money", p.medianEarnings4yr, match ? match.earnings : "(not in API)");
    add(`${label} median debt`, "money", p.medianDebt, match ? match.debt : "(not in API)");
  }
  return checks;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const ids = CASES.map((c) => c.unitId);
  const db = await getDb();
  const ourColleges = await db.select().from(colleges).where(inArray(colleges.unitId, ids));
  const ourPrograms = await db.select().from(collegePrograms).where(inArray(collegePrograms.unitId, ids));
  if (ourColleges.length === 0) throw new Error("No colleges loaded. Run `npm run data:load` first.");
  const results = await loadApiResults(refresh);

  const summary: { school: string; kind: string; checks: number; mismatches: number }[] = [];
  for (const c of CASES) {
    const ours = ourColleges.find((x) => x.unitId === c.unitId);
    const theirs = results.find((r) => r.id === c.unitId);
    const checks = compareSchool(ours, ourPrograms.filter((p) => p.unitId === c.unitId), theirs, c.expect);
    const name = ours?.name ?? String(theirs?.["school.name"] ?? "unknown");
    console.log(`\n${name} (${c.unitId}): ${c.kind}`);
    console.log(`  ${"".padEnd(9)}${"field".padEnd(28)}${"ours".padEnd(38)}Scorecard API`);
    for (const k of checks) {
      console.log(
        `  ${(k.ok ? "ok" : "MISMATCH").padEnd(9)}${k.field.padEnd(28)}${show(k.kind, k.ours).slice(0, 36).padEnd(38)}${show(k.kind, k.theirs).slice(0, 36)}`,
      );
    }
    summary.push({ school: `${name} (${c.unitId})`, kind: c.kind, checks: checks.length, mismatches: checks.filter((k) => !k.ok).length });
  }

  const total = summary.reduce((n, s) => n + s.checks, 0);
  const failed = summary.reduce((n, s) => n + s.mismatches, 0);
  console.log(`\n${"school".padEnd(64)}${"checks".padStart(7)}${"mismatches".padStart(12)}`);
  for (const s of summary) console.log(`${s.school.slice(0, 62).padEnd(64)}${String(s.checks).padStart(7)}${String(s.mismatches).padStart(12)}`);
  console.log(`\n${total - failed}/${total} values match College Scorecard across ${summary.length} schools.`);
  console.log(
    [
      "Notes on comparing the API with the downloaded files:",
      "- Rates are stored as 32-bit reals, so they're compared to 4 decimal places (Scorecard's published precision).",
      "- The API returns ZIP+4 when the file has it; we keep the 5-digit ZIP.",
      '- The files mark missing values "NA" and privacy-suppressed ones "PS"; the API returns null for both, and so do we.',
      "- Net price uses the school's own sector (public or private) first, then the other sector, then the discontinued",
      "  program-year and other-calendar fields, on both sides. Values can be negative when grants exceed the cost.",
      "- API program titles end with a period and include graduate credentials; we strip the period and keep levels 1-3.",
      "- The API serves the newest Scorecard release. If it's newer than the files in SOURCES (scripts/load-reference.ts),",
      "  update those URLs and reload before treating a mismatch as a bug.",
    ].join("\n"),
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
