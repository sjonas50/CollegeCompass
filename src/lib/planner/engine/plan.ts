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
import type { ContentHeader, Req } from "../rules";
import { admissionConflicts, ruleSetAudit, waiverNotes, worst } from "./audit";
import { buildContext, type Ctx, type FamilyCtx, leafPriority, rowIsOffered, schoolYearOfGrade } from "./context";
import { algebra2Reason, leafNoteReason, loadReason, prepReason, reason, requirementReason, resolveCitations, retakeReason } from "./explain";
import { type FillResult, isRepeatable, type PlanConfig, prereqsMetIn, runFill } from "./fill";
import { buildGaps } from "./gaps";
import { mathRankOf, rungName, unresolvedFailedRank } from "./ladder";
import { type Item } from "./model";
import { type Need, needUnits } from "./needs";
import { counselorQuestions } from "./questions";
import { matchesAny } from "./select";
import { buildDecisions, buildDeadlines } from "./timeline";
import { atLeast, earnsNoCredit, hash16, nth, stableJson } from "./util";

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
  const extra = summer ? "adds a summer class" : "adds a second math class in one year";
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

function targetSplit(ctx: Ctx, getA: () => FillResult, base: PlanConfig): Decision | null {
  const fams = ctx.families.filter((f, i) => ctx.families.findIndex((g) => g.target.familyId === f.target.familyId) === i);
  if (fams.length < 2 || !fams[0].content || !fams[1].content) return null;
  const fillA = getA();
  const misfit = fillA.needs.some((n) => n.source === "prep" && !n.soft && n.missing > 0 && ["doesnt_fit", "load"].includes(fillA.unmet.get(n.id) ?? ""));
  if (!misfit) return null;
  const a = runFill(ctx, { ...base, families: [fams[0]] });
  const b = runFill(ctx, { ...base, id: "B", families: [fams[1]] });
  if (!realChoice(a, b)) return null;
  const name = (f: FamilyCtx) => f.title.charAt(0).toLowerCase() + f.title.slice(1);
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
  for (const i of ctx.items) {
    const cluster = getCourseType(i.typeId).cteCluster;
    if (i.own && !i.noCredit && cluster && i.cte) clusters.push(cluster);
  }
  for (const cluster of clusters) {
    for (const { rs } of ctx.allRuleSets.values()) {
      if (rs.appliesWhen.choice?.key !== "txEndorsements" || rs.appliesWhen.choice.value === "stem") continue;
      const leaves = rs.variants.flatMap((v) => reqLeaves(v.requirements));
      if (leaves.some((l) => l.kind === "credits" && l.select.some((sel) => sel.cte && sel.types?.includes(`cte.${cluster}.1` as CourseTypeId)))) push(rs.appliesWhen.choice.value as EndorsementValue);
    }
  }
  return out;
}

function endorsementSplit(ctx: Ctx, base: PlanConfig): Decision | null {
  if (ctx.state !== "TX" || ctx.choices.txEndorsements?.length || ctx.choices.txFoundationOnly || ctx.grade > 10 || ctx.firstGrade <= 8) return null;
  if (ctx.input.targets.path === "training") return null;
  const preferred = preferredEndorsements(ctx);
  const options = [...ctx.allRuleSets.values()].filter(({ rs }) => {
    const value = rs.appliesWhen.choice?.key === "txEndorsements" ? rs.appliesWhen.choice.value : null;
    // STEM needs a STEM goal: never a default for a student who hasn't named one.
    return value !== null && (value !== "stem" || preferred.includes("stem"));
  });
  if (options.length < 2) return null;
  const trials = options.map(({ rs }, order) => {
    const value = rs.appliesWhen.choice!.value as EndorsementValue;
    const sub = buildContext({ ...ctx.input, state: ctx.state, content: ctx.content, prefs: { ...ctx.input.prefs, choices: { ...ctx.input.prefs.choices, txEndorsements: [value] } } });
    const fill = runFill(sub, { ...base, ruleSets: sub.ruleSets, families: sub.families });
    const unmet = fill.needs.filter((n) => n.priority <= 1 && !n.soft).reduce((s, n) => s + needUnits(n), 0);
    const added = fill.placements.reduce((s, p) => s + p.item.units, 0);
    const college = fill.placements.filter((p) => isCollegeLevel(p.item.level)).length;
    // A goal's endorsement first; with no goal, Multidisciplinary Studies (the four core subjects the
    // DLA already asks for) before endorsements that add a program.
    const fit = preferred.includes(value) ? preferred.indexOf(value) : preferred.length === 0 && value === "multidisciplinary" ? 0 : 99;
    return { rs, fill, unmet, added, college, fit, order };
  });
  trials.sort((x, y) => x.unmet - y.unmet || x.fit - y.fit || x.added - y.added || x.college - y.college || x.order - y.order);
  const [first] = trials;
  const second = trials.slice(1).find((t) => realChoice(first.fill, t.fill));
  if (!second) return null;
  const fits = preferred.length > 0;
  return {
    a: first.fill,
    b: { ...second.fill, config: { ...second.fill.config, id: "B" } },
    labels: [`Plan A: with the ${first.rs.title}.`, `Plan B: with the ${second.rs.title}.`],
    choice: {
      kind: "endorsement",
      text: fits
        ? "You haven't named a Texas endorsement yet. Here are two that fit your goals; you can pick any endorsement and change it later."
        : "You haven't named a Texas endorsement yet. Here are two you could plan for; you can pick any endorsement and change it later.",
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

/**
 * Why a suggestion is on the plan: the requirements the final audit counts it toward, the
 * major-prep targets it meets, checks it was placed for, and its own notes. "Required by" wording
 * comes only from the final audit, never from the route the fill first planned toward.
 */
function slotReasons(ctx: Ctx, fill: FillResult, item: Item, extra: Reason[], primary: Need | null): Reason[] {
  const out: Reason[] = [];
  const seen = new Set<string>();
  const push = (r: Reason) => {
    const k = `${r.kind}|${r.ruleSetId}|${r.reqId}|${r.familyId}|${r.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  for (const e of fill.evals) {
    if (!e.best) continue;
    for (const l of e.best.leaves) {
      if (!l.counted.some((c) => c.item.key === item.key)) continue;
      if (l.leaf.req.kind === "total_credits" || l.leaf.req.kind === "remaining_electives") continue;
      const owner = l.leaf.own ? e.rc : (ctx.ruleSets.find((r) => e.rc.bases.some((b) => b.rs.id === r.rs.id)) ?? e.rc);
      // Only what can ask for a class explains a suggestion (not information-only or projected aid).
      if (leafPriority(owner, l.leaf.strength) === null) continue;
      push(requirementReason(owner, l.leaf));
      const note = leafNoteReason(owner, l.leaf);
      if (note) push(note);
    }
  }
  for (const n of [...fill.baselineNeeds, ...fill.needs]) {
    if (n.source !== "prep" || !matchesAny(item, n.selectors)) continue;
    for (const r of n.reasons) push(r);
  }
  // A check (Tennessee: math in every year) isn't an audit line of its own; its reason stands.
  if (primary?.source === "check") for (const r of primary.reasons) push(r);
  for (const r of extra) push(r);
  // Nothing requires it any more: an idea for an open slot, never "Required".
  if (out.length === 0) push(reason("choice", "An idea for an open slot. It's your choice.", { claim: "suggestion" }));
  if (ctx.items.some((i) => i.own && i.noCredit && i.typeId === item.typeId)) push(retakeReason());
  if (ctx.state === "TX" && item.typeId === "math.alg2") push(algebra2Reason());
  return out;
}

function buildYear(ctx: Ctx, fill: FillResult, grade: SchoolGrade, genericTitles: boolean): PlanYear {
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
      const seen = new Set<string>([`${p.item.typeId}:${p.item.level}`]);
      for (const row of cat.rows) {
        if (alternatives.length >= 4) break;
        const k = `${row.typeId}:${row.level}`;
        if (seen.has(k) || !rowIsOffered(row, grade, y.schoolYear) || row.defaultTerm === "summer") continue;
        const probeItem: Item = { ...p.item, typeId: row.typeId, level: row.level, subject: row.subject, units: row.units, cte: row.cte, lectureOnly: row.lectureOnly };
        if (!matchesAny(probeItem, primary.selectors)) continue;
        if (!isRepeatable(row.typeId) && fill.items.some((i) => i.typeId === row.typeId && !i.noCredit && i.key !== p.item.key)) continue;
        if (!prereqsMetIn(others, row, grade, () => null)) continue;
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
    const reasons = slotReasons(ctx, fill, p.item, p.extraReasons, primary);
    if (p.needsPlanNow) reasons.push(reason("gap", "A required credit you still need this year. Talk to your counselor soon.", { ruleSetId: primary?.rc?.rs.id ?? null }));
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
  return ctx.planGrades.filter((g) => g >= 9).map((g) => buildYear(ctx, fill, g, false));
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
    for (const p of f.content?.ctePathways ?? []) if (p.state === ctx.state) wanted.add(`cte.${p.cluster}.1`);
  }
  const grades = ctx.planGrades.filter((g) => g <= 9);
  const rows = grades.flatMap((g) => ctx.catalogs.get(g)?.rows.filter((r) => rowIsOffered(r, g, schoolYearOfGrade(ctx, g))) ?? []);
  const explore = (t: string) => wanted.has(t) || t === "cte.ms" || t === "cs.ms" || t === "cs.intro" || /^cte\.[a-z_]+\.1$/.test(t) || t === "cte.health_principles";
  for (const row of [...rows].sort((a, b) => Number(!wanted.has(b.typeId)) - Number(!wanted.has(a.typeId)) || a.order - b.order)) {
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
  const conflicts = admissionConflicts(fill.evals);
  const waivers = waiverNotes(fill.evals);
  const npn = new Set(fill.placements.filter((p) => p.needsPlanNow).map((p) => p.key));
  const first = new Map(
    fill.evals.map((e) => {
      const a = ruleSetAudit(ctx, e, fill.items, conflicts, npn, () => null);
      const courses = a.requirements.filter((r) => {
        const leaf = e.best?.leaves.find((l) => l.leaf.id === r.reqId)?.leaf;
        return leaf && leaf.req.kind !== "total_credits" && leaf.req.kind !== "remaining_electives";
      });
      return [e.rc.rs.id, worst(courses.map((r) => r.status))] as const;
    }),
  );
  return fill.evals.map((e) => {
    const audit = ruleSetAudit(ctx, e, fill.items, conflicts, npn, (id) => first.get(id) ?? null);
    for (const r of audit.requirements) r.reasons.push(...(waivers.get(`${audit.ruleSetId}/${r.reqId}`) ?? []));
    return audit;
  });
}

// Entry point ----------------------------------------------------------------------------------------

/** The context a plan is audited with: an endorsement plan includes the endorsement it plans with. */
function contextFor(ctx: Ctx, fill: FillResult, choice: PlanChoice | null): Ctx {
  if (choice?.kind !== "endorsement") return ctx;
  const value = fill.config.ruleSets.find((r) => r.rs.appliesWhen.choice?.key === "txEndorsements")?.rs.appliesWhen.choice?.value as EndorsementValue | undefined;
  if (!value) return ctx;
  return buildContext({ ...ctx.input, state: ctx.state, content: ctx.content, prefs: { ...ctx.input.prefs, choices: { ...ctx.input.prefs.choices, txEndorsements: [value] } } });
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
  const ctx = buildContext(input as PlannerInput & { state: PlannerState; content: NonNullable<PlannerInput["content"]> });
  const base: PlanConfig = { id: "A", ruleSets: ctx.ruleSets, families: ctx.families, accelerate: false, cteFirst: false };
  // The single plan is built only when it's needed (an endorsement choice builds its own plans).
  let single: FillResult | null = null;
  const getA = () => (single ??= runFill(ctx, base));
  let fillA: FillResult | null = null;
  let fillB: FillResult | null = null;
  let planChoice: PlanChoice | null = null;
  let labels: [string, string] = ["Your path", ""];
  const middle = ctx.firstGrade <= 8;
  if (!middle && ctx.planGrades.length > 0) {
    const decision = mathRoute(ctx, getA, base) ?? targetSplit(ctx, getA, base) ?? endorsementSplit(ctx, base) ?? languageVsCte(ctx, getA, base);
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
  const decisions = buildDecisions(ctx, fillA);
  const optionA = planOption("A", labels[0], auditCtx, fillA, decisions, middle);
  const optionB = fillB ? planOption("B", labels[1], contextFor(ctx, fillB, planChoice), fillB, decisions, middle) : null;
  const plans: PlannedPath["plans"] = middle || ctx.planGrades.length === 0 ? [] : optionB ? [optionA, optionB] : [optionA];
  const path: Omit<PlannedPath, "citations"> = {
    mode: modeOf(ctx),
    state: ctx.state,
    stage: middle ? "middle_school" : "high_school",
    inputsFingerprint: fingerprintOf(ctx),
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
