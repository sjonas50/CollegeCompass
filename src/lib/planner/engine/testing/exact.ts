import { expect, it } from "vitest";
import { exactRowType } from "../../course-type-guess";
import { getCourseType } from "../../course-types";
import type { PlannedPath, PlannerInput } from "../../engine-io";
import { plan } from "../index";
import { type Claim, claimsOnWaiting, extraClaims } from "./claims";
import { typedInputs } from "./input";

// Test helper: typed students as the app resolves them. The app takes a typed name that's an exact
// title in the student's state as that kind, confirmed (course-type-guess.ts resolveRowCourseType,
// exact-titles.ts); every other typed name stays a guess. An exact title must never make the plan
// claim what the student's real classes wouldn't (testing/claims.ts).

/**
 * The input with each guessed row whose name is an exact title in the state taken as that kind,
 * confirmed, the way service.ts `courseFacts` builds it. The same object when no name is exact.
 */
export function withExactTitles(input: PlannerInput): PlannerInput {
  const state = input.state;
  if (!state) return input;
  let changed = false;
  const courses = input.courses.map((c) => {
    if (!c.assumed) return c;
    const exact = exactRowType(c.name, c.subject, c.level, state, c.schoolYear);
    if (!exact) return c;
    changed = true;
    const type = getCourseType(exact.typeId);
    const cte = type.cte === "always" || (type.cte === "sometimes" && c.subject === "career_technical");
    return { ...c, typeId: exact.typeId, level: exact.level, typeSource: "exact" as const, assumed: false, subject: type.subject, cte };
  });
  return changed ? { ...input, courses } : input;
}

/** Every guessed row confirmed as the kind the test gave it: the student's real classes. */
export function allConfirmed(input: PlannerInput): PlannerInput {
  return { ...input, courses: input.courses.map((c) => (c.assumed ? { ...c, assumed: false, typeSource: "student" as const, subject: getCourseType(c.typeId).subject } : c)) };
}

function plannedPath(input: PlannerInput): PlannedPath {
  const result = plan(input);
  if (result.mode === "no_state") throw new Error("expected a planned path");
  return result;
}

/**
 * What a typed student gains wrongly once the app counts its exact titles: claims the truth (the
 * same student with the right kinds confirmed; by default the kinds the test gave the rows) doesn't
 * make and claims about requirements waiting on a confirmation, that the student with every typed
 * kind guessed doesn't make already (a typed kind the guesser wouldn't give, as in the random
 * students, can make a claim of its own). Empty for a student with no exact title. With the test's
 * own kinds as the truth it can't see an exact title read as the wrong kind: `misreadClaims` does.
 */
export function exactTitleClaims(input: PlannerInput, truth?: PlannedPath): Claim[] {
  const app = withExactTitles(input);
  if (app === input) return [];
  const real = truth ?? plannedPath(allConfirmed(input));
  const wrong = (path: PlannedPath) => [...extraClaims(path, real), ...claimsOnWaiting(path).map((c) => `waiting ${c}`)];
  const before = new Set(wrong(plannedPath(input)));
  return wrong(plannedPath(app)).filter((c) => !before.has(c));
}

/**
 * What the app claims wrongly about a student whose typed class isn't what its name says (`input`:
 * the typed student, each typed row with the guesser's kind, as the app reads it; `truth`: the same
 * student with the real kinds confirmed, such as a Tennessee "Health" that's Lifetime Wellness or a
 * Utah "U.S. Government" in 2028-29 that's the new ACGC): claims the truth doesn't make, and claims
 * about requirements waiting on a confirmation. Nothing the guessed run makes anyway is set aside
 * (unlike `exactTitleClaims`): a row read as an exact title is never asked about, so a claim it
 * makes, even one its guess made too, is one the student has no prompt to fix.
 */
export function misreadClaims(input: PlannerInput, truth: PlannedPath): Claim[] {
  const app = plannedPath(withExactTitles(input));
  return [...extraClaims(app, truth), ...claimsOnWaiting(app).map((c) => `waiting ${c}`)];
}

/**
 * A test to put last in a regression file: every typed student the file built with `scenario`
 * (in the order its tests ran) claims nothing new once its exact titles count as their kinds.
 */
export function auditExactTitles(atLeast: number) {
  it("typed students again, as the app reads them: an exact title adds no claim the confirmed classes wouldn't make", () => {
    let audited = 0;
    for (const input of typedInputs) {
      if (withExactTitles(input) === input) continue;
      const names = input.courses.filter((c) => c.assumed).map((c) => c.name);
      expect(exactTitleClaims(input), `${input.state} ${input.student.grade}th: ${names.join(", ")}`).toEqual([]);
      audited++;
    }
    expect(audited).toBeGreaterThanOrEqual(atLeast);
  });
}
