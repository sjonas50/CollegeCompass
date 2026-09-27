import type { SchoolGrade } from "../common";
import { GAP_OPTION_KINDS, type GapOptionKind, type OptionFact } from "../content-types";
import { courseTypeTitle, type CourseTypeId, getCourseType, levelLabel } from "../course-types";
import type { ByWhen, Gap, GapOption, Reason, UpToThree } from "../engine-io";
import { MATH_TARGET_DEFS } from "../families";
import { earlyWithoutCredit, expandedResults, type RuleSetEval } from "./audit";
import type { CLeaf } from "./compile";
import { type Ctx, leafPriority, rowIsOffered, schoolYearOfGrade } from "./context";
import { algebra2Reason, reason, requirementReason } from "./explain";
import { type BlockReason, failedAttempt, type FillResult, isRepeatable, lateEnglish, pastCteLevel, pastIntro, prereqsMetIn, probe, sameContent } from "./fill";
import { type LadderMoves, type LadderSolution, mathRankOf, rungName, rungTypes, solveLadder, startRank } from "./ladder";
import { countsForSequence, type Item, slotHalves } from "./model";
import { isLadderish, type Need } from "./needs";
import { matchesAny } from "./select";
import { atLeast, creditNoun, nth } from "./util";
import { toCredits } from "../common";

// ---------------------------------------------------------------------------
// Gaps and options (design §5.8): an unmet P0-P3 need or an infeasible math target, with at most
// three checked options from a fixed menu, least extra load first, "ask your counselor" always
// last. Each option shows only where the state's facts (and the student's own limits) allow it.
// Options never ask about income and never promise anything.
// ---------------------------------------------------------------------------

const ASK: GapOption = {
  kind: "ask_counselor",
  text: "Ask your counselor",
  note: "Your counselor knows your school's classes and can check your options.",
  closes: null,
  adds: [],
  citations: [],
};

/** Options that actually add a way to meet the need (as opposed to lowering it). */
const SOLVING: GapOptionKind[] = ["test_score", "summer", "credit_recovery", "double_up", "state_online", "college_credit", "credit_by_exam"];

/** A summer class for a class the student didn't pass: a retake, not a first attempt. */
const RETAKE_SUMMER_NOTE = "A retake of a class you didn't pass, not a first attempt. Ask your counselor whether your school offers it in summer.";

function fact(ctx: Ctx, kind: OptionFact["kind"], grade: number | null): OptionFact | null {
  return ctx.facts.options.find((o) => o.kind === kind && (grade === null || !o.grades || o.grades.includes(grade as SchoolGrade))) ?? null;
}

/**
 * The state's summer option for a first attempt at a class: where it's only for students on an
 * accelerated path (Tennessee, Policy 2.103 I(20)), only for a student who opted into acceleration.
 */
function firstAttemptSummer(ctx: Ctx): OptionFact | null {
  const summer = ctx.limits.allowSummer ? fact(ctx, "summer", null) : null;
  return summer && (!summer.firstAttemptAccelerated || ctx.limits.accelerateMath) ? summer : null;
}

function lastMathBOrBetter(fill: FillResult): boolean {
  const last = fill.items.filter((i) => i.own && i.subject === "math" && i.completed && i.letter).sort((a, b) => b.grade - a.grade)[0];
  return last ? atLeast(last.letter, "B") === true : false;
}

/**
 * The class an option would add for a need: one the class lists offer that matches it and that
 * the student can take next (not one they have or have planned, not a math rung at or below the
 * highest one they've reached, its prerequisites met by the plan), the next math rung first. Null
 * when there's none: the option would name a class the student can't take ("Algebra I" for a
 * student in Algebra II), so only "Ask your counselor" is offered.
 */
function typeForNeed(ctx: Ctx, fill: FillResult, need: Need): CourseTypeId | null {
  const items = fill.items.filter((i) => countsForSequence(i));
  if (need.language) return nextLanguageType(ctx, items);
  const reached = startRank(items, 13);
  const retake = failedAttempt(fill.items, need.selectors) !== null;
  const found: { typeId: CourseTypeId; rank: number; order: number }[] = [];
  for (const grade of ctx.planGrades) {
    if (grade < 9) continue;
    const sy = schoolYearOfGrade(ctx, grade);
    for (const r of ctx.catalogs.get(grade)?.rows ?? []) {
      if (!rowIsOffered(r, grade, sy) || (retake && r.collegeLevel) || lateEnglish(fill.items, r.typeId, grade)) continue;
      if (!matchesAny(probe(r, grade, sy), need.selectors)) continue;
      if (!isRepeatable(r.typeId) && items.some((i) => sameContent(i.typeId, r.typeId))) continue;
      if (pastIntro(items, r.typeId, grade) || pastCteLevel(fill.items, r.typeId)) continue;
      const rank = mathRankOf(r.typeId);
      if (rank !== null && rank >= 1 && rank <= reached) continue;
      // Never a class the family opted out of in writing (Utah Secondary Math III).
      if (ctx.choices.utMath3OptOut && rank === 3) continue;
      if (!prereqsMetIn(items, r, grade, () => null, true)) continue;
      found.push({ typeId: r.typeId, rank: rank ?? 0, order: r.order });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return found[0]?.typeId ?? null;
}

/**
 * The next level of the student's language for a same-language requirement: the one up from their
 * highest (Spanish IV after Spanish III, never Spanish I or II), in the language they chose or the
 * one they've gone furthest in. Null when no list offers it (the counselor's call).
 */
function nextLanguageType(ctx: Ctx, items: readonly Item[]): CourseTypeId | null {
  const reached = new Map<string, number>();
  for (const i of items) {
    const l = getCourseType(i.typeId).ladder;
    if (l?.id.startsWith("lang.") && !l.id.endsWith(".other")) reached.set(l.id.slice(5), Math.max(reached.get(l.id.slice(5)) ?? 0, l.rank));
  }
  const code = ctx.choices.worldLanguage ?? [...reached.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  if (!code) return null;
  const typeId = `lang.${code}.${Math.min(4, (reached.get(code) ?? 0) + 1)}` as CourseTypeId;
  const offered = ctx.planGrades.some((g) => g >= 9 && (ctx.catalogs.get(g)?.byType.get(typeId) ?? []).some((r) => rowIsOffered(r, g, schoolYearOfGrade(ctx, g))));
  return offered ? typeId : null;
}

/** Extra summer, double-up or college-credit math that would reach the target (re-solving the ladder with more moves). */
function ladderAdds(fill: FillResult, moves: LadderMoves): LadderSolution | null {
  const problem = fill.ladder.problem;
  if (!problem) return null;
  const sol = solveLadder({ ...problem, moves });
  return sol.unmet.length < (fill.ladder.solution?.unmet.length ?? 0) ? sol : null;
}

/**
 * Whether the options that add load (summer, online, college credit, an exam) are offered: for
 * required (P0-P1) needs, and for targets the student picked (a college on their list, a career
 * goal). A labeled default target's recommendation or a scholarship's course part is information
 * with "Ask your counselor" only; college classes are never pushed for a recommendation.
 */
function loadOptionsAllowed(need: Need): boolean {
  if (need.priority <= 1) return true;
  if (need.id.startsWith("cte:")) return false;
  if (need.source === "prep") return need.familyId !== null;
  if (!need.rc) return false;
  const kind = need.rc.rs.kind;
  return !need.rc.viaStateDefault && (kind === "college_admission" || kind === "program_admission" || kind === "guaranteed_admission");
}

export function optionsFor(ctx: Ctx, fill: FillResult, need: Need, ladder: boolean): UpToThree<GapOption> {
  const lim = ctx.limits;
  const byGrade = Math.max(ctx.firstGrade, Math.min(12, need.byGrade));
  const out: GapOption[] = [];
  const type = typeForNeed(ctx, fill, need);
  const typeTitle = type ? courseTypeTitle(type, ctx.state) : `a class for ${lowerFirst(need.label)}`;
  // Acceleration (a summer, online or college math class on top of the year's own) only with the
  // student's opt-in and a B or better in their last math class (design §1, §5.13): for a math
  // sequence, and for any math class when every year left already has one (a senior's required
  // credit aside). Load options add a class the student can take next; a need that counts years
  // ("four years of high school math") gets none, since a summer class or a second class in a year
  // adds no year.
  const accelerate = lim.accelerateMath && lastMathBOrBetter(fill);
  // A class the student took and didn't pass: summer school or credit recovery retakes it (never
  // its AP version), whatever else the year holds.
  const failed = failedAttempt(fill.items, need.selectors);
  const retake = failed && type && !need.distinctGrades && sameContent(failed.typeId, type) ? failed : null;
  const yearsLeft = ctx.planGrades.filter((g) => g >= 9 && g !== ctx.inProgressGrade);
  const extraMath =
    type !== null &&
    getCourseType(type).subject === "math" &&
    yearsLeft.every((g) => fill.items.some((i) => i.grade === g && i.subject === "math" && i.term !== "summer" && countsForSequence(i))) &&
    !(ctx.inProgressGrade === 12 && need.priority === 0);
  const withLoad = loadOptionsAllowed(need) && !need.distinctGrades && (ladder ? accelerate : type !== null && (!extraMath || accelerate || retake !== null));

  for (const route of need.testRoutes) {
    out.push({ kind: "test_score", text: route.text, note: "A test score instead of a class. Scores and dates are the source's own.", closes: null, adds: [], citations: route.cite });
    break;
  }
  // A retake in summer is for anyone; a first attempt only where the state allows it for this student.
  const summer = lim.allowSummer && withLoad ? (retake && !ladder ? fact(ctx, "summer", null) : firstAttemptSummer(ctx)) : null;
  if (summer) {
    let adds: GapOption["adds"] = [];
    if (ladder) {
      const sol = ladderAdds(fill, { double: false, summer: true });
      if (sol) adds = sol.steps.filter((s) => s.summer).map((s) => ({ grade: s.grade, typeId: rungTypes(fill.ladder.family, s.rank)[0], level: "regular", term: "summer" }));
      if (adds.length === 0) adds = [];
    } else if (type) adds = [{ grade: Math.max(9, Math.min(byGrade, 12) - (need.byGrade >= 12 ? 1 : 0)) as SchoolGrade, typeId: type, level: "regular", term: "summer" }];
    if (retake && !ladder) {
      out.push({ kind: "summer", text: `Retake ${typeTitle} in summer.`, note: RETAKE_SUMMER_NOTE, closes: null, adds, citations: summer.cite });
    } else if (!ladder || adds.length) {
      out.push({ kind: "summer", text: `Take ${adds.length ? courseTypeTitle(adds[0].typeId, ctx.state) : typeTitle} in summer${summer.programName ? ` (${summer.programName})` : ""}.`, note: summer.note, closes: null, adds, citations: summer.cite });
    }
  }
  const recovery = retake && loadOptionsAllowed(need) ? fact(ctx, "credit_recovery", null) : null;
  if (recovery) {
    out.push({ kind: "credit_recovery", text: `Retake ${typeTitle} through credit recovery${recovery.programName ? ` (${recovery.programName})` : ""}.`, note: recovery.note, closes: null, adds: [], citations: recovery.cite });
  }
  if (ladder && lim.accelerateMath && lastMathBOrBetter(fill)) {
    const sol = ladderAdds(fill, { double: true, summer: false });
    if (sol) {
      const doubled = sol.steps.filter((s, i) => sol.steps.some((t, j) => j !== i && t.grade === s.grade && !t.summer && !s.summer));
      const year = doubled[0]?.grade;
      if (year) {
        out.push({
          kind: "double_up",
          text: `Take two math classes in ${nth(year)} grade.`,
          note: "A heavier year. Only if you want it and you got a B or better in your last math class.",
          closes: null,
          adds: doubled.slice(1).map((s) => ({ grade: s.grade, typeId: rungTypes(fill.ladder.family, s.rank)[0], level: "regular", term: "full_year" })),
          citations: [],
        });
      }
    }
  }
  const online = lim.allowOnline && withLoad ? fact(ctx, "state_online", byGrade) : null;
  if (online) {
    // For a math sequence, the rung that would be doubled up (never the target itself: an online
    // calculus class doesn't close a year's gap in the sequence).
    const doubled = ladder ? ladderAdds(fill, { double: true, summer: false }) : null;
    const pair = doubled?.steps.filter((st, i) => doubled.steps.some((u, j) => j !== i && u.grade === st.grade && !u.summer && !st.summer)) ?? [];
    const title = ladder ? (pair[0] ? rungName(fill.ladder.family, pair[0].rank, ctx.state) : null) : typeTitle;
    if (title) out.push({ kind: "state_online", text: `Take ${title} online${online.programName ? ` through ${online.programName}` : ""}.`, note: online.note, closes: null, adds: [], citations: online.cite });
  }
  const college = lim.allowCollegeCredit && withLoad ? (fact(ctx, "college_credit", byGrade) ?? fact(ctx, "college_credit", 12)) : null;
  if (college) {
    const name = college.programName ?? levelLabel("dual_enrollment", ctx.state);
    if (ladder) {
      // Only when college classes would actually close the gap (two college math classes in one
      // year, precalculus first), in the grades the state allows.
      const grades = (college.grades ?? ([9, 10, 11, 12] as SchoolGrade[])).filter((g) => g >= 9);
      const sol = ladderAdds(fill, { double: false, summer: false, college: grades });
      const steps = sol?.steps.filter((st) => st.college) ?? [];
      if (steps.length) {
        const year = steps[0].grade;
        out.push({
          kind: "college_credit",
          text: `Take ${rungName(fill.ladder.family, steps[0].rank, ctx.state)} and then ${rungName(fill.ladder.family, steps[steps.length - 1].rank, ctx.state)} for college credit in ${nth(year)} grade: ${name}.`,
          note: college.note,
          closes: null,
          adds: steps.map((st) => ({ grade: st.grade, typeId: rungTypes(fill.ladder.family, st.rank)[0], level: "dual_enrollment", term: "full_year" })),
          citations: college.cite,
        });
      }
    } else if (type && getCourseType(type).levels.includes("dual_enrollment")) {
      out.push({ kind: "college_credit", text: `Take ${typeTitle} for college credit: ${name}.`, note: college.note, closes: null, adds: [], citations: college.cite });
    }
  }
  const exam = withLoad ? fact(ctx, "credit_by_exam", null) : null;
  if (exam && (!exam.types || (type && exam.types.includes(type)))) {
    out.push({ kind: "credit_by_exam", text: `Earn the credit by exam${exam.programName ? ` (${exam.programName})` : ""}.`, note: exam.note, closes: null, adds: [], citations: exam.cite });
  }
  let lower: GapOption | null = null;
  if (need.mathTarget) {
    const def = MATH_TARGET_DEFS[need.mathTarget];
    if (def.minimumRank < def.rank || need.mathTarget === "CALC") {
      lower = {
        kind: "lower_target",
        text: `Aim for the minimum that keeps the path open: ${def.minimum}.`,
        note: "A College Compass suggestion, not a college rule.",
        closes: `${rungName(fill.ladder.family, def.rank, ctx.state)} in your first college year instead`,
        adds: [],
        citations: [],
      };
    }
  }
  // At most two real options, then "ask your counselor". A lower target is kept when there is one.
  const solving = out.filter((o) => SOLVING.includes(o.kind));
  const chosen: GapOption[] = lower ? [...solving.slice(0, 1), lower] : solving.slice(0, 2);
  chosen.sort((a, b) => GAP_OPTION_KINDS.indexOf(a.kind) - GAP_OPTION_KINDS.indexOf(b.kind));
  return [...chosen, ASK] as UpToThree<GapOption>;
}

/** A question for the counselor, with the rule's own test-score route when it has one. */
function askOptions(need: Need): UpToThree<GapOption> {
  const route = need.testRoutes[0];
  const test: GapOption[] = route ? [{ kind: "test_score", text: route.text, note: "A test score instead of a class. Scores and dates are the source's own.", closes: null, adds: [], citations: route.cite }] : [];
  return [...test, ASK] as UpToThree<GapOption>;
}

function lowerFirst(text: string): string {
  return /^(A|An|The|One|Two|Three|Four) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function byWhenFor(ctx: Ctx, grade: number): ByWhen | null {
  if (grade < ctx.grade) return null;
  return { grade: Math.max(7, Math.min(12, grade)) as SchoolGrade, point: "end" };
}

/**
 * A planned class in a year the need can use whose place another class could take and meet the
 * need, keeping what the planned class was there for (Utah's senior-year math): "Precalculus in
 * place of Statistics in 12th grade would meet this." The swap is checked on the plan itself: with
 * it applied, every rule set on its audit route (and the checks and major-prep targets) must miss
 * less of this need, and nothing ranked with or above it, and no required (P0-P1) need, may miss
 * more. So Statistics in place of a Texas student's only Algebra II (still three math credits, and
 * the DLA's Algebra II gone), Personal Financial Literacy and Economics in place of Economics (both
 * half a credit), or a class the family opted out of in writing, is never named. Null when none.
 */
function swapHint(ctx: Ctx, fill: FillResult, need: Need): string | null {
  const from = Math.max(need.fromGrade, 9);
  const order = [...fill.placements].filter((p) => p.item.grade >= from && p.item.grade <= need.byGrade && p.kind !== "english" && p.item.term !== "summer").sort((a, b) => b.priority - a.priority || b.item.grade - a.item.grade || b.n - a.n);
  if (order.length === 0) return null;
  const before = fill.missingWith();
  const missingBefore = before.get(need.id)?.missing ?? need.missing;
  // Required credits are never traded away, nor anything ranked with or above this need.
  const guard = Math.max(need.priority, 1);
  const works = (p: (typeof order)[number], trial: Item): boolean => {
    const after = fill.missingWith({ out: p.item, in: trial });
    if ((after.get(need.id)?.missing ?? 0) >= missingBefore) return false;
    for (const [id, a] of after) {
      const b = before.get(id);
      if (a.missing > (b?.missing ?? 0) && Math.min(a.priority, b?.priority ?? 3) <= guard) return false;
    }
    return true;
  };
  for (const p of order) {
    const grade = p.item.grade;
    const sy = schoolYearOfGrade(ctx, grade);
    const others = fill.items.filter((i) => i.key !== p.item.key && countsForSequence(i));
    const reached = startRank(others, grade);
    const rows = (ctx.catalogs.get(grade)?.rows ?? [])
      .filter((r) => r.subject === p.item.subject && r.typeId !== p.item.typeId && r.defaultTerm !== "summer" && rowIsOffered(r, grade, sy))
      // The same slot: a full-year class doesn't take a semester's place.
      .filter((r) => slotHalves(r.defaultTerm, r.units) <= slotHalves(p.item.term, p.item.units))
      .filter((r) => {
        const it = probe(r, grade, sy);
        if (!matchesAny(it, need.selectors)) return false;
        if (p.primary && p.priority <= need.priority && !matchesAny(it, p.primary.selectors)) return false;
        if (!isRepeatable(r.typeId) && others.some((i) => sameContent(i.typeId, r.typeId))) return false;
        // Never a class the family opted out of in writing (Utah Secondary Math III), nor a second
        // art or PE class of the same kind in a year.
        const rank = mathRankOf(r.typeId);
        if (ctx.choices.utMath3OptOut && rank === 3) return false;
        if (isRepeatable(r.typeId) && others.filter((i) => !i.own && i.grade === grade && i.typeId === r.typeId).length >= (r.units >= 4 ? 1 : 2)) return false;
        if (rank !== null && rank >= 1 && rank <= reached) return false;
        return prereqsMetIn(others, r, grade, () => null, true);
      })
      .sort((a, b) => (mathRankOf(a.typeId) ?? 9) - (mathRankOf(b.typeId) ?? 9) || Number(a.collegeLevel) - Number(b.collegeLevel) || a.order - b.order);
    for (const r of rows) {
      const trial: Item = { ...probe(r, grade, sy, p.item.term), key: p.item.key, ref: p.item.ref };
      if (works(p, trial)) return `${courseTypeTitle(r.typeId, ctx.state)} in place of ${courseTypeTitle(p.item.typeId, ctx.state)} in ${nth(grade)} grade would meet this.`;
    }
  }
  return null;
}

function gapText(ctx: Ctx, need: Need, kind: Gap["kind"], block: BlockReason | null, needsPlanNow: boolean, swap: string | null = null, thisYear = false): string {
  const amount = need.measure === "units" && need.missing % 4 !== 0 ? ` (${toCredits(need.missing)} credit)` : "";
  const label = need.label;
  if (block === "ask" && need.seniorMath?.ce) {
    return `${label}: a C in your concurrent enrollment math class may already show college-ready math. Ask your counselor; if it doesn't, plan a full year of math ${ctx.inProgressGrade === 12 ? "this year" : "in 12th grade"}.`;
  }
  if (block === "ask") return `${label}: ask your counselor whether you've already shown college-ready math. If you haven't, plan a full year of math ${ctx.inProgressGrade === 12 ? "this year" : "in 12th grade"}.`;
  // Questions for the counselor come before "Needs a plan now": a class the student took may already count.
  if (block === "choice") return `${label}: your family opted out of the class this needs. Ask your counselor what that means for you.`;
  if (block === "equivalent") return `${label}: you've taken a class that may count the same way. Ask your counselor whether it does here.`;
  if (block === "hs_credit") {
    const early = earlyWithoutCredit(ctx.items, need.selectors);
    if (early) return `Your ${nth(early.grade)}-grade ${courseTypeTitle(early.typeId, ctx.state)} isn't marked for high school credit. Ask your counselor whether it counts.`;
  }
  if (needsPlanNow) return `Needs a plan now: ${label}${amount}.`;
  switch (kind) {
    case "ladder_infeasible":
      return need.byGrade > ctx.grade || (need.byGrade === ctx.grade && ctx.inProgressGrade === null)
        ? `${label} by the end of ${nth(Math.min(12, need.byGrade))} grade would take more than one math class a year from here.`
        : `${label} doesn't fit in what's left of ${nth(Math.min(12, need.byGrade))} grade.`;
    case "not_offered":
      return `Your school's class list doesn't show a class for this: ${label}.`;
    case "doesnt_fit":
      return block === "load"
        ? `Room to add: ${label}. The classes that count are college-level, and your years are at your limit of ${ctx.limits.maxCollegeLevelPerYear}.`
        : swap
          ? `Room to add: ${label}${amount}. ${swap}`
          : thisYear
            ? `Room to add: ${label}${amount}. This school year has started; ask your counselor whether you can still add it this year (or this spring).`
            : `Room to add: ${label}${amount}. It doesn't fit in the years you have left as planned.`;
    default:
      return `Room to add: ${label}${amount}.`;
  }
}

/**
 * Room left in the plan's school years, in units. The year in progress counts only for its spring
 * term (half a credit per open class period): its schedule is mostly set, and an open period may
 * earn no credit (release time, a study hall). `wholeYear` counts all of it: classes being taken
 * now may not be recorded yet.
 */
export function freeUnits(fill: FillResult, wholeYear = false): number {
  return [...fill.years.values()].reduce((n, y) => n + Math.max(0, y.capHalves - y.used) * (y.inProgress && !wholeYear ? 1 : 2), 0);
}

/**
 * Room in the years after the one in progress, in units: what the plan can hold without adding
 * classes this year (none for a senior).
 */
export function laterFreeUnits(fill: FillResult): number {
  return [...fill.years.values()].reduce((n, y) => n + (y.inProgress ? 0 : Math.max(0, y.capHalves - y.used) * 2), 0);
}

/**
 * The room a credit total can count on without a gap. A shortfall the years after this one can't
 * hold needs this spring's open periods, and nothing is planned there yet: a gap for any grade (a
 * junior with 2 open periods in 12th and half a credit more to go, H21). Only when the year in
 * progress has two or more open periods, and the student isn't a senior, does its spring still
 * count: this year's classes may not all be recorded yet (a 9th grader who has entered four).
 */
export function creditRoom(ctx: Ctx, fill: FillResult): number {
  const now = ctx.inProgressGrade === null ? undefined : fill.years.get(ctx.inProgressGrade as SchoolGrade);
  const openNow = now ? Math.floor(Math.max(0, now.capHalves - now.used) / 2) : 0;
  return now && ctx.inProgressGrade !== 12 && openNow >= 2 ? freeUnits(fill) : laterFreeUnits(fill);
}

/**
 * "Your plan has room for about 2 more credits, and total credits needs 3 more." When only this
 * year's open periods would hold it, the gap says what that takes.
 */
function roomText(room: string, needs: string, fitsThisYear: boolean): string {
  return fitsThisYear ? `${room} after this fall, and ${needs}. That fits only if you add classes this year; ask your counselor.` : `${room}, and ${needs}.`;
}

/**
 * A program that adds credits on top of the one it extends (a Texas endorsement: "at least 26
 * credits", 19 TAC §74.13(c)): the base program's total plus the option's own added credits and
 * electives, against every class on the plan that earns credit. Null for a rule set that doesn't
 * extend a program with a credit total.
 */
export function addedCreditTotal(e: RuleSetEval, items: readonly Item[]): { required: number; missing: number; leaf: CLeaf } | null {
  if (!e.best || e.rc.bases.length === 0) return null;
  const total = e.best.leaves.find((l) => !l.leaf.own && l.leaf.req.kind === "total_credits");
  const electives = e.best.leaves.find((l) => l.leaf.own && l.leaf.req.kind === "remaining_electives");
  if (!total || !electives) return null;
  const added = e.best.leaves
    .filter((l) => l.leaf.own && ((l.leaf.req.kind === "credits" && !l.leaf.req.shareable) || l.leaf.req.kind === "remaining_electives"))
    .reduce((n, l) => n + l.required, 0);
  const required = total.required + added;
  const have = items.filter((i) => i.creditable).reduce((n, i) => n + i.units, 0);
  return { required, missing: Math.max(0, required - have), leaf: electives.leaf };
}

/** The state's verified ways to add credit outside the school day, at most two, the counselor last. */
function creditOptions(ctx: Ctx): UpToThree<GapOption> {
  // Tennessee summer school (for a student on an accelerated path), Utah's online program, Texas
  // credit by exam, each with its own note.
  const summer = firstAttemptSummer(ctx);
  const online = ctx.limits.allowOnline ? fact(ctx, "state_online", ctx.grade) : null;
  const exam = fact(ctx, "credit_by_exam", null);
  const options: GapOption[] = [
    ...(summer ? [{ kind: "summer" as const, text: `Take a class in summer${summer.programName ? ` (${summer.programName})` : ""}.`, note: summer.note, closes: null, adds: [], citations: summer.cite }] : []),
    ...(online ? [{ kind: "state_online" as const, text: `Take a class online${online.programName ? ` through ${online.programName}` : ""}.`, note: online.note, closes: null, adds: [], citations: online.cite }] : []),
    ...(exam ? [{ kind: "credit_by_exam" as const, text: `Earn credit by exam${exam.programName ? ` (${exam.programName})` : ""}.`, note: exam.note, closes: null, adds: [], citations: exam.cite }] : []),
  ].slice(0, 2);
  return [...options, ASK] as UpToThree<GapOption>;
}

/** The state's reviewed notes on high school credit earned before 9th grade. */
function earlyCreditNotes(ctx: Ctx): Reason[] {
  return ctx.facts.middleSchoolMath.filter((n) => /credit/i.test(n.text)).map((n) => reason("state_note", n.text, { citations: n.cite }));
}

/** The math rungs (1-3) a requirement names by type (Algebra I is rung 1). */
function equivalentRanks(need: Need): number[] {
  const ranks = new Set<number>();
  for (const sel of need.selectors) for (const t of sel.types ?? []) {
    const rank = mathRankOf(t);
    if (rank !== null && rank >= 1 && rank <= 3) ranks.add(rank);
  }
  return [...ranks].sort((a, b) => a - b);
}

/** Gaps for Plan A (design §5.8). */
export function buildGaps(ctx: Ctx, fill: FillResult): Gap[] {
  const gaps: Gap[] = [];
  const ladderUnmet = new Map((fill.ladder.solution?.unmet ?? []).map((c) => [c.id, c]));
  // A class from before 9th grade without high school credit is one question, asked once (for
  // the highest-priority requirement it would meet), not a gap for every college too.
  const earlyAsked = new Set<string>();
  for (const need of [...fill.needs].sort((a, b) => a.priority - b.priority)) {
    if (need.missing <= 0 || need.soft || need.priority > 3) continue;
    let block = fill.unmet.get(need.id) ?? null;
    if (block === "hs_credit") {
      const early = earlyWithoutCredit(ctx.items, need.selectors);
      if (early && earlyAsked.has(early.key)) continue;
      if (early) earlyAsked.add(early.key);
    }
    // So is "you've taken a class that may count the same way" (Secondary Math I for Texas's and
    // Texas A&M's Algebra I): once per class.
    if (block === "equivalent") {
      const key = `equivalent:${equivalentRanks(need).join(",")}`;
      if (earlyAsked.has(key)) continue;
      earlyAsked.add(key);
    }
    if (ctx.choices.utMath3OptOut && (isLadderish(need.selectors) ?? 0) >= 3) block = "choice";
    if (block === "guessed") continue;
    // A dated test-score route (UT Austin calculus readiness) is the plan when the class route
    // isn't planned: it's on the "by when" strip with the class route as a line, not a gap.
    if (need.testRoutes.some((t) => t.by)) continue;
    // A major-prep class no remaining grade's list offers never counts against the student (design
    // §5.1): it's a good choice if the school has it, not a gap.
    if (need.source === "prep" && block === "not_offered") continue;
    // A senior's admission and prep extras aren't actionable; required credits are.
    if (ctx.inProgressGrade === 12 && need.priority >= 2) continue;
    if (ctx.firstGrade <= 8) continue;
    const ladder = ladderUnmet.has(need.id) && block !== "choice" && !(ctx.choices.utMath3OptOut && (isLadderish(need.selectors) ?? 0) >= 3);
    const school = ctx.planGrades.filter((g) => g >= 9).every((g) => ctx.catalogs.get(g)!.school);
    const kind: Gap["kind"] = ladder
      ? "ladder_infeasible"
      : block === "not_offered" && school
        ? "not_offered"
        : block === "doesnt_fit" || block === "load" || block === "dismissed"
          ? "doesnt_fit"
          : "unmet";
    // A class the student already took that may count (another state's math, a class from before
    // 9th grade, one the family opted out of) is a question for the counselor, not a missing credit.
    const counselorCall = block === "ask" || block === "equivalent" || block === "choice" || block === "hs_credit";
    const needsPlanNow = ctx.inProgressGrade === 12 && need.priority === 0 && !counselorCall;
    const reasons = [...need.reasons];
    if (ctx.state === "TX" && need.selectors.some((s) => s.types?.includes("math.alg2"))) reasons.push(algebra2Reason());
    if (needsPlanNow) reasons.push(reason("gap", "This is a required credit. Summer school or credit recovery may work; ask your counselor soon.", { ruleSetId: need.rc?.rs.id ?? null }));
    // A career pathway's next level the list doesn't show (for the pathway, or a program of study
    // an endorsement counts): the counselor knows the school's sequence.
    const pathway = need.id.startsWith("cte:") || (block === "not_offered" && fill.pastLevelsOnly(need));
    gaps.push({
      id: `gap:${need.id}`,
      kind,
      priority: need.priority,
      demandId: need.id,
      text: pathway
        ? `Room to add: ${need.label}. Ask your counselor about the next class in this pathway.`
        : gapText(
            ctx,
            need,
            kind,
            block,
            needsPlanNow,
            kind === "doesnt_fit" && block === "doesnt_fit" && !needsPlanNow ? swapHint(ctx, fill, need) : null,
            // The year in progress had room for it: the planner adds only required credits there
            // (its schedule is mostly set), so "doesn't fit" would be wrong.
            kind === "doesnt_fit" && block === "doesnt_fit" && !needsPlanNow && fill.fitsThisYear(need),
          ),
      decideBy: byWhenFor(ctx, need.byGrade),
      options: block === "choice" || block === "equivalent" || block === "hs_credit" || pathway ? [ASK] : block === "ask" ? askOptions(need) : optionsFor(ctx, fill, need, ladder),
      reasons: block === "hs_credit" ? [...reasons, ...earlyCreditNotes(ctx)] : reasons,
    });
  }
  // Credits that expand an elective focus (Tennessee's waived world language and fine arts credits,
  // Policy 2.103 I(16)-(17)) beyond the classes the focus counts: which classes count is the
  // counselor's call, so a shortfall is a gap with the counselor as the option, never a class added.
  for (const [key, l] of expandedResults(fill.evals, fill.items)) {
    if (l.missing <= 0 || ctx.firstGrade <= 8) continue;
    const rc = ctx.ruleSets.find((r) => r.rs.id === key.slice(0, key.indexOf("/")));
    const priority = rc ? leafPriority(rc, l.leaf.strength) : null;
    if (!rc || priority === null || priority > 3) continue;
    const planNow = ctx.inProgressGrade === 12 && priority === 0;
    const left = l.missing < l.required ? ` (${toCredits(l.missing)} ${creditNoun(toCredits(l.missing))} left)` : "";
    gaps.push({
      id: `gap:${key}`,
      kind: "unmet",
      priority,
      demandId: null,
      text: `${planNow ? "Needs a plan now" : "Room to add"}: ${l.leaf.label}${left}.`,
      decideBy: byWhenFor(ctx, 12),
      options: [ASK],
      reasons: [requirementReason(rc, l.leaf)],
    });
  }
  // Graduation totals the years after this one can't hold (this year only for its spring term). The
  // part past them needs this spring's open periods, and nothing is planned there yet: a gap for any
  // grade, "needs a plan now" for a senior (whose only room is this spring).
  const free = freeUnits(fill);
  const whole = freeUnits(fill, true);
  const later = laterFreeUnits(fill);
  const limit = creditRoom(ctx, fill);
  const senior = ctx.inProgressGrade === 12;
  const room = `Your plan has room for about ${toCredits(free)} more ${creditNoun(toCredits(free))}`;
  const spring = (what: string, missing: number, planNow: boolean) => {
    const now = missing - later;
    const after = later > 0 ? `, and the years after this one have room for about ${toCredits(later)}` : "";
    return `${planNow ? "Needs a plan now" : "Room to add"}: ${what}${after}. Add ${toCredits(now)} ${creditNoun(toCredits(now))} this spring (your open periods); ask your counselor.`;
  };
  const springReason = (ruleSetId: string) => reason("gap", "This is a required credit. Classes in your open periods this spring can cover it; ask your counselor soon.", { ruleSetId });
  // Room before 12th grade the plan shows as "Your choice" (the years after this one, before 12th),
  // and a non-senior's year in progress with two or more open periods (its classes may not all be
  // recorded yet): a total that needs more than that needs classes in 12th grade, where the plan
  // shows no slot.
  const unrecorded = (y: { inProgress: boolean; capHalves: number; used: number }) => y.inProgress && !senior && y.capHalves - y.used >= 4;
  const beforeTwelfth = [...fill.years.values()].reduce((n, y) => n + ((y.inProgress && !unrecorded(y)) || y.grade >= 12 ? 0 : Math.max(0, y.capHalves - y.used) * 2), 0);
  const twelfthYear = fill.years.get(12);
  const roomInTwelfth = twelfthYear && !twelfthYear.inProgress ? Math.max(0, twelfthYear.capHalves - twelfthYear.used) * 2 : 0;
  const inTwelfth = (what: string, missing: number, ruleSetId: string, reqId: string, priority: Gap["priority"], requirement: Reason): Gap => {
    const twelfth = Math.min(missing - beforeTwelfth, roomInTwelfth);
    const rest = missing - beforeTwelfth - twelfth;
    const besides = beforeTwelfth > 0 ? `Besides your "Your choice" slots, plan` : "Plan";
    const now = rest > 0 ? ` Ask your counselor about adding ${toCredits(rest)} more this school year.` : "";
    return {
      id: `gap:${ruleSetId}/${reqId}`,
      kind: "unmet",
      priority,
      demandId: null,
      text: `Room to add: ${what}. ${besides} ${toCredits(twelfth)} more ${creditNoun(toCredits(twelfth))} in 12th grade (your open periods).${now}`,
      decideBy: byWhenFor(ctx, 12),
      options: [ASK],
      reasons: [
        requirement,
        reason("gap", "Your 12th-grade schedule has room for these credits. A shorter senior day (release time or early out) could leave you short, so ask your counselor.", { ruleSetId }),
      ],
    };
  };
  for (const e of fill.evals) {
    if (!e.best || ctx.firstGrade <= 8) continue;
    if (e.rc.rs.kind === "state_graduation" || e.rc.rs.kind === "local_graduation") {
      for (const l of e.best.leaves) {
        if (l.leaf.req.kind !== "total_credits" || l.missing <= 0) continue;
        if (limit >= l.missing) {
          if (!senior && l.missing > beforeTwelfth && roomInTwelfth > 0) {
            const requirement = reason("requirement", `${l.leaf.label}: ${toCredits(l.required)} credits.`, { ruleSetId: e.rc.rs.id, reqId: l.leaf.id, citations: l.leaf.cite });
            gaps.push(inTwelfth(`${l.leaf.label.toLowerCase()} needs ${toCredits(l.missing)} more`, l.missing, e.rc.rs.id, l.leaf.id, 0, requirement));
          }
          continue;
        }
        const what = `${l.leaf.label.toLowerCase()} needs ${toCredits(l.missing)} more`;
        gaps.push({
          id: `gap:${e.rc.rs.id}/${l.leaf.id}`,
          kind: "doesnt_fit",
          priority: 0,
          demandId: null,
          text: free >= l.missing ? spring(what, l.missing, senior) : roomText(room, what, whole >= l.missing),
          decideBy: byWhenFor(ctx, 12),
          options: creditOptions(ctx),
          reasons: [
            reason("requirement", `${l.leaf.label}: ${toCredits(l.required)} credits.`, { ruleSetId: e.rc.rs.id, reqId: l.leaf.id, citations: l.leaf.cite }),
            ...(free >= l.missing ? [springReason(e.rc.rs.id)] : []),
          ],
        });
      }
    }
    // A program's own credit total on top of its base (a Texas endorsement's 26 credits): the
    // electives it adds create no class to place, so a shortfall the years left can't hold is a
    // gap of its own, with the same options as the graduation total.
    const added = addedCreditTotal(e, fill.items);
    const priority = added ? leafPriority(e.rc, added.leaf.strength) : null;
    if (!added || priority === null || added.missing <= 0) continue;
    if (limit >= added.missing) {
      if (!senior && added.missing > beforeTwelfth && roomInTwelfth > 0 && priority <= 3) {
        const what = `the ${e.rc.rs.title} needs at least ${toCredits(added.required)} credits in all (${toCredits(added.missing)} more)`;
        const requirement = reason("requirement", `${e.rc.rs.title}: at least ${toCredits(added.required)} credits.`, {
          ruleSetId: e.rc.rs.id,
          reqId: added.leaf.id,
          strength: added.leaf.strength,
          citations: added.leaf.cite,
        });
        gaps.push(inTwelfth(what, added.missing, e.rc.rs.id, added.leaf.id, priority as Gap["priority"], requirement));
      }
      continue;
    }
    const planNow = senior && priority === 0;
    const what = `the ${e.rc.rs.title} needs at least ${toCredits(added.required)} credits in all (${toCredits(added.missing)} more)`;
    const fits = free >= added.missing;
    gaps.push({
      id: `gap:${e.rc.rs.id}/${added.leaf.id}`,
      kind: "doesnt_fit",
      priority,
      demandId: null,
      text: fits ? spring(what, added.missing, planNow) : `${planNow ? "Needs a plan now: " : ""}${roomText(room, what, whole >= added.missing)}`,
      decideBy: byWhenFor(ctx, 12),
      options: creditOptions(ctx),
      reasons: [
        reason("requirement", `${e.rc.rs.title}: at least ${toCredits(added.required)} credits.`, { ruleSetId: e.rc.rs.id, reqId: added.leaf.id, strength: added.leaf.strength, citations: added.leaf.cite }),
        ...(fits ? [springReason(e.rc.rs.id)] : planNow ? [reason("gap", "This is a required credit. Summer school or credit recovery may work; ask your counselor soon.", { ruleSetId: e.rc.rs.id })] : []),
      ],
    });
  }
  return gaps.sort((a, b) => a.priority - b.priority || (a.decideBy?.grade ?? 13) - (b.decideBy?.grade ?? 13) || (a.id < b.id ? -1 : 1));
}
