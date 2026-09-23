/**
 * Credibility check against the real O*NET data (Phase 1 exit criterion): for a test student of
 * each RIASEC type and some common two-letter blends, prints the top matches and checks that at
 * least 8 of the top 10 lead with one of the student's interests (the main one, or either
 * letter of a blend — an RI student should see engineers, which O*NET codes as IR). Run after `npm run data:load`:
 *
 *   npm run check:matching
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { RIASEC, type Riasec } from "../src/lib/assessments/instruments";
import { pathwayFor, rankForStudent } from "../src/lib/matching/match";
import { loadOccupationProfiles } from "../src/lib/matching/service";

// A strongly typed student: "strongly like" every activity in the main area(s), "dislike" the rest.
function student(main: Riasec[], second?: Riasec) {
  const interests = Object.fromEntries(RIASEC.map((a) => [a, 10])) as Record<Riasec, number>;
  for (const a of main) interests[a] = 40;
  if (second) interests[second] = 28;
  return { interests };
}

const CASES: { label: string; main: Riasec[]; second?: Riasec }[] = [
  ...RIASEC.map((a) => ({ label: a, main: [a] })),
  { label: "IA", main: ["I"], second: "A" },
  { label: "SE", main: ["S"], second: "E" },
  { label: "RI", main: ["R"], second: "I" },
  { label: "EC", main: ["E"], second: "C" },
];

async function main() {
  const profiles = await loadOccupationProfiles(await getDb(), { fresh: true });
  if (profiles.length === 0) throw new Error("No reference data. Run `npm run data:load` first.");
  const byCode = new Map(profiles.map((p) => [p.code, p]));
  let failures = 0;

  for (const c of CASES) {
    const all = rankForStudent(student(c.main, c.second), profiles);
    const top = all.slice(0, 10);
    const leadsWithMain = top.filter((m) => {
      const p = byCode.get(m.code)!;
      const topArea = RIASEC.reduce((best, a) => (p.interests[a] > p.interests[best] ? a : best));
      return c.main.includes(topArea) || topArea === c.second;
    }).length;
    const ok = leadsWithMain >= 8;
    if (!ok) failures++;
    const target = [...c.main, ...(c.second ? [c.second] : [])].join(" or ");
    console.log(`\n${ok ? "PASS" : "FAIL"} ${c.label}: ${leadsWithMain}/10 lead with ${target}`);
    for (const m of all.slice(0, 5)) console.log(`  degree    ${String(m.score).padStart(3)}  ${m.title}`);
    for (const m of all.filter((m) => pathwayFor(m.jobZone) === "training").slice(0, 3))
      console.log(`  training  ${String(m.score).padStart(3)}  ${m.title}`);
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} profiles credible`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
