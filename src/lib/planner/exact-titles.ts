import type { CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolYear } from "./common";
import {
  allCourseTypes,
  type CourseType,
  type CourseTypeId,
  type CourseTypeLevel,
  getCourseType,
  isCollegeLevel,
  LANGUAGE_NAMES,
  LANGUAGES,
} from "./course-types";

// ---------------------------------------------------------------------------
// Exact titles: the tier between a stored type and a guess (course-type-guess.ts
// resolveRowCourseType). A class typed with the official or canonical name of exactly one kind of
// class in the student's state ("Algebra I", "World Geography", Texas's "Lifetime Fitness and
// Wellness Pursuits", Utah's "Secondary Mathematics I") is that kind: it counts for requirements
// and isn't on "Confirm your classes". Everything else stays a guess to confirm (engine/confirm.ts).
//
// Two titles are the same after normalizing case, spaces, punctuation ("U.S." is "US", "&" is
// "and") and numerals ("Algebra 1" is "Algebra I"), and one level marker at the start or end
// ("H", "Honors", "AP", "Pre-AP", "CE", "Dual Credit"). The marker only sets the level, and only
// when it can't change the kind of class:
// - "Pre-AP" is Texas's honors-style label, never AP;
// - the type must be offered at that level, and a college-level Biology, Chemistry, Physics or
//   Calculus isn't exact at all: an AP, IB or college-credit version may be the second-year type
//   (the school's printed prerequisite decides, course-types.ts);
// - the row's own level must agree (a row left at "Regular" takes the marker's level).
// A title never counts as exact when it joins two classes' names ("Gov/Econ", "Personal Financial
// Literacy and Economics", any "/" or "+"), when two kinds share it in the state, or when the
// state's schools use it for another kind of class too (`otherKindsInState`: Tennessee's "Health",
// Utah's "U.S. Government" from 2027-28, Utah's college-credit "English 11"). The guesser then
// lists that other kind as well (course-type-guess.ts), so "Confirm your classes" asks about the
// row and nothing the other kind would decide is claimed before the student answers.
//
// The names come from the vocabulary (each type's title where it's a class's name, its state
// titles), plus the common names below and each state's official titles from its sources.
// ---------------------------------------------------------------------------

/**
 * Names every state uses for exactly one kind of class, where the vocabulary's title describes the
 * kind instead ("World or human geography"). Grade-numbered English is that grade's English class.
 */
const COMMON_NAMES: Partial<Record<CourseTypeId, readonly string[]>> = {
  "ela.9": ["English 9"],
  "ela.10": ["English 10"],
  "ela.11": ["English 11"],
  "ela.12": ["English 12"],
  "math.precalc": ["Pre-Calculus"],
  "sci.env": ["Environmental Science"],
  "ss.us_hist": ["United States History"],
  "ss.world_hist": ["World History"],
  "ss.world_geo": ["World Geography", "Human Geography"],
  "ss.us_gov": ["United States Government"],
};

/**
 * Each state's own course titles, beyond the vocabulary's state titles (`stateTitles`), from the
 * saved sources in .data/course-rules-verified:
 * - Texas: 19 TAC §74.12 (TX-S1) and §74.3 (TX-S2), TEKS course names; TEA's statewide programs
 *   of study (MP-TEA-POS-ENG-ENGINEERING-FOUNDATIONS "Level 1 • Principles of Applied Engineering",
 *   "Level 2 … • Robotics I", "Level 3 … • Robotics II … • Digital Electronics";
 *   MP-TEA-POS-HS-NURSING-SCIENCE "Level 1• Principles of Health Science";
 *   MP-TEA-POS-BMF-ACCOUNTING-AND-FINANCIAL-SERVICES "Level 2• Accounting I").
 * - Tennessee: Policy 3.205, approved high school courses (TN-S6B).
 * - Utah: USBE, "Current Courses Meeting the Criteria for Graduation Requirements 2026-2027" (UT-S3).
 * Only titles whose kind is certain: never a catch-all ("Physical Education"), a title the state
 * uses for more than one kind (Tennessee's "Wellness" and "Health", SHARED_NAMES), or a class whose
 * level in a career cluster isn't in a saved source.
 */
const OFFICIAL_TITLES: Record<PlannerState, Partial<Record<CourseTypeId, readonly string[]>>> = {
  TX: {
    "ela.research": ["Research and Technical Writing"],
    "ela.humanities": ["Humanities", "Literary Genres"],
    "ela.speech": ["Communication Applications"],
    "ela.professional_comm": ["Business English"],
    "math.discrete": ["Discrete Mathematics for Problem Solving"],
    "sci.aquatic": ["Aquatic Science"],
    "sci.earth": ["Earth Systems Science"],
    "sci.microbio": ["Medical Microbiology"],
    "sci.biotech": ["Biotechnology I", "Biotechnology II"],
    "ss.us_hist": ["United States History Studies Since 1877"],
    "ss.econ": ["Economics with Emphasis on the Free Enterprise System and Its Benefits"],
    // §74.12(b)(6)(A): "(i) Lifetime Fitness and Wellness Pursuits; (ii) Lifetime Recreation and
    // Outdoor Pursuits; and (iii) Skill-Based Lifetime Activities."
    "pe.fitness": ["Lifetime Fitness and Wellness Pursuits"],
    "pe.lifetime": ["Lifetime Recreation and Outdoor Pursuits"],
    "pe.skills": ["Skill-Based Lifetime Activities"],
    "cte.animal_science": ["Advanced Animal Science"],
    "cte.engineering_design": ["Principles of Applied Engineering"],
    "cte.health_principles": ["Principles of Health Science"],
    "cte.accounting": ["Accounting I"],
    "cte.accounting2": ["Accounting II"],
    "cte.robotics": ["Robotics I"],
    "cte.robotics2": ["Robotics II"],
    "cte.digital_electronics": ["Digital Electronics"],
  },
  TN: {
    "ela.9": ["English Language Arts I"],
    "ela.10": ["English Language Arts II"],
    "ela.11": ["English Language Arts III"],
    "ela.12": ["English Language Arts IV"],
    "sci.bio2": ["Biology II"],
    "sci.chem2": ["Chemistry II"],
    "sci.phys2": ["Physics II"],
    "sci.anat": ["Human Anatomy and Physiology"],
    "sci.earth": ["Geology"],
    "sci.env": ["Ecology"],
    "sci.research": ["Scientific Research"],
    "ss.us_hist": ["United States History and Geography"],
    "ss.us_gov": ["United States Government and Civics"],
    "health.health": ["Health Education"],
    "cs.cyber": ["Cybersecurity I"],
    "cs.data_science": ["Data Science I"],
    "arts.art_history": ["Visual Art History"],
    "other.jrotc": ["JROTC I", "JROTC II", "JROTC III", "JROTC IV"],
    "cte.accounting": ["Accounting I"],
    "cte.digital_electronics": ["Digital Electronics"],
    "cte.landscape_design": ["Landscaping & Turf Science"],
  },
  UT: {
    "ela.9": ["ELA 9"],
    "ela.10": ["ELA 10"],
    "math.college_prep": ["College Prep Math"],
    "ss.world_hist": ["World Civilization"],
    "ss.world_geo": ["Geography for Life"],
    "ss.us_hist": ["U.S. History 2"],
    "pe.lifetime": ["Individual Lifetime Activities"],
    "cte.business_office": ["Business Office Specialist"],
    "cte.accounting": ["Accounting I"],
    "cte.accounting2": ["Accounting II"],
    "cte.robotics": ["Robotics 1"],
    "cte.robotics2": ["Robotics 2"],
  },
};

/**
 * Kinds whose vocabulary title isn't one class's name everywhere: catch-alls for a family of classes
 * (any PE, music or art class); Tennessee's Lifetime Wellness, which is sure only in Tennessee (its
 * state title there); and "Advanced …" titles that describe a second course ("Advanced biology" is
 * Biology II or AP Biology after Biology, but a school's "Advanced Biology" may be its first).
 */
const NOT_CANONICAL: ReadonlySet<CourseTypeId> = new Set([
  "pe.general",
  "arts.music",
  "arts.visual",
  "health.wellness",
  "sci.bio2",
  "sci.chem2",
  "sci.phys2",
  "cs.advanced",
]);

/**
 * Kinds whose general names (the vocabulary's title and common names) a state's schools also use
 * for another kind, and that kind. There, only the state's own titles for the kind are exact:
 * - Tennessee: the required Lifetime Wellness (Policy 2.103 I(14), "one (1) credit in wellness") is
 *   usually called "Health" or "Wellness" at school. The state's health class is "Health Education"
 *   (Policy 3.205 6.2, TN-S6B), which is sure.
 */
const SHARED_NAMES: Partial<Record<PlannerState, Partial<Record<CourseTypeId, CourseTypeId>>>> = {
  TN: { "health.health": "health.wellness" },
};

/**
 * Kinds a state stops offering, from the school year their replacement starts: a class with one of
 * the kind's titles from then on (or in a school year that isn't known) may be the replacement.
 * - Utah: "American Constitutional Government and Citizenship will be available to students in the
 *   2027-2028 school year" and "The U.S. Government and Citizenship course is being replaced by the
 *   American Constitutional Government and Citizenship course" (UT-S4 p. 1).
 */
const REPLACED: Partial<Record<PlannerState, Partial<Record<CourseTypeId, { from: SchoolYear; by: CourseTypeId }>>>> = {
  UT: { "ss.us_gov": { from: 2027, by: "ss.ut_acgc" } },
};

/**
 * Kinds whose college-credit version in a state is usually another kind:
 * - Utah: concurrent enrollment English 11 is ENGL 1010, college composition (ela.lang_comp).
 *   "Students who took ENGL 1010* to fulfill their level 11 ELA requirement before the 2026-2027
 *   school year or who are participating in an approved ENGL 1010 pilot, may apply that credit to
 *   the level 11 ELA requirement" (UT-S3 p. 2), so which one it is decides level 11.
 */
const COLLEGE_LEVEL_MAY_BE: Partial<Record<PlannerState, Partial<Record<CourseTypeId, CourseTypeId>>>> = {
  UT: { "ela.11": "ela.lang_comp" },
};

/**
 * First-year classes whose AP, IB or college-credit version may be the second-year type (AP Biology
 * after Biology is Advanced biology; AP Calculus BC after AB is Calculus II): a college level never
 * makes them exact.
 */
const COLLEGE_LEVEL_MAY_BE_SECOND_YEAR: ReadonlySet<CourseTypeId> = new Set(["sci.bio", "sci.chem", "sci.phys", "math.calc"]);

/** Level markers, longest first, as normalized words. "Pre-AP" is honors, never AP. */
const MARKERS: readonly [words: readonly string[], level: CourseTypeLevel, preAp?: true][] = [
  [["pre", "ap"], "honors", true],
  [["preap"], "honors", true],
  [["dual", "credit"], "dual_enrollment"],
  [["dual", "enrollment"], "dual_enrollment"],
  [["concurrent", "enrollment"], "dual_enrollment"],
  [["honors"], "honors"],
  [["honours"], "honors"],
  [["hon"], "honors"],
  [["h"], "honors"],
  [["ap"], "ap"],
  [["ce"], "dual_enrollment"],
  [["dual"], "dual_enrollment"],
];

const NUMERALS: Record<string, string> = { "1": "i", "2": "ii", "3": "iii", "4": "iv" };

/**
 * A title's words for comparing: lower case, accents and punctuation dropped ("U.S." and "U. S."
 * are "us"), "&" as "and", "/" and "+" kept as words, and 1-4 as roman numerals. A trailing
 * honors letter on a numeral ("English 10H", "Algebra 1H") is its own word.
 */
export function titleWords(title: string): string[] {
  const raw = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/([/+])/g, " $1 ")
    .replace(/[^a-z0-9/+]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const words: string[] = [];
  for (const w of raw) {
    const glued = /^(\d+|i{1,3}|iv)h$/.exec(w);
    if (glued) words.push(glued[1], "h");
    else if (w === "s" && words.at(-1) === "u") words[words.length - 1] = "us";
    else words.push(w);
  }
  return words.map((w) => NUMERALS[w] ?? w);
}

const keyOf = (words: readonly string[]) => words.join(" ");

/** One level marker at the start or the end of the title, and the title without it. */
function splitMarker(words: readonly string[]): { words: readonly string[]; level: CourseTypeLevel | null; preAp: boolean } | null {
  let found: { words: readonly string[]; level: CourseTypeLevel; preAp: boolean } | null = null;
  for (const [marker, level, preAp] of MARKERS) {
    const n = marker.length;
    if (words.length <= n) continue;
    const atStart = marker.every((m, i) => words[i] === m);
    const atEnd = marker.every((m, i) => words[words.length - n + i] === m);
    if (!atStart && !atEnd) continue;
    found = { words: atStart ? words.slice(n) : words.slice(0, words.length - n), level, preAp: preAp === true };
    break;
  }
  if (!found) return { words, level: null, preAp: false };
  // A second marker ("Honors AP Biology", "Biology H AP") isn't a plain level: not exact.
  for (const [marker] of MARKERS) {
    const n = marker.length;
    if (found.words.length <= n) continue;
    if (marker.every((m, i) => found.words[i] === m) || marker.every((m, i) => found.words[found.words.length - n + i] === m)) return null;
  }
  return found;
}

/** A vocabulary title as a class's name: the words before a parenthetical, unless they describe a kind. */
function titleName(t: CourseType): string | null {
  if (t.fallback || NOT_CANONICAL.has(t.id) || t.cte === "always" || t.id.startsWith("lang.")) return null;
  const name = t.title.split(" (")[0];
  if (/,| or |^middle school|^other /i.test(name)) return null;
  return name;
}

/** Every language's levels by their plain names ("Spanish I" … "Spanish IV"), not "another language". */
function languageNames(): [CourseTypeId, string][] {
  const roman = ["I", "II", "III", "IV"] as const;
  return LANGUAGES.filter((c) => c !== "other").flatMap((code) => roman.map((r, i): [CourseTypeId, string] => [`lang.${code}.${i + 1}` as CourseTypeId, `${LANGUAGE_NAMES[code]} ${r}`]));
}

/** An exact title and the kind it names, with where it comes from. */
export type ExactTitle = { title: string; typeId: CourseTypeId; source: "vocabulary" | "state title" | "common" | "official" };

/** Every exact title in a state, with its kind (for reviews of the tables, and tests). */
export function exactTitlesFor(state: PlannerState): ExactTitle[] {
  const out: ExactTitle[] = [];
  // A kind whose general names the state's schools use for another kind has only its state titles.
  const general = (typeId: CourseTypeId) => SHARED_NAMES[state]?.[typeId] === undefined;
  for (const t of allCourseTypes()) {
    const name = titleName(t);
    if (name && general(t.id)) out.push({ title: name, typeId: t.id, source: "vocabulary" });
    const stateTitle = t.stateTitles[state];
    if (stateTitle) out.push({ title: stateTitle, typeId: t.id, source: "state title" });
  }
  for (const [typeId, title] of languageNames()) out.push({ title, typeId, source: "vocabulary" });
  for (const [table, source] of [
    [COMMON_NAMES, "common"],
    [OFFICIAL_TITLES[state], "official"],
  ] as const) {
    for (const [typeId, titles] of Object.entries(table) as [CourseTypeId, readonly string[]][]) {
      if (source === "common" && !general(typeId)) continue;
      for (const title of titles) out.push({ title, typeId, source });
    }
  }
  return out;
}

/** Normalized title to the kinds that have it. */
type TitleIndex = Map<string, Set<CourseTypeId>>;

function indexTitles(titles: readonly ExactTitle[]): TitleIndex {
  const index: TitleIndex = new Map();
  for (const { title, typeId } of titles) {
    const key = keyOf(titleWords(title));
    index.set(key, (index.get(key) ?? new Set()).add(typeId));
  }
  return index;
}

const INDEX = new Map<PlannerState, TitleIndex>();
function indexFor(state: PlannerState): TitleIndex {
  let index = INDEX.get(state);
  if (!index) INDEX.set(state, (index = indexTitles(exactTitlesFor(state))));
  return index;
}

/** The one kind a normalized title names, or null (no kind, or two). */
function onlyKind(index: TitleIndex, words: readonly string[]): CourseTypeId | null {
  const kinds = index.get(keyOf(words));
  return kinds && kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * Two classes' names joined into one title: any "/" or "+", or an "and" ("&") with an exact title
 * of a different kind on each side ("Personal Financial Literacy and Economics"). One class's own
 * name with an "and" ("Integrated Physics and Chemistry", "U.S. Government and Civics") isn't.
 */
function joinsTwoClasses(index: TitleIndex, words: readonly string[]): boolean {
  if (words.includes("/") || words.includes("+")) return true;
  return words.some((w, i) => {
    if (w !== "and") return false;
    const left = onlyKind(index, words.slice(0, i));
    const right = onlyKind(index, words.slice(i + 1));
    return left !== null && right !== null && left !== right;
  });
}

/** The level a title's one marker names ("English 11 CE" is dual enrollment), or null without one. */
export function titleMarkerLevel(name: string): CourseTypeLevel | null {
  return splitMarker(titleWords(name))?.level ?? null;
}

/** Whether a typed title, without its marker, is one of the state's own titles for the kind. */
function isStateTitle(name: string, typeId: CourseTypeId, state: PlannerState): boolean {
  const split = splitMarker(titleWords(name));
  if (!split) return false;
  const key = keyOf(split.words);
  const own = [getCourseType(typeId).stateTitles[state], ...(OFFICIAL_TITLES[state][typeId] ?? [])];
  return own.some((t) => t !== undefined && keyOf(titleWords(t)) === key);
}

/** What's known about a row besides its name: its level, and its school year (null: not known). */
export type RowFacts = { level: CourseTypeLevel; schoolYear: SchoolYear | null };

/**
 * Other kinds a row named `name`, read as `typeId`, may really be in the state's schools, where they
 * use the kind's name for another kind: a general name of a kind whose names they share
 * (Tennessee's "Health" may be Lifetime Wellness), a retired kind from the year its replacement
 * starts (Utah's U.S. Government from 2027-28 may be ACGC), and a college-credit version that's
 * usually another kind (Utah's CE English 11 may be ENGL 1010). The level is the row's, or its
 * name's marker. Such a title is never exact, and the guesser lists these kinds too.
 */
export function otherKindsInState(typeId: CourseTypeId, name: string, state: PlannerState, row: RowFacts): CourseTypeId[] {
  const out: CourseTypeId[] = [];
  const shared = SHARED_NAMES[state]?.[typeId];
  if (shared && !isStateTitle(name, typeId, state)) out.push(shared);
  const replaced = REPLACED[state]?.[typeId];
  if (replaced && (row.schoolYear === null || row.schoolYear >= replaced.from)) out.push(replaced.by);
  const college = COLLEGE_LEVEL_MAY_BE[state]?.[typeId];
  if (college) {
    const marked = titleMarkerLevel(name);
    if (isCollegeLevel(row.level) || (marked !== null && isCollegeLevel(marked))) out.push(college);
  }
  return out;
}

export type ExactCourseType = { typeId: CourseTypeId; level: CourseTypeLevel };

/**
 * The kind a typed title names exactly in the student's state, and its level (the row's, or the
 * title's marker when the row is left at regular), or null when it isn't exact: no single kind has
 * that title in the state, it joins two classes, the kind doesn't fit the row's subject, the level
 * could change the kind, or the state's schools use the title for another kind too, in the row's
 * school year (`otherKindsInState`; null: not known, so a retired kind is never exact). See the
 * header. `titles` stands in for the state's list (tests).
 */
export function exactCourseType(
  name: string,
  subject: CourseSubject,
  rowLevel: CourseTypeLevel,
  state: PlannerState,
  { schoolYear = null, titles }: { schoolYear?: SchoolYear | null; titles?: readonly ExactTitle[] } = {},
): ExactCourseType | null {
  const index = titles ? indexTitles(titles) : indexFor(state);
  const words = titleWords(name);
  if (words.length === 0 || joinsTwoClasses(index, words)) return null;
  const split = splitMarker(words);
  if (!split || joinsTwoClasses(index, split.words)) return null;
  const typeId = onlyKind(index, split.words);
  if (!typeId) return null;
  const type = getCourseType(typeId);
  if (type.subject !== subject && !type.altSubjects.includes(subject)) return null;
  let level = rowLevel;
  if (split.level) {
    // "Pre-AP" never makes a class AP, or any other college level.
    if (split.preAp && isCollegeLevel(rowLevel)) return null;
    if (rowLevel !== "regular" && rowLevel !== split.level) return null;
    level = split.level;
  }
  if (!type.levels.includes(level)) return null;
  if (isCollegeLevel(level) && COLLEGE_LEVEL_MAY_BE_SECOND_YEAR.has(typeId)) return null;
  if (otherKindsInState(typeId, name, state, { level, schoolYear }).length > 0) return null;
  return { typeId, level };
}
