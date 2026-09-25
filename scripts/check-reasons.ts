/**
 * Checks the template reasons against every real O*NET career (the free quiz's results and the
 * signed-in fallback show them). For each career's description, every clause a reason may take
 * from it (the first cut, and each shorter one used to keep a reason short) must start with a verb
 * must not stop on a function word ("…the selling of", "…duties related") or partway through a list
 * ("…by telephone, mail"). For a
 * student who shares the career's two strongest interest areas, both wordings of its reason must be
 * one sentence of at most MAX_REASON_WORDS words.
 *
 * No two careers on a page may say the same thing about what the work is ("plan, direct, or
 * coordinate activities" for three managers), even in different words: checked for every pair of
 * careers whose reasons would say the same on their own, in both orders, and for the pages a range
 * of students would see. Run after `npm run data:load`:
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
import {
  MAX_REASON_WORDS,
  type TemplateCareer,
  careerClause,
  careerStrongAreas,
  reasonClauses,
  templateExplanation,
} from "../src/lib/matching/explain";
import { rankForStudent } from "../src/lib/matching/match";
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

/** What a reason says the work is: what follows "you could", "you'd" or the career's name, without the interest. */
function workClause(why: string, title: string): string | null {
  const body = why.startsWith(`${title} `) ? why.slice(title.length + 1) : /(?:^|, )you(?:'d| could) (.+)$/i.exec(why)?.[1];
  return body ? body.replace(/, (?:using|which fits) your interest in [^.]*\.$/, "").replace(/\.$/, "") : null;
}

/** Lowercase words without punctuation, to compare a clause with a description. */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s'’&-]/gu, " ").split(/\s+/).filter(Boolean);
const startsWith = (text: string[], start: string[]) => start.length <= text.length && start.every((w, i) => text[i] === w);
/** The description's words from where the clause starts in it (after an opening like "Under…,"), or null. */
function fromClause(description: string[], clause: string[]): string[] | null {
  for (let i = 0; i + clause.length <= description.length; i++) if (startsWith(description.slice(i), clause)) return description.slice(i);
  return null;
}

type Said = { title: string; clause: string; description: string };
/**
 * Whether two reasons say the same about the work: the same clause, or clauses that stop before the
 * words that set the two descriptions apart ("teach one or more subjects" and "teach one or more
 * subjects to students", for two teachers "…to students at the middle…" and "…at the secondary…").
 */
function sameWork(a: Said, b: Said): boolean {
  const [ca, cb] = [plain(a.clause), plain(b.clause)];
  if (ca.join(" ") === cb.join(" ")) return true;
  const [da, db] = [fromClause(plain(a.description), ca), fromClause(plain(b.description), cb)];
  return da !== null && db !== null && startsWith(da, cb) && startsWith(db, ca);
}

/** Pairs of reasons on one page that say the same about the work, as problems. */
function sameWorkOnPage(careers: TemplateCareer[], whys: string[], where: string): string[] {
  const said = careers.flatMap((c, i) => {
    const clause = workClause(whys[i], c.title);
    return clause ? [{ title: c.title, clause, description: c.description ?? "" }] : [];
  });
  const problems: string[] = [];
  for (let i = 0; i < said.length; i++) {
    for (let j = i + 1; j < said.length; j++) {
      if (sameWork(said[i], said[j])) {
        problems.push(`${where}: ${said[i].title} and ${said[j].title} both say "${said[i].clause}" / "${said[j].clause}"`);
      }
    }
  }
  return problems;
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
  const careers = new Map<string, TemplateCareer>();
  /** A student who liked the career's two strongest areas and disliked the rest. */
  const likesTopTwo = (interests: Record<Riasec, number>) => {
    const student = Object.fromEntries(RIASEC.map((a) => [a, 10])) as Record<Riasec, number>;
    careerStrongAreas(interests)
      .slice(0, 2)
      .forEach((a, i) => (student[a] = 40 - 5 * i));
    return student;
  };
  // Careers by what their reason says the work is when each is alone on a page.
  const byWork = new Map<string, TemplateCareer[]>();
  for (const p of profiles) {
    const description = descriptions.get(p.code) ?? "";
    if (!careerClause(description)) withoutClause++;
    // Every clause a reason may take: the first cut, each shorter one, and the longer ones a reason
    // takes when another career on the page already says what the first ones do.
    const clauses = new Set([
      careerClause(description),
      ...Array.from({ length: 12 }, (_, i) => careerClause(description, 13 - i)),
      ...reasonClauses(description).longer,
    ]);
    for (const clause of clauses) {
      const problem = clause && clauseProblem(clause, description);
      if (problem) problems.push(`${p.title} (${p.code}): clause ${problem}: "${clause}"`);
    }

    const student = likesTopTwo(p.interests);
    const career = { occupationCode: p.code, title: p.title, description, jobZone: p.jobZone, interests: p.interests };
    careers.set(p.code, career);
    // Alone; second on a page, so it starts from the other wording; and after itself, so it has to
    // say something else.
    const other = { occupationCode: "other", title: "Other", description: null, jobZone: p.jobZone };
    const reasons = [
      ...templateExplanation(student, [career]).careers,
      templateExplanation(student, [other, career]).careers[1],
      templateExplanation(student, [career, { ...career, occupationCode: `${p.code}#2` }]).careers[1],
    ].map((c) => c.why);
    for (const why of reasons) {
      const n = words(why).length;
      lengths.push(n);
      if (n > MAX_REASON_WORDS) problems.push(`${p.title} (${p.code}): ${n} words: "${why}"`);
      if (why.match(/[.!?](\s|$)/g)?.length !== 1) problems.push(`${p.title} (${p.code}): not one sentence: "${why}"`);
    }
    const work = workClause(reasons[0], p.title);
    if (work) byWork.set(work, [...(byWork.get(work) ?? []), career]);
  }

  // Careers whose reasons say the same on their own, together on a page, in both orders.
  let pairs = 0;
  for (const [work, group] of byWork) {
    for (const a of group) {
      for (const b of group) {
        if (a === b) continue;
        pairs++;
        const whys = templateExplanation(likesTopTwo(a.interests!), [a, b]).careers.map((c) => c.why);
        problems.push(...sameWorkOnPage([a, b], whys, `"${work}"`));
      }
    }
  }
  // The pages a range of students would see: the free quiz's (6 + 6) and a signed-in student's (12 + 8).
  let seed = 7;
  const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const pages = 500;
  for (let round = 0; round < pages; round++) {
    const student = Object.fromEntries(RIASEC.map((a) => [a, next(41)])) as Record<Riasec, number>;
    for (const limits of [{ degree: 6, training: 6 }, { degree: 12, training: 8 }]) {
      const page = rankForStudent({ interests: student }, profiles, limits).map((r) => careers.get(r.code)!);
      const whys = templateExplanation(student, page).careers.map((c) => c.why);
      problems.push(...sameWorkOnPage(page, whys, `Page for ${JSON.stringify(student)}`));
    }
  }

  lengths.sort((a, b) => a - b);
  console.log(`${profiles.length} careers, ${withoutClause} without a clean clause (their reason says why it fits, not what the work is)`);
  console.log(`Reason length: median ${lengths[lengths.length >> 1]} words, longest ${lengths.at(-1)} (limit ${MAX_REASON_WORDS})`);
  console.log(`Same work on a page: ${pairs} pairs of careers that say the same alone, and ${pages * 2} students' pages`);
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(problems.length ? `\n${problems.length} problems` : "\nAll reasons pass");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
