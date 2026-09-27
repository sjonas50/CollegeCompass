import { US_STATES } from "@/lib/colleges/states";
import type { PlannerState, SchoolGrade } from "../common";
import { comingLaterNote, DRAFT_BANNER, STANDING_PLAN_NOTE } from "../copy";
import { courseTypeTitle, type CourseTypeId, getCourseType, isCollegeLevel } from "../course-types";
import {
  COLLEGE_LEVEL_SOFT_WARNING_AT,
  type BuiltFrom,
  type Demand,
  type MiddleSchoolView,
  type NoStatePath,
  type PathResult,
  type PendingDecision,
  type PlanChoice,
  type PlannedPath,
  type PlannerChoices,
  type PlannerInput,
  type PlanOption,
  type PlanSlot,
  type PlanYear,
  type Reason,
  type ReviewNotice,
  type RuleSetAudit,
  type SlotWarning,
  suggestionKey,
} from "../engine-io";
import { isStale, reviewLabel, staleLabel } from "../review";
import type { Check, ContentHeader, Req, Selector } from "../rules";
import { type AltResult, evaluateAlternative, type LeafResult } from "./allocate";
import { admissionConflicts, expandedResults, ruleSetAudit, waiverNotes, worst } from "./audit";
import { type Alternative, type CLeaf, leafSignature } from "./compile";
import { aimsAt, buildContext, type Ctx, type FamilyCtx, leafPriority, rowIsOffered, type RuleSetCtx, schoolYearOfGrade } from "./context";
import { algebra2Reason, leafNoteReason, loadReason, prepReason, reason, requirementReason, resolveCitations, retakeReason, seniorMathReason } from "./explain";
import { belowPrecalculus, type FillResult, isRepeatable, pastIntro, type PlanConfig, prereqsMetIn, runFill, sameContent } from "./fill";
import { addedCreditTotal, buildGaps, creditRoom } from "./gaps";
import { mathRankOf, rungName, rungTypes, startRank, unresolvedFailedRank } from "./ladder";
import { asPlanned, type Item } from "./model";
import { type Need, needUnits } from "./needs";
import { counselorQuestions } from "./questions";
import { matchesAny } from "./select";
import { buildDecisions, buildDeadlines } from "./timeline";
import { atLeast, earnsNoCredit, hash16, lowerFirstWord, nth, stableJson } from "./util";

// ---------------------------------------------------------------------------
// plan(input) → PathResult (design §5). Pure and deterministic: the same input gives the same
// output, byte for byte. No database, no clock (the date is in the input), no randomness.
// ---------------------------------------------------------------------------

function noState(input: PlannerInput): NoStatePath {
  const name = input.homeState ? (US_STATES.find((s) => s.code === input.homeState)?.name ?? input.homeState) : null;
  return { mode: "no_state", homeState: input.homeState, comingLater: name ? comingLaterNote(name) : null };
}

function fingerprintOf(ctx: Ctx): string {
  const { content: _content, ...rest } = ctx.input;
  const files = [...ctx.fingerprints.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, fp]) => `${id}=${fp}`);
  return hash16(`${stableJson(rest)}|${files.join(",")}`);
}

// Plans -------------------------------------------------------------------------------------------

function signature(fill: FillResult): string {
  return fill.placements
    .map((p) => `${p.item.grade}:${p.item.typeId}:${p.item.term === "summer" ? "s" : ""}`)
    .sort()
    .join("|");
}

function materiallyDifferent(a: FillResult, b: FillResult): boolean {
  return signature(a) !== signature(b);
}

/** Units of required (P0-P1) needs still unmet: a Plan B must be as feasible as Plan A. */
function hardUnmet(fill: FillResult): number {
  return fill.needs.filter((n) => n.priority <= 1 && !n.soft && n.missing > 0).reduce((s, n) => s + needUnits(n), 0);
}

function realChoice(a: FillResult, b: FillResult): boolean {
  return materiallyDifferent(a, b) && hardUnmet(b) <= hardUnmet(a);
}

type Decision = { a: FillResult; b: FillResult; choice: PlanChoice; labels: [string, string] };

function lastMathBOrBetter(ctx: Ctx): boolean {
  const last = ctx.items.filter((i) => i.subject === "math" && i.completed && i.letter).sort((x, y) => y.grade - x.grade)[0];
  return last ? atLeast(last.letter, "B") === true : false;
}

function mathRoute(ctx: Ctx, getA: () => FillResult, base: PlanConfig): Decision | null {
  if (!ctx.limits.accelerateMath || !lastMathBOrBetter(ctx)) return null;
  const fillA = getA();
  const unmet = fillA.ladder.solution?.unmet ?? [];
  if (unmet.length === 0) return null;
  const fillB = runFill(ctx, { ...base, id: "B", accelerate: true });
  const unmetB = fillB.ladder.solution?.unmet ?? [];
  if (unmetB.length >= unmet.length || !realChoice(fillA, fillB)) return null;
  const solved = unmet.find((c) => !unmetB.some((k) => k.id === c.id))!;
  const need = fillA.needs.find((n) => n.id === solved.id);
  const summer = fillB.placements.some((p) => p.item.term === "summer" && p.kind === "ladder");
  const college = fillB.ladder.solution?.steps.some((st) => st.college) ?? false;
  const extra = summer ? "adds a summer class" : college ? "adds two college-credit math classes in one year" : "adds a second math class in one year";
  const target = rungName(fillB.ladder.family, solved.rank, ctx.state);
  const labelA = need?.testRoutes.length ? `Plan A: show ${need.rc?.rs.title ?? target} with a test score.` : "Plan A: one math class a year.";
  const labelB = `Plan B: ${target} by the end of ${nth(solved.byGrade)} grade, ${extra}.`;
  return {
    a: fillA,
    b: fillB,
    labels: [labelA, labelB],
    choice: {
      kind: "math_route",
      text: `You opted in to moving faster in math. The plans differ in how you reach ${target}.`,
      reasons: [reason("ladder", `Only because you asked to consider moving faster in math and your last math grade was a B or better.`, { claim: "suggestion" })],
    },
  };
}

/**
 * The rule sets a plan for one goal follows: a program gate or admission rule that names families
 * or majors applies only if it names this goal (Texas A&M's engineering math isn't part of a
 * nursing plan).
 */
function ruleSetsFor(ctx: Ctx, f: FamilyCtx): RuleSetCtx[] {
  return ctx.ruleSets.filter((rc) => {
    const gate = rc.rs.appliesWhen;
    return (!gate.families && !gate.cips) || aimsAt(f.target, gate.families, gate.cips);
  });
}

/** A goal's major-prep classes that have no room in the plan (not a class it doesn't list). */
function misfits(fill: FillResult, familyId: FamilyCtx["target"]["familyId"] | null = null): string[] {
  return fill.needs
    .filter((n) => n.source === "prep" && !n.soft && n.missing > 0 && (familyId === null || n.familyId === familyId) && ["doesnt_fit", "load"].includes(fill.unmet.get(n.id) ?? ""))
    .map((n) => n.id);
}

function targetSplit(ctx: Ctx, getA: () => FillResult, base: PlanConfig): Decision | null {
  // The student chose which family to plan around: the other is "also check" (design §2.6).
  if (ctx.families[0]?.target.source === "chosen") return null;
  const fams = ctx.families.filter((f, i) => ctx.families.findIndex((g) => g.target.familyId === f.target.familyId) === i);
  if (fams.length < 2 || !fams[0].content || !fams[1].content) return null;
  const fillA = getA();
  const misfit = misfits(fillA);
  if (misfit.length === 0) return null;
  // Each plan prepares for its own goal: the other goal's program rules aren't part of it, and in
  // Texas it plans with that goal's endorsement when the student hasn't named one (nursing's
  // Public Services, engineering's STEM).
  const own = (f: FamilyCtx) => {
    const sub = goalEndorsement(ctx, f);
    const fam = sub.families.find((g) => g.target.familyId === f.target.familyId) ?? f;
    return { sub, fam };
  };
  const [pa, pb] = [own(fams[0]), own(fams[1])];
  const a = runFill(pa.sub, { ...base, families: [pa.fam], ruleSets: ruleSetsFor(pa.sub, pa.fam) });
  const b = runFill(pb.sub, { ...base, id: "B", families: [pb.fam], ruleSets: ruleSetsFor(pb.sub, pb.fam) });
  if (!realChoice(a, b)) return null;
  // Only a real choice: one goal's classes that didn't fit next to the other's fit in its own plan.
  // When they don't fit there either, the goals don't compete for room and one plan shows both.
  const resolved = [a, b].some((fill, i) => misfit.some((id) => id.startsWith(`prep:${fams[i].target.familyId}/`) && !misfits(fill, fams[i].target.familyId).includes(id)));
  if (!resolved) return null;
  const name = (f: FamilyCtx) => lowerFirstWord(f.title);
  return {
    a,
    b,
    labels: [`Plan A: prepares for ${name(fams[0])}.`, `Plan B: prepares for ${name(fams[1])}.`],
    choice: {
      kind: "target_split",
      text: `Your two goals, ${name(fams[0])} and ${name(fams[1])}, need different classes that don't all fit. Each plan prepares for one; you can switch any time.`,
      reasons: fams.slice(0, 2).map((f) => prepReason(ctx, f.target.familyId, "the classes this goal needs", f.content?.math.cite ?? [])),
    },
  };
}

type EndorsementValue = NonNullable<PlannerChoices["txEndorsements"]>[number];

/** Rule sets' requirement trees, leaves only. */
function reqLeaves(reqs: readonly Req[]): Req[] {
  return reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? reqLeaves(r.of) : r.kind === "option" ? reqLeaves([r.on, r.off]) : [r]));
}

/**
 * The endorsements that fit the student's goals, best first: a goal's own Texas endorsement
 * (families.json, cited), then the endorsements whose career and technical programs include the
 * goal's Texas pathway, or the pathway the student is already taking. STEM only ever comes from a
 * goal that names it (never as a default for a student without a STEM goal).
 */
function preferredEndorsements(ctx: Ctx): EndorsementValue[] {
  const out: EndorsementValue[] = [];
  const push = (v: EndorsementValue) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const f of ctx.families) if (f.content?.txEndorsement) push(f.content.txEndorsement.value);
  const clusters: string[] = [];
  for (const f of ctx.families) for (const p of f.content?.ctePathways ?? []) if (p.state === ctx.state) clusters.push(p.cluster);
  if (ctx.choices.ctePathway) clusters.push(ctx.choices.ctePathway.cluster);
  for (const v of endorsementsForClusters(ctx, [...clusters, ...ownCteClusters(ctx)])) push(v);
  return out;
}

/** Career clusters of the student's own career and technical classes (not failed). */
function ownCteClusters(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const i of ctx.items) {
    const cluster = getCourseType(i.typeId).cteCluster;
    if (i.own && !i.noCredit && cluster && i.cte && !out.includes(cluster)) out.push(cluster);
  }
  return out;
}

/** Endorsements (never STEM) whose career and technical programs of study include these clusters. */
function endorsementsForClusters(ctx: Ctx, clusters: string[]): EndorsementValue[] {
  const out: EndorsementValue[] = [];
  for (const cluster of clusters) {
    for (const { rs } of ctx.allRuleSets.values()) {
      if (rs.appliesWhen.choice?.key !== "txEndorsements" || rs.appliesWhen.choice.value === "stem") continue;
      const value = rs.appliesWhen.choice.value as EndorsementValue;
      const leaves = rs.variants.flatMap((v) => reqLeaves(v.requirements));
      if (!out.includes(value) && leaves.some((l) => l.kind === "credits" && l.select.some((sel) => sel.cte && sel.types?.includes(`cte.${cluster}.1` as CourseTypeId)))) out.push(value);
    }
  }
  return out;
}

/**
 * A Texas student who hasn't named an endorsement and whom the two-plan endorsement choice doesn't
 * reach (the training path, 11th grade, a transfer): the plan uses a default instead of stopping
 * at the Foundation program. The endorsement of the career pathway the plan follows: the one the
 * student chose, the one their own career classes are in (a Transportation program counts for
 * Business and Industry), or on the training path the goal's Texas pathway that the plan places
 * (an electrician's construction program); else Multidisciplinary Studies. The pending decision
 * still asks the student to name one; seniors keep the Foundation plan (with the audit's "ask your
 * counselor").
 */
function withDefaultEndorsement(ctx: Ctx): Ctx {
  if (ctx.state !== "TX" || ctx.choices.txEndorsements?.length || ctx.choices.txFoundationOnly || ctx.firstGrade <= 8 || ctx.grade >= 12) return ctx;
  const goalPathway = ctx.input.targets.path === "training" ? ctx.families[0]?.content?.ctePathways.find((p) => p.state === ctx.state)?.cluster : undefined;
  const clusters = [...(ctx.choices.ctePathway ? [ctx.choices.ctePathway.cluster] : []), ...ownCteClusters(ctx), ...(goalPathway ? [goalPathway] : [])];
  return withEndorsement(ctx, endorsementsForClusters(ctx, clusters)[0] ?? "multidisciplinary");
}

/** The context with an endorsement the student hasn't named, used for now (the audit says so). */
function withEndorsement(ctx: Ctx, value: EndorsementValue): Ctx {
  const rs = [...ctx.allRuleSets.values()].find(({ rs }) => rs.appliesWhen.choice?.key === "txEndorsements" && rs.appliesWhen.choice.value === value)?.rs;
  if (!rs) return ctx;
  const sub = buildContext({ ...ctx.input, state: ctx.state, content: ctx.content, prefs: { ...ctx.input.prefs, choices: { ...ctx.input.prefs.choices, txEndorsements: [value] } } });
  return { ...sub, endorsementDefault: rs.title };
}

/**
 * Where the two-plan endorsement choice applies but another decision (or none) makes the plans, a
 * plan still needs an endorsement: a 9th or 10th grader can't graduate without one unless, after
 * 10th grade, a parent signs (19 TAC §74.11(f)). The goal's own endorsement (families.json
 * txEndorsement), else the one its pathway leads to, else Multidisciplinary Studies; the audit says
 * it's used for now, and the pending decision still asks the student to name one.
 */
function goalEndorsement(ctx: Ctx, f?: FamilyCtx): Ctx {
  if (!endorsementSplitApplies(ctx)) return ctx;
  const value = f?.content?.txEndorsement?.value ?? preferredEndorsements(ctx)[0];
  return value ? withEndorsement(ctx, value) : withDefaultEndorsement(ctx);
}

/** The two-plan endorsement choice: Texas, none named, 9th-10th grade, not the training path. */
function endorsementSplitApplies(ctx: Ctx): boolean {
  if (ctx.state !== "TX" || ctx.choices.txEndorsements?.length || ctx.choices.txFoundationOnly || ctx.grade > 10 || ctx.firstGrade <= 8) return false;
  return ctx.input.targets.path !== "training";
}

function endorsementSplit(ctx: Ctx, base: PlanConfig): Decision | null {
  if (!endorsementSplitApplies(ctx)) return null;
  const preferred = preferredEndorsements(ctx);
  const options = [...ctx.allRuleSets.values()].filter(({ rs }) => {
    const value = rs.appliesWhen.choice?.key === "txEndorsements" ? rs.appliesWhen.choice.value : null;
    // STEM needs a STEM goal: never a default for a student who hasn't named one.
    return value !== null && (value !== "stem" || preferred.includes("stem"));
  });
  if (options.length < 2) return null;
  const all = options.map(({ rs }, order) => {
    const value = rs.appliesWhen.choice!.value as EndorsementValue;
    const sub = buildContext({ ...ctx.input, state: ctx.state, content: ctx.content, prefs: { ...ctx.input.prefs, choices: { ...ctx.input.prefs.choices, txEndorsements: [value] } } });
    const fill = runFill(sub, { ...base, ruleSets: sub.ruleSets, families: sub.families }, false);
    const unmet = fill.needs.filter((n) => n.priority <= 1 && !n.soft).reduce((s, n) => s + needUnits(n), 0);
    const added = fill.placements.reduce((s, p) => s + p.item.units, 0);
    const college = fill.placements.filter((p) => isCollegeLevel(p.item.level)).length;
    // A goal's endorsement first; with no goal, Multidisciplinary Studies (the four core subjects the
    // DLA already asks for) before endorsements that add a program.
    const fit = preferred.includes(value) ? preferred.indexOf(value) : preferred.length === 0 && value === "multidisciplinary" ? 0 : 99;
    // A program that counts only on a condition the plan doesn't meet (an IT program for Business
    // and Industry when the plan also meets STEM's math and science, §74.13(f)(7)(B)) isn't a real
    // way to earn this endorsement: the student would earn STEM instead.
    const conditional = audits(sub, fill).some((a) => a.ruleSetId === rs.id && a.checks.some((c) => c.kind === "counts_unless" && c.status === "ask_counselor"));
    return { rs, fill, unmet, added, college, fit, order, conditional };
  });
  const trials = all.filter((t) => !t.conditional);
  trials.sort((x, y) => x.unmet - y.unmet || x.fit - y.fit || x.added - y.added || x.college - y.college || x.order - y.order);
  const [first] = trials;
  if (!first) return null;
  const second = trials.slice(1).find((t) => realChoice(first.fill, t.fill));
  if (!second) return null;
  // "Two that fit your goals" only when both come from the goals: Multidisciplinary Studies as the
  // fallback next to a computer science goal's STEM is "two you could plan for", naming the one
  // that fits.
  const valueOf = (t: (typeof trials)[number]) => t.rs.appliesWhen.choice!.value as EndorsementValue;
  const fitsA = preferred.includes(valueOf(first));
  const fitsB = preferred.includes(valueOf(second));
  const text =
    fitsA && fitsB
      ? "You haven't named a Texas endorsement yet. Here are two that fit your goals; you can pick any endorsement and change it later."
      : fitsA || fitsB
        ? `You haven't named a Texas endorsement yet. Here are two you could plan for, and Plan ${fitsA ? "A" : "B"}'s endorsement fits your goals. You can pick any endorsement and change it later.`
        : "You haven't named a Texas endorsement yet. Here are two you could plan for; you can pick any endorsement and change it later.";
  return {
    a: first.fill,
    b: { ...second.fill, config: { ...second.fill.config, id: "B" } },
    labels: [`Plan A: with the ${first.rs.title}.`, `Plan B: with the ${second.rs.title}.`],
    choice: {
      kind: "endorsement",
      text,
      reasons: [reason("choice", "Texas students name an endorsement when they start high school, and can switch later.", { ruleSetId: first.rs.id, citations: [first.rs.strengthCite] })],
    },
  };
}

function languageVsCte(ctx: Ctx, getA: () => FillResult, base: PlanConfig): Decision | null {
  const fillA = getA();
  const blocked = (f: FillResult, pred: (n: Need) => boolean) => f.needs.some((n) => pred(n) && n.missing > 0 && f.unmet.get(n.id) === "doesnt_fit");
  const isLang = (n: Need) => n.language !== null;
  const isCte = (n: Need) => n.id.startsWith("cte:");
  if (!fillA.needs.some(isCte) && !fillA.baselineNeeds.some(isCte)) return null;
  if (!fillA.baselineNeeds.some(isLang)) return null;
  if (!blocked(fillA, isCte) && !blocked(fillA, isLang)) return null;
  const b = runFill(ctx, { ...base, id: "B", cteFirst: true });
  if (!realChoice(fillA, b)) return null;
  return {
    a: fillA,
    b,
    labels: ["Plan A: more years of your world language.", "Plan B: finish your career pathway."],
    choice: {
      kind: "language_vs_cte",
      text: "There isn't room for both another world language year and your full career pathway. Each plan keeps one.",
      reasons: [reason("choice", "Both count; which matters more depends on your goals. Ask your counselor.", { claim: "suggestion" })],
    },
  };
}

// Years and slots ---------------------------------------------------------------------------------

function yoursWarnings(ctx: Ctx, fill: FillResult, fact: PlannerInput["courses"][number]): SlotWarning[] {
  const out: SlotWarning[] = [];
  // A typed class the name didn't place, planned as the class its grade says it is: say which.
  const item = ctx.items.find((i) => i.key === `c:${fact.id}`);
  if (item?.provisional) {
    out.push({ kind: "guess", text: `We planned around this as ${courseTypeTitle(item.typeId, ctx.state)} because of its grade. Set "What kind of class is this?" on it to be sure it counts.` });
  }
  // A math class above a rung the student failed or withdrew from and hasn't passed since (Geometry
  // after an F in Algebra I): it builds on that rung.
  const rank = mathRankOf(fact.typeId);
  const failed = unresolvedFailedRank(ctx.items.filter((i) => i.own));
  if (rank !== null && failed !== null && rank > failed && !(fact.status === "completed" && earnsNoCredit(fact.finalGrade))) {
    out.push({ kind: "prereq_missing", text: `You haven't passed ${rungName(fill.ladder.family, failed, ctx.state)} yet, and this class builds on it. Ask your counselor about retaking it.` });
  }
  if (fact.status === "completed" || fact.grade < ctx.firstGrade || fact.grade < 9) return out;
  const cat = ctx.catalogs.get(fact.grade);
  if (!cat) return out;
  const sy = schoolYearOfGrade(ctx, fact.grade);
  const sameType = cat.rows.filter((r) => r.typeId === fact.typeId);
  const row = (fact.catalogCourseId ? cat.byId.get(fact.catalogCourseId) : undefined) ?? sameType.find((r) => r.level === fact.level) ?? sameType[0];
  if (cat.school && !fact.assumed && !getCourseType(fact.typeId).fallback) {
    if (!row) out.push({ kind: "not_offered", text: "Your school's class list doesn't show this class. Check with your counselor." });
    else if (!rowIsOffered(row, fact.grade, sy)) out.push({ kind: "grade_not_allowed", text: `Your school's class list shows this class in other grades, not ${nth(fact.grade)}.` });
  }
  if (row && fact.status === "planned") {
    const others = fill.items.filter((i) => i.key !== `c:${fact.id}`);
    if (!prereqsMetIn(others, row, fact.grade, () => null)) {
      out.push({ kind: "prereq_missing", text: "We don't see the class this one builds on before it. Check the order with your counselor." });
    }
  }
  if (fact.lectureOnly && fact.subject === "science" && ctx.ruleSets.some((rc) => rc.variant?.requirements && JSON.stringify(rc.variant.requirements).includes('"lab":true'))) {
    out.push({ kind: "conflict", text: "It's listed without a lab, so it may not count as a lab science here. Ask your counselor." });
  }
  return out;
}

/** The final audit's routes, with the student's guessed class types taken as confirmed (as the fill planned). */
type Routes = {
  items: Item[];
  routes: Map<string, AltResult>;
  /** What each suggestion is needed for, per rule set (computed once per slot). */
  needed: Map<string, { rc: RuleSetCtx; route: AltResult; leaves: CLeaf[]; rest: Item[] }[]>;
  /** Every alternative of a rule set on the plan's classes (computed once, for Other choices). */
  all: Map<string, AltResult[]>;
};

function confirmedRoutes(fill: FillResult): Routes {
  const items = asPlanned(fill.items);
  const routes = new Map<string, AltResult>();
  for (const e of fill.evals) if (e.best) routes.set(e.rc.rs.id, evaluateAlternative(e.best.alt, items, e.rc.allocation));
  return { items, routes, needed: new Map(), all: new Map() };
}

/** Each rule set's requirements a suggestion is needed for, on the final audit's routes. */
function neededFor(ctx: Ctx, fill: FillResult, routes: Routes, item: Item): { rc: RuleSetCtx; route: AltResult; leaves: CLeaf[]; rest: Item[] }[] {
  const cached = routes.needed.get(item.key);
  if (cached) return cached;
  const rest = withoutClass(ctx, fill, routes.items, item.key);
  const out: { rc: RuleSetCtx; route: AltResult; leaves: CLeaf[]; rest: Item[] }[] = [];
  for (const e of fill.evals) {
    const route = routes.routes.get(e.rc.rs.id);
    if (!route) continue;
    let leaves = neededLeaves(e.rc, route, item.key, rest);
    // Suggestions that could stand in for each other (Chemistry, and a Physics a college only
    // recommends, for Utah's "one more science credit"): taking out either one leaves the
    // requirement met, but setting both aside would leave it short. The class the route counts
    // carries the requirement; the others count only as what they're there for.
    if (leaves.length === 0 && !item.own) {
      const strict = withoutFreeSuggestions(route, rest);
      if (strict.length < rest.length) leaves = neededLeaves(e.rc, route, item.key, strict);
    }
    out.push({ rc: e.rc, route, leaves, rest });
  }
  routes.needed.set(item.key, out);
  return out;
}

/**
 * The classes left once suggestions this rule set's route doesn't use are set aside: the
 * student's own classes, and suggestions the route counts toward a requirement that uses up their
 * credit (not a total, the electives, or a requirement that shares credit).
 */
function withoutFreeSuggestions(route: AltResult, rest: Item[]): Item[] {
  const carried = new Set<string>();
  for (const l of route.leaves) {
    if (!namedLeaf(l)) continue;
    const req = l.leaf.req;
    if (req.kind === "credits" && req.shareable) continue;
    for (const c of l.counted) carried.add(c.item.key);
  }
  return rest.filter((i) => i.own || carried.has(i.key));
}

/**
 * What another class must do to take a suggestion's place, one test per required (P0-P1)
 * requirement the suggestion is needed for (U.S. History, not just "the rest of your social
 * studies credits"): count for that requirement itself; or, swapped in, keep the rule set's route
 * as met, or meet another of its routes as well (Physics for Chemistry in Utah's "two of the five
 * science areas"); or, for a graduation option's program of study, be another program's class at
 * the same step (Health Science 1 for Education and Training 1). A sibling in the same route
 * (Speech for a required World History in "four credits in each core subject") never is.
 */
function requiredChecks(ctx: Ctx, fill: FillResult, routes: Routes, item: Item): ((probe: Item) => boolean)[] {
  const out: ((probe: Item) => boolean)[] = [];
  const step = getCourseType(item.typeId).ladder?.rank ?? null;
  for (const { rc, route, leaves } of neededFor(ctx, fill, routes, item)) {
    const cache = new Map<string, boolean>();
    const swapOk = (probe: Item): boolean => {
      const k = `${probe.typeId}|${probe.level}|${probe.units}|${probe.cte}|${probe.lectureOnly}`;
      let ok = cache.get(k);
      if (ok === undefined) {
        ok = swapKeepsRoute(rc, route, routes, probe, routes.items.map((i) => (i.key === item.key ? probe : i)));
        cache.set(k, ok);
      }
      return ok;
    };
    for (const leaf of leaves) {
      const owner = leaf.own ? rc : (ctx.ruleSets.find((r) => rc.bases.some((b) => b.rs.id === r.rs.id)) ?? rc);
      const priority = leafPriority(owner, leaf.strength);
      if (priority === null || priority > 1) continue;
      const own = leaf.req.kind === "credits" || leaf.req.kind === "count" ? leaf.req.select : leaf.req.kind === "same_language" ? [{ subjects: ["world_language" as const] }] : null;
      if (!own) continue;
      const group = leaf.choice?.kind === "any" && owner.rs.kind === "graduation_option" && owner.variant ? findReq(owner.variant.requirements, leaf.choice.id) : null;
      const otherPrograms =
        group?.kind === "any" ? group.of.filter((b) => !containsReq(b, leaf.id)).flatMap((b) => reqLeaves([b]).flatMap((r) => (r.kind === "credits" || r.kind === "count" ? r.select : []))) : [];
      out.push(
        (probe) =>
          matchesAny(probe, own) ||
          (step !== null && (getCourseType(probe.typeId).ladder?.rank ?? null) === step && matchesAny(probe, otherPrograms)) ||
          swapOk(probe),
      );
    }
  }
  return out;
}

/**
 * With a class swapped for another, the rule set's route loses nothing it had, or another of its
 * routes is met at least as well.
 */
function swapKeepsRoute(rc: RuleSetCtx, route: AltResult, routes: Routes, probe: Item, swapped: Item[]): boolean {
  const before = new Map(route.leaves.filter(namedLeaf).map((l) => [l.leaf.id, l.missing]));
  const same = evaluateAlternative(route.alt, swapped, rc.allocation);
  const lost = same.leaves.filter((l) => namedLeaf(l) && l.missing > (before.get(l.leaf.id) ?? 0)).map((l) => leafSignature(l.leaf));
  if (same.notDone <= route.notDone && lost.length === 0) return true;
  let now = routes.all.get(rc.rs.id);
  if (!now) {
    now = rc.alternatives.map((alt) => evaluateAlternative(alt, routes.items, rc.allocation));
    routes.all.set(rc.rs.id, now);
  }
  return rc.alternatives.some((alt, i) => {
    // A route that has every requirement the swap left short goes short the same way, and one more
    // than a class away now can't be met by swapping one class.
    if (alt.index === route.alt.index || lost.every((sig) => alt.leaves.some((l) => leafSignature(l) === sig))) return false;
    if (now[i].missingNamed - probe.units > route.missingNamed || now[i].offTrackNamed - 1 > route.offTrackNamed) return false;
    const r = evaluateAlternative(alt, swapped, rc.allocation);
    return r.notDone === 0 && r.offTrackNamed <= route.offTrackNamed && r.missingNamed <= route.missingNamed;
  });
}

function containsReq(req: Req, id: string): boolean {
  if (req.id === id) return true;
  const kids = req.kind === "all" || req.kind === "any" || req.kind === "choose" ? req.of : req.kind === "option" ? [req.on, req.off] : [];
  return kids.some((k) => containsReq(k, id));
}

const namedLeaf = (l: LeafResult) => l.leaf.req.kind !== "total_credits" && l.leaf.req.kind !== "remaining_electives";

/**
 * The requirements of one rule set a suggestion is needed for: the leaves on the route that count
 * it, when taking it out would leave the rule set less met and no other combination of a "choose"
 * ("two of the five science areas") meets it without the class. A class that only adds to a
 * requirement other classes already meet isn't "Required" by it. (An `any` group's branch is the
 * plan's route, chosen by the audit: Spanish II is required for the language route even when a
 * suggested programming class could make the other route.)
 */
function neededLeaves(rc: RuleSetCtx, route: AltResult, key: string, rest: Item[]): CLeaf[] {
  const counting = route.leaves.filter((l) => namedLeaf(l) && l.counted.some((c) => c.item.key === key));
  if (counting.length === 0) return [];
  const before = new Map(route.leaves.filter(namedLeaf).map((l) => [l.leaf.id, l.missing]));
  const lost = (r: AltResult) => r.leaves.filter((l) => namedLeaf(l) && l.missing > (before.get(l.leaf.id) ?? 0)).map((l) => l.leaf.id);
  const lessMet = (r: AltResult) => r.notDone > 0 || lost(r).length > 0;
  const without = evaluateAlternative(route.alt, rest, rc.allocation);
  const lostHere = new Set(lost(without));
  if (lostHere.size === 0) return [];
  const groups = new Set(counting.flatMap((l) => (l.leaf.choice?.kind === "choose" ? [l.leaf.choice.id] : [])));
  if (groups.size > 0) {
    const outside = (a: Alternative) =>
      a.leaves
        .filter((l) => !l.path.some((p) => groups.has(p)))
        .map(leafSignature)
        .sort()
        .join("|");
    const same = outside(route.alt);
    for (const alt of rc.alternatives) {
      if (alt.index === route.alt.index || outside(alt) !== same) continue;
      if (!lessMet(evaluateAlternative(alt, rest, rc.allocation))) return [];
    }
  }
  // The requirements that would go short without it; when the others shift to cover those (one
  // pool of credit), the ones it counts toward.
  const short = counting.filter((l) => lostHere.has(l.leaf.id));
  return (short.length ? short : counting).map((l) => l.leaf);
}

/** An option's own requirements (not its base program's) that go short without a class. */
function ownLeavesShortWithout(rc: RuleSetCtx, route: AltResult, rest: Item[]): CLeaf[] {
  const without = evaluateAlternative(route.alt, rest, rc.allocation);
  return without.leaves.filter((l, i) => l.leaf.own && namedLeaf(l) && l.missing > route.leaves[i].missing).map((l) => l.leaf);
}

/**
 * The plan's classes without a suggestion and the suggestions that build on it (Spanish II
 * without Spanish I, calculus without precalculus): what taking it out would really leave.
 */
function withoutClass(ctx: Ctx, fill: FillResult, items: Item[], key: string): Item[] {
  const catalogIdOf = (i: Item) =>
    i.own ? (ctx.input.courses.find((c) => `c:${c.id}` === i.key)?.catalogCourseId ?? null) : (fill.placements.find((p) => p.item.key === i.key)?.row.id ?? null);
  const met = (p: FillResult["placements"][number], pool: Item[]) => prereqsMetIn(pool, p.row, p.item.grade, catalogIdOf, p.item.term === "summer", p.item.term === "spring");
  const before = new Set(fill.placements.filter((p) => met(p, items)).map((p) => p.item.key));
  const removed = new Set([key]);
  for (let changed = true; changed; ) {
    changed = false;
    const pool = items.filter((i) => !removed.has(i.key));
    for (const p of fill.placements) {
      if (removed.has(p.item.key) || !before.has(p.item.key) || met(p, pool)) continue;
      removed.add(p.item.key);
      changed = true;
    }
  }
  return items.filter((i) => !removed.has(i.key));
}

/**
 * Why a suggestion is on the plan: the requirements it's needed for on the final audit's route,
 * the major-prep targets it meets, checks it was placed for, and its own notes. "Required by"
 * wording comes only from the final audit (never from the route the fill first planned toward),
 * only when the class is needed for it, and names the whole requirement when the class is one way
 * through a choice.
 */
function slotReasons(ctx: Ctx, fill: FillResult, routes: Routes, item: Item, extra: Reason[], primary: Need | null, priority: number): Reason[] {
  const out: Reason[] = [];
  const seen = new Set<string>();
  const push = (r: Reason) => {
    // By what the line says: two requirements of one route named as the whole choice ("… (one way:
    // four credits in each core subject)") are one line.
    const k = `${r.kind}|${r.ruleSetId}|${r.familyId}|${r.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  for (const { rc, route, leaves: neededList, rest } of neededFor(ctx, fill, routes, item)) {
    for (const needed of neededList) {
      const base = needed.own ? null : (ctx.ruleSets.find((r) => rc.bases.some((b) => b.rs.id === r.rs.id)) ?? null);
      // A requirement of the program an option builds on (Tennessee's 4th math under an elective
      // focus) is named only as the audit shows it: the base program's own route counts the class
      // there. Otherwise the class is needed because the option's own requirements use a class the
      // base counts (the focus takes Coding I, the 4th math then needs another class), and those
      // are what it's for.
      const baseRoute = base ? routes.routes.get(base.rs.id) : undefined;
      const leaves =
        !base || baseRoute?.leaves.some((l) => l.leaf.id === needed.id && l.counted.some((c) => c.item.key === item.key))
          ? [needed]
          : ownLeavesShortWithout(rc, route, rest);
      for (const leaf of leaves) {
        const owner = leaf.own ? rc : (base ?? rc);
        // Only what can ask for a class explains a suggestion (not information-only or projected aid).
        if (leafPriority(owner, leaf.strength) === null) continue;
        // A class that's one way through a choice names the whole requirement: "two of the five
        // science areas", or a graduation option's route as one of several ("A public services
        // career and technical program of study (one way: education and training program)").
        const whole = leaf.choice?.kind === "choose" || (leaf.choice?.kind === "any" && owner.rs.kind === "graduation_option");
        push(requirementReason(owner, leaf, whole ? leaf.choice!.text : leaf.label, true));
        const note = leafNoteReason(owner, leaf, ctx.items);
        if (note) push(note);
      }
    }
  }
  for (const n of [...fill.baselineNeeds, ...fill.needs]) {
    if (n.source !== "prep" || !matchesAny(item, n.selectors)) continue;
    for (const r of n.reasons) push(r);
  }
  // A 12th-grade math class the senior-year math check counts (Utah, R277-700-9(2)) says so, the way
  // a requirement it's needed for does, whatever it was placed for (Precalculus placed for the
  // math sequence is also the senior-year math): dropping it would leave the check short.
  const senior = seniorMathCheck(ctx, fill, item);
  if (senior) push(seniorMathReason(senior.rc, senior.check.id, senior.check.cite));
  // A check (Tennessee: math in every year) isn't an audit line of its own; its reason stands.
  if (primary?.source === "check") for (const r of primary.reasons) push(r);
  for (const r of extra) push(r);
  // A class placed for a required credit keeps what it was placed for; only a class nothing
  // requires any more is an idea for an open slot, never "Required".
  if (out.length === 0 && priority <= 1 && primary) for (const r of primary.reasons) push(r);
  if (out.length === 0) push(reason("choice", "An idea for an open slot. It's your choice.", { claim: "suggestion" }));
  if (ctx.items.some((i) => i.own && i.noCredit && i.typeId === item.typeId)) {
    push(retakeReason());
    // Where the state has it, credit recovery is another way to retake it.
    const recovery = ctx.facts.options.find((o) => o.kind === "credit_recovery");
    if (recovery) push(reason("state_note", `Credit recovery is another way to retake it. ${recovery.note}`, { citations: recovery.cite }));
  }
  if (ctx.state === "TX" && item.typeId === "math.alg2") push(algebra2Reason());
  return out;
}

/**
 * The senior-year math check a suggested 12th-grade math class is needed for: the check applies
 * (college-bound, competency not recorded) and the student's other 12th-grade math wouldn't make a
 * full year without it.
 */
function seniorMathCheck(ctx: Ctx, fill: FillResult, item: Item): { rc: RuleSetCtx; check: Extract<Check, { kind: "senior_year_math" }> } | null {
  if (item.own || item.subject !== "math" || item.grade !== 12 || item.noCredit || ctx.input.targets.path === "training") return null;
  for (const e of fill.evals) {
    const check = e.rc.variant?.checks?.find((c): c is Extract<Check, { kind: "senior_year_math" }> => c.kind === "senior_year_math");
    if (!check || ctx.choices[check.unlessChoice] || leafPriority(e.rc, e.rc.rs.strength) === null) continue;
    const others = fill.items.filter((i) => i.key !== item.key && i.subject === "math" && i.grade === 12 && !i.noCredit).reduce((n, i) => n + i.units, 0);
    if (others < 4) return { rc: e.rc, check };
  }
  return null;
}

/**
 * What another class could count for in a suggestion's place: the need's own requirement, and for
 * a graduation option's route through a choice (one of a Texas endorsement's programs, §74.13(f)),
 * the other routes it lists (never the rest of its own route: Speech isn't another way to meet
 * "four social studies credits").
 */
function routeSelectors(need: Need): Selector[] {
  const leaf = need.leaf;
  const rc = need.rc;
  if (!leaf || !rc?.variant || leaf.choice?.kind !== "any" || rc.rs.kind !== "graduation_option") return need.selectors;
  const group = findReq(rc.variant.requirements, leaf.choice.id);
  if (!group || group.kind !== "any") return need.selectors;
  const others = group.of.filter((b) => !containsReq(b, leaf.id)).flatMap((b) => reqLeaves([b]).flatMap((r) => (r.kind === "credits" || r.kind === "count" ? r.select : [])));
  return [...need.selectors, ...others];
}

function findReq(reqs: readonly Req[], id: string): Req | null {
  for (const r of reqs) {
    if (r.id === id) return r;
    const kids = r.kind === "all" || r.kind === "any" || r.kind === "choose" ? r.of : r.kind === "option" ? [r.on, r.off] : [];
    const found = findReq(kids, id);
    if (found) return found;
  }
  return null;
}

function buildYear(ctx: Ctx, fill: FillResult, grade: SchoolGrade, genericTitles: boolean, routes: Routes = confirmedRoutes(fill)): PlanYear {
  const y = fill.years.get(grade)!;
  const cat = ctx.catalogs.get(grade)!;
  const slots: PlanSlot[] = [];
  for (const fact of ctx.input.courses.filter((c) => c.grade === grade)) {
    slots.push({
      kind: "yours",
      courseId: fact.id,
      typeId: fact.typeId,
      assumed: fact.assumed,
      level: fact.level,
      title: fact.name,
      units: fact.units,
      status: fact.status,
      warnings: yoursWarnings(ctx, fill, fact),
    });
  }
  const placements = fill.placements
    .filter((p) => p.item.grade === grade)
    .sort((a, b) => a.priority - b.priority || getCourseType(a.item.typeId).subject.localeCompare(getCourseType(b.item.typeId).subject) || a.n - b.n);
  for (const p of placements) {
    if (genericTitles && isCollegeLevel(p.item.level)) continue;
    const primary = p.primary;
    const alternatives: Extract<PlanSlot, { kind: "suggested" }>["alternatives"] = [];
    if (primary && !genericTitles) {
      const others = fill.items.filter((i) => i.key !== p.item.key);
      // The highest math rung reached before this year (passed or planned): never offer one at or
      // below it (Secondary Math I after Secondary Math III).
      const reached = startRank(others, grade);
      // Applied, algebraic-reasoning, college-readiness and quantitative reasoning math is never an
      // Other choice for a student who has reached precalculus (as for suggestions: fill.ts candidates).
      const pastPrecalculus = startRank(others, 13) >= 4;
      const altSelectors = routeSelectors(primary);
      const required = requiredChecks(ctx, fill, routes, p.item);
      const retake = ctx.items.some((i) => i.own && i.noCredit && i.typeId === p.item.typeId);
      const seen = new Set<string>([`${p.item.typeId}:${p.item.level}`]);
      for (const row of cat.rows) {
        if (alternatives.length >= 4) break;
        const k = `${row.typeId}:${row.level}`;
        if (seen.has(k) || !rowIsOffered(row, grade, y.schoolYear) || row.defaultTerm === "summer") continue;
        const probeItem: Item = { ...p.item, typeId: row.typeId, level: row.level, subject: row.subject, units: row.units, cte: row.cte, lectureOnly: row.lectureOnly };
        if (!matchesAny(probeItem, primary.selectors)) {
          // Another route's class stands in only at the same step (Health Science 1 for Education
          // and Training 1, never for its level 2).
          const rung = getCourseType(row.typeId).ladder?.rank ?? null;
          if (!matchesAny(probeItem, altSelectors) || rung !== (getCourseType(p.item.typeId).ladder?.rank ?? null)) continue;
        }
        // A retake of a class the student didn't pass is never its AP or college version.
        if (retake && isCollegeLevel(row.level)) continue;
        if (!isRepeatable(row.typeId) && fill.items.some((i) => sameContent(i.typeId, row.typeId) && !i.noCredit && i.key !== p.item.key)) continue;
        if (pastIntro(others, row.typeId, grade)) continue;
        if (pastPrecalculus && belowPrecalculus(row.typeId)) continue;
        const rank = mathRankOf(row.typeId);
        if (rank !== null && rank >= 1 && rank <= reached) continue;
        // Never a switch of math sequence mid-way (Integrated Math III after Algebra I and Geometry).
        if (rank !== null && rank >= 1 && rank <= 3 && reached >= 1 && row.typeId !== p.item.typeId && rungTypes(fill.ladder.family, rank)[0] !== row.typeId) continue;
        // Never a class the family opted out of in writing (Utah Secondary Math III).
        if (ctx.choices.utMath3OptOut && rank === 3) continue;
        if (!prereqsMetIn(others, row, grade, () => null, false, p.item.term === "spring")) continue;
        // Never a class that drops a required class (Creative Writing for a required U.S. History).
        if (!required.every((ok) => ok(probeItem))) continue;
        seen.add(k);
        alternatives.push({
          key: suggestionKey(primary.forWhat as Parameters<typeof suggestionKey>[0], row.typeId, row.level),
          typeId: row.typeId,
          level: row.level,
          title: row.title,
          catalogCourseId: cat.school ? row.id : null,
        });
      }
    }
    const reasons = slotReasons(ctx, fill, routes, p.item, p.extraReasons, primary, p.priority);
    if (p.needsPlanNow) reasons.push(reason("gap", "A required credit you still need this year. Talk to your counselor soon.", { ruleSetId: primary?.rc?.rs.id ?? null }));
    // This school year has started: a full-year class may no longer fit (a semester one goes in spring).
    if (y.inProgress && p.item.term === "full_year") reasons.push(reason("gap", "This school year has already started, so ask your counselor whether you can still add this full-year class.", { ruleSetId: primary?.rc?.rs.id ?? null }));
    slots.push({
      kind: "suggested",
      key: p.key,
      typeId: p.item.typeId,
      level: p.item.level,
      title: genericTitles ? courseTypeTitle(p.item.typeId, ctx.state) : p.row.title,
      genericTitle: getCourseType(p.item.typeId).title,
      catalogCourseId: cat.school && !genericTitles ? p.row.id : null,
      term: p.item.term,
      units: p.item.units,
      priority: p.priority,
      collegeLevel: isCollegeLevel(p.item.level),
      needsPlanNow: p.needsPlanNow,
      alternatives,
      approvals: [...p.row.approvals],
      reasons,
    });
  }
  const free = y.capHalves - y.used;
  if (grade >= 9 && grade <= 11 && !y.inProgress && free >= 2) slots.push({ kind: "your_choice" });
  const inYear = fill.items.filter((i) => i.grade === grade);
  const collegeLevel = inYear.filter((i) => isCollegeLevel(i.level) && (!genericTitles || i.own)).length;
  const warning = collegeLevel >= COLLEGE_LEVEL_SOFT_WARNING_AT;
  return {
    grade,
    schoolYear: y.schoolYear,
    catalog: cat.ref,
    slots,
    capacity: { classes: y.capHalves / 2, used: y.used / 2 },
    load: { collegeLevel, cap: ctx.limits.maxCollegeLevelPerYear, warning, reasons: warning ? [loadReason()] : [] },
  };
}

function planYears(ctx: Ctx, fill: FillResult): PlanYear[] {
  const routes = confirmedRoutes(fill);
  return ctx.planGrades.filter((g) => g >= 9).map((g) => buildYear(ctx, fill, g, false, routes));
}

// Middle school -------------------------------------------------------------------------------------

/** The placement card, with the state's name for the first high school math class (Utah: Secondary Mathematics I). */
function mathCard(first: string): string {
  return `Taking ${first} in 8th leaves room for calculus by 12th, which some engineering and science programs like to see. Taking it in 9th is common and still keeps most paths open. Many programs accept a test score or placement exam to show you're ready.`;
}

function middleSchool(ctx: Ctx, fill: FillResult): MiddleSchoolView {
  const hasAlg1 = ctx.items.some((i) => !i.noCredit && ["math.alg1", "math.int1", "math.ut_sec1"].includes(i.typeId));
  const first = rungName(fill.ladder.family, 1, ctx.state);
  const text = hasAlg1
    ? `You have ${first} (or its equal) in middle school, which leaves room for calculus by 12th if you want it. Strong grades matter more than speed, and many programs accept a test score or placement exam to show you're ready.`
    : mathCard(first);
  const famCite = ctx.families[0]?.content?.math.cite ?? [];
  const exploration: MiddleSchoolView["exploration"] = [];
  const wanted = new Set<string>();
  for (const f of ctx.families) {
    for (const t of f.content?.keyCourses ?? []) wanted.add(t);
    // The goal's career cluster in this state, or where the state has no pathway listed for the goal
    // (Tennessee), the cluster other states list for it: an exploration class, not a requirement.
    const pathways = f.content?.ctePathways ?? [];
    const here = pathways.filter((p) => p.state === ctx.state);
    for (const p of here.length ? here : pathways) wanted.add(`cte.${p.cluster}.1`);
  }
  const grades = ctx.planGrades.filter((g) => g <= 9);
  const rows = grades.flatMap((g) => ctx.catalogs.get(g)?.rows.filter((r) => rowIsOffered(r, g, schoolYearOfGrade(ctx, g))) ?? []);
  const explore = (t: string) => wanted.has(t) || t === "cte.ms" || t === "cs.ms" || t === "cs.intro" || /^cte\.[a-z_]+\.1$/.test(t) || t === "cte.health_principles";
  // The goals' own classes and pathways first.
  for (const row of [...rows].sort((a, b) => Number(!wanted.has(a.typeId)) - Number(!wanted.has(b.typeId)) || a.order - b.order)) {
    if (exploration.length >= 5) break;
    if (!explore(row.typeId) || exploration.some((e) => e.typeId === row.typeId)) continue;
    exploration.push({ typeId: row.typeId, title: row.title });
  }
  const sketch = ctx.planGrades.includes(9) ? buildYear(ctx, fill, 9, true) : null;
  return {
    mathPlacement: { text, reasons: [reason("ladder", text, { claim: "suggestion", citations: famCite })] },
    stateNotes: ctx.facts.middleSchoolMath.map((n) => ({ text: n.text, citations: n.cite })),
    exploration,
    ninthGradeSketch: sketch,
  };
}

// Provenance ----------------------------------------------------------------------------------------

function reviewNotices(ctx: Ctx): ReviewNotice[] {
  const files: ContentHeader[] = [];
  const add = (f: ContentHeader | null | undefined) => {
    if (f && !files.includes(f) && f.id !== "local-guide") files.push(f);
  };
  for (const rc of ctx.ruleSets) add(rc.file);
  add(ctx.content.genericCatalog);
  add(ctx.content.facts);
  if (ctx.families.length) add(ctx.content.families);
  return files.map((f) => {
    const stale = isStale(ctx.input.asOf.today, f.verifiedForSchoolYear);
    return { fileId: f.id, status: f.review.status, label: reviewLabel(f.review), stale, staleLabel: stale ? staleLabel(f.verifiedForSchoolYear) : null };
  });
}

function builtFrom(ctx: Ctx): BuiltFrom {
  return {
    ruleSets: ctx.ruleSets.map((rc) => ({
      id: rc.rs.id,
      title: rc.rs.title,
      fileId: rc.file.id,
      fingerprint: ctx.fingerprints.get(rc.file.id) ?? "",
      review: rc.file.review.status,
      reviewedOn: rc.file.review.reviewedOn ?? null,
      verifiedForSchoolYear: rc.file.verifiedForSchoolYear,
      stale: rc.stale,
      projected: rc.projected,
    })),
    catalogs: ctx.planGrades.filter((g) => g >= 9).map((grade) => ({ grade, catalog: ctx.catalogs.get(grade)!.ref })),
    families: ctx.input.targets.families,
    colleges: [
      ...ctx.input.targets.colleges.map((c) => ({ unitId: c.unitId, name: c.name, stateDefault: false })),
      ...ctx.ruleSets.filter((r) => r.viaStateDefault).map((r) => ({ unitId: null, name: r.rs.issuer.name, stateDefault: true })),
    ],
    rigor: ctx.tier,
  };
}

function modeOf(ctx: Ctx): PlannedPath["mode"] {
  const grades = ctx.planGrades.filter((g) => g >= 9);
  const cats = grades.map((g) => ctx.catalogs.get(g)!);
  if (cats.length === 0 || cats.every((c) => !c.school)) return "generic";
  if (cats.every((c) => c.school && c.view.confirmedSubjects === "all")) return "catalog";
  return "mixed";
}

function demands(fill: FillResult): Demand[] {
  return fill.baselineNeeds.map((n) => ({
    id: n.id,
    priority: n.priority,
    select: n.selectors,
    units: needUnits(n),
    window: { fromGrade: Math.max(7, Math.min(12, n.fromGrade)) as SchoolGrade, byGrade: Math.max(7, Math.min(12, n.byGrade)) as SchoolGrade },
    serves: [n.familyId && n.source === "prep" ? { familyId: n.familyId } : { ruleSetId: n.rc?.rs.id ?? "plan", reqId: n.leaf?.id ?? n.id.split("/").pop()! }],
    reasons: n.reasons,
  }));
}

function audits(ctx: Ctx, fill: FillResult): RuleSetAudit[] {
  const conflicts = admissionConflicts(fill.evals, fill.items);
  const waivers = waiverNotes(fill.evals);
  const npn = new Set(fill.placements.filter((p) => p.needsPlanNow).map((p) => p.key));
  const expanded = expandedResults(fill.evals, fill.items);
  const room = creditRoom(ctx, fill);
  const first = new Map(
    fill.evals.map((e) => {
      const a = ruleSetAudit(ctx, e, fill.items, conflicts, npn, () => null, expanded);
      const courses = a.requirements.filter((r) => {
        const leaf = e.best?.leaves.find((l) => l.leaf.id === r.reqId)?.leaf;
        return leaf && leaf.req.kind !== "total_credits" && leaf.req.kind !== "remaining_electives";
      });
      // Credit totals and electives are met by any class ("Your choice" slots), so they count
      // against a rule set here only when the years after this one can't hold them: an
      // endorsement's 26 credits (§74.13(c)) out of a senior's reach leaves the DLA without an
      // endorsement. A shortfall this spring's open periods would have to hold counts until classes
      // on the plan cover it: nothing is planned there yet.
      const totals = (e.best?.leaves ?? []).filter((l) => l.leaf.own && l.leaf.req.kind === "total_credits").map((l) => l.missing);
      const added = addedCreditTotal(e, fill.items);
      const short = [...totals, added?.missing ?? 0].some((m) => m > room);
      return [e.rc.rs.id, worst([...courses.map((r) => r.status), ...(short ? (["room_to_add"] as const) : [])])] as const;
    }),
  );
  return fill.evals.map((e) => {
    const audit = ruleSetAudit(ctx, e, fill.items, conflicts, npn, (id) => first.get(id) ?? null, expanded);
    for (const r of audit.requirements) r.reasons.push(...(waivers.get(`${audit.ruleSetId}/${r.reqId}`) ?? []));
    return audit;
  });
}

// Entry point ----------------------------------------------------------------------------------------

/**
 * The context a plan is audited with: a plan includes the endorsement it plans with. One the
 * student didn't name (a goal's endorsement in a two-goal plan) is labeled as used for now; the
 * endorsement choice's own plans say why in the choice.
 */
function contextFor(ctx: Ctx, fill: FillResult, choice: PlanChoice | null): Ctx {
  const rs = fill.config.ruleSets.find((r) => r.rs.appliesWhen.choice?.key === "txEndorsements")?.rs;
  const value = rs?.appliesWhen.choice?.value as EndorsementValue | undefined;
  if (!rs || !value || ctx.ruleSets.some((r) => r.rs.id === rs.id)) return ctx;
  if (choice?.kind === "endorsement") {
    return buildContext({ ...ctx.input, state: ctx.state, content: ctx.content, prefs: { ...ctx.input.prefs, choices: { ...ctx.input.prefs.choices, txEndorsements: [value] } } });
  }
  return withEndorsement(ctx, value);
}

/** What each plan shows for itself: its years, audit, gaps, "by when" and counselor questions. */
function planOption(id: "A" | "B", label: string, pctx: Ctx, fill: FillResult, decisions: PendingDecision[], middle: boolean): PlanOption {
  const audit = audits(pctx, fill);
  const gaps = middle || pctx.planGrades.length === 0 ? [] : buildGaps(pctx, fill);
  return {
    id,
    label,
    years: middle || pctx.planGrades.length === 0 ? [] : planYears(pctx, fill),
    audit,
    gaps,
    deadlines: buildDeadlines(pctx, fill, decisions),
    askCounselor: counselorQuestions(pctx, fill, audit, gaps),
  };
}

export function plan(input: PlannerInput): PathResult {
  if (input.state === null || input.content === null) return noState(input);
  const own = buildContext(input as PlannerInput & { state: PlannerState; content: NonNullable<PlannerInput["content"]> });
  // Endorsement plans (Plan A and B) when the choice applies; otherwise a default endorsement.
  const ctx = endorsementSplitApplies(own) ? own : withDefaultEndorsement(own);
  // Plans that don't come from the endorsement choice still plan with an endorsement.
  let planCtx: Ctx | null = null;
  const withGoal = () => (planCtx ??= goalEndorsement(ctx));
  const base: PlanConfig = { id: "A", ruleSets: ctx.ruleSets, families: ctx.families, accelerate: false, cteFirst: false };
  const baseFor = (c: Ctx): PlanConfig => ({ ...base, ruleSets: c.ruleSets, families: c.families });
  // The single plan is built only when it's needed (an endorsement choice builds its own plans).
  let single: FillResult | null = null;
  const getA = () => (single ??= runFill(withGoal(), baseFor(withGoal())));
  let fillA: FillResult | null = null;
  let fillB: FillResult | null = null;
  let planChoice: PlanChoice | null = null;
  let labels: [string, string] = ["Your path", ""];
  const middle = ctx.firstGrade <= 8;
  if (!middle && ctx.planGrades.length > 0) {
    const decision =
      mathRoute(withGoal(), getA, baseFor(withGoal())) ?? targetSplit(ctx, getA, base) ?? endorsementSplit(ctx, base) ?? languageVsCte(withGoal(), getA, baseFor(withGoal()));
    if (decision) {
      fillA = decision.a;
      fillB = decision.b;
      planChoice = decision.choice;
      labels = decision.labels;
    }
  }
  fillA ??= getA();
  // Each plan is audited on its own: Plan B's gaps, "what counts" and questions are Plan B's.
  const auditCtx = contextFor(ctx, fillA, planChoice);
  // Pending decisions come from the student's own choices (a default endorsement is still to name).
  const decisions = buildDecisions(own, fillA);
  const optionA = planOption("A", labels[0], auditCtx, fillA, decisions, middle);
  const optionB = fillB ? planOption("B", labels[1], contextFor(ctx, fillB, planChoice), fillB, decisions, middle) : null;
  const plans: PlannedPath["plans"] = middle || ctx.planGrades.length === 0 ? [] : optionB ? [optionA, optionB] : [optionA];
  const path: Omit<PlannedPath, "citations"> = {
    mode: modeOf(ctx),
    state: ctx.state,
    stage: middle ? "middle_school" : "high_school",
    inputsFingerprint: fingerprintOf(own),
    notices: { draft: DRAFT_BANNER, standing: STANDING_PLAN_NOTE, review: reviewNotices(auditCtx) },
    builtFrom: builtFrom(auditCtx),
    // Plan A's, for summaries (the parent dashboard) and the middle-school view.
    deadlines: optionA.deadlines,
    decisions,
    plans,
    planChoice,
    gaps: optionA.gaps,
    audit: optionA.audit,
    demands: demands(fillA),
    askCounselor: optionA.askCounselor,
    middleSchool: middle ? middleSchool(ctx, fillA) : null,
  };
  return { ...path, citations: resolveCitations(auditCtx, path) };
}

export type { FamilyCtx };
