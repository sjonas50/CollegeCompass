import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/applications/dates";
import { deadlineName, dueText } from "@/lib/applications/display";
import { type CareerLink, type ChildProgress, type ChildResults, PARENT_GPA_NOTE } from "@/lib/parent-dashboard";
import { type MilestoneStatus, gradeName, monthList, schoolYearIndex } from "@/lib/roadmap";

function Block({ title, className = "", children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-1 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-accent-soft">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${
        done ? "bg-accent text-accent-foreground" : "border border-border"
      }`}
    >
      {done ? "✓" : ""}
    </span>
  );
}

const ASSESSMENT_STATE = { done: "Done", in_progress: "Started", not_started: "Not started" } as const;
const MILESTONE_STATE: Record<MilestoneStatus, string> = { done: "Done", skipped: "Set aside", open: "Not yet" };

function whenText(months: number[]) {
  const ordered = [...months].sort((a, b) => schoolYearIndex(a) - schoolYearIndex(b));
  return ordered.length ? `best in ${monthList(ordered)}` : "any time this year";
}

/** Early state: nothing done or saved yet. */
function JustStarted({ name }: { name: string }) {
  return (
    <div className="mt-4 rounded-lg bg-accent-soft p-4 text-sm">
      <p className="font-medium">{name} is just getting started.</p>
      <p className="mt-1">
        As they try the activities and build their plan, you&apos;ll see their progress here. A good first step is the
        Interests activity. It takes about 10 minutes and unlocks career ideas that fit them.
      </p>
    </div>
  );
}

const careerLink = "inline-flex min-h-11 items-center underline underline-offset-2";

function CareerList({ careers, ordered = false }: { careers: CareerLink[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={`${ordered ? "list-decimal" : "list-disc"} pl-5`}>
      {careers.map((c) => (
        <li key={c.code}>
          <Link href={`/careers/${c.code}`} className={careerLink}>
            {c.title}
          </Link>
        </li>
      ))}
    </List>
  );
}

function Later({ activity }: { activity: string }) {
  return <p className="text-muted">Shows here after the {activity} activity.</p>;
}

/**
 * What the child's activities found, for now: interests (honest when no area stands out or areas
 * tie), the strengths that count and their top career matches. The same results a linked parent's
 * data download holds. Never "Staying calm" (see ChildResults).
 */
function ChildResultsSummary({ name, results: r }: { name: string; results: ChildResults }) {
  const noLead = r.interests?.noLead ?? false;
  return (
    <div className="rounded-lg border border-border p-4 sm:col-span-2">
      <h3 className="text-sm font-medium">Results, for now</h3>
      <p className="mt-1 text-sm text-muted">
        What {name}&apos;s activities show so far. Interests often change in the teen years, and {name} can retake the
        activities as they grow.
      </p>
      <div className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
        <div className="space-y-2">
          <h4 className="font-medium">Interests</h4>
          {r.interests ? <p>{r.interests.text}</p> : <Later activity="Interests" />}
        </div>
        <div className="space-y-2">
          <h4 className="font-medium">Strengths</h4>
          {!r.strengths ? (
            <Later activity="Personality" />
          ) : r.strengths.length ? (
            <>
              <p className="text-muted">Strengths {name} sees in themselves:</p>
              <ul className="space-y-1">
                {r.strengths.map((s) => (
                  <li key={s.trait}>
                    <span className="font-medium">{s.name}:</span> {s.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted">
              Done. None of the four strengths linked to careers was above the middle of the scale this time. Ask {name}{" "}
              what they learned about themselves.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <h4 className="font-medium">{noLead ? "Careers to explore" : "Top career matches"}</h4>
          {r.topMatches.length ? (
            <>
              {noLead && <p className="text-muted">No interest area stands out yet, so these are just a place to start.</p>}
              <CareerList careers={r.topMatches} ordered={!noLead} />
            </>
          ) : (
            <Later activity="Interests" />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A linked child's progress and activity results for the parent page. Never their counselor
 * chats, the counselor's notes or safety flags.
 */
export function ChildProgressSummary({ name, progress: p }: { name: string; progress: ChildProgress }) {
  if (p.justStarted) return <JustStarted name={name} />;
  const assessmentsDone = p.assessments.filter((a) => a.state === "done").length;

  return (
    <div className="mt-4 grid gap-5 sm:grid-cols-2">
      {p.results && <ChildResultsSummary name={name} results={p.results} />}

      <Block title="Discover activities">
        <p>
          {assessmentsDone} of {p.assessments.length} done
        </p>
        <ul className="space-y-1">
          {p.assessments.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Check done={a.state === "done"} />
              <span>
                {a.title} <span className="text-muted">· {ASSESSMENT_STATE[a.state]}</span>
              </span>
            </li>
          ))}
        </ul>
        {!p.results && (
          <p className="text-muted">Results show up here once {name} finishes the Interests or Personality activity.</p>
        )}
      </Block>

      <Block title="North stars">
        {p.northStars.length ? (
          <>
            <p className="text-muted">Careers {name} is aiming for, for now:</p>
            <CareerList careers={p.northStars} />
          </>
        ) : (
          <p className="text-muted">Not picked yet. After the Interests activity, {name} can choose one or two careers to aim for.</p>
        )}
      </Block>

      {p.roadmap && p.grade !== null && (
        <Block title={`${gradeName(p.grade)} roadmap`}>
          <p>
            {p.roadmap.total > 0 ? `${p.roadmap.done} of ${p.roadmap.total} steps done` : "Nothing to track for this grade yet"}
          </p>
          {p.roadmap.total > 0 && <Bar done={p.roadmap.done} total={p.roadmap.total} />}
          {p.roadmap.timely.length > 0 ? (
            <>
              <p className="text-muted">Good to do now:</p>
              <ul className="list-disc pl-5">
                {p.roadmap.timely.map((m) => (
                  <li key={m.id}>{m.title}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted">All caught up for this month.</p>
          )}
        </Block>
      )}

      <Block title="Weekly steps">
        <p>
          {p.steps.thisWeekTotal > 0
            ? `This week: ${p.steps.thisWeekDone} of ${p.steps.thisWeekTotal} done`
            : "No steps picked for this week yet."}
        </p>
        <p className="text-muted">
          {p.steps.lifetimeDone === 1 ? "1 step finished so far." : `${p.steps.lifetimeDone} steps finished so far.`}
        </p>
      </Block>

      <Block title="Class plan">
        {p.plan.courses > 0 ? (
          <>
            <p>
              {p.plan.courses === 1 ? "1 class" : `${p.plan.courses} classes`} in the plan
              {p.plan.estimatedGpa !== null && <> · estimated GPA {p.plan.estimatedGpa.toFixed(2)}</>}
            </p>
            {p.plan.estimatedGpa !== null && <p className="text-muted">{PARENT_GPA_NOTE}</p>}
          </>
        ) : (
          <p className="text-muted">No classes added yet.</p>
        )}
      </Block>

      <Block title="College list">
        <p>{p.colleges.count === 0 ? "Nothing saved yet." : `${p.colleges.count} on the list`}</p>
        {p.colleges.nextDeadlines &&
          (p.colleges.nextDeadlines.length > 0 ? (
            <>
              <p className="text-muted">Next deadlines:</p>
              <ul className="space-y-1">
                {p.colleges.nextDeadlines.map((d, i) => (
                  <li key={`${d.name}-${d.deadline}-${i}`}>
                    <span className="font-medium break-words">{d.name}</span>
                    <span className="block text-muted">
                      {deadlineName(d.deadlineType)}: <time dateTime={d.deadline}>{formatDate(d.deadline)}</time> ·{" "}
                      {dueText(d.daysLeft)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            p.colleges.count > 0 && <p className="text-muted">No application deadlines coming up.</p>
          ))}
      </Block>

      {p.fafsa && p.fafsa.length > 0 && (
        <Block title="Senior year: applying for financial aid" className="sm:col-span-2">
          <ul className="space-y-2">
            {p.fafsa.map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <Check done={m.status === "done"} />
                <span>
                  {m.title}
                  <span className="block text-muted">
                    {MILESTONE_STATE[m.status]}
                    {m.status === "open" && ` · ${whenText(m.months)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
