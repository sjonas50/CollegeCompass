import type { PlannerState } from "../common";
import { guessCourseType } from "../course-type-guess";
import { type CourseTypeId, courseTypesForSubject, getCourseType } from "../course-types";
import type { CourseFact } from "../engine-io";
import type { Selector } from "../rules";
import { leafAccepts, type LeafResult } from "./allocate";
import type { CLeaf } from "./compile";
import { isLadderish, mathRankOf } from "./ladder";
import { countsForSequence, type Item } from "./model";
import { matchesAny } from "./select";

// ---------------------------------------------------------------------------
// Confirm first (the owner's rule for guessed class kinds). A class the student typed without
// picking its kind is a guess, and a guess must never, by itself, make the plan claim something:
// a requirement that's missing ("Room to add", "doesn't fit", "Needs a plan now"), a class
// "Required by" a rule when the student's row might already be that class, or a different route
// (an endorsement, a Plan B). The engine uses a guess only where it can't produce a false claim:
// to pick the next rung, and to avoid suggesting a class the student probably has. Everything a
// guess decides waits on the student to confirm the class ("Waiting on you to confirm a class").
//
// A row "might count" toward a requirement when one of the kinds it might be would count there,
// while the row as a guess (by its subject alone) wouldn't. The kinds it might be come from the
// guesser (course-type-guess.ts `candidates`): its guess, another rung its name also names, the
// family a catch-all name stands for ("PE" is any PE class), a kind the state's schools also use
// the name for in the row's year and at its level (Tennessee's "Health" may be Lifetime Wellness),
// or, for a name the guesser couldn't place, any kind of class in its subject that usually comes
// in or next to its grade.
// ---------------------------------------------------------------------------

/**
 * Every kind an unconfirmed row might be, its own (guessed) kind first, and whether the guesser
 * couldn't place its name at all (`open`: then any kind in its subject around its grade);
 * undefined when confirmed.
 */
export function mightBeKinds(fact: CourseFact, state: PlannerState): { kinds: CourseTypeId[]; open: boolean } | undefined {
  if (!fact.assumed) return undefined;
  const guess = guessCourseType(fact.name, fact.subject, state, { level: fact.level, schoolYear: fact.schoolYear });
  const open = getCourseType(fact.typeId).fallback || getCourseType(guess.typeId).fallback;
  if (!open) return { kinds: [...new Set([fact.typeId, ...guess.candidates])], open };
  const nearby = courseTypesForSubject(fact.subject)
    .filter((t) => t.fallback || (fact.grade >= t.grades[0] - 1 && fact.grade <= t.grades[1] + 1))
    .map((t) => t.id);
  return { kinds: [...new Set([fact.typeId, ...nearby])], open };
}

/**
 * A class the plan shouldn't add because a row the student hasn't confirmed might already be it:
 * another kind its name names (Biology for a typed "Biology" the guesser read as Chemistry), or one
 * of the family a catch-all name stands for. Not for a name the guesser couldn't place (it might be
 * anything in its subject; the plan follows the class its place says it is).
 */
export function mightAlreadyBe(items: readonly Item[], typeId: CourseTypeId): boolean {
  return items.some((i) => i.own && i.unconfirmed && !i.unplaced && countsForSequence(i) && i.typeId !== typeId && i.unconfirmed.includes(typeId));
}

/** The row as one of the kinds it might be (subject and career-class flag follow the kind). */
export function probeAs(item: Item, typeId: CourseTypeId): Item {
  const t = getCourseType(typeId);
  const cte = t.cte === "always" || (t.cte === "sometimes" && item.subject === "career_technical");
  return { ...item, typeId, assumed: false, subject: t.subject, cte };
}

/** As a guess, the row counts only by its subject (design §5.4). */
function asGuess(item: Item): Item {
  return { ...item, assumed: true };
}

/**
 * Some other kind the row might be counts toward these selectors, where the row as a guess
 * doesn't. Its planned kind (the guess) isn't one: the plan already counts the row as that kind
 * wherever it helps most, so confirming the guess changes nothing (a typed "Physics" counted as the
 * 3rd science doesn't make the 4th science wait).
 */
export function mightCount(item: Item, sels: readonly Selector[]): boolean {
  if (!item.unconfirmed || !item.creditable) return false;
  if (matchesAny(asGuess(item), sels)) return false;
  return item.unconfirmed.some((t) => t !== item.typeId && matchesAny(probeAs(item, t), sels));
}

function languageCode(typeId: CourseTypeId): string | null {
  const ladder = getCourseType(typeId).ladder?.id;
  return ladder?.startsWith("lang.") ? ladder.slice(5) : null;
}

function unconfirmedRows(result: LeafResult | null | undefined, items: readonly Item[]): Item[] {
  const counted = new Set((result?.counted ?? []).map((c) => c.item.key));
  return items.filter((i) => i.own && i.unconfirmed && i.creditable && !counted.has(i.key));
}

/**
 * Unconfirmed rows that might be a class this requirement counts (another kind they might be would
 * count here): no class is added for it, since it might repeat the row.
 */
export function mightBeRows(leaf: CLeaf, result: LeafResult | null | undefined, items: readonly Item[]): Item[] {
  const rows = unconfirmedRows(result, items);
  if (rows.length === 0) return [];
  const req = leaf.req;
  if (req.kind === "same_language") {
    const first = result?.counted[0]?.item;
    const code = first ? languageCode(first.typeId) : null;
    return rows.filter((i) => i.subject === "world_language" && i.unconfirmed!.some((t) => t !== i.typeId && (code === null || languageCode(t) === code)));
  }
  if (req.kind !== "credits" && req.kind !== "count") return [];
  return rows.filter((i) => !leafAccepts(leaf, asGuess(i)) && i.unconfirmed!.some((t) => t !== i.typeId && leafAccepts(leaf, probeAs(i, t))));
}

/**
 * Unconfirmed math rows at or above the rung a requirement names (by its deadline): the plan counts
 * the rung as passed only because of the guess, so the requirement is never called missing. A class
 * for it may still be added where one fits (the row isn't that class).
 */
export function pastRungRows(leaf: CLeaf, result: LeafResult | null | undefined, items: readonly Item[]): Item[] {
  const req = leaf.req;
  if (req.kind !== "credits" && req.kind !== "count") return [];
  const rung = isLadderish(req.select);
  if (rung === null) return [];
  const deadline = req.kind === "credits" ? req.deadlineGrade : undefined;
  return unconfirmedRows(result, items).filter((i) => {
    const at = i.term === "summer" ? i.grade + 1 : i.grade;
    return !leafAccepts(leaf, asGuess(i)) && countsForSequence(i) && (mathRankOf(i.typeId) ?? 0) >= rung && (deadline === undefined || at <= deadline);
  });
}

/**
 * A requirement on the audit's route and what a guess decides there:
 * - `shaky`: the student's guessed rows it counts that it wouldn't count as guesses (a typed
 *   "Algebra II" counted as Algebra II): met only if the student confirms them;
 * - `waiting`: unconfirmed rows that might count toward it, but don't on this route (or that put
 *   the student past the rung it names);
 * - `waits`: the requirement's status is the student's to settle: it's met only by counting a
 *   guess, or it's short (or met by a suggestion) while a row might count, or it's short only
 *   because a guessed row puts the student past its rung. A requirement still short with its
 *   guesses counted, and no row that might make up the rest, is really short: "Room to add",
 *   flagged "Guessed class type".
 */
export function guessState(leaf: CLeaf, result: LeafResult, items: readonly Item[]): { shaky: LeafResult["counted"]; waiting: Item[]; waits: boolean; strictMissing: number } {
  const req = leaf.req;
  const guessed = (i: Item) => i.own && i.unconfirmed !== undefined;
  const shaky =
    req.kind === "credits" || req.kind === "count"
      ? result.counted.filter((c) => guessed(c.item) && !leafAccepts(leaf, asGuess(c.item)))
      : req.kind === "same_language"
        ? result.counted.filter((c) => guessed(c.item))
        : [];
  let firm = 0;
  let planned = 0;
  for (const c of result.counted) {
    if (shaky.includes(c)) continue;
    if (c.item.firm) firm += c.amount;
    else planned += c.amount;
  }
  firm = Math.min(firm, result.required);
  planned = Math.min(planned, result.required - firm);
  const strictMissing = result.required - firm - planned;
  const might = mightBeRows(leaf, result, items);
  const past = pastRungRows(leaf, result, items);
  const waiting = [...new Set([...might, ...past])];
  const suggested = result.counted.some((c) => !c.item.own);
  const waits = (shaky.length > 0 && result.missing === 0) || (might.length > 0 && (strictMissing > 0 || suggested)) || (past.length > 0 && strictMissing > 0);
  return { shaky, waiting, waits, strictMissing };
}

/**
 * The kinds the waiting rows might be that would meet the requirement (Algebra II for a typed
 * "Algebra II/Trig" read as Trigonometry): what a class held for the confirmation would be.
 */
export function waitingKinds(rows: readonly Item[], accepts: (probe: Item) => boolean): CourseTypeId[] {
  return [...new Set(rows.flatMap((i) => i.unconfirmed!.filter((t) => t !== i.typeId && accepts(probeAs(i, t)))))];
}

/** Unconfirmed rows, not counted yet, that might count toward a need's selectors (major prep). */
export function waitingForSelectors(sels: readonly Selector[], counted: ReadonlySet<string>, items: readonly Item[]): Item[] {
  return items.filter((i) => i.own && !counted.has(i.key) && mightCount(i, sels));
}
