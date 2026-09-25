import { getCourseType } from "../course-types";
import type { Selector } from "../rules";
import type { Item } from "./model";
import { atLeast } from "./util";

// Selector matching (rules.ts): fields AND together, a list of selectors ORs. A guessed
// ("assumed") type never matches a selector that names types or capabilities.

/** Whether the selector names something a guess can't prove (a type or a capability). */
export function isSpecific(sel: Selector): boolean {
  return sel.types !== undefined || sel.capabilities !== undefined;
}

function matchesFields(item: Item, sel: Selector, ignoreAssumed: boolean): boolean {
  if (item.assumed && !ignoreAssumed && isSpecific(sel)) return false;
  if (sel.types && !sel.types.includes(item.typeId)) return false;
  if (sel.capabilities) {
    const caps = getCourseType(item.typeId).capabilities;
    if (!sel.capabilities.some((c) => caps.includes(c))) return false;
  }
  if (sel.subjects && !sel.subjects.includes(item.subject)) return false;
  if (sel.levels && !sel.levels.includes(item.level)) return false;
  if (sel.grades && !sel.grades.includes(item.grade)) return false;
  if (sel.schoolYears) {
    const { from, to } = sel.schoolYears;
    if (from !== undefined && item.schoolYear < from) return false;
    if (to !== undefined && item.schoolYear > to) return false;
  }
  if (sel.minLetter && item.completed) {
    // A finished class needs the letter; an unknown letter (none recorded) isn't held against it,
    // but P (pass) doesn't show the minimum.
    if (item.letter === "P") return false;
    if (item.letter !== null && atLeast(item.letter, sel.minLetter) === false) return false;
  }
  if (sel.cte !== undefined && item.cte !== sel.cte) return false;
  if (sel.lab && item.lectureOnly) return false;
  if (sel.exclude && sel.exclude.includes(item.typeId)) return false;
  return true;
}

export function matchesAny(item: Item, sels: readonly Selector[]): boolean {
  return sels.some((s) => matchesFields(item, s, false));
}

/** A guessed class that would count if the student confirmed its type ("Guessed class type"). */
export function wouldMatchIfConfirmed(item: Item, sels: readonly Selector[]): boolean {
  return item.assumed && !matchesAny(item, sels) && sels.some((s) => matchesFields(item, s, true));
}

/**
 * How specific a requirement is, 0 (a named class) to 5 (any elective), so broad requirements take
 * leftovers last (design §5.5).
 */
export function selectorSpecificity(sels: readonly Selector[]): number {
  let best = 4;
  for (const s of sels) {
    const score = s.types ? (s.types.length <= 3 ? 0 : 1) : s.capabilities ? 1 : s.subjects ? (s.levels || s.cte !== undefined ? 2 : 3) : 2;
    best = Math.min(best, score);
  }
  return best;
}
