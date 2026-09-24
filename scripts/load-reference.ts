/**
 * Downloads and loads public reference data: O*NET occupations and interest profiles, the
 * O*NET 30.0 work values (dropped from 31.0), the NCES CIP–SOC crosswalk (majors ↔ careers),
 * and College Scorecard institutions and their undergraduate programs (field-of-study data).
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
  occupations,
} from "../src/db/schema";
import {
  collectCollegePrograms,
  parseCipSoc,
  parseCollege,
  parseJobZone,
  parseOccupation,
  parseOccupationInterest,
  parseOccupationValue,
} from "../src/lib/reference/parsers";

const DIR = ".data/reference";
const ONET = "https://www.onetcenter.org/dl_files/database/db_31_0_csv";
const SOURCES = {
  occupations: `${ONET}/occupation_data.csv`,
  jobZones: `${ONET}/job_zones.csv`,
  interests: `${ONET}/career_interest_types.csv`,
  workValues: "https://www.onetcenter.org/dl_files/database/db_30_0_text/Work%20Values.txt",
  crosswalk: "https://nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx",
  scorecard: "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip",
  fieldOfStudy: "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_06102026.zip",
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

async function* csvRows(input: Readable, delimiter = ",") {
  yield* input.pipe(parse({ columns: true, bom: true, relax_column_count: true, delimiter, quote: delimiter === "\t" ? false : '"' })) as AsyncIterable<
    Record<string, string>
  >;
}

async function collect<T>(input: Readable, map: (row: Record<string, string>) => T | null, delimiter = ",") {
  const out: T[] = [];
  for await (const row of csvRows(input, delimiter)) {
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
  const interestRows = (await collect(createReadStream(files.interests), parseOccupationInterest)).filter((r) =>
    codes.has(r.occupationCode),
  );

  const valueRows = (await collect(createReadStream(files.workValues), parseOccupationValue, "\t")).filter((r) =>
    codes.has(r.occupationCode),
  );

  const sheet = await readSheet(files.crosswalk, "CIP-SOC");
  const [header, ...body] = sheet;
  const crosswalk = body
    .map((cells) => parseCipSoc(Object.fromEntries(header.map((h, i) => [String(h), cells[i] == null ? undefined : String(cells[i])]))))
    .filter((r) => r !== null);
  const majorRows = [...new Map(crosswalk.map((r) => [r.cipCode, { cipCode: r.cipCode, title: r.cipTitle }])).values()];
  const linkRows = [...new Map(crosswalk.map((r) => [`${r.cipCode}|${r.socCode}`, { cipCode: r.cipCode, socCode: r.socCode }])).values()];

  const collegeRows = await collect(await csvFromZip(files.scorecard), parseCollege);
  // ~228k rows: streamed, keeping only parsed undergraduate programs at the colleges above.
  const programRows = await collectCollegePrograms(csvRows(await csvFromZip(files.fieldOfStudy)), new Set(collegeRows.map((c) => c.unitId)));

  await migrateDb();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(occupationInterests);
    await tx.delete(occupationValues);
    await tx.delete(occupations);
    await tx.delete(cipSocLinks);
    await tx.delete(majors);
    await tx.delete(collegePrograms);
    await tx.delete(colleges);
    for (const batch of chunks(occupationRows)) await tx.insert(occupations).values(batch);
    for (const batch of chunks(interestRows)) await tx.insert(occupationInterests).values(batch);
    for (const batch of chunks(valueRows)) await tx.insert(occupationValues).values(batch);
    for (const batch of chunks(majorRows)) await tx.insert(majors).values(batch);
    for (const batch of chunks(linkRows)) await tx.insert(cipSocLinks).values(batch);
    for (const batch of chunks(collegeRows, 500)) await tx.insert(colleges).values(batch);
    for (const batch of chunks(programRows)) await tx.insert(collegePrograms).values(batch);
  });

  console.log(
    `Loaded ${occupationRows.length} occupations, ${interestRows.length} interest scores, ${valueRows.length} work value scores, ` +
      `${majorRows.length} majors, ${linkRows.length} major–career links, ${collegeRows.length} colleges, ` +
      `${programRows.length} college programs.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
