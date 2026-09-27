import { toCredits } from "../common";
import { getCourseType } from "../course-types";
import type { CounselorQuestion, Gap, RuleSetAudit } from "../engine-io";
import type { Ctx } from "./context";
import { reason } from "./explain";
import type { FillResult } from "./fill";
import { mathRankOf } from "./ladder";
import { asPlanned } from "./model";
import { matchesAny } from "./select";

// ---------------------------------------------------------------------------
// 3 to 8 questions for the counselor meeting (design §2.8), from what the plan can't settle:
// diploma-vs-admission conflicts, projected rules, test routes, classes the list may not offer,
// catalog problems, moves between schools, and last the guessed class types that decide a requirement.
// ---------------------------------------------------------------------------

const MIN = 3;
const MAX = 8;

const AREA_WORDS: Record<string, string> = {
  english: "an English credit",
  math: "a math credit",
  science: "a science credit",
  social_studies: "a social studies credit",
  world_language: "a world language credit",
  arts: "a fine arts credit",
  computer_science: "a computer science credit",
  career_technical: "a career and technical credit",
  health_pe: "a health or PE credit",
  financial_literacy: "a financial literacy credit",
  digital_studies: "a digital studies credit",
};

/**
 * An unconfirmed item as a question for the counselor: the item's facts without its own "Ask your
 * counselor …" advice (the student is asking now), ending in "Can you check this for me?".
 */
export function unverifiedQuestion(text: string): string {
  const facts = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/^ask your counselor\b/i.test(s))
    .map((s) => s.replace(/[;,]\s*(so )?ask your counselor\b[^.!?]*([.!?])/i, "$2"))
    .join(" ")
    .trim();
  return `${facts || text} Can you check this for me?`;
}

/** "A 4th math credit" → "a 4th math credit" (inside a sentence). */
function lowerArticle(text: string): string {
  return /^(A|An|The|One|Two|Three|Four) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function listWords(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function counselorQuestions(ctx: Ctx, fill: FillResult, audit: RuleSetAudit[], gaps: Gap[]): CounselorQuestion[] {
  const out: CounselorQuestion[] = [];
  const add = (id: string, text: string, citations: string[] = [], ruleSetId: string | null = null) => {
    if (out.some((q) => q.id === id || q.text === text)) return;
    out.push({ id, text, reasons: [reason("state_note", text, { ruleSetId, citations })] });
  };
  const titleOf = (ref: { kind: "course"; courseId: string } | { kind: "suggestion"; key: string }) => {
    const item = fill.items.find((i) => (ref.kind === "course" ? i.key === `c:${ref.courseId}` : i.ref.kind === "suggestion" && i.ref.key === ref.key));
    return item ? getCourseType(item.typeId).title.replace(/ \(.*\)$/, "") : "this class";
  };

  // Diploma vs admission, one question per class and area.
  const grouped = new Map<string, { title: string; area: string; colleges: string[]; ruleSetId: string }>();
  for (const rs of audit) {
    for (const r of rs.requirements) {
      for (const c of r.conflicts) {
        const college = ctx.ruleSets.find((x) => x.rs.id === c.admission.ruleSetId)?.rs.issuer.name ?? "a college on my list";
        const title = titleOf(c.courseRef);
        const key = `${title}|${r.area}`;
        const g = grouped.get(key) ?? { title, area: AREA_WORDS[r.area ?? ""] ?? r.label.toLowerCase(), colleges: [], ruleSetId: c.admission.ruleSetId };
        if (!g.colleges.includes(college)) g.colleges.push(college);
        grouped.set(key, g);
      }
    }
  }
  for (const [key, g] of grouped) {
    add(`conflict:${key}`, `My plan counts ${g.title} as ${g.area} for my diploma. Will ${listWords(g.colleges)} count it that way for admission?`, [], g.ruleSetId);
  }
  // Waivers where a target college lists the same area.
  for (const rs of audit) {
    for (const r of rs.requirements) {
      for (const reasonLine of r.reasons) {
        if (reasonLine.kind !== "conflict" || !reasonLine.ruleSetId) continue;
        const college = ctx.ruleSets.find((x) => x.rs.id === reasonLine.ruleSetId)?.rs.issuer.name;
        const option = /You chose the (.+?), but/.exec(reasonLine.text)?.[1] ?? "waiver";
        if (college) add(`waiver:${reasonLine.ruleSetId}:${option}`, `If I use the ${option}, will ${college} still admit me?`, reasonLine.citations, reasonLine.ruleSetId);
      }
    }
  }
  // A class of the student's that a requirement counts only on an exception the plan can't see
  // (Utah's ENGL 1010 from 2026-27, only in an approved pilot): the requirement's own question.
  const own = asPlanned(fill.items).filter((i) => i.own && !i.noCredit);
  for (const e of fill.evals) {
    for (const l of e.best?.leaves ?? []) {
      const ask = l.leaf.req.kind === "credits" ? l.leaf.req.ask : undefined;
      if (ask && own.some((i) => matchesAny(i, ask.select))) add(`ask:${e.rc.rs.id}/${l.leaf.id}`, ask.question, ask.cite, e.rc.rs.id);
    }
  }
  // Test-score routes still open for a required course route.
  for (const g of gaps) {
    const test = g.options.find((o) => o.kind === "test_score");
    if (test && g.priority <= 1) {
      const rs = ctx.ruleSets.find((r) => g.demandId?.startsWith(`${r.rs.id}/`));
      // The need itself, not the rule set's title ("Utah high school graduation requirements" can't
      // be shown with a test score; college-ready math can).
      const need = fill.needs.find((n) => n.id === g.demandId);
      const what = need?.seniorMath ? `college-ready math (${rs?.rs.issuer.name ?? "the state"}'s senior-year math)` : need ? lowerArticle(need.label) : (rs?.rs.title ?? "this");
      add(`test:${g.id}`, `Should I plan to show ${what} with a test score or with a class, and when do scores need to be in?`, test.citations, rs?.rs.id ?? null);
    }
  }
  // Dated test-score routes whose class route isn't planned (UT Austin calculus readiness).
  for (const e of fill.evals) {
    if (!e.best || !e.best.leaves.some((l) => l.missing > 0) || e.rc.rs.strength !== "required") continue;
    const route = (e.rc.rs.testRoutes ?? []).find((t) => t.by);
    if (route) add(`test:${e.rc.rs.id}`, `Should I plan to show ${e.rc.rs.title} with a test score or with a class, and when do scores need to be in?`, route.cite, e.rc.rs.id);
  }
  // DLA on schedule (Texas).
  const dla = ctx.ruleSets.find((r) => r.rs.appliesWhen.choice?.key === "txAimDla");
  if (dla && ctx.grade <= 11) add("dla", "Is my plan on schedule for the Distinguished Level of Achievement by the end of 11th grade?", [dla.rs.strengthCite], dla.rs.id);
  // Projected and conflicting rules.
  for (const rs of audit) {
    if (rs.projected) add(`projected:${rs.ruleSetId}`, `The ${rs.title} rules for my class aren't final yet. Which ones apply to me?`, [], rs.ruleSetId);
    if (rs.confidence === "conflicting") add(`conflicting:${rs.ruleSetId}`, `${rs.issuer.name}'s pages don't agree. Which courses does it expect from me?`, [], rs.ruleSetId);
  }
  // Classes the list may not offer, or offers every other year.
  for (const g of gaps.filter((x) => x.kind === "not_offered").slice(0, 2)) {
    const what = g.text.replace(/^Your school's class list doesn't show a class for this: /, "").replace(/\.$/, "");
    add(`offered:${g.id}`, `Does our school offer a class that counts for this: ${what}?`);
  }
  for (const p of fill.placements) {
    if (p.row.everyOtherYear) add(`every-other:${p.row.id}`, `Does our school offer ${getCourseType(p.row.typeId).title} every year?`);
  }
  // Lecture-only college science.
  for (const f of ctx.input.courses) {
    if (f.lectureOnly && f.subject === "science") add(`lab:${f.typeId}`, `My ${getCourseType(f.typeId).title} class is listed without a lab. Will it count as a lab science?`);
  }
  // Catalog problems (prerequisite loops, missing references).
  const cycles = new Map<string, string[]>();
  for (const g of ctx.planGrades) {
    const cat = ctx.catalogs.get(g);
    for (const issue of cat?.issues ?? []) {
      if (issue.kind !== "prereq_cycle" || !issue.typeId) continue;
      const list = cycles.get(cat!.view.id) ?? [];
      const title = getCourseType(issue.typeId).title.replace(/ \(.*\)$/, "");
      if (!list.includes(title)) list.push(title);
      cycles.set(cat!.view.id, list);
    }
  }
  // Keyed by position, never by the list's id (it points to one school's guide).
  [...cycles.values()].forEach((titles, i) => add(`cycle:${i + 1}`, `The class list shows ${listWords(titles)} each needing the other first. Which comes first?`));
  // Math from another sequence (Algebra I, Geometry and Algebra II for Utah's Secondary Math I-III,
  // or the other way): one question, naming each of the student's classes and the class it may
  // stand for here.
  const pairs = new Map<number, { mine: string; here: string }>();
  for (const n of [...fill.needs].sort((a, b) => a.priority - b.priority)) {
    if (n.missing <= 0 || fill.unmet.get(n.id) !== "equivalent") continue;
    const named = n.selectors.flatMap((sel) => sel.types ?? []);
    for (const t of named) {
      const rank = mathRankOf(t);
      if (rank === null || rank < 1 || rank > 3 || pairs.has(rank)) continue;
      const mine = ctx.items.find((i) => i.own && !i.noCredit && mathRankOf(i.typeId) === rank && !named.includes(i.typeId));
      if (mine) pairs.set(rank, { mine: getCourseType(mine.typeId).title, here: lowerArticle(n.label) });
    }
  }
  if (pairs.size) {
    const sorted = [...pairs.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    const here = sorted.map((p) => p.here).filter((h, i, all) => all.indexOf(h) === i);
    add("equivalent-math", `Do my ${listWords(sorted.map((p) => p.mine))} count as ${listWords(here)} here?`);
  }
  // Moves.
  const moved = Object.values(ctx.cohort.overrides).includes("transferred");
  if (moved) add("transfer", "I changed schools. Will the classes I finished count the same way here?");
  // Family notes about college credit (UT Knoxville nursing's dual enrollment hours), for a plan with
  // a college-credit class: only those tagged as about college credit, and a college's own note only
  // when that college is on the list.
  if (fill.items.some((i) => i.level === "dual_enrollment")) {
    const listed = new Set(ctx.input.targets.colleges.map((c) => c.unitId));
    for (const f of ctx.families) {
      const notes: { id: string; text: string; colleges?: number[]; collegeCredit?: boolean; cite: string[] }[] = [...(f.content?.gates ?? []), ...(f.content?.cautions ?? [])];
      for (const c of notes) {
        if (!c.collegeCredit || (c.colleges && !c.colleges.some((u) => listed.has(u)))) continue;
        add(`caution:${c.id}`, `${c.text} How does that apply to me?`, c.cite);
      }
    }
  }
  // The state minimum isn't the district's total.
  const total = audit.flatMap((rs) => (rs.kind === "state_graduation" ? rs.requirements : [])).find((r) => r.reqId && r.measure === "units" && r.label.toLowerCase().includes("total"));
  if (total && !ctx.ruleSets.some((r) => r.rs.kind === "local_graduation")) add("district-total", `Does our district require more than the state's ${toCredits(total.required)} credits?`);
  // Unverified items, shown once.
  for (const rs of audit) for (const u of rs.unverified.slice(0, 1)) add(`unverified:${rs.ruleSetId}:${u.id}`, unverifiedQuestion(u.text), [], rs.ruleSetId);
  // Guessed class types, last and as one question: only the guessed rows a requirement counts (the
  // student can also settle a guess in the app by picking the class's kind). Generic titles only:
  // the student's typed names stay out of anything that could be shared.
  const guessedIds = new Set(ctx.input.courses.filter((f) => f.assumed).map((f) => f.id));
  const guessedTitles: string[] = [];
  for (const rs of audit) {
    for (const r of rs.requirements) {
      if (!r.modifiers.includes("guessed_type")) continue;
      for (const c of r.counted) {
        if (c.ref.kind !== "course" || !guessedIds.has(c.ref.courseId)) continue;
        const title = titleOf(c.ref);
        if (!guessedTitles.includes(title)) guessedTitles.push(title);
      }
    }
  }
  if (guessedTitles.length === 1) add("guess", `One of my classes looks like ${guessedTitles[0]}, but its kind is a guess. Does it count as that for graduation?`);
  else if (guessedTitles.length > 1) {
    const names = guessedTitles.length > 4 ? [...guessedTitles.slice(0, 3), `${guessedTitles.length - 3} others`] : guessedTitles;
    add("guess", `Some of my classes' kinds are guesses: they look like ${listWords(names)}. Do they count that way for graduation?`);
  }

  const fillers = [
    ["general:on-track", "Are my classes on track to graduate?"],
    ["general:offered", "Which classes on this draft does our school offer, and in which grades?"],
    ["general:change", "Is there anything in this draft you'd change for me?"],
  ] as const;
  for (const [id, text] of fillers) if (out.length < MIN) add(id, text);
  return out.slice(0, MAX);
}
