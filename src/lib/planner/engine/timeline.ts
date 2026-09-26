import type { SchoolGrade } from "../common";
import { courseTypeTitle, LANGUAGE_NAMES, type LanguageCode } from "../course-types";
import type { ByWhen, Deadline, PendingDecision } from "../engine-io";
import type { Ctx } from "./context";
import { reason } from "./explain";
import { type FillResult, ownCtePathway } from "./fill";
import { mathRankOf, rungName, type LadderSolution } from "./ladder";
import { atLeast, byWhenOrder, nth } from "./util";

// ---------------------------------------------------------------------------
// "By when" (design §2.7, §5.6): zero-slack ladder steps, rule deadlines, test-route dates and the
// choices a rule depends on, soonest first. Nothing already past is shown as a deadline.
// ---------------------------------------------------------------------------

function future(ctx: Ctx, by: ByWhen): boolean {
  if (by.grade > ctx.grade) return true;
  if (by.grade < ctx.grade) return false;
  // This grade: "start" has passed once the year is under way; "end" and dates are still ahead
  // during the school year, and past in June-July.
  if (by.point === "start") return false;
  return ctx.inProgressGrade === ctx.grade;
}

function ladderDeadlines(ctx: Ctx, fill: FillResult, sol: LadderSolution | null, idPrefix: string): Deadline[] {
  if (!sol) return [];
  const out: Deadline[] = [];
  for (const { step, latest, binding } of sol.slack) {
    if (!binding || binding.rank <= step.rank || step.summer) continue;
    const slack = latest - step.grade;
    if (slack !== 0) continue;
    const by: ByWhen = { grade: Math.max(7, Math.min(12, latest)) as SchoolGrade, point: "end" };
    if (!future(ctx, by)) continue;
    if (ctx.firstGrade <= 8 && latest > 9) continue;
    const placed = fill.placements.find((p) => p.kind === "ladder" && p.item.grade === step.grade && mathRankOf(p.item.typeId) === step.rank);
    const rung = placed ? courseTypeTitle(placed.item.typeId, ctx.state) : rungName(fill.ladder.family, step.rank, ctx.state);
    const rungText = rung.charAt(0).toUpperCase() + rung.slice(1);
    const when = binding.byGrade === 12 ? "in 12th" : `by the end of ${nth(binding.byGrade)}`;
    const target = fill.placements.find((p) => p.kind === "ladder" && mathRankOf(p.item.typeId) === binding.rank);
    const targetName = binding.rank === 5 ? "calculus" : binding.rank === 4 ? "precalculus" : target ? courseTypeTitle(target.item.typeId, ctx.state) : binding.label;
    const text = step.rank === 1 && latest <= 8 ? `${rungText} in ${nth(latest)} keeps ${targetName} ${when} open.` : `${rungText} by the end of ${nth(latest)} keeps ${targetName} ${when} open.`;
    out.push({
      id: `${idPrefix}:${step.rank}`,
      kind: "ladder",
      by,
      text,
      slackYears: 0,
      reasons: [reason("ladder", text, { claim: "suggestion", params: { rank: step.rank, grade: latest } })],
    });
  }
  return out;
}

function ruleDeadlines(ctx: Ctx, fill: FillResult): Deadline[] {
  const out: Deadline[] = [];
  for (const e of fill.evals) {
    if (!e.best || !e.rc.variant) continue;
    const checks = (e.rc.variant.checks ?? []).filter((c) => c.kind === "on_schedule_by");
    for (const leafResult of e.best.leaves) {
      if (!leafResult.leaf.own) continue;
      const req = leafResult.leaf.req;
      const check = checks.find((c) => c.kind === "on_schedule_by" && c.req === leafResult.leaf.id);
      const grade = check && check.kind === "on_schedule_by" ? check.grade : req.kind === "credits" ? req.deadlineGrade : undefined;
      if (grade === undefined) continue;
      // With a test-score route, an unplanned course route isn't the default: the test date shows instead.
      if (leafResult.missing > 0 && (e.rc.rs.testRoutes ?? []).some((t) => t.by)) continue;
      // Already done: nothing to schedule.
      if (leafResult.firm >= leafResult.required) continue;
      const by: ByWhen = { grade, point: "end" };
      if (!future(ctx, by)) continue;
      const at = leafResult.counted.length ? Math.max(...leafResult.counted.map((c) => c.item.grade)) : null;
      const slack = leafResult.missing === 0 && at !== null ? Math.max(0, grade - at) : 0;
      const text = `${leafResult.leaf.label} on your plan by the end of ${nth(grade)} grade, for ${e.rc.rs.title}.`;
      out.push({
        id: `rule:${e.rc.rs.id}/${leafResult.leaf.id}`,
        kind: "rule",
        by,
        text,
        slackYears: slack,
        reasons: [
          reason("deadline", text, {
            ruleSetId: e.rc.rs.id,
            reqId: leafResult.leaf.id,
            strength: leafResult.leaf.strength,
            citations: [...(check ? check.cite : []), ...leafResult.leaf.cite],
          }),
        ],
      });
    }
  }
  return out;
}

/** "Calculus I with a B or higher and a 4th math credit". */
function listLabels(labels: string[]): string {
  const words = labels.map((l, i) => (i > 0 && /^(A|An|The|One|Two|Three|Four) /.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * A dated test-score route whose class route isn't planned (design §5.6, §5.13: the test route is
 * the default in Plan A): the date on the strip, and the class route as a line under it, never a
 * gap or a push to accelerate.
 */
/** The student's last finished math class was a B or better (unknown letters don't count). */
function lastMathBOrBetter(ctx: Ctx): boolean {
  const last = ctx.items.filter((i) => i.own && i.subject === "math" && i.completed && i.letter).sort((a, b) => b.grade - a.grade)[0];
  return last ? atLeast(last.letter, "B") === true : false;
}

function testDeadlines(ctx: Ctx, fill: FillResult): Deadline[] {
  const out: Deadline[] = [];
  for (const e of fill.evals) {
    if (!e.best) continue;
    const open = e.best.leaves.filter((l) => l.missing > 0);
    if (open.length === 0) continue;
    for (const route of e.rc.rs.testRoutes ?? []) {
      if (!route.by) continue;
      const by: ByWhen = { grade: route.by.grade, point: "date", month: route.by.month, day: route.by.day };
      if (!future(ctx, by)) continue;
      const text = `${e.rc.rs.title}, test-score route: ${route.text}`;
      const deadlines = open.map((l) => (l.leaf.req.kind === "credits" ? l.leaf.req.deadlineGrade : undefined)).filter((g): g is SchoolGrade => g !== undefined);
      const when = deadlines.length ? ` by the end of ${nth(Math.min(...deadlines))} grade` : "";
      const unreachable = (fill.ladder.solution?.unmet ?? []).some((c) => open.some((l) => c.id === `${e.rc.rs.id}/${l.leaf.id}`));
      // The student who opted in with a B or better has already said they want to move faster.
      const optedIn = ctx.limits.accelerateMath && lastMathBOrBetter(ctx);
      const note =
        `Or show it with a class: ${listLabels(open.map((l) => l.leaf.label))}${when}.` +
        (unreachable
          ? optedIn
            ? " From where you are, that would take a summer class or two math classes in one year. Ask your counselor what your school offers."
            : " From where you are, that would take a summer class or two math classes in one year. Only if you want that and your last math grade is a B or better."
          : "");
      out.push({
        id: `test:${e.rc.rs.id}/${route.id}`,
        kind: "test",
        by,
        text,
        slackYears: 0,
        note,
        reasons: [reason("deadline", text, { ruleSetId: e.rc.rs.id, citations: [...route.cite, ...open.flatMap((l) => l.leaf.cite)] })],
      });
    }
  }
  return out;
}

export function buildDecisions(ctx: Ctx, fill: FillResult): PendingDecision[] {
  const out: PendingDecision[] = [];
  const rules = ctx.content.rules.flatMap((f) => f.ruleSets);
  if (ctx.state === "TX" && !(ctx.choices.txEndorsements?.length) && !ctx.choices.txFoundationOnly && ctx.firstGrade <= 11) {
    const endorsements = rules.filter((r) => r.appliesWhen.choice?.key === "txEndorsements");
    if (endorsements.length) {
      const by: ByWhen | null = ctx.grade <= 8 || (ctx.grade === 9 && ctx.inProgressGrade === null) ? { grade: 9, point: "start" } : null;
      out.push({
        key: "txEndorsements",
        by,
        text: by ? "Name your Texas endorsement when you start 9th grade. You can change it later." : "Name your Texas endorsement. You can change it any time.",
        reasons: [reason("choice", "Texas students name an endorsement when they start high school, and can switch later.", { ruleSetId: endorsements[0].id, citations: [endorsements[0].strengthCite] })],
      });
    }
  }
  if (ctx.state === "TN" && !ctx.choices.tnElectiveFocus) {
    const focus = rules.filter((r) => r.appliesWhen.choice?.key === "tnElectiveFocus");
    if (focus.length) {
      const by: ByWhen | null = ctx.grade < 10 || (ctx.grade === 10 && ctx.inProgressGrade === 10) ? { grade: 10, point: "end" } : null;
      out.push({
        key: "tnElectiveFocus",
        by,
        text: by ? "Choose your elective focus by the end of 10th grade." : "Choose your elective focus. Ask your counselor which one fits the classes you've taken.",
        reasons: [reason("choice", "Tennessee students choose an elective focus by the end of 10th grade.", { ruleSetId: focus[0].id, citations: [focus[0].strengthCite] })],
      });
    }
  }
  if (ctx.input.targets.families.length === 0) {
    out.push({ key: "family", by: null, text: "Pick a career goal, and we'll add the classes that prepare you for it.", reasons: [reason("choice", "Major prep comes from your career goals.", { claim: "suggestion" })] });
  }
  const lang = fill.placements.find((p) => p.kind === "language");
  if (lang && !ctx.choices.worldLanguage && !ctx.items.some((i) => i.subject === "world_language")) {
    const code = lang.row.typeId.split(".")[1] as LanguageCode;
    // The latest start that still fits the levels a requirement asks for (2 levels: the start of
    // 11th); a recommendation alone puts nothing on the "by when" strip.
    const required = fill.baselineNeeds.filter((n) => n.language && n.priority <= 1 && n.leaf?.strength === "required");
    const levels = Math.max(0, ...required.map((n) => n.language!.levels));
    const latest = levels > 0 ? 13 - Math.min(4, levels) : null;
    out.push({
      key: "worldLanguage",
      by: latest !== null && latest >= 9 ? { grade: latest as SchoolGrade, point: "start" } : null,
      text: `Pick a world language. We planned ${LANGUAGE_NAMES[code]} for now; any language your school offers works.`,
      reasons: [reason("choice", "Two years of one language counts for graduation or college here.", { claim: "rule", citations: lang.primary?.reasons.flatMap((r) => r.citations) ?? [] })],
    });
  }
  if (ctx.input.targets.path === "training" && !ctx.choices.ctePathway && !ownCtePathway(ctx) && !fill.placements.some((p) => p.kind === "cte") && ctx.firstGrade <= 11) {
    out.push({ key: "ctePathway", by: null, text: "Pick a career pathway (CTE), and we'll plan its classes in order.", reasons: [reason("choice", "A CTE pathway taken in order prepares you for training after high school.", { claim: "suggestion" })] });
  }
  return out;
}

export function buildDeadlines(ctx: Ctx, fill: FillResult, decisions: PendingDecision[]): Deadline[] {
  const middle = ctx.firstGrade <= 8;
  const all = [
    ...ladderDeadlines(ctx, fill, middle ? fill.ladder.fullSolution : fill.ladder.solution, "ladder"),
    ...ruleDeadlines(ctx, fill),
    ...testDeadlines(ctx, fill),
    ...decisions
      .filter((d): d is PendingDecision & { by: ByWhen } => d.by !== null && future(ctx, d.by))
      .map((d) => ({ id: `decision:${d.key}`, kind: "decision" as const, by: d.by, text: d.text, slackYears: 0, reasons: d.reasons })),
  ];
  const seen = new Set<string>();
  return all
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .map((d, i) => ({ d, i }))
    .sort((a, b) => byWhenOrder(a.d.by) - byWhenOrder(b.d.by) || a.d.slackYears - b.d.slackYears || a.i - b.i)
    .map(({ d }) => d);
}
