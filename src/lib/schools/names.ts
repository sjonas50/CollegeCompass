// School names and labels from the NCES directories, for display and search. Pure, so the loader,
// the server and client components can all use it.
//
// Many states file their names in capitals with abbreviations ("PLANO SR H S", "MT. PILGRIM
// CHRISTIAN ACADEMY"). Those are shown title-cased with the common abbreviations spelled out
// ("Plano Senior High School"). Search matches both spellings (see schoolSearchText).

/** Words kept in capitals when a capitalized name is title-cased. */
const ACRONYMS = new Set([
  "AEP", "AP", "AVID", "BASIS", "CCSD", "CISD", "CS", "CTE", "DAEP", "DC", "ECHS", "ESD", "FFA", "GT", "HS", "IB", "ID", "IDEA",
  "II", "III", "IS", "ISD", "IV", "JJAEP", "JROTC", "KIPP", "MS", "MSD", "NYC", "PK", "PS", "PSJA", "ROTC", "SAT", "STEAM",
  "STEM", "TX", "UIL", "USA", "UT", "UTEP", "UTSA", "VI", "VII", "VIII", "YES", "YMCA", "YWCA",
]);

/** Words kept lowercase inside a title-cased name (never first). */
const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to"]);

/**
 * Abbreviations spelled out wherever they appear as a whole word. "JR" isn't one of them: in
 * "M L KING JR H S" it's part of a person's name.
 */
const WORDS: Record<string, string> = {
  ACAD: "Academy",
  ALT: "Alternative",
  CTR: "Center",
  ELEM: "Elementary",
  INTER: "Intermediate",
  MID: "Middle",
  SCH: "School",
  SCHL: "School",
};

/** Abbreviations spelled out only at the end of a name ("EL PASO" keeps its "El"). */
const ENDINGS: [string[], string][] = [
  [["J", "H", "S"], "Junior High School"],
  [["H", "S"], "High School"],
  [["J", "H"], "Junior High"],
  [["M", "S"], "Middle School"],
  [["HS"], "High School"],
  [["JHS"], "Junior High School"],
  [["JH"], "Junior High"],
  [["MS"], "Middle School"],
  [["EL"], "Elementary"],
  [["INT"], "Intermediate"],
];

function titleWord(word: string, first: boolean): string {
  if (!/[A-Z]/.test(word)) return word;
  const bare = word.replace(/[^A-Z0-9]/g, "");
  if (ACRONYMS.has(bare) && bare === word.replace(/[.,]/g, "")) return word;
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower)) return lower;
  // Capitalize after the start, a hyphen, a slash, a period or an apostrophe before a letter
  // ("o'connell" -> "O'Connell", "winston-salem" -> "Winston-Salem", "st.mary" -> "St.Mary"),
  // and after a leading "Mc" ("McKinney").
  return lower
    .replace(/(^|[-/.(]|'(?=[a-z]{2}))([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/^Mc([a-z]{2})/, (_m, rest: string) => `Mc${rest[0].toUpperCase()}${rest.slice(1)}`);
}

/** "WEST VALLEY CITY" -> "West Valley City". Leaves words that already have lowercase letters. */
export function titleCase(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => titleWord(w, i === 0)).join(" ");
}

/**
 * A school's name as shown: trimmed, and, when it's all capitals, title-cased with common
 * abbreviations spelled out. "PLANO SR H S" -> "Plano Senior High School". Names with lowercase
 * letters are left as the school reported them.
 */
export function displaySchoolName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (/[a-z]/.test(name) || !/[A-Z]/.test(name)) return name;
  const words = name.split(" ");
  for (const [ending, spelled] of ENDINGS) {
    if (words.length > ending.length && ending.every((w, i) => words[words.length - ending.length + i] === w)) {
      words.splice(words.length - ending.length, ending.length, ...spelled.toUpperCase().split(" "));
      break;
    }
  }
  // "SR" before "HIGH" is "Senior" ("PLANO SR H S", "PLANO EAST SR HIGH").
  const expanded = words.map((w, i) => (w === "SR" && words[i + 1] === "HIGH" ? "SENIOR" : (WORDS[w]?.toUpperCase() ?? w)));
  return titleCase(expanded.join(" "));
}

/**
 * Lowercase letters and digits, accents and apostrophes removed, one space between words:
 * "Zoë's  Café" -> "zoes cafe", so "st marys" finds "St. Mary's".
 */
export function searchWords(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** What a school is found by: its name as filed and as shown, its city and its district. */
export function schoolSearchText(parts: { rawName: string; name: string; city?: string | null; district?: string | null }): string {
  const words = [parts.rawName, parts.name, parts.city ?? "", parts.district ?? ""].map(searchWords).join(" ").split(" ");
  // Each word once, in order: the index doesn't need repeats.
  return [...new Set(words.filter(Boolean))].join(" ");
}

/**
 * The words a student typed as a Postgres text-search query where every word must start a word of
 * the school's search text: "plano sr" -> "plano:* & sr:*". Null when nothing searchable is left.
 * Only letters and digits get through, so the result is always a valid tsquery.
 */
export function schoolSearchQuery(typed: string, maxWords = 6): string | null {
  const words = searchWords(typed.slice(0, 100)).split(" ").filter(Boolean).slice(0, maxWords);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

function gradeName(g: number): string {
  return g === -1 ? "PK" : g === 0 ? "K" : String(g);
}

/** "Grades 9–12", "Grades K–8", "Grade 12". Null when the directory doesn't say. */
export function gradeSpanLabel(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  if (low === high) return `Grade ${gradeName(low)}`;
  return `Grades ${gradeName(low)}–${gradeName(high)}`;
}

export type SchoolKind = "public" | "charter" | "private";

export const SCHOOL_KIND_LABELS: Record<SchoolKind, string> = {
  public: "Public",
  charter: "Public charter",
  private: "Private",
};
