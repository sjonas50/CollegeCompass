import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { WeeklyStepsCard } from "@/components/weekly-steps";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { MAX_GRADE, MIN_GRADE } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import {
  type GradeProgress,
  type Roadmap,
  type RoadmapItem,
  buildRoadmap,
  countedTotal,
  getMilestoneProgress,
  gradeName,
  gradeProgressLabel,
  milestonesByMonth,
  monthList,
  monthName,
  progressByGrade,
} from "@/lib/roadmap";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { MAX_STEPS_PER_WEEK, type WeeklyStep, listWeek, weekStartOf } from "@/lib/steps";
import { Announcer } from "./announcer";
import type { WeekState } from "./milestone-actions";
import { MilestoneCard } from "./milestone-card";

export const metadata: Metadata = { title: "Your roadmap" };

const PAGE_HEADING_ID = "roadmap-heading";

/** `?grade=N` for a read-only look at another grade (7–12, not the student's own). */
function peekGradeFrom(param: string | string[] | undefined, current: number | null): number | null {
  const n = Number(Array.isArray(param) ? param[0] : param);
  if (!Number.isInteger(n) || n < MIN_GRADE || n > MAX_GRADE || n === current) return null;
  return n;
}

function headerLead(grade: number | null, now: Date) {
  const month = monthName(now.getUTCMonth() + 1);
  if (grade === null) return "A month-by-month guide for grades 7–12.";
  if (grade > MAX_GRADE) return "You've finished 12th grade. Congratulations!";
  const summer = now.getUTCMonth() + 1 === 6 || now.getUTCMonth() + 1 === 7;
  return `${summer ? `Summer after ${gradeName(grade)}` : gradeName(grade)} · ${month}`;
}

export default async function RoadmapPage({ searchParams }: PageProps<"/roadmap">) {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const now = new Date();
  const db = await getDb();
  const [progress, week, params] = await Promise.all([
    getMilestoneProgress(db, student.id),
    listWeek(db, student.id, weekStartOf(now)),
    searchParams,
  ]);
  const grade = student.grade;
  const peek = peekGradeFrom(params.grade, grade);
  const grades = progressByGrade(MILESTONES, progress);

  let body: ReactNode;
  if (peek !== null) {
    body = <PeekView grade={peek} current={grade} groups={milestonesByMonth(MILESTONES, peek, progress)} />;
  } else if (grade === null) {
    body = (
      <Card>
        <p>We don&apos;t know which grade you&apos;re in yet, so we can&apos;t line up your roadmap. You can still look at any grade below.</p>
      </Card>
    );
  } else if (grade > MAX_GRADE) {
    body = <GraduatedView finished={grades.reduce((n, g) => n + g.done, 0)} />;
  } else {
    body = (
      <MainView
        roadmap={buildRoadmap(MILESTONES, grade, now, progress)}
        gradeProgress={grades.find((g) => g.grade === grade)}
        week={week}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 id={PAGE_HEADING_ID} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl">
          Your roadmap
        </h1>
        <p className="mt-2 text-muted">{headerLead(grade, now)}</p>
      </div>
      {body}
      <GradeNav grades={grades} current={grade} viewing={peek ?? grade} />
      <p className="text-sm">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to dashboard
        </Link>
      </p>
      <Announcer />
    </div>
  );
}

function MainView({ roadmap, gradeProgress, week }: { roadmap: Roadmap; gradeProgress?: GradeProgress; week: WeeklyStep[] }) {
  const weekFull = week.length >= MAX_STEPS_PER_WEEK;
  const weekAllDone = weekFull && week.every((s) => s.status === "done");
  const weekState = (id: string): WeekState =>
    week.some((s) => s.milestoneId === id) ? "added" : weekFull ? "full" : "can_add";
  const month = monthName(roadmap.month);
  const done = roadmap.done.filter((m) => m.status === "done");
  const skipped = roadmap.done.filter((m) => m.status === "skipped");
  const doneTitle = skipped.length > 0 ? "Done and set aside" : "Done";
  // Undo moves a card out of "Done"; if it was the last one the section goes away too.
  const doneFocus = roadmap.done.length > 1 ? "done-summary" : PAGE_HEADING_ID;

  return (
    <>
      {gradeProgress && gradeProgress.total > 0 && <GradeProgressLine grade={roadmap.grade} progress={gradeProgress} />}

      <div className="space-y-2">
        <WeeklyStepsCard linkToRoadmap={false} />
        {weekFull && (
          <p id="week-full-note" className="text-sm text-muted">
            This week&apos;s list is full ({MAX_STEPS_PER_WEEK} steps), so &ldquo;Add to this week&rdquo; is paused.{" "}
            {weekAllDone
              ? "You finished all of them, so there's room again next week."
              : "Remove a step you haven't finished if you'd like to swap one in."}
          </p>
        )}
      </div>

      <MilestoneSection
        id="now"
        title="Right now"
        lead={`Good things to work on in ${month}.`}
        items={roadmap.now}
        grade={roadmap.grade}
        weekState={weekState}
        persistent
      >
        <p className="text-sm text-muted">
          Nothing on the roadmap for {month}. Enjoy the breather, or add a small step of your own for this week.
        </p>
      </MilestoneSection>

      {roadmap.comingUpMonths.length > 0 && (
        <MilestoneSection
          id="coming-up"
          title="Coming up"
          lead={`In ${monthList(roadmap.comingUpMonths)}. No need to start yet, but it's good to know what's next.`}
          items={roadmap.comingUp}
          grade={roadmap.grade}
          weekState={weekState}
          persistent
        >
          <p className="text-sm text-muted">Nothing new in {monthList(roadmap.comingUpMonths)}.</p>
        </MilestoneSection>
      )}

      {roadmap.catchUp.length > 0 && (
        <MilestoneSection
          id="catch-up"
          title="Catch up"
          lead="From earlier this year. It's not too late: do what still makes sense, and set aside anything that doesn't fit you."
          items={roadmap.catchUp}
          grade={roadmap.grade}
          weekState={weekState}
        />
      )}

      {roadmap.later.length > 0 && (
        <MilestoneSection
          id="later"
          title="Later this year"
          lead="A look at what's ahead this school year."
          items={roadmap.later}
          grade={roadmap.grade}
          weekState={weekState}
        />
      )}

      {roadmap.done.length > 0 && (
        <section aria-labelledby="done-heading">
          {/* A real heading, so the finished cards (h3) sit under "Done" in the heading outline
              rather than under whichever section came before. The summary is only the toggle. */}
          <h2 id="done-heading" className="sr-only">
            {doneTitle}
          </h2>
          <details className="group rounded-xl border border-border bg-surface">
            <summary
              id="done-summary"
              className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-medium [&::-webkit-details-marker]:hidden"
            >
              <span>
                {doneTitle} ({roadmap.done.length})
              </span>
              <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              {done.length > 0 && (
                <MilestoneList items={done} grade={roadmap.grade} focusAfter={doneFocus} weekState={weekState} />
              )}
              {skipped.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted">Not for you right now</h3>
                  <MilestoneList
                    items={skipped}
                    grade={roadmap.grade}
                    focusAfter={doneFocus}
                    weekState={weekState}
                    headingLevel={4}
                  />
                </div>
              )}
            </div>
          </details>
        </section>
      )}
    </>
  );
}

/** "2 of 3 done in 10th grade, not counting 2 set aside." Set-aside items never count against anyone. */
function GradeProgressLine({ grade, progress }: { grade: number; progress: GradeProgress }) {
  const counted = countedTotal(progress);
  if (counted === 0) {
    return (
      <p className="text-sm">
        You&apos;ve set aside everything on your {gradeName(grade)} roadmap for now. You can bring anything back from
        &ldquo;Done and set aside&rdquo; below.
      </p>
    );
  }
  return (
    <div>
      <p className="text-sm">
        <strong>{progress.done}</strong> of {counted} done in {gradeName(grade)}
        {progress.skipped > 0 && `, not counting ${progress.skipped} set aside`}
        {progress.done > 0 ? ". Nice going!" : "."}
      </p>
      <div className="mt-2 h-2 rounded-full bg-border" aria-hidden>
        <div
          className="h-2 rounded-full bg-accent"
          style={{ width: `${Math.max(2, Math.round((progress.done / counted) * 100))}%` }}
        />
      </div>
    </div>
  );
}

function MilestoneSection({
  id,
  title,
  lead,
  items,
  grade,
  weekState,
  persistent = false,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  items: RoadmapItem[];
  grade: number;
  weekState: (id: string) => WeekState;
  /** Always rendered, so it's a safe place to return focus to. */
  persistent?: boolean;
  children?: ReactNode;
}) {
  const headingId = `${id}-heading`;
  // If this was the section's last item the section disappears, so fall back to the page heading.
  const focusAfter = persistent || items.length > 1 ? headingId : PAGE_HEADING_ID;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2 id={headingId} tabIndex={-1} className="text-lg font-medium focus:outline-none">
          {title}
        </h2>
        <p className="text-sm text-muted">{lead}</p>
      </div>
      {items.length > 0 ? <MilestoneList items={items} grade={grade} focusAfter={focusAfter} weekState={weekState} /> : children}
    </section>
  );
}

function MilestoneList({
  items,
  grade,
  focusAfter,
  weekState,
  headingLevel = 3,
}: {
  items: RoadmapItem[];
  grade: number;
  focusAfter: string;
  weekState: (id: string) => WeekState;
  headingLevel?: 3 | 4;
}) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <MilestoneCard
            milestone={item}
            status={item.status}
            studentGrade={grade}
            actions={{ week: weekState(item.id), focusAfter }}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}

function PeekView({
  grade,
  current,
  groups,
}: {
  grade: number;
  current: number | null;
  groups: ReturnType<typeof milestonesByMonth>;
}) {
  const past = current !== null && grade < current;
  return (
    <section aria-labelledby="peek-heading" className="space-y-6">
      <div>
        <h2 id="peek-heading" className="text-xl font-semibold">
          {past ? `Looking back at ${gradeName(grade)}` : `A peek at ${gradeName(grade)}`}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {past
            ? "Here's what this grade covered. Anything you finished is marked."
            : "Just for looking. You'll be able to check these off when you get there."}
        </p>
        {current !== null && current <= MAX_GRADE && (
          <p className="text-sm">
            <Link href="/roadmap" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Back to my {gradeName(current)} roadmap
            </Link>
          </p>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="text-muted">Nothing on the roadmap for {gradeName(grade)} yet.</p>
      ) : (
        groups.map((group) => {
          const headingId = `peek-${group.month ?? "any"}`;
          const summer = group.month === 6 || group.month === 7;
          return (
            <section key={headingId} aria-labelledby={headingId} className="space-y-3">
              <h3 id={headingId} className="font-medium">
                {group.month ? monthName(group.month) : "Any time"}
                {summer && <span className="font-normal text-muted"> (summer after {gradeName(grade)})</span>}
              </h3>
              <ul className="space-y-3">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <MilestoneCard milestone={item} status={item.status} showMonths headingLevel={4} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}

function GraduatedView({ finished }: { finished: number }) {
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-medium">You did it!</h2>
      <p>
        You&apos;ve finished high school, and your roadmap covered every grade from 7th through 12th. Whatever comes next, whether
        that&apos;s college, training, work, or something else, you&apos;ve got this.
      </p>
      {finished > 0 && (
        <p className="text-sm text-muted">
          You checked off {finished === 1 ? "1 milestone" : `${finished} milestones`} along the way.
        </p>
      )}
    </Card>
  );
}

function GradeNav({ grades, current, viewing }: { grades: GradeProgress[]; current: number | null; viewing: number | null }) {
  const inSchool = current !== null && current <= MAX_GRADE;
  return (
    <nav aria-labelledby="grades-heading" className="space-y-3">
      <h2 id="grades-heading" className="text-lg font-medium">
        {inSchool ? "Peek at other grades" : "Look at any grade"}
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {grades.map((g) => {
          const isCurrent = g.grade === current;
          const isViewing = g.grade === viewing;
          return (
            <li key={g.grade}>
              <Link
                href={isCurrent ? "/roadmap" : `/roadmap?grade=${g.grade}`}
                aria-current={isViewing ? "page" : undefined}
                className={`flex min-h-11 flex-col justify-center rounded-lg border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  isViewing ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent"
                }`}
              >
                <span className="font-medium">
                  {gradeName(g.grade)}
                  {isCurrent && <span className="font-normal text-muted"> (you&apos;re here)</span>}
                </span>
                <span className="text-xs text-muted">{gradeProgressLabel(g)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
