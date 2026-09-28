import type { CourseStatus } from "@/db/schema";
import type { LetterGrade } from "@/lib/courses/catalog";
import { type PlannerState, type SchoolGrade } from "../../common";
import { type CourseTypeId, getCourseType } from "../../course-types";
import type { CatalogCourse, CatalogView, CollegeTarget, PlannerInput } from "../../engine-io";
import { FAMILY_IDS, type FamilyId } from "../../families";
import { TN_ELECTIVE_FOCUSES, TX_ENDORSEMENTS } from "../../rules";
import { COLLEGES, contentFor, type CourseSpec, scenario } from "./input";

// Seeded random students, targets, limits and school lists for the property tests. Same seed,
// same inputs, so a failure can be replayed.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = ReturnType<typeof rng>;

export const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const chance = (r: Rand, p: number) => r() < p;

const LETTERS: LetterGrade[] = ["A", "A-", "B+", "B", "B-", "C", "C-", "D", "F", "W", "P"];

const COLLEGES_BY_STATE: Record<PlannerState, CollegeTarget[]> = {
  TX: [COLLEGES.utAustin, COLLEGES.tamu, COLLEGES.austinCc],
  TN: [COLLEGES.utk, COLLEGES.utc, COLLEGES.utm],
  UT: [COLLEGES.usu, COLLEGES.uofu],
};

/** A random school list built from the state's generic list: some types dropped, grades printed, a few prerequisites. */
export function randomSchoolList(r: Rand, state: PlannerState, schoolYear: number): CatalogView {
  const generic = contentFor(state).genericCatalog;
  const courses: CatalogCourse[] = [];
  for (const c of generic.courses) {
    if (chance(r, 0.15)) continue;
    for (const level of c.levels) {
      const type = getCourseType(c.typeId);
      const units = c.units ?? type.units;
      courses.push({
        id: `r-${c.typeId}-${level}`,
        typeId: c.typeId,
        level,
        subject: type.subject,
        title: `Local ${type.title}`,
        units,
        grades: chance(r, 0.4) ? ([9, 10, 11, 12] as SchoolGrade[]).filter(() => chance(r, 0.7)) : null,
        terms: units <= 2 ? ["fall", "spring"] : ["full_year"],
        prereqs: [],
        approvals: chance(r, 0.1) ? ["teacher_recommendation"] : [],
        cte: type.cte === "always",
        lectureOnly: false,
        delivery: "in_person",
        firstSchoolYear: null,
        everyOtherYear: chance(r, 0.05),
      });
    }
  }
  // A few printed prerequisites between rows, sometimes a loop.
  for (let i = 0; i < 4 && courses.length > 2; i++) {
    const a = pick(r, courses);
    const b = pick(r, courses);
    if (a !== b) a.prereqs = [{ anyOf: [{ catalogId: b.id }] }];
  }
  for (const c of courses) if (c.grades && c.grades.length === 0) c.grades = null;
  return {
    id: `random-${state}`,
    source: chance(r, 0.5) ? "school_published" : "school_family",
    state,
    schoolYear,
    lastYears: chance(r, 0.2),
    classesPerYear: chance(r, 0.5) ? pick(r, [6, 7, 8]) : null,
    schedule: "traditional",
    localTotalUnits: chance(r, 0.2) ? pick(r, [96, 104, 112]) : null,
    confirmedSubjects: chance(r, 0.7) ? "all" : ["english", "math", "science", "social_studies"],
    courses,
  };
}

/** A random student in a planner state, with classes in the grades before and during this one. */
export function randomInput(seed: number): PlannerInput {
  const r = rng(seed);
  const state: PlannerState = pick(r, ["TX", "TN", "UT"] as const);
  const grade = pick(r, [7, 8, 9, 9, 10, 10, 11, 11, 12] as SchoolGrade[]);
  const month = pick(r, [9, 1, 4, 6]);
  const schoolYear = 2026;
  const generic = contentFor(state).genericCatalog.courses.map((c) => c.typeId);
  const extra: CourseTypeId[] = ["sci.ipc", "math.int1", "cs.prog1", "ss.psych", "cte.health_principles", "arts.theatre", "lang.fr.1", "math.applied.models"];
  const courses: CourseSpec[] = [];
  const lastGrade = month === 6 ? grade : grade;
  for (let g = Math.max(7, grade - 3); g <= Math.min(12, lastGrade); g++) {
    const count = g < 9 ? pick(r, [0, 1, 2]) : pick(r, [3, 5, 6, 7]);
    for (let i = 0; i < count; i++) {
      const typeId = chance(r, 0.85) ? pick(r, generic) : pick(r, extra);
      const type = getCourseType(typeId);
      const past = g < grade || month === 6;
      const status: CourseStatus = past ? "completed" : "in_progress";
      courses.push({
        type: typeId,
        grade: g as SchoolGrade,
        level: chance(r, 0.25) ? pick(r, type.levels) : "regular",
        status,
        letter: status === "completed" ? pick(r, LETTERS) : null,
        assumed: chance(r, 0.15),
        hsCredit: g >= 9 || chance(r, 0.3),
      });
    }
  }
  // A few planned rows in later grades.
  for (let i = 0; i < pick(r, [0, 0, 1, 3]); i++) {
    const g = Math.min(12, grade + 1 + Math.floor(r() * 2)) as SchoolGrade;
    if (g <= grade) continue;
    const typeId = pick(r, generic);
    courses.push({ type: typeId, grade: g, status: "planned", level: chance(r, 0.4) ? pick(r, getCourseType(typeId).levels) : "regular" });
  }
  const families: FamilyId[] = [];
  for (let i = 0; i < pick(r, [0, 1, 1, 2]); i++) {
    const f = pick(r, ["engineering", "computer_data_science", "nursing", "construction_trades", "business", ...FAMILY_IDS] as FamilyId[]);
    if (!families.includes(f)) families.push(f);
  }
  const colleges: CollegeTarget[] = COLLEGES_BY_STATE[state].filter(() => chance(r, 0.35));
  const catalogs: PlannerInput["catalogs"] = {};
  if (chance(r, 0.35)) {
    const list = randomSchoolList(r, state, schoolYear);
    for (const g of [9, 10, 11, 12] as SchoolGrade[]) if (chance(r, 0.8)) catalogs[g] = list;
  }
  const choices: PlannerInput["prefs"]["choices"] = {};
  if (state === "TX") {
    if (chance(r, 0.6)) choices.txEndorsements = [pick(r, TX_ENDORSEMENTS)];
    if (chance(r, 0.1)) choices.txFoundationOnly = true;
    if (chance(r, 0.2)) choices.txAimDla = chance(r, 0.5);
    if (chance(r, 0.1)) choices.txArtsHumanitiesScienceSwap = true;
  }
  if (state === "TN") {
    if (chance(r, 0.6)) choices.tnElectiveFocus = pick(r, TN_ELECTIVE_FOCUSES);
    if (chance(r, 0.15)) choices.tnWorldLanguageWaiver = true;
    if (chance(r, 0.1)) choices.tnFineArtsWaiver = true;
  }
  if (state === "UT") {
    if (chance(r, 0.15)) choices.utMath3OptOut = true;
    if (chance(r, 0.15)) choices.utMathCompetencyMet = true;
  }
  if (chance(r, 0.1)) choices.worldLanguage = pick(r, ["es", "fr"] as const);
  if (chance(r, 0.15)) choices.ctePathway = { cluster: pick(r, ["health", "architecture_construction", "engineering"] as const) };
  const input = scenario({
    state,
    grade,
    month,
    schoolYear,
    courses,
    families,
    colleges,
    path: pick(r, ["degree", "degree", "training", "undecided"] as const),
    choices,
    catalogs,
    limits: {
      maxCollegeLevelPerYear: pick(r, [0, 1, 2, 3, 3, 3, 4]),
      classesPerYear: chance(r, 0.3) ? pick(r, [5, 6, 7, 8]) : null,
      accelerateMath: chance(r, 0.3),
      allowSummer: chance(r, 0.8),
      allowOnline: chance(r, 0.8),
      allowCollegeCredit: chance(r, 0.8),
    },
  });
  // Dismiss a couple of plausible suggestion keys.
  if (chance(r, 0.3)) input.prefs.dismissed = [`prep:${families[0] ?? "nursing"}/sci.chem/regular`, `tx.fhsp.grad/arts/arts.visual/regular`];
  return input;
}
