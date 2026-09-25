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

/** Typed words that might be initials, like "mit" or "ucla". */
const mightBeInitials = (word: string) => /^[a-z]{2,8}$/.test(word);

export type NameMatch = {
  /** Every word typed is in the college's name or city, or starts its initials. */
  where: SQL;
  /** 0 to 3, best first (see nameMatch). */
  rank: SQL;
};

/**
 * Matches words typed in the name box. Each word must start a word of the college's name or
 * city ("tech" finds Technical College; "art" doesn't find Smart), or start the name's initials
 * ("mit"). Ranks, best first:
 * 0. the name is what was typed, or its initials are ("MIT");
 * 1. the name starts with what was typed ("Ohio State University-Main Campus" for "ohio state");
 * 2. every word typed starts a word in the name, or the name's initials start with it;
 * 3. the rest (words found only in the city, or only in the initials).
 * Null when nothing searchable was typed.
 */
export function nameMatch(name: SQLWrapper, city: SQLWrapper, text: string | undefined): NameMatch | null {
  const typed = nameWords((text ?? "").slice(0, 100)).slice(0, 6);
  if (!typed.length) return null;
  const nameText = wordsSql(name);
  const cityText = wordsSql(city);
  const nameInitials = initialsSql(nameText);
  const inName = (w: string) => sql`${nameText} like ${`% ${w}%`}`;

  const where = and(
    ...typed.map((w) => {
      // A cheap check first, so only a few rows need the regular expressions above: the letters
      // typed (or the long form, like "Saint" for "st") are in the name or city as written, the
      // name starts with the word's first letter (for initials), or the name or city has an
      // apostrophe or accent (which this check can't see past).
      const spellings = [w, ...(w === "and" ? ["&"] : []), ...Object.keys(SHORT_FORMS).filter((k) => SHORT_FORMS[k] === w)];
      const cheap = or(
        ...spellings.flatMap((s) => [sql`${name} ilike ${`%${s}%`}`, sql`${city} ilike ${`%${s}%`}`]),
        ...(mightBeInitials(w) ? [sql`${name} ilike ${`${w[0]}%`}`, sql`${name} ilike ${`the ${w[0]}%`}`] : []),
        ...[name, city].map((c) => sql`(${c} like '%''%' or octet_length(${c}) > length(${c}))`),
      );
      const full = or(
        inName(w),
        sql`${cityText} like ${`% ${w}%`}`,
        mightBeInitials(w) ? sql`${nameInitials} like ${`${w}%`}` : undefined,
      );
      return and(cheap, full);
    }),
  ) as SQL;

  const phrase = typed.join(" ");
  const single = typed.length === 1 && mightBeInitials(phrase);
  const rank = sql`case
    when ${nameText} = ${` ${phrase} `}${single ? sql` or ${nameInitials} = ${phrase}` : sql``} then 0
    when ${nameText} like ${` ${phrase} %`} then 1
    when ${and(...typed.map(inName))}${single ? sql` or ${nameInitials} like ${`${phrase}%`}` : sql``} then 2
    else 3 end`;
  return { where, rank };
}
