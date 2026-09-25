import { and, ilike, like, not, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { occupations } from "@/db/schema";

/** How many careers one page of search results lists. */
export const CAREER_PAGE_SIZE = 25;

/**
 * Everyday words → words in O*NET job titles. Keys are one or two typed words (singular). Each
 * value lists alternatives, any of which can match; an alternative with two words must find them
 * next to each other in the title. Keep this short: an entry belongs here only when students
 * really type the word and the titles never use it.
 */
export const CAREER_SYNONYMS: Record<string, readonly string[]> = {
  cop: ["police"],
  vet: ["veterinarian", "veterinary"],
  tech: ["technician", "technologist"],
  programmer: ["programmer", "software developer"],
  coder: ["programmer", "software developer"],
  coding: ["programmer", "software developer"],
  "software engineer": ["software developer"],
  attorney: ["lawyer"],
  law: ["law", "lawyer"],
  "high school": ["secondary school"],
  art: ["art", "artist"],
  engineering: ["engineer", "engineering"],
  nursing: ["nurse", "nursing"],
  teaching: ["teacher", "teaching"],
};

/**
 * Everyday words for a group of careers whose titles share no word, as the starts of their
 * O*NET-SOC codes. "doctor" is Physicians and Surgeons (29-1211 to 29-1249: Pediatricians,
 * Psychiatrists, Radiologists and the rest), not Physician Assistants (29-1071) or the other
 * practitioners in 29-129x (Acupuncturists, Naturopathic Physicians). "IT" is the computer
 * occupations (15-12xx) and Computer and Information Systems Managers (11-3021).
 */
export const CAREER_GROUPS: Record<string, readonly string[]> = {
  doctor: ["29-121", "29-122", "29-124"],
  it: ["15-12", "11-3021"],
};

/** Words that say nothing about which career, as in "I want to be a nurse". */
const FILLER_WORDS = new Set([
  "a", "an", "and", "or", "the", "of", "to", "in", "i", "im", "my", "want", "be", "become", "job", "jobs", "career", "careers",
]);

/** Lowercase words without accents or punctuation. Apostrophes are dropped: "Sheriff's" → "sheriffs". */
function titleWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A word and the same word without a plural ending: "nurses" → nurses, nurse (and "nurs"). */
function stems(word: string): string[] {
  const out = [word];
  if (word.length > 4 && word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
  if (word.length > 3 && word.endsWith("es")) out.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) out.push(word.slice(0, -1));
  return out;
}

/** Every form of a word a title may use: "nurse" is Nurses, "secretary" is Secretaries, "coaches" is Coach. */
function wordForms(word: string): Set<string> {
  const forms = new Set<string>();
  for (const stem of stems(word)) {
    forms.add(stem).add(`${stem}s`).add(`${stem}es`);
    if (/[^aeiou]y$/.test(stem)) forms.add(`${stem.slice(0, -1)}ies`);
  }
  return forms;
}

type QueryWord = { word: string; forms: Set<string> };

/**
 * One way to read the words typed. Each term is words that must be next to each other in the
 * title (a single typed word, or a synonym like "software developer"); each group is code starts
 * (CAREER_GROUPS), one of which the career's code must have.
 */
type Alternative = { terms: QueryWord[][]; groups: (readonly string[])[] };

/** A typed word is the whole title word, in any of its forms. */
const isWord = (w: QueryWord, titleWord: string | undefined) => titleWord !== undefined && w.forms.has(titleWord);
/** A typed word of 4 or more letters also matches the start of a longer word: "engin" finds Engineers. */
const startsWord = (w: QueryWord, titleWord: string) => w.word.length >= 4 && titleWord.startsWith(w.word);

/**
 * What to look for: alternatives, each a list of terms and groups that must all match. Typed
 * words in CAREER_SYNONYMS are swapped for the title words listed there, and words in
 * CAREER_GROUPS for their codes.
 */
function parseCareerQuery(text: string): Alternative[] {
  const typed = titleWords(text.slice(0, 60))
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w))
    .slice(0, 6);
  const synonym = (key: string) => CAREER_SYNONYMS[key];
  const group = (key: string) => CAREER_GROUPS[key];
  const segments: Alternative[][] = [];
  const term = (words: string): Alternative => ({ terms: [words.split(" ").map((word) => ({ word, forms: wordForms(word) }))], groups: [] });
  for (let i = 0; i < typed.length; i++) {
    const next = typed[i + 1];
    const pair = next === undefined ? undefined : stems(next).map((s) => synonym(`${typed[i]} ${s}`)).find(Boolean);
    if (pair) i++;
    const codes = pair ? undefined : stems(typed[i]).map(group).find(Boolean);
    const options = pair ?? stems(typed[i]).map(synonym).find(Boolean);
    segments.push(codes ? [{ terms: [], groups: [codes] }] : (options ?? [typed[i]]).map(term));
  }
  let alternatives: Alternative[] = segments.length ? [{ terms: [], groups: [] }] : [];
  for (const options of segments) {
    alternatives = alternatives
      .flatMap((alt) => options.map((o) => ({ terms: [...alt.terms, ...o.terms], groups: [...alt.groups, ...o.groups] })))
      .slice(0, 16);
  }
  return alternatives;
}

/** How well a title matches, best first. */
const EXACT = 0;
const STARTS = 1;
const PHRASE = 2;
const OTHER = 3;

/**
 * EXACT: the title is the words typed ("Actors" for "actor"), or is them plus a qualifier
 * ("Dentists, General"), or the career is in the group typed ("Psychiatrists" for "doctor").
 * STARTS: the title starts with the words ("Nurse Practitioners"). PHRASE: they are next to each
 * other in the title ("Registered Nurses"). OTHER: each word is somewhere in the title, or starts
 * a longer word ("Engineering Managers" for "engineer"), with a synonym's words together.
 */
function tierFor(career: { code: string; title: string }, alt: Alternative): number | null {
  if (!alt.groups.every((codes) => codes.some((start) => career.code.startsWith(start)))) return null;
  const typed = alt.terms.flat();
  if (!typed.length) return EXACT;
  // Words after "Except" name what the career isn't: "Dispatchers, Except Police, Fire, and
  // Ambulance" is no match for "police".
  const words = titleWords(career.title.replace(/,\s*except\b.*$/i, ""));
  // "Dentists, General" is Dentists; "Art, Drama, and Music Teachers" is a list, not Art.
  const head = /,\s*(?:and|or)\s/i.test(career.title) ? null : titleWords(career.title.split(",")[0]);
  const phraseAt = (phrase: QueryWord[], list: string[], i: number) => phrase.every((w, j) => isWord(w, list[i + j]));
  if ((words.length === typed.length && phraseAt(typed, words, 0)) || (head?.length === typed.length && phraseAt(typed, head, 0))) return EXACT;
  if (phraseAt(typed, words, 0)) return STARTS;
  if (words.some((_, i) => phraseAt(typed, words, i))) return PHRASE;
  const found = (term: QueryWord[]) =>
    term.length === 1 ? words.some((t) => isWord(term[0], t) || startsWord(term[0], t)) : words.some((_, i) => phraseAt(term, words, i));
  if (alt.terms.every(found)) return OTHER;
  return null;
}

/** College teaching jobs ("Chemistry Teachers, Postsecondary") come after the others in a tier: few students in grades 7–12 mean them. */
const isPostsecondary = (title: string) => /,\s*postsecondary\b/i.test(title);

export type CareerHit = { code: string; title: string; jobZone: number | null };

export type CareerSearchResult = {
  total: number;
  /** The page actually returned (requests past the end get the last page). */
  page: number;
  pageSize: number;
  results: CareerHit[];
};

/**
 * Careers whose titles match the words typed, closest matches first (see tierFor), then A to Z
 * with college teaching jobs last. Matches whole words, so "art" isn't "Smart" and "actor" isn't
 * "Contractors", with plurals and a few everyday words (CAREER_SYNONYMS, CAREER_GROUPS). Leaves
 * out O*NET's catch-all "…, All Other" titles.
 */
export async function findCareers(
  db: Db,
  query: string,
  { page = 1, pageSize = CAREER_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<CareerSearchResult> {
  const alternatives = parseCareerQuery(query);
  if (!alternatives.length) return { total: 0, page: 1, pageSize, results: [] };

  // Titles with any of the words at the start of a word, and careers in the groups typed: a short
  // list, ranked here.
  const starts = new Set(alternatives.flatMap((alt) => alt.terms.flat()).flatMap((w) => [w.word, ...w.forms]));
  const codeStarts = new Set(alternatives.flatMap((alt) => alt.groups.flat()));
  const candidates = await db
    .select({ code: occupations.code, title: occupations.title, jobZone: occupations.jobZone })
    .from(occupations)
    .where(
      and(
        or(
          starts.size ? sql`${occupations.title} ~* ${`\\m(${[...starts].join("|")})`}` : undefined,
          ...[...codeStarts].map((start) => like(occupations.code, `${start}%`)),
        ),
        not(ilike(occupations.title, "%, All Other")),
      ),
    );

  const ranked = candidates
    .map((c) => ({ ...c, tier: Math.min(...alternatives.map((alt) => tierFor(c, alt) ?? Infinity)) }))
    .filter((c) => c.tier !== Infinity)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(isPostsecondary(a.title)) - Number(isPostsecondary(b.title)) ||
        a.title.localeCompare(b.title) ||
        a.code.localeCompare(b.code),
    );

  const lastPage = Math.max(1, Math.ceil(ranked.length / pageSize));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, requested), lastPage);
  const results = ranked.slice((current - 1) * pageSize, current * pageSize).map(({ tier: _tier, ...hit }) => hit);
  return { total: ranked.length, page: current, pageSize, results };
}
