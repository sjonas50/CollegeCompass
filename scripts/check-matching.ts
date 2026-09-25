/**
 * Credibility check against the real O*NET data (Phase 1 exit criterion): for a test student of
 * each RIASEC type and some common two-letter blends, prints the top matches and checks that at
 * least 8 of the top 10 lead with one of the student's interests (the main one, or either
 * letter of a blend — an RI student should see engineers, which O*NET codes as IR).
 *
 * Matches for minors (src/lib/matching/minors.ts): no career in NOT_MATCHED_FOR_MINORS appears in
 * any list checked here, nor for a student whose interests are shaped exactly like that career (who
 * would otherwise get it first), and no list shows more than one of each MATCH_FAMILIES kind per
 * pathway. Every listed code must still name the same career in the loaded data, and any other
 * gambling or bartending title must be reviewed (listed, or in REVIEWED_AND_KEPT).
 *
 * Personality: the same students with a few strengths profiles must stay credible, personality may
 * add at most PERSONALITY_WEIGHT × 100 points to any career, and at most 5 of the 20 careers shown
 * may change. Personality mustn't stand in for years of school: on each path, every strengths
 * profile must lift careers at each Job Zone by about the same amount on average (within
 * MAX_ZONE_GAP points). Run after `npm run data:load`:
 *
 *   npm run check:matching
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { occupations } from "../src/db/schema";
import { type BigFive, RIASEC, type Riasec } from "../src/lib/assessments/instruments";
import {
  type OccupationProfile,
  PERSONALITY_WEIGHT,
  type Pathway,
  pathwayFor,
  personalityFit,
  rankForStudent,
  scoreOccupation,
} from "../src/lib/matching/match";
import { MATCH_FAMILIES, NOT_MATCHED_FOR_MINORS, REVIEWED_AND_KEPT, matchFamily } from "../src/lib/matching/minors";
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

// Trait scores 0–100. Emotional stability is set but never used.
const STRENGTHS: { label: string; traits: Record<BigFive, number> }[] = [
  { label: "caring and curious", traits: { extraversion: 50, agreeableness: 75, conscientiousness: 60, neuroticism: 45, intellect: 70 } },
  { label: "outgoing", traits: { extraversion: 90, agreeableness: 70, conscientiousness: 50, neuroticism: 40, intellect: 55 } },
  { label: "quiet and organized", traits: { extraversion: 20, agreeableness: 60, conscientiousness: 90, neuroticism: 50, intellect: 60 } },
];
/**
 * For the Job Zone check, also a student sure of every strength: the case where trait demand
 * tracking Job Zone showed most. Not in the ranking checks: with every trait lifting, more of a
 * tight top 20 moves (still at most PERSONALITY_WEIGHT × 100 points each).
 */
const ZONE_PROFILES = [
  ...STRENGTHS,
  { label: "every strength at 80", traits: { extraversion: 80, agreeableness: 80, conscientiousness: 80, neuroticism: 50, intellect: 80 } },
];
const MAX_CHANGED = 5;
/** The most the average lift may differ, in points, between Job Zones on the same path. */
const MAX_ZONE_GAP = 0.5;

/** The average lift (points added) a strengths profile gives careers at each Job Zone on a path. */
function liftByZone(profiles: OccupationProfile[], traits: Record<BigFive, number>, pathway: Pathway) {
  const byZone = new Map<number, number[]>();
  for (const p of profiles) {
    if (!p.traitDemand || pathwayFor(p.jobZone) !== pathway) continue;
    const zone = p.jobZone ?? 0;
    const lifts = byZone.get(zone) ?? byZone.set(zone, []).get(zone)!;
    lifts.push(PERSONALITY_WEIGHT * personalityFit(traits, p.traitDemand));
  }
  return [...byZone].sort((a, b) => a[0] - b[0]).map(([zone, lifts]) => ({ zone, mean: lifts.reduce((a, b) => a + b, 0) / lifts.length }));
}

/** What's wrong with a match list under the rules for minors: listed careers, or a family shown twice on a path. */
function minorsProblems(list: { code: string; title: string; jobZone: number | null }[]): string[] {
  const problems = list.filter((m) => Object.hasOwn(NOT_MATCHED_FOR_MINORS, m.code)).map((m) => `${m.title} is never matched`);
  for (const pathway of ["degree", "training"] as const) {
    for (const family of MATCH_FAMILIES) {
      const shown = list.filter((m) => pathwayFor(m.jobZone) === pathway && matchFamily(m) === family.id);
      if (shown.length > 1) problems.push(`${shown.length} ${family.id} careers on the ${pathway} path: ${shown.map((m) => m.title).join("; ")}`);
    }
  }
  return problems;
}

/** A student whose six scores (0–40) have exactly the shape of an occupation's O*NET profile (1–7). */
function shapedLike(p: OccupationProfile) {
  return { interests: Object.fromEntries(RIASEC.map((a) => [a, Math.round(((p.interests[a] - 1) / 6) * 40)])) as Record<Riasec, number> };
}

function leadsWith(byCode: Map<string, OccupationProfile>, codes: string[], c: (typeof CASES)[number]) {
  return codes.filter((code) => {
    const p = byCode.get(code)!;
    const topArea = RIASEC.reduce((best, a) => (p.interests[a] > p.interests[best] ? a : best));
    return c.main.includes(topArea) || topArea === c.second;
  }).length;
}

async function main() {
  const db = await getDb();
  const profiles = await loadOccupationProfiles(db, { fresh: true });
  if (profiles.length === 0) throw new Error("No reference data. Run `npm run data:load` first.");
  const byCode = new Map(profiles.map((p) => [p.code, p]));
  const withStyles = profiles.filter((p) => p.traitDemand).length;
  if (withStyles === 0) throw new Error("No work styles loaded. Run `npm run data:load` again.");
  let failures = 0;

  for (const c of CASES) {
    const all = rankForStudent(student(c.main, c.second), profiles);
    const leadsWithMain = leadsWith(byCode, all.slice(0, 10).map((m) => m.code), c);
    const ok = leadsWithMain >= 8;
    if (!ok) failures++;
    const target = [...c.main, ...(c.second ? [c.second] : [])].join(" or ");
    console.log(`\n${ok ? "PASS" : "FAIL"} ${c.label}: ${leadsWithMain}/10 lead with ${target}`);
    for (const m of all.slice(0, 5)) console.log(`  degree    ${String(m.score).padStart(3)}  ${m.title}`);
    for (const m of all.filter((m) => pathwayFor(m.jobZone) === "training").slice(0, 3))
      console.log(`  training  ${String(m.score).padStart(3)}  ${m.title}`);
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} profiles credible`);

  console.log(`\nPersonality (${withStyles}/${profiles.length} careers have work styles; adds at most ${PERSONALITY_WEIGHT * 100} points)`);
  let personalityFailures = 0;
  for (const c of CASES) {
    const base = student(c.main, c.second);
    const without = rankForStudent(base, profiles).map((m) => m.code);
    for (const s of STRENGTHS) {
      const withP = rankForStudent({ ...base, personality: s.traits }, profiles);
      const leads = leadsWith(byCode, withP.slice(0, 10).map((m) => m.code), c);
      const added = withP.filter((m) => !without.includes(m.code));
      const maxLift = Math.max(...profiles.map((p) => scoreOccupation({ ...base, personality: s.traits }, p).score - scoreOccupation(base, p).score));
      const ok = leads >= 8 && added.length <= MAX_CHANGED && maxLift <= PERSONALITY_WEIGHT * 100;
      if (!ok) personalityFailures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.label.padEnd(2)} ${s.label.padEnd(20)} ${leads}/10 lead, ${added.length}/20 changed, most added ${maxLift}` +
          (added.length ? `: + ${added.map((m) => m.title).join("; ")}` : ""),
      );
    }
  }
  console.log(`\n${CASES.length * STRENGTHS.length - personalityFailures}/${CASES.length * STRENGTHS.length} personality cases pass`);

  console.log(`\nAverage lift by Job Zone (may differ by at most ${MAX_ZONE_GAP} points on each path)`);
  let zoneFailures = 0;
  for (const s of ZONE_PROFILES) {
    for (const pathway of ["training", "degree"] as const) {
      const zones = liftByZone(profiles, s.traits, pathway);
      const gap = Math.max(...zones.map((z) => z.mean)) - Math.min(...zones.map((z) => z.mean));
      const ok = gap <= MAX_ZONE_GAP;
      if (!ok) zoneFailures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${s.label.padEnd(20)} ${pathway.padEnd(8)} gap ${gap.toFixed(2)}: ` +
          zones.map((z) => `zone ${z.zone} +${z.mean.toFixed(2)}`).join(", "),
      );
    }
  }
  console.log(`\n${ZONE_PROFILES.length * 2 - zoneFailures}/${ZONE_PROFILES.length * 2} Job Zone cases pass`);

  console.log("\nMatches for minors");
  let minorsFailures = 0;
  const fail = (message: string) => {
    minorsFailures++;
    console.log(`FAIL ${message}`);
  };
  // The listed codes still name the careers they were chosen for, and no gambling or bar job is new.
  const titles = new Map((await db.select({ code: occupations.code, title: occupations.title }).from(occupations)).map((o) => [o.code, o.title]));
  for (const [code, { title }] of Object.entries({ ...NOT_MATCHED_FOR_MINORS, ...REVIEWED_AND_KEPT })) {
    if (titles.get(code) !== title) fail(`${code} is "${titles.get(code) ?? "missing"}" in the loaded data, not "${title}": review src/lib/matching/minors.ts`);
  }
  for (const [code, title] of titles) {
    const reviewed = Object.hasOwn(NOT_MATCHED_FOR_MINORS, code) || Object.hasOwn(REVIEWED_AND_KEPT, code);
    if (!reviewed && /gambl|casino|bartend|liquor|sports ?book/i.test(title)) fail(`${code} ${title} hasn't been reviewed for minors`);
  }
  // Every list above, at the signed-in and free quiz sizes (FREE_MATCH_LIMITS; import.ts is
  // server-only), and students shaped exactly like each career left out or shown once per path, who
  // would otherwise get it first.
  const FREE_MATCH_LIMITS = { degree: 6, training: 6 };
  const students = [
    ...CASES.flatMap((c) => [student(c.main, c.second), ...STRENGTHS.map((s) => ({ ...student(c.main, c.second), personality: s.traits }))]),
    ...profiles.filter((p) => Object.hasOwn(NOT_MATCHED_FOR_MINORS, p.code) || matchFamily(p)).map(shapedLike),
  ];
  let lists = 0;
  for (const s of students) {
    for (const limits of [undefined, FREE_MATCH_LIMITS]) {
      lists++;
      for (const problem of minorsProblems(rankForStudent(s, profiles, limits))) {
        fail(`${RIASEC.map((a) => `${a}${s.interests[a]}`).join(" ")}: ${problem}`);
      }
    }
  }
  console.log(
    `${minorsFailures ? "FAIL" : "PASS"} ${lists} match lists: none of the ${profiles.filter((p) => Object.hasOwn(NOT_MATCHED_FOR_MINORS, p.code)).length} ` +
      `careers never matched, and at most one of each family per path (${profiles.filter((p) => matchFamily(p)).length} careers in families)`,
  );
  process.exit(failures || personalityFailures || zoneFailures || minorsFailures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
