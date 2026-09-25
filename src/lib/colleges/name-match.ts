import { type SQL, type SQLWrapper, and, or, sql } from "drizzle-orm";

// College names and cities as plain words, so a search matches however the College Scorecard
// happens to spell a name: "St. Olaf", "Saint Olaf" and "St Olaf" are all "st olaf". nameWords
// does this for what's typed and wordsSql for the database; keep the two in step.

/** Short forms, so "Saint" and "St." match: "saint" → "st", "mount" → "mt", "fort" → "ft". */
const SHORT_FORMS: Record<string, string> = { saint: "st", mount: "mt", fort: "ft" };

/** Words left out of a name's initials: "Massachusetts Institute of Technology" is MIT. */
const SMALL_WORDS = new Set(["of", "the", "and", "at", "in", "for", "on"]);

/** Accented letters in names and cities, and their plain letters (apostrophes have none, so they're dropped). */
const ACCENTED = "áàâäãåéèêëíìîïóòôöõúùûüñçý’'";
const PLAIN = "aaaaaaeeeeiiiiooooouuuuncy";

/**
 * Lowercase words without accents or punctuation. "&" is "and", apostrophes are dropped
 * ("John's" → "johns"), Saint/Mount/Fort are st/mt/ft, and a leading "The" is left out:
 * "The College of St. John's" → ["college", "of", "st", "johns"].
 */
export function nameWords(text: string): string[] {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => SHORT_FORMS[w] ?? w);
  return words[0] === "the" ? words.slice(1) : words;
}

/** First letters of a name's words, leaving out "of", "the" and the like: "mit", "ucla", "nyu". */
export function initials(words: string[]): string {
  return words
    .filter((w) => !SMALL_WORDS.has(w))
    .map((w) => w[0])
    .join("");
}

/** Lowercase, with plain letters and no apostrophes. */
function plainSql(column: SQLWrapper): SQL {
  return sql`translate(lower(${column}), ${ACCENTED}, ${PLAIN})`;
}

/** nameWords in SQL, as one string with a space before and after each word: " college of st johns ". */
export function wordsSql(column: SQLWrapper): SQL {
  const words = sql`regexp_replace(regexp_replace(replace(${plainSql(column)}, '&', ' and '), '[^a-z0-9]+', ' ', 'g'), '\\m(?:(s)ain|(m)oun|(f)or)(t)\\M', '\\1\\2\\3\\4', 'g')`;
  return sql`(' ' || regexp_replace(trim(${words}), '^the ', '') || ' ')`;
}

/** initials in SQL, from wordsSql's string. */
export function initialsSql(words: SQL): SQL {
  const small = [...SMALL_WORDS].join("|");
  return sql`replace(regexp_replace(regexp_replace(${words}, ${` (?:${small})(?= )`}, '', 'g'), ' ([a-z0-9])[a-z0-9]*', ' \\1', 'g'), ' ', '')`;
}

/** st, mt and ft (Saint, Mount and Fort) are whole words only: typed "st" doesn't find State or Stanley. */
const isShortForm = (word: string) => Object.values(SHORT_FORMS).includes(word);

/** Typed words that might be initials, like "mit" or "ucla" (but not "st", "mt" or "ft", which are Saint, Mount and Fort). */
const mightBeInitials = (word: string) => /^[a-z]{2,8}$/.test(word) && !isShortForm(word);

/** Typed words of 4 or more letters also match inside a name's words: "tech" finds Virginia Polytechnic. */
const matchesInside = (word: string) => word.length >= 4;

/** A LIKE pattern for a typed word at the start of a word in wordsSql's string (the whole word for st, mt and ft). */
const wordStart = (word: string) => (isShortForm(word) ? `% ${word} %` : `% ${word}%`);

export type WordMatch = {
  /**
   * A quick check on the name and city as written, true whenever `full` is, so the database can
   * skip most rows before the regular expressions in wordsSql run.
   */
  cheap: SQL;
  /** The typed word starts a word of the name or city, is inside a name's word, or starts its initials. */
  full: SQL;
};

/** How one typed word (from nameWords) matches a college's name and city. */
export function wordMatch(name: SQLWrapper, city: SQLWrapper, word: string): WordMatch {
  const nameText = wordsSql(name);
  const cityText = wordsSql(city);
  // The letters typed as the name or city spells them: the long forms of st/mt/ft ("Saint"), and
  // "&" for "and" (and for "a" and "an", which start it).
  const spellings = [
    word,
    ...Object.keys(SHORT_FORMS).filter((long) => SHORT_FORMS[long] === word),
    ...("and".startsWith(word) ? ["&"] : []),
  ];
  // Initials skip small words, so the letter comes after any "The", "Of" and the like, whatever
  // the spaces or punctuation between them ("The  Beauty Institute" is "bi").
  const initialsStart = `^[^a-z0-9]*((${[...SMALL_WORDS].join("|")})[^a-z0-9]+)*${word[0]}`;
  const cheap = or(
    ...spellings.flatMap((s) => [sql`${name} ilike ${`%${s}%`}`, sql`${city} ilike ${`%${s}%`}`]),
    mightBeInitials(word) ? sql`${name} ~* ${initialsStart}` : undefined,
    // Apostrophes and accents are dropped or changed in wordsSql, so this check can't see past them.
    ...[name, city].map((c) => sql`(${c} like '%''%' or octet_length(${c}) > length(${c}))`),
  ) as SQL;
  const full = or(
    sql`${nameText} like ${wordStart(word)}`,
    matchesInside(word) ? sql`${nameText} like ${`%${word}%`}` : undefined,
    sql`${cityText} like ${wordStart(word)}`,
    mightBeInitials(word) ? sql`${initialsSql(nameText)} like ${`${word}%`}` : undefined,
  ) as SQL;
  return { cheap, full };
}

export type NameMatch = {
  /** Every word typed is in the college's name or city, or starts its initials. */
  where: SQL;
  /** 0 to 4, best first (see nameMatch). */
  rank: SQL;
};

/**
 * Matches words typed in the name box. Each word must start a word of the college's name or
 * city ("tech" finds Technical College; "art" doesn't find Smart), or start the name's initials
 * ("mit"). Words of 4 or more letters may also be inside a word of the name ("tech" finds
 * Polytechnic). "st", "mt" and "ft" (and Saint, Mount and Fort) are whole words only.
 * Ranks, best first, with larger colleges first within each (see searchColleges):
 * 0. the name is what was typed, or its initials are ("MIT");
 * 1. the name starts with the words typed ("Ohio State University-Main Campus"; "The Ohio State
 *    University" too, since a leading "The" is left out), or with "University of" or "College of"
 *    and them ("University of Kentucky", "The University of Alabama");
 * 2. every word typed starts a word in the name, or the name's initials start with it;
 * 3. every word typed is in the name, some inside a word ("Virginia Polytechnic Institute" for
 *    "virginia tech");
 * 4. the rest (words found only in the city, or only in the initials).
 * Null when nothing searchable was typed.
 */
export function nameMatch(name: SQLWrapper, city: SQLWrapper, text: string | undefined): NameMatch | null {
  const typed = nameWords((text ?? "").slice(0, 100)).slice(0, 6);
  if (!typed.length) return null;
  const nameText = wordsSql(name);
  const nameInitials = initialsSql(nameText);

  // The cheap check first, so only a few rows need the regular expressions.
  const where = and(
    ...typed.map((w) => {
      const { cheap, full } = wordMatch(name, city, w);
      return and(cheap, full);
    }),
  ) as SQL;

  const phrase = typed.join(" ");
  const single = typed.length === 1 && mightBeInitials(phrase);
  const startsWord = (w: string) => sql`${nameText} like ${wordStart(w)}`;
  const inName = (w: string) => (matchesInside(w) ? sql`${nameText} like ${`%${w}%`}` : startsWord(w));
  const named = [` ${phrase} %`, ` university of ${phrase} %`, ` college of ${phrase} %`].map((p) => sql`${nameText} like ${p}`);
  const rank = sql`case
    when ${nameText} = ${` ${phrase} `}${single ? sql` or ${nameInitials} = ${phrase}` : sql``} then 0
    when ${or(...named)} then 1
    when ${and(...typed.map(startsWord))}${single ? sql` or ${nameInitials} like ${`${phrase}%`}` : sql``} then 2
    when ${and(...typed.map(inName))} then 3
    else 4 end`;
  return { where, rank };
}
