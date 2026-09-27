import type { PlannerState } from "../common";
import { type CourseTypeId, getCourseType } from "../course-types";
import type { PlannerChoices } from "../engine-io";
import { ladderFamily, mathRankOf, rungTypes } from "./ladder";
import { countsForSequence, type Item } from "./model";

// ---------------------------------------------------------------------------
// Typed classes whose names didn't place them (design §5.2 name guesses). A guess that fell to its
// subject's "Other" class ("Honors Math 9", "Lit & Comp 10") never counts for a requirement that
// names a class, so the plan would add that class again, or call it impossible, for a student who
// is almost certainly taking it. Where such a row sits exactly where a named class would (an
// English level in its own grade, the next math rung), the plan takes it as that class. It stays a
// guess: the audit flags it and the counselor questions ask whether it counts that way.
// ---------------------------------------------------------------------------

/** The English level each grade takes (English I in 9th ... English IV in 12th). */
const ENGLISH_BY_GRADE: Partial<Record<number, CourseTypeId>> = { 9: "ela.9", 10: "ela.10", 11: "ela.11", 12: "ela.12" };

/** English classes that are a grade's own English level (or stand in for it). */
function englishLevel(typeId: CourseTypeId): boolean {
  return getCourseType(typeId).ladder?.id === "ela";
}

/**
 * The student's guessed rows with a provisional type: an "Other English class" in a high school
 * grade with no other English level that year is that grade's English; an "Other math class" in a
 * year without another math class on the ladder is the next rung (Algebra I, Geometry, Algebra II
 * or the state's equivalents), when that rung usually comes in that grade or the one before, and
 * never a rung the family opted out of in writing (Utah's Secondary Math III: the row is more
 * likely the applied class that takes its place, which only the student can say). Rows the name
 * placed, and the student's own picks, are never changed.
 */
export function placeGuesses(state: PlannerState, items: Item[], choices: PlannerChoices = {}): Item[] {
  const out = [...items];
  const guessed = (i: Item, fallback: CourseTypeId) => i.own && i.assumed && i.typeId === fallback;
  // English: one row per grade, when the student has no English level that year or anywhere else.
  for (let k = 0; k < out.length; k++) {
    const i = out[k];
    const level = ENGLISH_BY_GRADE[i.grade];
    if (!level || !guessed(i, "ela.other")) continue;
    if (out.some((j) => j !== i && j.own && ((j.grade === i.grade && englishLevel(j.typeId)) || j.typeId === level))) continue;
    out[k] = { ...i, typeId: level, provisional: true };
  }
  // Math: in grade order, each unplaced row is the rung after the highest one reached before it.
  const family = ladderFamily(state, out);
  const order = out.map((i, k) => ({ i, k })).filter(({ i }) => guessed(i, "math.other") && (i.grade >= 9 || i.hsCredit)).sort((a, b) => a.i.grade - b.i.grade);
  for (const { k } of order) {
    const i = out[k];
    if (out.some((j) => j !== i && j.own && j.grade === i.grade && (mathRankOf(j.typeId) ?? 0) >= 1)) continue;
    const reached = Math.max(0, ...out.filter((j) => j.own && j.grade < i.grade && countsForSequence(j)).map((j) => mathRankOf(j.typeId) ?? 0));
    const rank = reached + 1;
    // Past the ladder's first three rungs, or a rung the student takes later under its own name.
    if (rank > 3 || out.some((j) => j.own && j.grade > i.grade && mathRankOf(j.typeId) === rank)) continue;
    if (rank === 3 && choices.utMath3OptOut) continue;
    const typeId = rungTypes(family, rank)[0];
    // A student a year behind the usual order still fits (Algebra I in 10th); a senior's only
    // recorded class isn't taken for Algebra I.
    if (i.grade > getCourseType(typeId).grades[1] + 1) continue;
    out[k] = { ...i, typeId, provisional: true };
  }
  return out;
}
