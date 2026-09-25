/**
 * Checks the course planner's rule content (src/content/planner/) before it ships:
 *
 *   npm run check:rules                   # schema, citations, strength words, saved copies, staleness, diff vs HEAD
 *   npm run check:rules -- --base v2      # summarize what changed since another git revision
 *   npm run check:rules -- --live         # also fetch each source page and look for its quotes (drift is a warning)
 *   npm run check:rules -- --no-db        # skip the UNITID and CIP checks against the database
 *
 * 1. Every file parses against the contracts' schema and passes the cross-file validator (ids,
 *    citations, cohort coverage for the classes of 2027-2034, the 256-alternative cap, reviewed
 *    fingerprints). Failures exit 1.
 * 2. Every requirement, check, condition, warning, test route, information card, fact, family line
 *    and rigor line cites a source quote with an https link. Failures exit 1.
 * 3. Strength words are backed by their quotes ("strongly encouraged" must say "strongly").
 * 4. Each quote appears in the saved copy of its source, .data/course-rules-verified/<dir>/<KEY>.txt
 *    (kept outside git, like .data/aid-guide-verified/). A quote missing from its saved copy exits
 *    1; sources with no saved copy are listed.
 * 5. Staleness: files and rule sets past, or within 60 days of, their check date are warnings.
 *    Dates never fail this check, so safety fixes can always deploy.
 * 6. With a database (DATABASE_URL, or an existing PGlite folder at PGLITE_DATA_DIR after
 *    `npm run data:load`): every UNITID the content names is in `colleges` (else exit 1), and every
 *    CIP routing prefix matches a loaded major (else a warning).
 * 7. A summary of what changed in each file since the base revision (default HEAD), so reviewers
 *    see which rule sets need a fresh counselor review.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PLANNER_CONTENT_DIR, PLANNER_CONTENT_FILES, VERIFIED_SOURCES_DIR } from "../src/lib/planner/content-files";
import { checkQuotes, citationCoverageIssues, diffSummary, stalenessWarnings, strengthWordIssues } from "../src/lib/planner/content-check";
import { quoteAppears } from "../src/lib/planner/quotes";
import { contentFingerprint } from "../src/lib/planner/review";
import { type RawContent, validateContent, type ValidatedContent } from "../src/lib/planner/validate";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const errors: string[] = [];
const warnings: string[] = [];
const section = (title: string) => console.log(`\n== ${title}`);

// 1. Parse and validate ---------------------------------------------------------------------------

const rawByLabel = new Map<string, Record<string, unknown>>();
for (const { label } of PLANNER_CONTENT_FILES) {
  const file = path.join(PLANNER_CONTENT_DIR, label);
  try {
    rawByLabel.set(label, JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    errors.push(`${label}: can't read it as JSON (${(e as Error).message}).`);
  }
}
const onDisk = ["ut", "tn", "tx", "major-prep"].flatMap((dir) =>
  existsSync(path.join(PLANNER_CONTENT_DIR, dir)) ? readdirSync(path.join(PLANNER_CONTENT_DIR, dir)).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [],
);
for (const label of onDisk) if (!PLANNER_CONTENT_FILES.some((f) => f.label === label)) errors.push(`${label} isn't listed in src/lib/planner/content-files.ts, so nothing loads it.`);

const raw: RawContent = { rules: [], genericCatalogs: [], facts: [] };
for (const { label, group } of PLANNER_CONTENT_FILES) {
  const value = rawByLabel.get(label);
  if (value === undefined) continue;
  if (group === "rules" || group === "genericCatalogs" || group === "facts") raw[group].push({ label, raw: value });
  else raw[group] = { label, raw: value };
}
const result = validateContent(raw);
section("Schema and cross-file checks");
if (result.ok) console.log(`OK: ${PLANNER_CONTENT_FILES.length} files.`);
else errors.push(...result.issues);
warnings.push(...result.warnings);

if (!result.ok) finish();
const content = (result as { content: ValidatedContent }).content;

// Summary table.
const rows = [
  ...content.rules.map((f) => ({
    id: f.id,
    what: `${f.ruleSets.length} rule sets, ${f.ruleSets.reduce((n, r) => n + r.variants.length, 0)} variants, ${f.infoCards?.length ?? 0} cards`,
    file: f,
  })),
  ...content.genericCatalogs.map((f) => ({ id: f.id, what: `${f.courses.length} course types`, file: f })),
  ...content.facts.map((f) => ({ id: f.id, what: `${f.options.length} options, ${f.terms?.length ?? 0} terms`, file: f })),
  ...(content.families ? [{ id: content.families.id, what: `${content.families.families.length} families`, file: content.families }] : []),
  ...(content.cipRouting ? [{ id: content.cipRouting.id, what: `${content.cipRouting.rules.length} routing rules`, file: content.cipRouting }] : []),
  ...(content.rigor ? [{ id: content.rigor.id, what: `${content.rigor.tiers.length} tiers, ${content.rigor.guardrails.length} guardrails`, file: content.rigor }] : []),
];
for (const r of rows) {
  console.log(`  ${r.id.padEnd(28)} ${r.file.review.status.padEnd(19)} ${contentFingerprint(r.file)}  ${r.file.citations.length} quotes; ${r.what}`);
}

// 2-3. Citations and strength words ------------------------------------------------------------------

section("Every requirement cites a quote and a source link");
const coverage = citationCoverageIssues(content);
if (coverage.issues.length) errors.push(...coverage.issues);
else console.log(`OK: ${coverage.statements} statements cite a quote with an https source.`);
const strength = strengthWordIssues(content.rules);
if (strength.length) errors.push(...strength);
else console.log("OK: every strength word is backed by its quote.");

// 4. Saved copies ---------------------------------------------------------------------------------------

section("Quotes against the saved source copies");
const sourcesDir = option("--sources", VERIFIED_SOURCES_DIR);
const copyCache = new Map<string, string | null>();
const copyFor = (key: string) => {
  if (!copyCache.has(key)) {
    const dirs = existsSync(sourcesDir) ? readdirSync(sourcesDir) : [];
    const hit = dirs.map((d) => path.join(sourcesDir, d, `${key}.txt`)).find((p) => existsSync(p));
    copyCache.set(key, hit ? readFileSync(hit, "utf8") : null);
  }
  return copyCache.get(key)!;
};
const quotes = checkQuotes(content, copyFor);
console.log(`${quotes.checked} quotes checked against saved copies in ${sourcesDir}; ${quotes.noCopy.length} with no saved copy.`);
for (const q of quotes.notFound) errors.push(`Quote not found in its saved source: ${q}`);
if (quotes.noCopy.length) warnings.push(`No saved copy for ${quotes.noCopy.length} quote(s), so they weren't checked: ${quotes.noCopy.slice(0, 10).join(", ")}${quotes.noCopy.length > 10 ? ", …" : ""}`);

// 5. Staleness ----------------------------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
warnings.push(...stalenessWarnings(content, today));

// 6-7. Database, live sources and diff (async) --------------------------------------------------------------

async function main() {
  await databaseChecks();
  if (flag("--live")) await liveChecks();
  diff();
  finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function databaseChecks() {
  section("UNITIDs and CIP prefixes against the database");
  if (flag("--no-db")) return console.log("Skipped (--no-db).");
  const pgliteDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  if (!process.env.DATABASE_URL && !existsSync(pgliteDir)) return console.log(`Skipped: no DATABASE_URL and no database at ${pgliteDir}. Run \`npm run data:load\` first.`);
  const { getDb } = await import("../src/db");
  const { colleges, majors } = await import("../src/db/schema");
  const { count: countRows, inArray } = await import("drizzle-orm");
  const db = await getDb();

  const unitIds = new Set<number>();
  for (const f of content.rules) {
    for (const rs of f.ruleSets) for (const id of rs.appliesWhen.colleges ?? []) unitIds.add(id);
    for (const c of f.infoCards ?? []) if (c.unitId) unitIds.add(c.unitId);
  }
  for (const fam of content.families?.families ?? []) for (const g of fam.gates) for (const id of g.colleges ?? []) unitIds.add(id);
  for (const r of content.rigor?.raises ?? []) for (const id of r.colleges) unitIds.add(id);
  const [{ n }] = await db.select({ n: countRows() }).from(colleges);
  if (!n) console.log("Colleges table is empty; run `npm run data:load` to check UNITIDs.");
  else {
    const found = await db.select({ unitId: colleges.unitId, name: colleges.name }).from(colleges).where(inArray(colleges.unitId, [...unitIds]));
    const known = new Set(found.map((r) => r.unitId));
    const missing = [...unitIds].filter((id) => !known.has(id));
    for (const id of missing) errors.push(`UNITID ${id} isn't in the colleges table.`);
    if (!missing.length) console.log(`OK: all ${unitIds.size} UNITIDs are loaded colleges.`);
  }

  const cips = (await db.select({ cip: majors.cipCode }).from(majors)).map((r) => r.cip);
  if (!cips.length) console.log("Majors table is empty; run `npm run data:load` to check CIP prefixes.");
  else {
    const prefixes = (content.cipRouting?.rules ?? []).flatMap((r) => r.match);
    const unmatched = prefixes.filter((p) => !cips.some((c) => c.startsWith(p)));
    for (const p of unmatched) warnings.push(`CIP routing prefix ${p} matches no loaded major.`);
    console.log(`${prefixes.length - unmatched.length} of ${prefixes.length} CIP routing prefixes match loaded majors.`);
  }
}

async function liveChecks() {
  section("Quotes against the live source pages (--live)");
  const byUrl = new Map<string, { id: string; quote: string }[]>();
  const files = [...content.rules, ...content.genericCatalogs, ...content.facts, ...(content.families ? [content.families] : []), ...(content.rigor ? [content.rigor] : [])];
  for (const f of files) {
    for (const c of f.citations) {
      const url = f.sources[c.source].url;
      const list = byUrl.get(url) ?? [];
      if (!list.some((q) => q.id === c.id)) list.push({ id: c.id, quote: c.quote });
      byUrl.set(url, list);
    }
  }
  let ok = 0;
  for (const [url, list] of byUrl) {
    if (/\.pdf($|\?)/i.test(url)) {
      console.log(`  skip (PDF, check by hand): ${url}`);
      continue;
    }
    try {
      const res = await fetch(url, { headers: { "user-agent": "College Compass rules check" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        warnings.push(`${url} answered ${res.status}.`);
        continue;
      }
      const text = (await res.text()).replace(/<[^>]+>/g, " ");
      for (const q of list) {
        if (quoteAppears(q.quote, text)) ok++;
        else warnings.push(`Drift: ${q.id} no longer appears at ${url}.`);
      }
    } catch (e) {
      warnings.push(`${url} couldn't be fetched (${(e as Error).message}).`);
    }
  }
  console.log(`${ok} quotes still appear on their live pages.`);
}

function diff() {
  const base = option("--base", "HEAD");
  section(`Changes since ${base}`);
  const files = PLANNER_CONTENT_FILES.flatMap(({ label }) => {
    const after = rawByLabel.get(label);
    if (!after) return [];
    let before: Record<string, unknown> | null = null;
    try {
      before = JSON.parse(execFileSync("git", ["show", `${base}:${PLANNER_CONTENT_DIR}/${label}`], { stdio: ["ignore", "pipe", "ignore"] }).toString());
    } catch {
      before = null;
    }
    return [{ label, before, after }];
  });
  const lines = diffSummary(files);
  console.log(lines.length ? lines.map((l) => `  ${l}`).join("\n") : "  No content changes.");
}

function finish(): never {
  if (warnings.length) {
    section(`Warnings (${warnings.length})`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length) {
    section(`Problems (${errors.length})`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log("\ncheck:rules passed.");
  process.exit(0);
}
