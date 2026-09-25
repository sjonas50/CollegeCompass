import type { SchoolGrade } from "../common";
import { GAP_OPTION_KINDS, type GapOptionKind, type OptionFact } from "../content-types";
import { courseTypeTitle, type CourseTypeId, levelLabel } from "../course-types";
import type { ByWhen, Gap, GapOption, UpToThree } from "../engine-io";
import { MATH_TARGET_DEFS } from "../families";
import type { Ctx } from "./context";
import { algebra2Reason, reason } from "./explain";
import type { BlockReason, FillResult } from "./fill";
import { type LadderSolution, rungName, rungTypes, solveLadder } from "./ladder";
import { isLadderish, type Need } from "./needs";
import { atLeast, nth } from "./util";
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

function typeForNeed(ctx: Ctx, need: Need): CourseTypeId | null {
  for (const s of need.selectors) if (s.types?.length) return s.types[0];
  for (const grade of ctx.planGrades) {
    const row = ctx.catalogs.get(grade)?.rows.find((r) => need.selectors.some((s) => (!s.subjects || s.subjects.includes(r.subject)) && !s.types && !s.capabilities));
    if (row) return row.typeId;
  }
  return null;
}

/** Extra summer or double-up math that would reach the target (re-solving the ladder with more moves). */
function ladderAdds(fill: FillResult, moves: { double: boolean; summer: boolean }): LadderSolution | null {
  const problem = fill.ladder.problem;
  if (!problem) return null;
  const sol = solveLadder({ ...problem, moves });
  return sol.unmet.length < (fill.ladder.solution?.unmet.length ?? 0) ? sol : null;
}

export function optionsFor(ctx: Ctx, fill: FillResult, need: Need, ladder: boolean): UpToThree<GapOption> {
  const lim = ctx.limits;
  const byGrade = Math.max(ctx.firstGrade, Math.min(12, need.byGrade));
  const out: GapOption[] = [];
  const type = typeForNeed(ctx, need);
  const typeTitle = type ? courseTypeTitle(type, ctx.state) : need.label;

  for (const route of need.testRoutes) {
    out.push({ kind: "test_score", text: route.text, note: "A test score instead of a class. Scores and dates are the source's own.", closes: null, adds: [], citations: route.cite });
    break;
  }
  const summer = lim.allowSummer ? fact(ctx, "summer", null) : null;
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
  const online = lim.allowOnline ? fact(ctx, "state_online", byGrade) : null;
  if (online) out.push({ kind: "state_online", text: `Take ${typeTitle} online${online.programName ? ` through ${online.programName}` : ""}.`, note: online.note, closes: null, adds: [], citations: online.cite });
  const college = lim.allowCollegeCredit ? (fact(ctx, "college_credit", byGrade) ?? fact(ctx, "college_credit", 12)) : null;
  if (college) {
    out.push({
      kind: "college_credit",
      text: `Take ${typeTitle} as a ${levelLabel("dual_enrollment", ctx.state).toLowerCase()} class${college.programName ? ` (${college.programName})` : ""}.`,
      note: college.note,
      closes: null,
      adds: [],
      citations: college.cite,
    });
  }
  const exam = fact(ctx, "credit_by_exam", null);
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

function byWhenFor(ctx: Ctx, grade: number): ByWhen | null {
  if (grade < ctx.grade) return null;
  return { grade: Math.max(7, Math.min(12, grade)) as SchoolGrade, point: "end" };
}

function gapText(ctx: Ctx, need: Need, kind: Gap["kind"], block: BlockReason | null, needsPlanNow: boolean): string {
  const amount = need.measure === "units" && need.missing % 4 !== 0 ? ` (${toCredits(need.missing)} credit)` : "";
  const label = need.label;
  if (needsPlanNow) return `Needs a plan now: ${label}${amount}.`;
  if (block === "choice") return `${label}: your family opted out of the class this needs. Ask your counselor what that means for you.`;
  if (block === "equivalent") return `${label}: you've taken a class that may count the same way. Ask your counselor whether it does here.`;
  switch (kind) {
    case "ladder_infeasible":
      return need.byGrade > ctx.grade || (need.byGrade === ctx.grade && ctx.inProgressGrade === null)
        ? `${label} by the end of ${nth(Math.min(12, need.byGrade))} grade would take more than one math class a year from here.`
        : `${label} isn't on your plan by the end of ${nth(Math.min(12, need.byGrade))} grade.`;
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
    const needsPlanNow = ctx.inProgressGrade === 12 && need.priority === 0;
    const reasons = [...need.reasons];
    if (ctx.state === "TX" && need.selectors.some((s) => s.types?.includes("math.alg2"))) reasons.push(algebra2Reason());
    if (needsPlanNow) reasons.push(reason("gap", "This is a required credit. Summer school or credit recovery may work; ask your counselor soon.", { ruleSetId: need.rc?.rs.id ?? null }));
    gaps.push({
      id: `gap:${need.id}`,
      kind,
      priority: need.priority,
      demandId: need.id,
      text: gapText(ctx, need, kind, block, needsPlanNow),
      decideBy: byWhenFor(ctx, need.byGrade),
      options: block === "choice" || block === "equivalent" ? [ASK] : optionsFor(ctx, fill, need, ladder),
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
      const summer = ctx.limits.allowSummer ? fact(ctx, "summer", null) : null;
      const options: GapOption[] = summer ? [{ kind: "summer", text: "Take a class in summer.", note: summer.note, closes: null, adds: [], citations: summer.cite }] : [];
      gaps.push({
        id: `gap:${e.rc.rs.id}/${l.leaf.id}`,
        kind: "doesnt_fit",
        priority: 0,
        demandId: null,
        text: `Your plan has room for about ${toCredits(free)} more credits, and ${l.leaf.label.toLowerCase()} needs ${toCredits(l.missing)} more.`,
        decideBy: byWhenFor(ctx, 12),
        options: [...options, ASK] as UpToThree<GapOption>,
        reasons: [reason("requirement", `${l.leaf.label}: ${toCredits(l.required)} credits.`, { ruleSetId: e.rc.rs.id, reqId: l.leaf.id, citations: l.leaf.cite })],
      });
    }
  }
  return gaps.sort((a, b) => a.priority - b.priority || (a.decideBy?.grade ?? 13) - (b.decideBy?.grade ?? 13) || (a.id < b.id ? -1 : 1));
}
