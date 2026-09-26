import { allCourseTypes, getCourseType } from "../course-types";
import type {
  AdmissionConflict,
  AuditModifier,
  AuditStatus,
  CheckResult,
  Reason,
  RequirementAudit,
  RuleSetAudit,
} from "../engine-io";
import { cohortValue } from "../cohort";
import type { Check, OptionPref, Req, Selector } from "../rules";
import { type AltResult, evaluateAlternative, languageProgress, leafAccepts, type LeafResult, pickAlternative, type PickOptions } from "./allocate";
import type { CLeaf } from "./compile";
import type { Ctx, RuleSetCtx } from "./context";
import { leafPriority, rowIsOffered, schoolYearOfGrade, variantFor } from "./context";
import { leafNoteReason, reason, requirementReason, ruleSetNotes } from "./explain";
import { asConfirmed, type Item } from "./model";
import { matchesAny } from "./select";
import { nth } from "./util";

// ---------------------------------------------------------------------------
// The audit (design §5.5): for every rule set that applies, the requirements with who asks,
// how strongly, what counts, and a status in words. Rule sets are audited independently, so one
// Chemistry class counts for graduation, a college and major prep at once.
// ---------------------------------------------------------------------------

export type RuleSetEval = { rc: RuleSetCtx; best: AltResult | null };

/**
 * Every alternative, then the best (design §5.5). With `rankItems` (the student's guessed types
 * taken as confirmed), the route is chosen on those and reported on `items`, so the audit shows
 * the route the student's own classes most likely meet, with its guesses flagged.
 */
export function evaluateRuleSet(rc: RuleSetCtx, items: Item[], opts: PickOptions = {}, rankItems?: Item[]): RuleSetEval {
  if (!rc.variant || rc.alternatives.length === 0) return { rc, best: null };
  const alts = opts.allowed ? rc.alternatives.filter(opts.allowed) : rc.alternatives;
  const results = (alts.length ? alts : rc.alternatives).map((alt) => evaluateAlternative(alt, rankItems ?? items, rc.allocation));
  const best = pickAlternative(results, opts);
  return { rc, best: rankItems ? evaluateAlternative(best.alt, items, rc.allocation) : best };
}

const SEVERITY: Record<AuditStatus, number> = { not_tracked: 0, done: 1, planned: 2, ask_counselor: 3, room_to_add: 4 };

export function worst(statuses: AuditStatus[]): AuditStatus {
  return statuses.reduce<AuditStatus>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), statuses.length ? "done" : "not_tracked");
}

/** Whether any remaining grade's class list offers something that would count (on a school's list). */
export function offeredSomewhere(ctx: Ctx, leaf: CLeaf): { anyOffered: boolean; allSchool: boolean } {
  const sels = leaf.req.kind === "credits" || leaf.req.kind === "count" ? leaf.req.select : null;
  let anyOffered = false;
  let allSchool = ctx.planGrades.length > 0;
  for (const grade of ctx.planGrades) {
    const cat = ctx.catalogs.get(grade)!;
    if (!cat.school) allSchool = false;
    if (anyOffered) continue;
    const sy = schoolYearOfGrade(ctx, grade);
    for (const row of cat.rows) {
      if (!rowIsOffered(row, grade, sy)) continue;
      if (leaf.req.kind === "same_language") {
        if (row.subject === "world_language") anyOffered = true;
      } else if (sels) {
        const probe: Item = {
          key: "probe",
          ref: { kind: "suggestion", key: "probe" },
          own: false,
          typeId: row.typeId,
          assumed: false,
          level: row.level,
          subject: row.subject,
          grade,
          schoolYear: sy,
          term: row.defaultTerm,
          units: row.units,
          firm: false,
          completed: false,
          creditable: true,
          noCredit: false,
          hsCredit: true,
          letter: null,
          cte: row.cte,
          lectureOnly: row.lectureOnly,
        };
        if (matchesAny(probe, sels)) anyOffered = true;
      } else anyOffered = true;
      if (anyOffered) break;
    }
  }
  return { anyOffered, allSchool };
}

function localTotalKnown(ctx: Ctx): boolean {
  return ctx.ruleSets.some((r) => r.rs.kind === "local_graduation");
}

export type LeafStatus = { status: AuditStatus; modifiers: AuditModifier[] };

/** The student has a different class on the rung a math requirement names. */
function equivalentMath(ctx: Ctx, sels: readonly Selector[]): boolean {
  const ranks = new Set<number>();
  for (const s of sels) for (const t of s.types ?? []) {
    const l = getCourseType(t).ladder;
    if (l?.id === "math" && l.rank >= 1 && l.rank <= 3) ranks.add(l.rank);
  }
  if (ranks.size === 0) return false;
  return ctx.items.some((i) => {
    const l = getCourseType(i.typeId).ladder;
    return !i.noCredit && l?.id === "math" && ranks.has(l.rank) && !sels.some((s) => s.types?.includes(i.typeId));
  });
}

/**
 * A high school class the student took before 9th grade that isn't marked for high school credit
 * and would count here if it were (Algebra I in 8th): whether it earned credit is the school's
 * call (Texas 19 TAC §74.26(b), Tennessee Policy 3.103 I(3)). Middle school classes (8th-grade
 * English) never are.
 */
export function earlyWithoutCredit(items: readonly Item[], sels: readonly Selector[]): Item | null {
  return items.find((i) => i.own && i.grade < 9 && !i.hsCredit && !i.noCredit && i.units > 0 && getCourseType(i.typeId).grades[1] >= 9 && matchesAny(i, sels)) ?? null;
}

export function leafStatus(ctx: Ctx, rc: RuleSetCtx, r: LeafResult, needsPlanNow: boolean): LeafStatus {
  const modifiers: AuditModifier[] = [];
  let status: AuditStatus;
  const req = r.leaf.req;
  if (req.kind === "total_credits" && req.source === "state" && !localTotalKnown(ctx)) {
    // The state minimum; the district may require more (design §3.1). Never Done.
    status = r.missing > 0 ? "room_to_add" : "ask_counselor";
  } else if (r.missing === 0) {
    status = r.planned > 0 ? "planned" : "done";
  } else {
    status = "room_to_add";
    if (req.kind === "credits" || req.kind === "count" || req.kind === "same_language") {
      const { anyOffered, allSchool } = offeredSomewhere(ctx, r.leaf);
      if (!anyOffered && allSchool) status = "ask_counselor";
    }
    // A class on the same math rung (Integrated Math I for "Algebra I") may count: the counselor decides.
    if (req.kind === "credits" && equivalentMath(ctx, req.select)) status = "ask_counselor";
    // So may a class from before 9th grade that isn't marked for high school credit.
    if (req.kind === "credits" && earlyWithoutCredit(ctx.items, req.select)) status = "ask_counselor";
  }
  if (rc.projected) {
    modifiers.push("projected");
    if (status === "done" || status === "planned") status = "ask_counselor";
  }
  if (rc.stale) {
    modifiers.push("stale");
    if (status === "done") status = "ask_counselor";
  }
  if (rc.rs.confidence === "conflicting") {
    modifiers.push("sources_disagree");
    if (status === "done" || status === "planned") status = "ask_counselor";
  }
  if (rc.rs.confidence === "unverified") {
    modifiers.push("unverified");
    if (status === "done" || status === "planned") status = "ask_counselor";
  }
  if (r.guessed) modifiers.push("guessed_type");
  if (needsPlanNow) modifiers.push("needs_plan_now");
  return { status, modifiers };
}

// Checks ---------------------------------------------------------------------------------------

function enrolledYears(items: Item[], subject: Item["subject"]): { firm: number; all: number } {
  const hs = items.filter((i) => i.subject === subject && i.grade >= 9 && !(i.completed && i.letter === "W"));
  return { firm: new Set(hs.filter((i) => i.firm).map((i) => i.grade)).size, all: new Set(hs.map((i) => i.grade)).size };
}

export function evaluateCheck(
  ctx: Ctx,
  rc: RuleSetCtx,
  check: Check,
  leaves: LeafResult[],
  items: Item[],
  statusOf: (ruleSetId: string) => AuditStatus | null,
): CheckResult | null {
  const base = { checkId: check.id, kind: check.kind, citations: check.cite };
  switch (check.kind) {
    case "enrolled_years": {
      const { all } = enrolledYears(items, check.subject);
      const ok = all >= check.years;
      return {
        ...base,
        status: ok ? "ok" : "room_to_add",
        text: ok
          ? `${subjectWord(check.subject)} in at least ${check.years} years of high school: on your plan.`
          : `Room to add ${subjectWord(check.subject).toLowerCase()} in more years of high school (${check.years} years needed).`,
      };
    }
    case "on_schedule_by": {
      // "On schedule" (TEC §51.803(d)): by the end of the grade, the plan shows the classes, in any
      // grade through 12th. A class planned for 12th is on schedule.
      const rs = [check.req, ...(check.with ?? [])].map((id) => leaves.find((l) => l.leaf.id === id));
      if (rs.some((r) => !r)) return { ...base, status: "ask_counselor", text: "Ask your counselor whether this is on schedule." };
      const results = rs as LeafResult[];
      const label = listLabels(results.map((r) => r.leaf.label));
      const verb = results.length > 1 ? "are" : "is";
      const past = ctx.grade > check.grade || (ctx.grade === check.grade && ctx.inProgressGrade === null);
      if (results.every((r) => r.missing === 0)) {
        if (!past) return { ...base, status: "ok", text: `${label} ${verb} on your plan, so you're on schedule by the end of ${nth(check.grade)} grade.` };
        // After that grade the question is what the transcript showed then (§51.803(d)), which a
        // plan can't know unless every class was finished by then. Classes added this year don't count.
        const finished = results.every((r) => r.counted.every((c) => c.item.completed && c.item.grade <= check.grade));
        if (finished) return { ...base, status: "ok", text: `${label} ${verb} on your transcript by the end of ${nth(check.grade)} grade, so you were on schedule.` };
        return {
          ...base,
          status: "ask_counselor",
          text: `${label}: ask your counselor whether your transcript showed you on schedule at the end of ${nth(check.grade)} grade.`,
        };
      }
      // Only what's still missing: a planned Algebra II isn't listed as something to add.
      const missing = results.filter((r) => r.missing > 0);
      const missingLabel = listLabels(missing.map((r) => r.leaf.label));
      if (past) return { ...base, status: "ask_counselor", text: `${missingLabel} ${missing.length > 1 ? "weren't" : "wasn't"} on your plan by the end of ${nth(check.grade)} grade. Ask your counselor what this means for you.` };
      return { ...base, status: "room_to_add", text: `Room to add ${lowerArticle(missingLabel)} to your plan by the end of ${nth(check.grade)} grade (${missing.length > 1 ? "they" : "it"} can come as late as 12th).` };
    }
    case "counts_unless": {
      // Only while the requirement is what this rule set counts on.
      const r = leaves.find((l) => l.leaf.id === check.req);
      if (!r || r.counted.length === 0) return null;
      const other = ctx.allRuleSets.get(check.unless.ruleSet);
      const variant = other ? variantFor(other.rs, cohortValue(ctx.cohort, other.rs.cohortKey)).variant : null;
      const reqs = new Map<string, Req>();
      for (const q of walkLeaves(variant?.requirements ?? [])) reqs.set(q.id, q);
      // The student's guessed class types taken as confirmed, as the plan is built (a typed
      // "Chemistry" with no kind picked is still Chemistry for STEM's science).
      const confirmed = asConfirmed(items);
      const met = check.unless.groups.some((group) => group.every((id) => {
        const q = reqs.get(id);
        return q ? reqMetBy(q, confirmed) : false;
      }));
      if (met) return { ...base, status: "ask_counselor", text: `${check.text} Your plan meets those too, so this program may count for ${other?.rs.title ?? "that"} instead. Ask your counselor.` };
      return { ...base, status: "ok", text: check.text };
    }
    case "senior_year_math": {
      if (ctx.choices[check.unlessChoice]) return { ...base, status: "ok", text: "You recorded meeting the college-ready math competency, so a senior-year math class isn't required." };
      if (ctx.input.targets.path === "training") return { ...base, status: "ok", text: "A full year of math in 12th grade applies if you're college-bound." };
      const senior = items.filter((i) => i.subject === "math" && i.grade === 12 && !i.noCredit).reduce((n, i) => n + i.units, 0);
      if (senior >= 4) return { ...base, status: "ok", text: "A full year of math in 12th grade is on your plan." };
      return { ...base, status: "room_to_add", text: "Room to add a full year of math in 12th grade, unless you meet the college-ready math competency." };
    }
    case "no_endorsement_after": {
      if (!ctx.choices.txFoundationOnly) {
        // Only an endorsement that's actually in the plan counts: one the student named, or the one
        // this plan was built with.
        if (ctx.endorsementDefault) {
          return {
            ...base,
            status: "ask_counselor",
            text: `You haven't named an endorsement, so this plan uses the ${ctx.endorsementDefault} for now. You can name any endorsement; ask your counselor which one your school has on record.`,
          };
        }
        if (ctx.ruleSets.some((r) => r.rs.appliesWhen.choice?.key === "txEndorsements")) return { ...base, status: "ok", text: "You're planning with an endorsement." };
        return {
          ...base,
          status: "ask_counselor",
          text: "You haven't named an endorsement, so this plan covers only the Foundation program (22 credits). Ask your counselor.",
        };
      }
      if (ctx.grade <= check.grade && !(ctx.grade === check.grade && ctx.inProgressGrade === null)) {
        return {
          ...base,
          status: "ask_counselor",
          text: `You can't graduate without an endorsement until after ${nth(check.grade)} grade. After that it takes counselor advising and your parent's written permission. It also rules out the Distinguished Level of Achievement.`,
        };
      }
      return {
        ...base,
        status: "ask_counselor",
        text: "Graduating without an endorsement takes counselor advising and your parent's written permission. It also rules out the Distinguished Level of Achievement.",
      };
    }
    case "requires_rule_set": {
      const statuses = check.anyOf.map(statusOf).filter((s): s is AuditStatus => s !== null);
      if (statuses.some((s) => s === "done" || s === "planned")) return { ...base, status: "ok", text: "The other part this needs is on your plan too." };
      const names = check.anyOf.map((id) => ctx.allRuleSets.get(id)?.rs.title ?? id);
      if (statuses.length === 0) return { ...base, status: "room_to_add", text: `This also needs one of: ${names.join(", ")}. Choose one to count it.` };
      // The one on the plan isn't all planned yet (an endorsement's 26 credits).
      const onPlan = check.anyOf.filter((id) => statusOf(id) !== null);
      if (onPlan.length === 1 && statuses[0] === "room_to_add") {
        return { ...base, status: "room_to_add", text: `Room to add: this also needs the ${ctx.allRuleSets.get(onPlan[0])?.rs.title ?? onPlan[0]}, which isn't all on your plan yet.` };
      }
      return { ...base, status: statuses.includes("ask_counselor") ? "ask_counselor" : "room_to_add", text: `This also needs one of: ${names.join(", ")}, finished or planned.` };
    }
  }
}

/** "A 4th math credit" → "a 4th math credit" (after "Room to add"). */
function lowerArticle(text: string): string {
  return /^(A|An|The|One|Two|Three|Four) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** "Algebra II, a 4th math credit and a 4th science credit". */
function listLabels(labels: string[]): string {
  const words = labels.map((l, i) => (i > 0 && /^(A|An|The|One|Two|Three|Four) /.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function walkLeaves(reqs: readonly Req[]): Req[] {
  return reqs.flatMap((r) => (r.kind === "all" || r.kind === "any" || r.kind === "choose" ? walkLeaves(r.of) : r.kind === "option" ? walkLeaves([r.on, r.off]) : [r]));
}

/** A leaf of another rule set, met by these classes on its own (whole classes, no sharing). */
function reqMetBy(req: Req, items: Item[]): boolean {
  const creditable = items.filter((i) => i.creditable);
  if (req.kind === "credits") return creditable.filter((i) => matchesAny(i, req.select)).reduce((n, i) => n + i.units, 0) >= req.units;
  if (req.kind === "count") return creditable.filter((i) => matchesAny(i, req.select)).length >= req.n;
  return false;
}

function subjectWord(subject: Item["subject"]): string {
  return subject === "math" ? "Math" : subject === "english" ? "English" : subject === "science" ? "Science" : subject.replace(/_/g, " ");
}

// Conflicts --------------------------------------------------------------------------------------

/** Would an admission requirement accept this class? */
function admissionAccepts(leaf: CLeaf, item: Item): boolean {
  const req = leaf.req;
  if (req.kind === "credits" || req.kind === "count") return matchesAny(item, req.select);
  if (req.kind === "same_language") return languageProgress([item], leaf).counted.length > 0;
  return true;
}

const PARALLEL = new Map<string, boolean>();

/**
 * Two requirements are about the same kind of class when some course type counts for both (a
 * diploma's "4th math" and a college's "four math units"), as opposed to only sharing an area (a
 * diploma's "Secondary Math I" and a college's "one math beyond Math III").
 */
function parallel(grad: CLeaf, adm: CLeaf): boolean {
  const key = `${JSON.stringify(grad.req)}|${JSON.stringify(adm.req)}`;
  const cached = PARALLEL.get(key);
  if (cached !== undefined) return cached;
  let found = false;
  for (const t of allCourseTypes()) {
    if (t.fallback) continue;
    const probe = typeProbe(t.id);
    if (leafAccepts(grad, probe) && admissionAccepts(adm, probe)) {
      found = true;
      break;
    }
  }
  PARALLEL.set(key, found);
  return found;
}

function typeProbe(typeId: Item["typeId"]): Item {
  const t = getCourseType(typeId);
  return {
    key: "probe",
    ref: { kind: "suggestion", key: "probe" },
    own: false,
    typeId,
    assumed: false,
    level: "regular",
    subject: t.subject,
    grade: 11,
    schoolYear: 2030,
    term: "full_year",
    units: t.units,
    firm: true,
    completed: false,
    creditable: true,
    noCredit: false,
    hsCredit: true,
    letter: null,
    cte: t.cte === "always",
    lectureOnly: false,
  };
}

/**
 * "This counts for your diploma, but UTC may not count it. Ask your counselor." (design §5.5): a
 * class counts toward a graduation requirement; a target college's admission pattern has a
 * requirement about the same kind of class that isn't met yet; and none of that college's
 * requirements in the area would accept this class (computer science as the 4th math, Floral
 * Design as fine arts, CTE as a lab science).
 */
export function admissionConflicts(evals: RuleSetEval[]): Map<string, AdmissionConflict[]> {
  const out = new Map<string, AdmissionConflict[]>();
  // Unit patterns only: a program gate ("Calculus I with a B") isn't a list of what counts in an area.
  const admissions = evals.filter((e) => e.best && e.rc.rs.kind === "college_admission");
  for (const e of evals) {
    if (!e.best) continue;
    const kind = e.rc.rs.kind;
    if (kind !== "state_graduation" && kind !== "graduation_option" && kind !== "local_graduation") continue;
    for (const r of e.best.leaves) {
      if (!r.leaf.own || !r.leaf.area || r.leaf.area === "electives") continue;
      if (r.leaf.req.kind === "total_credits" || r.leaf.req.kind === "remaining_electives") continue;
      for (const c of r.counted) {
        for (const a of admissions) {
          const same = a.best!.leaves.filter((l) => l.leaf.area === r.leaf.area && l.leaf.req.kind !== "total_credits" && l.leaf.req.kind !== "remaining_electives");
          if (same.length === 0 || same.some((l) => admissionAccepts(l.leaf, c.item))) continue;
          const short = same.filter((l) => l.missing > 0 && parallel(r.leaf, l.leaf));
          if (short.length === 0) continue;
          const key = `${e.rc.rs.id}/${r.leaf.id}`;
          const list = out.get(key) ?? [];
          if (list.some((x) => x.admission.ruleSetId === a.rc.rs.id && sameRef(x.courseRef, c.item.ref))) continue;
          list.push({
            courseRef: c.item.ref,
            graduation: { ruleSetId: e.rc.rs.id, reqId: r.leaf.id },
            admission: { ruleSetId: a.rc.rs.id, reqId: short[0].leaf.id },
            text: `This counts for your diploma, but ${a.rc.rs.issuer.name} may not count it. Ask your counselor.`,
          });
          out.set(key, list);
        }
      }
    }
  }
  return out;
}

/**
 * A family-chosen waiver or opt-out (an `option` branch) where a target college lists the same area
 * for admission: "You chose a waiver for world language, but UT Chattanooga lists it for admission."
 * Keyed like conflicts: "<ruleSetId>/<reqId>".
 */
export const OPTION_WORDS: Record<OptionPref, string> = {
  utMath3OptOut: "Secondary Math III opt-out",
  tnWorldLanguageWaiver: "world language waiver",
  tnFineArtsWaiver: "fine arts waiver",
  txArtsHumanitiesScienceSwap: "4th science swap",
};

export function waiverNotes(evals: RuleSetEval[]): Map<string, Reason[]> {
  const out = new Map<string, Reason[]>();
  const admissions = evals.filter((e) => e.best && e.rc.rs.kind === "college_admission");
  for (const e of evals) {
    if (!e.best || (e.rc.rs.kind !== "state_graduation" && e.rc.rs.kind !== "graduation_option")) continue;
    const noted = new Set<string>();
    for (const r of e.best.leaves) {
      if (!r.leaf.own || !r.leaf.optionPref || !r.leaf.area) continue;
      for (const a of admissions) {
        if (noted.has(`${r.leaf.optionPref}|${a.rc.rs.id}`)) continue;
        const same = a.best!.leaves.find((l) => l.leaf.area === r.leaf.area);
        if (!same) continue;
        noted.add(`${r.leaf.optionPref}|${a.rc.rs.id}`);
        const key = `${e.rc.rs.id}/${r.leaf.id}`;
        const text = `You chose the ${OPTION_WORDS[r.leaf.optionPref as OptionPref] ?? "waiver"}, but ${a.rc.rs.issuer.name} lists "${same.leaf.label}" for admission. Ask your counselor.`;
        out.set(key, [...(out.get(key) ?? []), reason("conflict", text, { ruleSetId: a.rc.rs.id, reqId: same.leaf.id, strength: same.leaf.strength, citations: same.leaf.cite })]);
      }
    }
  }
  return out;
}

function sameRef(a: Item["ref"], b: Item["ref"]): boolean {
  return a.kind === b.kind && (a.kind === "course" ? a.courseId === (b as typeof a).courseId : a.key === (b as typeof a).key);
}

// Output ----------------------------------------------------------------------------------------

/**
 * `guessOnly`: the requirement is unmet only because some of the student's classes have a guessed
 * kind (confirmed, they'd meet it). That's a "confirm the class type" prompt, never "Needs a plan now".
 */
export function requirementAudit(ctx: Ctx, rc: RuleSetCtx, r: LeafResult, conflicts: AdmissionConflict[], needsPlanNowKeys: Set<string>, guessOnly = false): RequirementAudit {
  const priority = leafPriority(rc, r.leaf.strength);
  const npn =
    ctx.inProgressGrade === 12 &&
    priority === 0 &&
    ((r.missing > 0 && !guessOnly) || r.counted.some((c) => c.item.ref.kind === "suggestion" && needsPlanNowKeys.has(c.item.ref.key)));
  const { status, modifiers } = leafStatus(ctx, rc, r, npn);
  return {
    reqId: r.leaf.id,
    label: r.leaf.label,
    strength: r.leaf.strength,
    area: r.leaf.area,
    status,
    modifiers,
    measure: r.leaf.measure,
    required: r.required,
    firm: r.firm,
    planned: r.planned,
    missing: r.missing,
    counted: r.counted.map((c) => ({ ref: c.item.ref, amount: c.amount, firm: c.item.firm })),
    reasons: [
      requirementReason(rc, r.leaf),
      ...[leafNoteReason(rc, r.leaf)].filter((x): x is Reason => x !== null),
      ...ruleSetNotes(rc).filter((n) => n.kind === "projected" || n.kind === "stale"),
    ],
    conflicts,
  };
}

export function ruleSetAudit(
  ctx: Ctx,
  e: RuleSetEval,
  items: Item[],
  conflicts: Map<string, AdmissionConflict[]>,
  needsPlanNowKeys: Set<string>,
  statusOf: (id: string) => AuditStatus | null,
): RuleSetAudit {
  const { rc, best } = e;
  const variant = rc.variant;
  // The same route with the student's guessed class kinds taken as confirmed (as the plan was built).
  const confirmed = best && best.leaves.some((l) => l.guessed && l.missing > 0) ? evaluateAlternative(best.alt, asConfirmed(items), rc.allocation) : null;
  const requirements = best
    ? best.leaves
        .map((l, i) => ({ l, guessOnly: l.guessed && l.missing > 0 && confirmed !== null && confirmed.leaves[i].missing === 0 }))
        .filter(({ l }) => l.leaf.own)
        .map(({ l, guessOnly }) => requirementAudit(ctx, rc, l, conflicts.get(`${rc.rs.id}/${l.leaf.id}`) ?? [], needsPlanNowKeys, guessOnly))
    : [];
  const checks = best && variant ? (variant.checks ?? []).flatMap((c) => evaluateCheck(ctx, rc, c, best.leaves, items, statusOf) ?? []) : [];
  // A check that needs another rule set that's only planned (the Foundation program with classes
  // still to take this year) leaves this one planned, never done.
  const checkStatuses: AuditStatus[] = checks.map((c) => {
    if (c.status !== "ok") return c.status;
    const def = variant?.checks?.find((x) => x.id === c.checkId);
    if (def?.kind === "requires_rule_set" && !def.anyOf.some((id) => statusOf(id) === "done")) return "planned";
    return "done";
  });
  let status = variant ? worst([...requirements.map((r) => r.status), ...checkStatuses]) : "ask_counselor";
  if (rc.rs.strength === "info" && status === "room_to_add") status = "not_tracked";
  return {
    ruleSetId: rc.rs.id,
    title: rc.rs.title,
    kind: rc.rs.kind,
    issuer: rc.rs.issuer,
    strength: rc.rs.strength,
    confidence: rc.rs.confidence,
    cohort: rc.cohort,
    variantId: variant?.id ?? null,
    alternativeIndex: best ? best.alt.index : null,
    projected: rc.projected,
    stale: rc.stale,
    review: rc.file.review.status,
    status,
    requirements,
    checks,
    conditions: (variant?.conditions ?? []).map((c) => ({ id: c.id, label: c.label, kind: c.kind, citations: c.cite })),
    unverified: variant?.unverified ?? [],
    warnings: (variant?.warnings ?? []).map((w) => ({ id: w.id, text: w.text, citations: w.cite })),
    testRoutes: (rc.rs.testRoutes ?? []).map((t) => ({ id: t.id, text: t.text, citations: t.cite })),
  };
}

