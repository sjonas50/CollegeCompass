import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { removeNorthStarAction } from "@/app/actions/discover";
import { StudentSettings } from "@/components/student-settings";
import { ButtonLink, Card, Notice, PageHeading } from "@/components/ui";
import { WeeklyStepsCard } from "@/components/weekly-steps";
import { getDb } from "@/db";
import { INSTRUMENTS, type InstrumentId } from "@/lib/assessments/instruments";
import { type InstrumentStatus, instrumentStatuses } from "@/lib/assessments/service";
import { gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import { computeGpa } from "@/lib/courses/gpa";
import { listCourses } from "@/lib/courses/service";
import { listNorthStars } from "@/lib/goals";
import { buildRoadmap, getMilestoneProgress } from "@/lib/roadmap";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { listEntries } from "@/lib/applications/service";
import { formatDate, usToday } from "@/lib/applications/dates";
import { deadlineName, dueText } from "@/lib/applications/display";
import { dueWithin } from "@/lib/applications/timeline";
import { reminderSettingFor } from "@/lib/reminders";

export const metadata: Metadata = { title: "Your dashboard" };

const BAND_COPY = {
  explore: "Grades 7–8 are for exploring. Let's find subjects and careers that light you up.",
  build: "Grades 9–10 are for building. Let's find a direction and choose classes that fit it.",
  launch: "Grades 11–12 are for launching. Let's make sure your plans fit who you are.",
} as const;

const ORDER: InstrumentId[] = ["interests", "personality", "values"];

/** The colleges card lists unsent applications due within this many days. */
const DASHBOARD_DEADLINE_DAYS = 14;

function statusText(s: InstrumentStatus) {
  if (s.state === "not_started") return "Not started";
  if (s.state === "in_progress") return `${s.answered} of ${s.total} answered`;
  return "Done";
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser(["student"]);
  const { settings } = await searchParams;
  const db = await getDb();
  const grade = user.grade ?? 9;
  const [statuses, stars, progress, courses, reminders, list] = await Promise.all([
    instrumentStatuses(db, user.id),
    listNorthStars(db, user.id),
    getMilestoneProgress(db, user.id),
    listCourses(db, user.id),
    reminderSettingFor(db, user.id),
    listEntries(db, user.id),
  ]);
  const roadmap = buildRoadmap(MILESTONES, grade, new Date(), progress);
  const timely = [...roadmap.now, ...roadmap.catchUp].slice(0, 3);
  const gpa = computeGpa(courses);
  const next = ORDER.find((i) => statuses[i].state !== "done");
  const hasResults = statuses.interests.state === "done";
  const graduated = grade > 12;
  const launching = grade >= 11;
  // The student's own entries, as they typed them (no AI is involved, so nothing is scrubbed).
  const deadlines = launching ? dueWithin(list, usToday(), DASHBOARD_DEADLINE_DAYS) : [];

  return (
    <div className="space-y-8">
      <PageHeading
        title={`Hi, ${user.displayName}!`}
        lead={graduated ? "Congratulations on finishing high school! Your plans and notes are all still here." : BAND_COPY[gradeBand(grade)]}
      />
      {settings === "saved" && <Notice>Settings saved.</Notice>}
      {settings === "stale" && <Notice>The school year changed since that page loaded, so we didn&apos;t save the grade. Please pick it again.</Notice>}

      {/* For graduates (no roadmap milestones) the card asks only for their own steps. */}
      <WeeklyStepsCard />

      {!graduated && (
        <section>
          <h2 className="text-lg font-medium">Timely on your roadmap</h2>
          {timely.length ? (
            <ul className="mt-3 space-y-2">
              {timely.map((m) => (
                <li key={m.id}>
                  <Link href="/roadmap" className="block rounded-xl border border-border bg-surface p-4 hover:border-accent">
                    <span className="font-medium">{m.title}</span>
                    <span className="mt-1 block text-sm text-muted">{m.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">You&apos;re all caught up for this month. Nice work!</p>
          )}
          <div className="mt-3">
            <ButtonLink href="/roadmap" variant="secondary">See my roadmap</ButtonLink>
          </div>
        </section>
      )}

      {stars.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Your north stars</h2>
          <p className="mb-3 text-sm text-muted">Careers you&apos;re aiming for, for now. You can change them anytime.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {stars.map((s) => (
              <li key={s.occupationCode}>
                <Card className="flex items-start justify-between gap-2">
                  <Link href={`/careers/${s.occupationCode}`} className="font-medium underline-offset-2 hover:underline">
                    {s.title}
                  </Link>
                  <form action={removeNorthStarAction}>
                    <input type="hidden" name="code" value={s.occupationCode} />
                    <input type="hidden" name="back" value="dashboard" />
                    <button type="submit" className="min-h-11 text-sm text-muted underline">Remove</button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Discover your direction</h2>
        <p className="mb-3 text-sm text-muted">
          {next ? "Three short activities. Start with interests — it unlocks your career matches." : "All done. You can retake them as you grow."}
        </p>
        <ol className="space-y-3">
          {ORDER.map((id, i) => {
            const s = statuses[id];
            return (
              <li key={id}>
                <Link href={`/discover/${id}`} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 hover:border-accent">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      s.state === "done" ? "bg-accent text-accent-foreground" : "border border-border text-muted"
                    }`}
                    aria-hidden
                  >
                    {s.state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium">{INSTRUMENTS[id].title}</span>
                    <span className="block text-sm text-muted">{INSTRUMENTS[id].tagline}</span>
                  </span>
                  <span className="text-sm text-muted">{statusText(s)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {hasResults && <ButtonLink href="/discover/results">See my career matches</ButtonLink>}
          {next && (
            <ButtonLink href={`/discover/${next}`} variant={hasResults ? "secondary" : "primary"}>
              {statuses[next].state === "in_progress" ? "Keep going" : `Start ${INSTRUMENTS[next].title.toLowerCase()}`}
            </ButtonLink>
          )}
        </div>
      </section>

      {/* The explorer is for grades 9-12, but a younger student who has saved colleges sees them too. */}
      {(grade >= 9 || list.length > 0) && (
        <section>
          <h2 className="text-lg font-medium">{launching ? "Colleges and applications" : "Colleges and training"}</h2>
          {deadlines.length > 0 ? (
            <>
              <p id="dashboard-deadlines" className="mt-1 text-sm text-muted">
                Deadlines in the next two weeks:
              </p>
              <ul aria-labelledby="dashboard-deadlines" className="mt-3 space-y-2">
                {deadlines.map(({ entry, deadline, daysLeft }) => (
                  <li key={entry.id}>
                    <Link
                      href={`/applications/${entry.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-surface p-4 hover:border-accent"
                    >
                      <span className="font-medium break-words">{entry.name}</span>
                      <span className="text-sm text-muted">
                        {deadlineName(entry.deadlineType)}: <time dateTime={deadline}>{formatDate(deadline)}</time> · {dueText(daysLeft)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">
              {list.length
                ? `${list.length} on your list${launching ? ". No deadlines in the next two weeks." : "."}`
                : "Look up colleges and programs by major, place and price, and see what students really pay after grants."}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/colleges" variant="secondary">Explore colleges</ButtonLink>
            {(list.length > 0 || launching) && <ButtonLink href="/applications" variant="secondary">My list</ButtonLink>}
            {launching && <ButtonLink href="/aid" variant="secondary">Paying for college</ButtonLink>}
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-medium">Your class plan</h2>
          {courses.length ? (
            <p className="mt-1 text-sm text-muted">
              {courses.length} {courses.length === 1 ? "class" : "classes"} in your plan
              {gpa.unweighted !== null && <> · estimated GPA {gpa.unweighted.toFixed(2)}</>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Add your classes to see how they line up with your goals.</p>
          )}
          <div className="mt-3">
            <ButtonLink href="/plan" variant="secondary">{courses.length ? "Open my plan" : "Start my plan"}</ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="font-medium">Ask your counselor</h2>
          <p className="mt-1 text-sm text-muted">Questions about careers, classes, college, or training? Your AI counselor knows your goals.</p>
          <div className="mt-3">
            <ButtonLink href="/counselor" variant="secondary">Start a chat</ButtonLink>
          </div>
        </Card>
      </div>

      <StudentSettings grade={user.grade} reminders={reminders} />

      <form action={logoutAction}>
        <button type="submit" className="min-h-11 text-sm text-muted underline">Sign out</button>
      </form>
    </div>
  );
}
