/**
 * Checks the template reasons against every real O*NET career (the free quiz's results and the
 * signed-in fallback show them). For each career's description, every clause a reason may take
 * from it (the first cut, and each shorter one used to keep a reason short) must start with a verb
 * must not stop on a function word ("…the selling of", "…duties related") or partway through a list
 * ("…by telephone, mail"). For a
 * student who shares the career's two strongest interest areas, both wordings of its reason must be
 * one sentence of at most MAX_REASON_WORDS words. Run after `npm run data:load`:
 *
 *   npm run check:reasons
 *
 * The word lists here are kept apart from src/lib/matching/explain.ts on purpose, so the check
 * doesn't just repeat the rules it's checking.
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { occupations } from "../src/db/schema";
import { RIASEC, type Riasec } from "../src/lib/assessments/instruments";
import { MAX_REASON_WORDS, careerClause, careerStrongAreas, templateExplanation } from "../src/lib/matching/explain";
import { loadOccupationProfiles } from "../src/lib/matching/service";

/** Words a clause can't end on: they need what comes after them. */
const BAD_LAST = new Set([
  // Articles, determiners and pronouns.
  "a", "an", "the", "any", "all", "some", "each", "every", "its", "their", "this", "these", "those", "such", "other",
  // Prepositions and joining words.
  "to", "of", "for", "in", "on", "at", "by", "with", "from", "into", "onto", "within", "through", "during", "under",
  "as", "than", "and", "or", "nor", "but", "that", "which", "who", "whose", "where", "when", "while",
  // Helping verbs.
  "may", "can", "must", "will", "should", "be", "is", "are",
  // Words that were left hanging before this check ("…duties related", "…and participate").
  "related", "necessary", "participate", "connection", "enabling", "gathered", "variety", "number", "range",
]);
/** Words a clause can't start with: a clause starts with what the worker does. */
const BAD_FIRST = new Set([...BAD_LAST, "using", "following", "working", "usually", "often"]);

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const bare = (word = "") => word.replace(/[,.]$/, "").toLowerCase();

function clauseProblem(clause: string, description: string): string | null {
  const all = words(clause);
  // "…by telephone, mail" or "install, inspect, test, maintain": a list cut before its last item.
  // A whole sentence, or everything before its examples, can join its last item without a comma
  // ("…molecular, organism or population level.", "…appliances or prostheses, such as limbs").
  const escaped = clause.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cut = !new RegExp(`${escaped}(?:\\.|;|:|,?\\s+(?:such as|including|especially|e\\.g\\.))`).test(description.toLowerCase());
  const lastComma = all.findLastIndex((w) => w.endsWith(","));
  if (cut && lastComma >= 0 && !["and", "or"].includes(all[lastComma + 1])) return `stops partway through a list`;
  const first = bare(/^[a-z]{4,}ly$/i.test(all[0]) && !["apply", "supply", "comply"].includes(bare(all[0])) ? all[1] : all[0]);
  if (BAD_FIRST.has(first) || /ing$/.test(first)) return `starts with "${first}"`;
  if (BAD_LAST.has(bare(all.at(-1)))) return `ends with "${bare(all.at(-1))}"`;
  if (bare(all.at(-2)) === "may") return `ends right after "may"`;
  return null;
}

async function main() {
  const db = await getDb();
  const [profiles, rows] = await Promise.all([
    loadOccupationProfiles(db, { fresh: true }),
    db.select({ code: occupations.code, description: occupations.description }).from(occupations),
  ]);
  if (profiles.length === 0) throw new Error("No reference data. Run `npm run data:load` first.");
  const descriptions = new Map(rows.map((r) => [r.code, r.description]));

  const problems: string[] = [];
  let withoutClause = 0;
  const lengths: number[] = [];
  for (const p of profiles) {
    const description = descriptions.get(p.code) ?? "";
    if (!careerClause(description)) withoutClause++;
    const clauses = new Set([careerClause(description), ...Array.from({ length: 12 }, (_, i) => careerClause(description, 13 - i))]);
    for (const clause of clauses) {
      const problem = clause && clauseProblem(clause, description);
      if (problem) problems.push(`${p.title} (${p.code}): clause ${problem}: "${clause}"`);
    }

    // A student who liked the career's two strongest areas and disliked the rest.
    const strong = careerStrongAreas(p.interests);
    const student = Object.fromEntries(RIASEC.map((a) => [a, 10])) as Record<Riasec, number>;
    strong.slice(0, 2).forEach((a, i) => (student[a] = 40 - 5 * i));
    const career = { occupationCode: p.code, title: p.title, description, jobZone: p.jobZone, interests: p.interests };
    // Twice, so the second starts from the other wording, as a neighbor on the page would.
    const reasons = templateExplanation(student, [career, { ...career, occupationCode: `${p.code}#2` }]).careers.map((c) => c.why);
    for (const why of reasons) {
      const n = words(why).length;
      lengths.push(n);
      if (n > MAX_REASON_WORDS) problems.push(`${p.title} (${p.code}): ${n} words: "${why}"`);
      if (why.match(/[.!?](\s|$)/g)?.length !== 1) problems.push(`${p.title} (${p.code}): not one sentence: "${why}"`);
    }
  }

  lengths.sort((a, b) => a - b);
  console.log(`${profiles.length} careers, ${withoutClause} without a clean clause (their reason says why it fits, not what the work is)`);
  console.log(`Reason length: median ${lengths[lengths.length >> 1]} words, longest ${lengths.at(-1)} (limit ${MAX_REASON_WORDS})`);
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(problems.length ? `\n${problems.length} problems` : "\nAll reasons pass");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
