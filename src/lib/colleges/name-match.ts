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

/** Lowercase words without accents or punctuation, "&" as "and" and apostrophes dropped. */
function plainWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Lowercase words without accents or punctuation. "&" is "and", apostrophes are dropped
 * ("John's" → "johns"), Saint/Mount/Fort are st/mt/ft, and a leading "The" is left out:
 * "The College of St. John's" → ["college", "of", "st", "johns"].
 */
export function nameWords(text: string): string[] {
  // Own keys only: a word like "constructor" is a word, not something every object has.
  const words = plainWords(text).map((w) => (Object.hasOwn(SHORT_FORMS, w) ? SHORT_FORMS[w] : w));
  return words[0] === "the" ? words.slice(1) : words;
}

/**
 * Two letters joined by "and" as one typed term, from "A&M", "A & M" or "A and M" (see typedWords).
 * It matches only those words next to each other in the name, as letters ("Texas A&M") or, ranked
 * after them, spelled out ("Florida Agricultural and Mechanical"); never its letters one by one at
 * the start of any word (the "a" of Art and the "m" of William & Mary).
 */
const ABBREVIATION = /^([a-z]) and ([a-z])$/;

/**
 * The words typed in the name box, as nameWords spells them, except that:
 * - a separate "St" or "St." at the end, after another word, is State, as sports fans write it
 *   ("Penn St", "Ohio St", "San Diego St."). A leading "St" is Saint ("St Olaf"), and so is
 *   "Saint" wherever it's typed;
 * - an abbreviation like "A&M" or "S&T" (also typed "A & M" or "A and M") is one term, "a and m".
 */
export function typedWords(text: string): string[] {
  const words = nameWords(text);
  if (words.length > 1 && plainWords(text).at(-1) === "st") words[words.length - 1] = "state";
  const letter = (word: string | undefined) => word !== undefined && /^[a-z]$/.test(word);
  const terms: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (letter(words[i]) && words[i + 1] === "and" && letter(words[i + 2])) {
      terms.push(`${words[i]} and ${words[i + 2]}`);
      i += 2;
    } else {
      terms.push(words[i]);
    }
  }
  return terms;
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

/**
 * An abbreviation (see ABBREVIATION) in wordsSql's string: its words next to each other, each
 * letter a whole word or the start of one (" a and m", " agricultural and mechanical"). Null for
 * other typed words.
 */
function abbreviationMatch(nameText: SQL, word: string): SQL | null {
  const letters = ABBREVIATION.exec(word);
  return letters ? sql`${nameText} ~ ${` ${letters[1]}[a-z0-9]* and ${letters[2]}`}` : null;
}

/** Names and cities the cheap checks can't judge: wordsSql drops apostrophes and changes accented letters. */
const unusualSpelling = (column: SQLWrapper) => sql`(${column} like '%''%' or octet_length(${column}) > length(${column}))`;

/**
 * The typed word in the name: at the start of a word, or anywhere in one for 4 or more letters
 * ("tech" in Polytechnic). An abbreviation as typed ("Texas A&M"), not spelled out.
 */
function inName(nameText: SQL, word: string): SQL {
  if (ABBREVIATION.test(word)) return sql`${nameText} like ${`% ${word} %`}`;
  return sql`${nameText} like ${matchesInside(word) ? `%${word}%` : wordStart(word)}`;
}

export type WordMatch = {
  /**
   * A quick check on the name and city as written, true whenever `full` is, so the database can
   * skip most rows before the regular expressions in wordsSql run.
   */
  cheap: SQL;
  /**
   * The typed word starts a word of the name or city, is inside a name's word, or starts its
   * initials. An abbreviation ("a and m") is its words in the name, next to each other.
   */
  full: SQL;
};

/** How one typed word (from typedWords) matches a college's name and city. */
export function wordMatch(name: SQLWrapper, city: SQLWrapper, word: string): WordMatch {
  const nameText = wordsSql(name);
  const abbreviation = abbreviationMatch(nameText, word);
  if (abbreviation) {
    // The name has both letters in order, with "&" or "and" between them.
    const [first, , second] = word.split(" ");
    const cheap = or(
      sql`${name} ilike ${`%${first}%&%${second}%`}`,
      sql`${name} ilike ${`%${first}%and%${second}%`}`,
      unusualSpelling(name),
    ) as SQL;
    return { cheap, full: abbreviation };
  }
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
    ...[name, city].map(unusualSpelling),
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
  /** 0 to 3, best first (see nameMatch). */
  rank: SQL;
};

/**
 * Matches words typed in the name box. Each word must start a word of the college's name or
 * city ("tech" finds Technical College; "art" doesn't find Smart), or start the name's initials
 * ("mit"). Words of 4 or more letters may also be inside a word of the name ("tech" finds
 * Polytechnic). "st", "mt" and "ft" (and Saint, Mount and Fort) are whole words only, a
 * trailing "St" is State, and an abbreviation like "A&M" is its words in the name, next to each
 * other (see typedWords).
 * Ranks, best first, with larger colleges first within each (see searchColleges):
 * 0. the name is what was typed, or its initials are ("MIT");
 * 1. the name starts with the words typed ("Ohio State University-Main Campus"; "The Ohio State
 *    University" too, since a leading "The" is left out), or with "University of" or "College of"
 *    and them ("University of Kentucky", "The University of Alabama"), or ends with them, as a
 *    campus's name does ("University of California-Davis", "University of Wisconsin-Madison");
 * 2. every word typed is in the name, at the start of a word or inside one ("Virginia
 *    Polytechnic Institute" and "West Virginia University Institute of Technology" alike for
 *    "virginia tech", so the larger comes first), and an abbreviation as typed ("Texas A&M
 *    University" for "a&m"); or the name's initials start with the word typed;
 * 3. the rest (words found only in the city or the initials, and abbreviations spelled out, as in
 *    "Florida Agricultural and Mechanical University").
 * Null when nothing searchable was typed.
 */
export function nameMatch(name: SQLWrapper, city: SQLWrapper, text: string | undefined): NameMatch | null {
  const typed = typedWords((text ?? "").slice(0, 100)).slice(0, 6);
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
  const named = [` ${phrase} %`, ` university of ${phrase} %`, ` college of ${phrase} %`, `% ${phrase} `].map((p) => sql`${nameText} like ${p}`);
  const rank = sql`case
    when ${nameText} = ${` ${phrase} `}${single ? sql` or ${nameInitials} = ${phrase}` : sql``} then 0
    when ${or(...named)} then 1
    when ${and(...typed.map((w) => inName(nameText, w)))}${single ? sql` or ${nameInitials} like ${`${phrase}%`}` : sql``} then 2
    else 3 end`;
  return { where, rank };
}
