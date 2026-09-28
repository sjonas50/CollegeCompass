/**
 * Downloads and loads public reference data: O*NET occupations, interest profiles and work styles
 * (31.0; work styles are AI/Expert ratings, see src/lib/reference/work-styles.ts), the O*NET 30.0
 * work values (dropped from 31.0), the NCES CIP–SOC crosswalk (majors ↔ careers), College
 * Scorecard institutions and their undergraduate programs (field-of-study data), and every school
 * teaching grades 7–12: public schools from the NCES Common Core of Data (CCD) school directory
 * and characteristics files, private schools from the NCES Private School Universe Survey (PSS).
 *
 *   npm run data:load            # downloads into .data/reference (cached) and loads
 *
 * Replaces the reference tables wholesale in one transaction. Requires the `unzip` command.
 */
import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { parse } from "csv-parse";
import { readSheet } from "read-excel-file/node";
import { getDb, migrateDb } from "../src/db";
import {
  cipSocLinks,
  collegePrograms,
  colleges,
  majors,
  occupationInterests,
  occupationValues,
  occupationWorkStyles,
  occupations,
  schools,
} from "../src/db/schema";
import {
  collectCollegePrograms,
  collectWorkStyles,
  parseCipMajor,
  parseCipSoc,
  parseCollege,
  parseJobZone,
  parseOccupation,
  parseOccupationInterest,
  parseOccupationValue,
  parseWorkStyle,
  withLeadInterests,
} from "../src/lib/reference/parsers";
import { parseCcdSchool, parsePssSchool } from "../src/lib/reference/schools";

const DIR = ".data/reference";
const ONET = "https://www.onetcenter.org/dl_files/database/db_31_0_csv";
const SOURCES = {
  occupations: `${ONET}/occupation_data.csv`,
  jobZones: `${ONET}/job_zones.csv`,
  interests: `${ONET}/career_interest_types.csv`,
  workStyles: `${ONET}/work_styles.csv`,
  workValues: "https://www.onetcenter.org/dl_files/database/db_30_0_text/Work%20Values.txt",
  crosswalk: "https://nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx",
  scorecard: "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip",
  fieldOfStudy: "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_06102026.zip",
  // NCES school files (public domain; Latin-1 CSV). Moving to a new release: change these and
  // SCHOOL_RELEASES in src/lib/reference/schools.ts together.
  ccdDirectory: "https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip",
  ccdCharacteristics: "https://nces.ed.gov/ccd/Data/zip/ccd_sch_129_2425_w_1a_073025.zip",
  pss: "https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip",
};

async function download(url: string): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, path.basename(new URL(url).pathname));
  if (existsSync(file)) return file;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function* csvRows(input: Readable, delimiter = ",", encoding: BufferEncoding = "utf8") {
  yield* input.pipe(
    parse({ columns: true, bom: true, relax_column_count: true, delimiter, quote: delimiter === "\t" ? false : '"', encoding }),
  ) as AsyncIterable<Record<string, string>>;
}

async function collect<T>(input: Readable, map: (row: Record<string, string>) => T | null, delimiter = ",", encoding: BufferEncoding = "utf8") {
  const out: T[] = [];
  for await (const row of csvRows(input, delimiter, encoding)) {
    const value = map(row);
    if (value !== null) out.push(value);
  }
  return out;
}

async function csvFromZip(zipFile: string): Promise<Readable> {
  const { stdout } = await promisify(execFile)("unzip", ["-Z1", zipFile]);
  const entry = stdout.split("\n").find((n) => n.endsWith(".csv") && !n.startsWith("__MACOSX"));
  if (!entry) throw new Error(`No CSV in ${zipFile}`);
  return spawn("unzip", ["-p", zipFile, entry]).stdout;
}

function chunks<T>(items: T[], size = 1000) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const files = Object.fromEntries(
    await Promise.all(Object.entries(SOURCES).map(async ([k, url]) => [k, await download(url)])),
  ) as Record<keyof typeof SOURCES, string>;

  const zones = new Map(await collect(createReadStream(files.jobZones), parseJobZone));
  const occupationRows = (await collect(createReadStream(files.occupations), parseOccupation)).map((o) => ({
    ...o,
    jobZone: zones.get(o.code) ?? null,
  }));
  const codes = new Set(occupationRows.map((o) => o.code));
  // With each occupation's leading areas marked, for browsing careers by interest area.
  const interestRows = withLeadInterests(
    (await collect(createReadStream(files.interests), parseOccupationInterest)).filter((r) => codes.has(r.occupationCode)),
  );

  const valueRows = (await collect(createReadStream(files.workValues), parseOccupationValue, "\t")).filter((r) =>
    codes.has(r.occupationCode),
  );
  const workStyleRows = collectWorkStyles(await collect(createReadStream(files.workStyles), parseWorkStyle)).filter((r) =>
    codes.has(r.occupationCode),
  );

  const sheet = await readSheet(files.crosswalk, "CIP-SOC");
  const [header, ...body] = sheet;
  const sheetRows = body.map((cells) =>
    Object.fromEntries(header.map((h, i) => [String(h), cells[i] == null ? undefined : String(cells[i])])),
  );
  // Every major, including those with no matching occupation (for major search), and the links.
  const majorRows = [...new Map(sheetRows.map(parseCipMajor).filter((r) => r !== null).map((r) => [r.cipCode, r])).values()];
  const crosswalk = sheetRows.map(parseCipSoc).filter((r) => r !== null);
  const linkRows = [...new Map(crosswalk.map((r) => [`${r.cipCode}|${r.socCode}`, { cipCode: r.cipCode, socCode: r.socCode }])).values()];

  const collegeRows = await collect(await csvFromZip(files.scorecard), parseCollege);
  // ~228k rows: streamed, keeping only parsed undergraduate programs at the colleges above.
  const programRows = await collectCollegePrograms(csvRows(await csvFromZip(files.fieldOfStudy)), new Set(collegeRows.map((c) => c.unitId)));

  // Schools teaching grades 7-12 in every state. The characteristics file adds virtual and
  // shared-time status to the directory's rows.
  const characteristics = new Map(
    await collect(
      await csvFromZip(files.ccdCharacteristics),
      (row) => (row.NCESSCH ? ([row.NCESSCH.trim(), { sharedTime: row.SHARED_TIME, virtual: row.VIRTUAL }] as const) : null),
      ",",
      "latin1",
    ),
  );
  const publicSchools = await collect(await csvFromZip(files.ccdDirectory), (row) => parseCcdSchool(row, characteristics.get(row.NCESSCH?.trim() ?? "")), ",", "latin1");
  const privateSchools = await collect(await csvFromZip(files.pss), parsePssSchool, ",", "latin1");
  const schoolRows = [...new Map([...publicSchools, ...privateSchools].map((s) => [s.schoolRef, s])).values()];

  await migrateDb();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(occupationInterests);
    await tx.delete(occupationValues);
    await tx.delete(occupationWorkStyles);
    await tx.delete(occupations);
    await tx.delete(cipSocLinks);
    await tx.delete(majors);
    await tx.delete(collegePrograms);
    await tx.delete(colleges);
    await tx.delete(schools);
    for (const batch of chunks(occupationRows)) await tx.insert(occupations).values(batch);
    for (const batch of chunks(interestRows)) await tx.insert(occupationInterests).values(batch);
    for (const batch of chunks(valueRows)) await tx.insert(occupationValues).values(batch);
    for (const batch of chunks(workStyleRows)) await tx.insert(occupationWorkStyles).values(batch);
    for (const batch of chunks(majorRows)) await tx.insert(majors).values(batch);
    for (const batch of chunks(linkRows)) await tx.insert(cipSocLinks).values(batch);
    for (const batch of chunks(collegeRows, 500)) await tx.insert(colleges).values(batch);
    for (const batch of chunks(programRows)) await tx.insert(collegePrograms).values(batch);
    for (const batch of chunks(schoolRows, 500)) await tx.insert(schools).values(batch);
  });

  console.log(
    `Loaded ${occupationRows.length} occupations, ${interestRows.length} interest scores, ${valueRows.length} work value scores, ` +
      `${workStyleRows.length} work style ratings (${new Set(workStyleRows.map((r) => r.occupationCode)).size} occupations), ` +
      `${majorRows.length} majors, ${linkRows.length} major–career links, ${collegeRows.length} colleges, ` +
      `${programRows.length} college programs, ${publicSchools.length} public and ${privateSchools.length} private schools.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
