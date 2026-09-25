import type { SchoolGrade } from "../common";
import { courseTypeTitle, LANGUAGE_NAMES, type LanguageCode } from "../course-types";
import type { ByWhen, Deadline, PendingDecision } from "../engine-io";
import type { Ctx } from "./context";
import { reason } from "./explain";
import type { FillResult } from "./fill";
import { mathRankOf, rungName, type LadderSolution } from "./ladder";
import { byWhenOrder, nth } from "./util";

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

function testDeadlines(ctx: Ctx, fill: FillResult): Deadline[] {
  const out: Deadline[] = [];
  for (const e of fill.evals) {
    if (!e.best) continue;
    const courseRouteOpen = e.best.leaves.some((l) => l.missing > 0);
    if (!courseRouteOpen) continue;
    for (const route of e.rc.rs.testRoutes ?? []) {
      if (!route.by) continue;
      const by: ByWhen = { grade: route.by.grade, point: "date", month: route.by.month, day: route.by.day };
      if (!future(ctx, by)) continue;
      const text = `${e.rc.rs.title}, test-score route: ${route.text}`;
      out.push({ id: `test:${e.rc.rs.id}/${route.id}`, kind: "test", by, text, slackYears: 0, reasons: [reason("deadline", text, { ruleSetId: e.rc.rs.id, citations: route.cite })] });
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
    out.push({
      key: "worldLanguage",
      by: { grade: lang.item.grade, point: "start" },
      text: `Pick a world language. We planned ${LANGUAGE_NAMES[code]} for now; any language your school offers works.`,
      reasons: [reason("choice", "Two years of one language counts for graduation or college here.", { claim: "rule", citations: lang.primary?.reasons.flatMap((r) => r.citations) ?? [] })],
    });
  }
  if (ctx.input.targets.path === "training" && !ctx.choices.ctePathway && !fill.placements.some((p) => p.kind === "cte") && ctx.firstGrade <= 11) {
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
