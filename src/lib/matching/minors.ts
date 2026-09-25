/**
 * Which careers the match lists leave out or thin out. Students are in grades 7–12, nearly all under
 * 18, and the free quiz never knows anyone's age, so these rules apply to every match list (see
 * rankOccupations and shownMatches in ./match). They change only the matches: search and browse on
 * /careers still find every career.
 *
 * Kept small and conservative on purpose. A career is left out only when the work itself is
 * for adults (gambling, serving alcohol), never because it seems unusual, low-paid or hard to get
 * into. Everything else is thinned out at most (MATCH_FAMILIES). `npm run check:matching` checks the
 * rules against the real O*NET data. After a change here is deployed, `npm run matches:refill`
 * remakes stored match lists that the new rules shorten (see docs/operations.md).
 */

/**
 * O*NET-SOC codes never shown as matches, with the title they have in O*NET 31.0 and a one-line
 * reason. Casino gaming jobs are for adults (21 and over in most states, 18 in some); state laws
 * set the minimum age for serving alcohol between 18 and 21.
 */
export const NOT_MATCHED_FOR_MINORS: Readonly<Record<string, { title: string; reason: string }>> = {
  "11-9071.00": { title: "Gambling Managers", reason: "Runs casino gaming or betting operations: adults-only work." },
  "33-9031.00": {
    title: "Gambling Surveillance Officers and Gambling Investigators",
    reason: "Watches casino gaming for cheating and theft: adults-only work.",
  },
  "39-1013.00": { title: "First-Line Supervisors of Gambling Services Workers", reason: "Supervises casino games and betting: adults-only work." },
  "39-3011.00": { title: "Gambling Dealers", reason: "Deals casino table games: adults-only work." },
  "39-3012.00": { title: "Gambling and Sports Book Writers and Runners", reason: "Takes bets and pays out winnings: adults-only work." },
  "39-3019.00": {
    title: "Gambling Service Workers, All Other",
    reason: "Other casino gaming work (also left out as a catch-all title): adults-only work.",
  },
  "41-2012.00": { title: "Gambling Change Persons and Booth Cashiers", reason: "Exchanges cash and chips on a casino floor: adults-only work." },
  "43-3041.00": { title: "Gambling Cage Workers", reason: "Handles cash and chips in a casino cage: adults-only work." },
  "35-3011.00": { title: "Bartenders", reason: "Mixes and serves alcohol, which state laws limit to adults (18 to 21 and over)." },
};

/**
 * Careers whose titles name gambling or bartending but that stay in the matches, and why. Listed so
 * that `npm run check:matching` can flag any other such title a new O*NET release adds.
 */
export const REVIEWED_AND_KEPT: Readonly<Record<string, { title: string; reason: string }>> = {
  "11-9072.00": {
    title: "Entertainment and Recreation Managers, Except Gambling",
    reason: "Runs parks, theaters and recreation programs, not gambling.",
  },
  "39-1014.00": {
    title: "First-Line Supervisors of Entertainment and Recreation Workers, Except Gambling Services",
    reason: "Supervises recreation and entertainment staff, not gambling.",
  },
  "35-9011.00": {
    title: "Dining Room and Cafeteria Attendants and Bartender Helpers",
    reason: "Mostly clearing tables and restocking, a common first job; the bar-helper part is left to state rules.",
  },
};

/** Whether a career may be shown as a match (see NOT_MATCHED_FOR_MINORS). */
export function isAllowedForMinors(code: string): boolean {
  return !Object.hasOwn(NOT_MATCHED_FOR_MINORS, code);
}

/** A college teaching job: "Chemistry Teachers, Postsecondary", "Nursing Instructors and Teachers, Postsecondary". */
export function isPostsecondaryTeacher(title: string): boolean {
  return /\bTeachers, Postsecondary$/i.test(title);
}

/**
 * Kinds of careers a results group shows at most one of, the best-ranked. Each matches careers by
 * code or title, so a new O*NET release that adds a similar title is covered.
 *
 * - "postsecondary-teacher": O*NET 31.0 has 35 "… Teachers, Postsecondary" careers, one per college
 *   subject, with much the same interest profile. One is enough to show a student that teaching
 *   college is a path; before this rule, up to four of them filled a Social, Artistic or
 *   Investigative student's list.
 * - "model": Models (SOC 41-9012, with any O*NET specialties under it): a narrow field, so one spot
 *   is plenty.
 */
export const MATCH_FAMILIES = [
  { id: "postsecondary-teacher", matches: (c: { code: string; title: string }) => isPostsecondaryTeacher(c.title) },
  { id: "model", matches: (c: { code: string; title: string }) => c.code.startsWith("41-9012") },
] as const;

export type MatchFamily = (typeof MATCH_FAMILIES)[number]["id"];

/** The family a career belongs to (see MATCH_FAMILIES), or null. */
export function matchFamily(career: { code: string; title: string }): MatchFamily | null {
  return MATCH_FAMILIES.find((f) => f.matches(career))?.id ?? null;
}
