import type { SchoolGrade } from "../common";
import { GAP_OPTION_KINDS, type GapOptionKind, type OptionFact } from "../content-types";
import { courseTypeTitle, type CourseTypeId, getCourseType, levelLabel } from "../course-types";
import type { ByWhen, Gap, GapOption, UpToThree } from "../engine-io";
import { MATH_TARGET_DEFS } from "../families";
import { type Ctx, rowIsOffered, schoolYearOfGrade } from "./context";
import { algebra2Reason, reason } from "./explain";
import { type BlockReason, type FillResult, isRepeatable, prereqsMetIn, probe } from "./fill";
import { type LadderMoves, type LadderSolution, mathRankOf, rungName, rungTypes, solveLadder, startRank } from "./ladder";
import { countsForSequence } from "./model";
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
const SOLVING: GapOptionKind[] = ["test_score", "summer", "double_up", "state_online", "college_credit", "credit_by_exam"];

function fact(ctx: Ctx, kind: OptionFact["kind"], grade: number | null): OptionFact | null {
  return ctx.facts.options.find((o) => o.kind === kind && (grade === null || !o.grades || o.grades.includes(grade as SchoolGrade))) ?? null;
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
  const reached = startRank(items, 13);
  const found: { typeId: CourseTypeId; rank: number; order: number }[] = [];
  for (const grade of ctx.planGrades) {
    if (grade < 9) continue;
    const sy = schoolYearOfGrade(ctx, grade);
    for (const r of ctx.catalogs.get(grade)?.rows ?? []) {
      if (!rowIsOffered(r, grade, sy)) continue;
      if (!matchesAny(probe(r, grade, sy), need.selectors)) continue;
      if (!isRepeatable(r.typeId) && items.some((i) => i.typeId === r.typeId)) continue;
      const rank = mathRankOf(r.typeId);
      if (rank !== null && rank >= 1 && rank <= reached) continue;
      if (!prereqsMetIn(items, r, grade, () => null, true)) continue;
      found.push({ typeId: r.typeId, rank: rank ?? 0, order: r.order });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return found[0]?.typeId ?? null;
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
  const yearsLeft = ctx.planGrades.filter((g) => g >= 9 && g !== ctx.inProgressGrade);
  const extraMath =
    type !== null &&
    getCourseType(type).subject === "math" &&
    yearsLeft.every((g) => fill.items.some((i) => i.grade === g && i.subject === "math" && i.term !== "summer" && countsForSequence(i))) &&
    !(ctx.inProgressGrade === 12 && need.priority === 0);
  const withLoad = loadOptionsAllowed(need) && !need.distinctGrades && (ladder ? accelerate : type !== null && (!extraMath || accelerate));

  for (const route of need.testRoutes) {
    out.push({ kind: "test_score", text: route.text, note: "A test score instead of a class. Scores and dates are the source's own.", closes: null, adds: [], citations: route.cite });
    break;
  }
  const summer = lim.allowSummer && withLoad ? fact(ctx, "summer", null) : null;
  if (summer) {
    let adds: GapOption["adds"] = [];
    if (ladder) {
      const sol = ladderAdds(fill, { double: false, summer: true });
      if (sol) adds = sol.steps.filter((s) => s.summer).map((s) => ({ grade: s.grade, typeId: rungTypes(fill.ladder.family, s.rank)[0], level: "regular", term: "summer" }));
      if (adds.length === 0) adds = [];
    } else if (type) adds = [{ grade: Math.max(9, Math.min(byGrade, 12) - (need.byGrade >= 12 ? 1 : 0)) as SchoolGrade, typeId: type, level: "regular", term: "summer" }];
    if (!ladder || adds.length) {
      out.push({ kind: "summer", text: `Take ${adds.length ? courseTypeTitle(adds[0].typeId, ctx.state) : typeTitle} in summer${summer.programName ? ` (${summer.programName})` : ""}.`, note: summer.note, closes: null, adds, citations: summer.cite });
    }
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

function gapText(ctx: Ctx, need: Need, kind: Gap["kind"], block: BlockReason | null, needsPlanNow: boolean): string {
  const amount = need.measure === "units" && need.missing % 4 !== 0 ? ` (${toCredits(need.missing)} credit)` : "";
  const label = need.label;
  if (block === "ask") return `${label}: ask your counselor whether you've already shown college-ready math. If you haven't, plan a full year of math this year.`;
  if (needsPlanNow) return `Needs a plan now: ${label}${amount}.`;
  if (block === "choice") return `${label}: your family opted out of the class this needs. Ask your counselor what that means for you.`;
  if (block === "equivalent") return `${label}: you've taken a class that may count the same way. Ask your counselor whether it does here.`;
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
        : `Room to add: ${label}${amount}. It doesn't fit in the years you have left as planned.`;
    default:
      return `Room to add: ${label}${amount}.`;
  }
}

/** Gaps for Plan A (design §5.8). */
export function buildGaps(ctx: Ctx, fill: FillResult): Gap[] {
  const gaps: Gap[] = [];
  const ladderUnmet = new Map((fill.ladder.solution?.unmet ?? []).map((c) => [c.id, c]));
  for (const need of fill.needs) {
    if (need.missing <= 0 || need.soft || need.priority > 3) continue;
    let block = fill.unmet.get(need.id) ?? null;
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
    const needsPlanNow = ctx.inProgressGrade === 12 && need.priority === 0 && block !== "ask";
    const reasons = [...need.reasons];
    if (ctx.state === "TX" && need.selectors.some((s) => s.types?.includes("math.alg2"))) reasons.push(algebra2Reason());
    if (needsPlanNow) reasons.push(reason("gap", "This is a required credit. Summer school or credit recovery may work; ask your counselor soon.", { ruleSetId: need.rc?.rs.id ?? null }));
    // A career pathway's next level the list doesn't show: the counselor knows the school's sequence.
    const pathway = need.id.startsWith("cte:");
    gaps.push({
      id: `gap:${need.id}`,
      kind,
      priority: need.priority,
      demandId: need.id,
      text: pathway ? `Room to add: ${need.label}. Ask your counselor about the next class in this pathway.` : gapText(ctx, need, kind, block, needsPlanNow),
      decideBy: byWhenFor(ctx, need.byGrade),
      options: block === "choice" || block === "equivalent" || pathway ? [ASK] : block === "ask" ? askOptions(need) : optionsFor(ctx, fill, need, ladder),
      reasons,
    });
  }
  // Graduation totals the remaining years can't hold.
  for (const e of fill.evals) {
    if (!e.best || (e.rc.rs.kind !== "state_graduation" && e.rc.rs.kind !== "local_graduation")) continue;
    for (const l of e.best.leaves) {
      if (l.leaf.req.kind !== "total_credits" || l.missing <= 0) continue;
      // Free room counts the year in progress too: classes being taken now may not be recorded yet.
      const free = [...fill.years.values()].reduce((n, y) => n + Math.max(0, y.capHalves - y.used) * 2, 0);
      if (free >= l.missing || ctx.firstGrade <= 8) continue;
      // The state's verified ways to add credit outside the school day (Tennessee summer school,
      // Utah's online program, Texas credit by exam), each with its own note; the counselor last.
      const summer = ctx.limits.allowSummer ? fact(ctx, "summer", null) : null;
      const online = ctx.limits.allowOnline ? fact(ctx, "state_online", ctx.grade) : null;
      const exam = fact(ctx, "credit_by_exam", null);
      const options: GapOption[] = [
        ...(summer ? [{ kind: "summer" as const, text: `Take a class in summer${summer.programName ? ` (${summer.programName})` : ""}.`, note: summer.note, closes: null, adds: [], citations: summer.cite }] : []),
        ...(online ? [{ kind: "state_online" as const, text: `Take a class online${online.programName ? ` through ${online.programName}` : ""}.`, note: online.note, closes: null, adds: [], citations: online.cite }] : []),
        ...(exam ? [{ kind: "credit_by_exam" as const, text: `Earn credit by exam${exam.programName ? ` (${exam.programName})` : ""}.`, note: exam.note, closes: null, adds: [], citations: exam.cite }] : []),
      ].slice(0, 2);
      gaps.push({
        id: `gap:${e.rc.rs.id}/${l.leaf.id}`,
        kind: "doesnt_fit",
        priority: 0,
        demandId: null,
        text: `Your plan has room for about ${toCredits(free)} more ${creditNoun(toCredits(free))}, and ${l.leaf.label.toLowerCase()} needs ${toCredits(l.missing)} more.`,
        decideBy: byWhenFor(ctx, 12),
        options: [...options, ASK] as UpToThree<GapOption>,
        reasons: [reason("requirement", `${l.leaf.label}: ${toCredits(l.required)} credits.`, { ruleSetId: e.rc.rs.id, reqId: l.leaf.id, citations: l.leaf.cite })],
      });
    }
  }
  return gaps.sort((a, b) => a.priority - b.priority || (a.decideBy?.grade ?? 13) - (b.decideBy?.grade ?? 13) || (a.id < b.id ? -1 : 1));
}
