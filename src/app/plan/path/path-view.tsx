import Link from "next/link";
import { graduationPageTitle, DRAFT_NOTICE, LOAD_WARNING, TX_DLA_DEFAULT_NOTE } from "@/lib/planner/copy";
import { type CourseTypeLevel, LANGUAGE_NAMES, levelLabel } from "@/lib/planner/course-types";
import type { PlannedPath, PlanSlot, PlanYear } from "@/lib/planner/engine-io";
import { getFamily } from "@/lib/planner/families";
import { REVIEW_LABELS } from "@/lib/planner/review";
import type { PathContext } from "@/lib/planner/service";
import { savedSchoolLabel } from "@/lib/schools/labels";
import {
  byWhenText,
  COURSE_STATUS_WORDS,
  cohortLine,
  mainReason,
  ordinal,
  PATH_LABELS,
  stateTitle,
  TN_FOCUS_LABELS,
  TX_ENDORSEMENT_LABELS,
  yearLabel,
} from "@/lib/planner/view";
import { Chip, PathSection } from "./parts";
import { DecisionForm, PathSettings, type PathSettingsValues } from "./path-settings";
import { OtherChoices, RestoreSuggestions, SuggestionActions } from "./suggestion-actions";
import { WhatCounts } from "./what-counts";
import { CitationList, Why } from "./why";

// "Your path" (design §2.7): the draft notice, what it's built from, choices to make, "by when",
// the year-by-year plan with one-tap suggestions, what's still open with options, what counts
// toward what, questions for the counselor, the student's choices and how the plan was built.
// `mode: "parent"` is the parent's read-only view: same content, no buttons or forms.

export type PathViewMode = "student" | "parent";

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;

/** The level after a class's name, unless the name already says it ("Geometry Honors", "AP Biology"). */
function levelShown(title: string, level: CourseTypeLevel, state: PlannedPath["state"]): boolean {
  if (level === "regular") return false;
  const words = levelLabel(level, state).toLowerCase();
  const name = title.toLowerCase();
  return !name.includes(words) && !(level === "honors" && /\(h\)|\bhon\b|\bpre-?ap\b/.test(name));
}

function DraftNotice({ path, mode, printHref }: { path: PlannedPath; mode: PathViewMode; printHref: string }) {
  const draft = path.notices.review.some((n) => n.status === "draft");
  const stale = path.notices.review.find((n) => n.stale);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-accent-soft p-4 text-sm">
      <p className="text-base font-semibold">{DRAFT_NOTICE}</p>
      <p>{path.notices.draft}</p>
      <p className="flex flex-wrap items-center gap-2">
        {draft && <Chip tone="note">{REVIEW_LABELS.draft}</Chip>}
        {stale?.staleLabel && <Chip tone="note">{stale.staleLabel}</Chip>}
      </p>
      <p>{path.notices.standing}</p>
      <p className="print:hidden">
        <Link href={printHref} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
          {mode === "parent" ? "Print this draft" : "Print a one-page draft for your counselor"}
        </Link>
      </p>
    </div>
  );
}

function BuiltFrom({ path, ctx, mode }: { path: PlannedPath; ctx: PathContext; mode: PathViewMode }) {
  const you = mode === "parent" ? "their" : "your";
  const listLabel = path.builtFrom.catalogs[0]?.catalog.label ?? "";
  const school = ctx.school?.current;
  // The student's own schools (this one and the high school they expect to go to), for their eyes only.
  const listedSchools = [ctx.school?.current, ctx.school?.next].flatMap((s) => (s?.choice === "listed" && s.school ? [s.school.name] : []));
  const colleges = path.builtFrom.colleges;
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="text-muted">Rules</dt>
      <dd>
        {stateTitle(path.state)}, for {ctx.cohort ? cohortLine(ctx.cohort).toLowerCase() : "this class"}.{" "}
        <Link href={`/graduation/${path.state.toLowerCase()}`} className="underline underline-offset-2">
          {graduationPageTitle(path.state)}
        </Link>
      </dd>
      <dt className="text-muted">Classes</dt>
      <dd>
        {listLabel}.
        {listedSchools.length > 0 && (
          <>
            {" "}
            We don&apos;t have {listedSchools.join(" or ")}&apos;s class list yet, so check each class with {you} counselor.
          </>
        )}
        {school && school.choice === "not_listed" && <> School: {savedSchoolLabel(school)}.</>}
      </dd>
      <dt className="text-muted">Goals</dt>
      <dd>
        {PATH_LABELS[ctx.path]}
        {path.builtFrom.families.length > 0 && (
          <>
            {" · "}
            {path.builtFrom.families
              .map((f) => `${getFamily(f.familyId).title}${f.because ? ` (because ${mode === "parent" ? "they" : "you"} picked ${f.because})` : ""}`)
              .join("; ")}
          </>
        )}
      </dd>
      <dt className="text-muted">Colleges</dt>
      <dd>
        {colleges.length === 0
          ? "None yet."
          : colleges.map((c) => (c.stateDefault ? `${c.name} (a labeled default until ${you} list has an in-state public college)` : c.name)).join("; ")}
      </dd>
    </dl>
  );
}

function decisionField(key: string): "txEndorsement" | "tnElectiveFocus" | "worldLanguage" | "familyId" | null {
  if (key === "txEndorsements") return "txEndorsement";
  if (key === "tnElectiveFocus") return "tnElectiveFocus";
  if (key === "worldLanguage") return "worldLanguage";
  if (key === "family") return "familyId";
  return null;
}

function Decisions({ path, mode }: { path: PlannedPath; mode: PathViewMode }) {
  if (!path.decisions.length) return null;
  const labels: Record<string, string> = {
    txEndorsement: "Endorsement",
    tnElectiveFocus: "Elective focus",
    worldLanguage: "Language",
    familyId: "Plan around",
  };
  return (
    <PathSection id="path-decisions" title="Choices to make" lead="The rules depend on these. Nothing is final; you can change them later.">
      <ul className="space-y-3">
        {path.decisions.map((d) => {
          const field = decisionField(d.key);
          return (
            <li key={d.key} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <p className="font-medium">{d.text}</p>
              {d.by && <p className="text-muted">Decide {byWhenText(d.by)}.</p>}
              {d.reasons.map((r, i) => (
                <p key={i} className="mt-1">
                  {r.text}
                </p>
              ))}
              <Why ids={d.reasons.flatMap((r) => r.citations)} citations={path.citations} srContext={`for ${d.text}`} />
              {mode === "student" && field && <DecisionForm field={field} label={labels[field]} value="" />}
            </li>
          );
        })}
      </ul>
    </PathSection>
  );
}

function ByWhen({ path }: { path: PlannedPath }) {
  // Choices already shown under "Choices to make" aren't repeated here.
  const decided = new Set(path.decisions.map((d) => d.text));
  const items = path.deadlines.filter((d) => (d.slackYears === 0 || d.kind !== "ladder") && !(d.kind === "decision" && decided.has(d.text)));
  if (!items.length) return null;
  return (
    <PathSection id="path-by-when" title="By when" lead="The few dates that keep doors open.">
      <ol className="space-y-2">
        {items.map((d) => (
          <li key={d.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
            <span aria-hidden className="mt-0.5 text-muted">
              ◷
            </span>
            <span className="min-w-0">
              <span className="block font-medium first-letter:uppercase">{byWhenText(d.by)}</span>
              <span className="block">{d.text}</span>
              <Why ids={d.reasons.flatMap((r) => r.citations)} citations={path.citations} srContext={`for ${d.text}`} />
            </span>
          </li>
        ))}
      </ol>
    </PathSection>
  );
}

function SuggestedSlot({ slot, year, path, mode, headingId }: { slot: Suggested; year: PlanYear; path: PlannedPath; mode: PathViewMode; headingId: string }) {
  const level = levelShown(slot.title, slot.level, path.state) ? levelLabel(slot.level, path.state) : null;
  const reason = mainReason(slot);
  const more = slot.reasons.length - 1;
  const ids = slot.reasons.flatMap((r) => r.citations);
  return (
    <li className="rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-medium">
            <span className="sr-only">Suggested: </span>
            {slot.title}
            {level && <span className="font-normal text-muted"> · {level}</span>}
            {slot.term === "summer" && <span className="font-normal text-muted"> · the summer after {ordinal(year.grade)} grade</span>}
          </p>
          {slot.needsPlanNow && <p className="text-sm font-medium">Needs a plan now: this is a required credit.</p>}
          {reason && (
            <p className="text-sm text-muted">
              {reason}
              {more > 0 && ` Plus ${more} more ${more === 1 ? "reason" : "reasons"}.`}
            </p>
          )}
          {slot.approvals.length > 0 && <p className="text-sm">Some schools ask for a teacher recommendation or placement first.</p>}
        </div>
        {mode === "student" ? <SuggestionActions suggestionKey={slot.key} title={slot.title} focusAfter={headingId} /> : <Chip tone="soft">Suggested</Chip>}
      </div>
      <div className="flex flex-wrap gap-x-5">
        {(more > 0 || ids.some((id) => path.citations[id])) && (
          <details className="text-sm open:basis-full">
            <summary className="min-h-11 cursor-pointer content-center font-medium underline-offset-2 hover:underline print:hidden">
              Why?<span className="sr-only"> {slot.title}</span>
            </summary>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {slot.reasons.map((r, i) => (
                <li key={i}>{r.text}</li>
              ))}
            </ul>
            <div className="mt-2">
              <CitationList ids={ids} citations={path.citations} />
            </div>
          </details>
        )}
        {mode === "student" && slot.alternatives.length > 0 && (
          <OtherChoices
            title={slot.title}
            focusAfter={headingId}
            alternatives={slot.alternatives.map((a) => ({
              key: a.key,
              label: `${a.title}${a.level !== "regular" ? ` (${levelLabel(a.level, path.state)})` : ""}`,
            }))}
          />
        )}
      </div>
    </li>
  );
}

function YearCard({ year, path, mode, planId }: { year: PlanYear; path: PlannedPath; mode: PathViewMode; planId: string }) {
  const headingId = `path-${planId}-year-${year.grade}`;
  const yours = year.slots.filter((s): s is Extract<PlanSlot, { kind: "yours" }> => s.kind === "yours");
  const suggested = year.slots.filter((s): s is Suggested => s.kind === "suggested");
  const choice = year.slots.some((s) => s.kind === "your_choice");
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface p-4">
      <h4 id={headingId} tabIndex={-1} className="font-medium focus:outline-none">
        {yearLabel(year.grade, year.schoolYear)}
      </h4>
      <p className="text-sm text-muted">
        About {Math.round(year.capacity.used)} of {year.capacity.classes} classes · {year.load.collegeLevel} college-level (
        {mode === "parent" ? "their" : "your"} max {year.load.cap})
      </p>
      {year.load.warning && <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm">{LOAD_WARNING}</p>}
      <ul className="mt-3 space-y-2">
        {yours.map((s) => (
          <li key={s.courseId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-background px-3 py-2">
            <span>
              <span className="sr-only">{mode === "parent" ? "Their class" : "Your class"}: </span>
              {s.title}
              {levelShown(s.title, s.level, path.state) && <span className="text-muted"> · {levelLabel(s.level, path.state)}</span>}
              {s.assumed && <span className="block text-xs text-muted">Guessed class type. Set “What kind of class is this?” on the class to be sure it counts.</span>}
              {s.warnings.map((w, i) => (
                <span key={i} className="block text-xs text-muted">
                  {w.text}
                </span>
              ))}
            </span>
            <Chip>
              <span aria-hidden>{s.status === "completed" ? "✓" : s.status === "in_progress" ? "◑" : "○"}&nbsp;</span>
              {COURSE_STATUS_WORDS[s.status]}
            </Chip>
          </li>
        ))}
        {suggested.map((s) => (
          <SuggestedSlot key={s.key} slot={s} year={year} path={path} mode={mode} headingId={headingId} />
        ))}
        {choice && (
          <li className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
            <span className="font-medium text-foreground">Your choice:</span> room for a class {mode === "parent" ? "they pick" : "you pick"}.
          </li>
        )}
      </ul>
    </section>
  );
}

function Plans({ path, mode, planId, planHref }: { path: PlannedPath; mode: PathViewMode; planId: "A" | "B"; planHref: (id: "A" | "B") => string }) {
  if (!path.plans.length) return null;
  const current = path.plans.find((p) => p.id === planId) ?? path.plans[0];
  return (
    <PathSection
      id="path-plan"
      title="Year by year"
      lead={
        mode === "student"
          ? "Your classes are locked in; we plan around them. Add a suggestion with one tap, or say “Not for me”."
          : "Their own classes, plus suggestions they can add."
      }
    >
      {path.planChoice && path.plans.length === 2 && (
        <div className="space-y-2 text-sm">
          <p>{path.planChoice.text}</p>
          <nav aria-label="Plans" className="flex flex-wrap gap-2 print:hidden">
            {path.plans.map((p) => (
              <Link
                key={p.id}
                href={planHref(p.id)}
                aria-current={p.id === current.id ? "true" : undefined}
                scroll={false}
                className={`inline-flex min-h-11 items-center rounded-lg border px-3 ${p.id === current.id ? "border-accent bg-accent-soft font-medium" : "border-border bg-surface"}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
      {path.plans.length === 1 && <p className="text-sm text-muted">{current.label}</p>}
      <div className="space-y-3">
        {current.years.map((y) => (
          <YearCard key={y.grade} year={y} path={path} mode={mode} planId={current.id} />
        ))}
      </div>
    </PathSection>
  );
}

function Gaps({ path }: { path: PlannedPath }) {
  if (!path.gaps.length) return null;
  return (
    <PathSection id="path-gaps" title="Room to add" lead="Things that don't fit yet, and real options for each. Plans change; here's what still fits.">
      <ul className="space-y-3">
        {path.gaps.map((g) => (
          <li key={g.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="font-medium">{g.text}</p>
            {g.decideBy && <p className="text-muted">Decide {byWhenText(g.decideBy)}.</p>}
            <p className="mt-2 text-muted">Options:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {g.options.map((o, i) => (
                <li key={i}>
                  <span className="font-medium">{o.text}</span>
                  {o.note && <span className="block text-muted">{o.note}</span>}
                  {o.closes && <span className="block text-muted">What it changes: {o.closes}</span>}
                </li>
              ))}
            </ol>
            <Why ids={[...g.reasons.flatMap((r) => r.citations), ...g.options.flatMap((o) => o.citations)]} citations={path.citations} srContext={`for ${g.text}`} />
          </li>
        ))}
      </ul>
    </PathSection>
  );
}

function MiddleSchool({ path }: { path: PlannedPath }) {
  const ms = path.middleSchool;
  if (!ms) return null;
  const sketch = ms.ninthGradeSketch;
  return (
    <>
      <PathSection id="path-math" title="Math in middle school">
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <p>{ms.mathPlacement.text}</p>
          {ms.stateNotes.map((n, i) => (
            <div key={i} className="mt-3 border-t border-border pt-3">
              <p>{n.text}</p>
              <Why ids={n.citations} citations={path.citations} srContext="for this note" />
            </div>
          ))}
        </div>
      </PathSection>
      {ms.exploration.length > 0 && (
        <PathSection id="path-explore" title="Classes to explore" lead="Ideas to try in high school. No pressure: exploring is the point.">
          <ul className="flex flex-wrap gap-2">
            {ms.exploration.map((e) => (
              <li key={e.typeId}>
                <Chip>{e.title}</Chip>
              </li>
            ))}
          </ul>
        </PathSection>
      )}
      {sketch && (
        <PathSection id="path-sketch" title="A 9th-grade sketch" lead="What 9th grade often looks like here. You don't need to decide now.">
          <ul className="space-y-1 rounded-xl border border-border bg-surface p-4 text-sm">
            {sketch.slots.map((s, i) =>
              s.kind === "suggested" ? (
                <li key={s.key}>
                  {s.title}
                  {s.reasons[0] && <span className="block text-xs text-muted">{s.reasons[0].text}</span>}
                </li>
              ) : s.kind === "yours" ? (
                <li key={s.courseId}>{s.title}</li>
              ) : (
                <li key={`choice-${i}`} className="text-muted">
                  Your choice
                </li>
              ),
            )}
          </ul>
        </PathSection>
      )}
    </>
  );
}

function Questions({ path, printHref }: { path: PlannedPath; printHref: string }) {
  if (!path.askCounselor.length) return null;
  return (
    <PathSection id="path-questions" title="Questions for your counselor" lead="Bring these to your next meeting.">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {path.askCounselor.map((q) => (
          <li key={q.id}>{q.text}</li>
        ))}
      </ol>
      <p className="print:hidden">
        <Link href={printHref} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">
          Print the draft with these questions
        </Link>
      </p>
    </PathSection>
  );
}

function HowBuilt({ path }: { path: PlannedPath }) {
  return (
    <details className="rounded-xl border border-border bg-surface p-4 text-sm">
      <summary className="min-h-11 cursor-pointer content-center font-medium">How this plan was built</summary>
      <div className="mt-2 space-y-3">
        <p>
          Planning is done by code from reviewed rules, not by AI. The AI never decides what counts. {path.builtFrom.rigor.why}
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {path.builtFrom.ruleSets.map((r) => (
            <li key={r.id}>
              {r.title}: {r.review === "counselor-reviewed" && r.reviewedOn ? `reviewed by a school counselor on ${r.reviewedOn}` : REVIEW_LABELS.draft.toLowerCase()}
              , checked for {r.verifiedForSchoolYear}-{String((r.verifiedForSchoolYear + 1) % 100).padStart(2, "0")}
              {r.projected && ", projected"}
              {r.stale && ", being re-checked"} <span className="text-muted">(version {r.fingerprint})</span>
            </li>
          ))}
        </ul>
        <p className="text-muted">Plan version {path.inputsFingerprint}.</p>
      </div>
    </details>
  );
}

export function settingsValues(ctx: PathContext): PathSettingsValues {
  const c = ctx.prefs.choices;
  return {
    path: ctx.path,
    pathInferred: ctx.pathInferred,
    familyId: ctx.prefs.familyId ?? "",
    maxCollegeLevelPerYear: ctx.prefs.limits.maxCollegeLevelPerYear,
    accelerateMath: ctx.prefs.limits.accelerateMath,
    txEndorsement: c.txEndorsements?.[0] ?? "",
    txAimDla: c.txAimDla ?? ctx.path === "degree",
    tnElectiveFocus: c.tnElectiveFocus ?? "",
    worldLanguage: c.worldLanguage ?? "",
  };
}

/** The parent's read-only summary of the choices the path uses. */
function ChoicesSummary({ ctx, path }: { ctx: PathContext; path: PlannedPath }) {
  const c = ctx.prefs.choices;
  const rows: [string, string][] = [["Planning for", PATH_LABELS[ctx.path]]];
  if (path.state === "TX") {
    rows.push(["Endorsement", c.txEndorsements?.[0] ? TX_ENDORSEMENT_LABELS[c.txEndorsements[0]] : "Not chosen yet"]);
    rows.push(["Distinguished Level of Achievement", (c.txAimDla ?? ctx.path === "degree") ? "Planning for it" : "Not planning for it"]);
  }
  if (path.state === "TN") rows.push(["Elective focus", c.tnElectiveFocus ? TN_FOCUS_LABELS[c.tnElectiveFocus] : "Not chosen yet"]);
  rows.push(["World language", c.worldLanguage ? LANGUAGE_NAMES[c.worldLanguage] : "Not chosen yet"]);
  rows.push(["Most college-level classes a year", String(ctx.prefs.limits.maxCollegeLevelPerYear)]);
  return (
    <dl className="grid gap-x-4 gap-y-1 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PathView({
  path,
  ctx,
  mode,
  planId,
  planHref,
  printHref,
}: {
  path: PlannedPath;
  ctx: PathContext;
  mode: PathViewMode;
  planId: "A" | "B";
  planHref: (id: "A" | "B") => string;
  printHref: string;
}) {
  const dlaDefault = path.state === "TX" && ctx.prefs.choices.txAimDla === undefined && ctx.path === "degree";
  return (
    <div className="space-y-8">
      <DraftNotice path={path} mode={mode} printHref={printHref} />
      <BuiltFrom path={path} ctx={ctx} mode={mode} />
      {dlaDefault && <p className="rounded-xl border border-border bg-surface p-4 text-sm">{TX_DLA_DEFAULT_NOTE}</p>}
      {mode === "student" && ctx.prefs.dismissed.length > 0 && <RestoreSuggestions count={ctx.prefs.dismissed.length} />}
      <Decisions path={path} mode={mode} />
      {path.stage === "middle_school" && <MiddleSchool path={path} />}
      <ByWhen path={path} />
      <Plans path={path} mode={mode} planId={planId} planHref={planHref} />
      <Gaps path={path} />
      <WhatCounts path={path} ctx={ctx} planId={planId} />
      <Questions path={path} printHref={printHref} />
      <PathSection id="path-choices" title={mode === "parent" ? "Their choices" : "Your choices"}>
        {mode === "student" ? (
          <details className="rounded-xl border border-border bg-surface p-4">
            <summary className="min-h-11 cursor-pointer content-center font-medium">Change what your path plans for</summary>
            <div className="mt-3">
              <PathSettings state={path.state} initial={settingsValues(ctx)} />
            </div>
          </details>
        ) : (
          <ChoicesSummary ctx={ctx} path={path} />
        )}
      </PathSection>
      <HowBuilt path={path} />
    </div>
  );
}
