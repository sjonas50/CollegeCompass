import "server-only";
import { WeeklyStepsList } from "@/app/roadmap/weekly-steps-list";
import { Card } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { monthName } from "@/lib/roadmap";
import { STEP_TEXT_MAX, weeklyStepsView } from "@/lib/steps";

function weekLabel(weekStart: string) {
  const [, month, day] = weekStart.split("-").map(Number);
  return `Week of ${monthName(month)} ${day}`;
}

/**
 * The signed-in student's steps for this week: check off, remove, or add their own (up to 3),
 * plus lifetime progress. Loads its own data, so a page just renders `<WeeklyStepsCard />`.
 * Must be rendered for a student (it calls requireUser(["student"])).
 *
 * `linkToRoadmap` (default true) points the empty state at /roadmap; the roadmap page itself
 * turns it off.
 */
export async function WeeklyStepsCard({ linkToRoadmap = true }: { linkToRoadmap?: boolean }) {
  const student = await requireUser(["student"]);
  const { weekStart, steps, stats, max } = await weeklyStepsView(await getDb(), student.id);
  const headingId = "weekly-steps-heading";
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} tabIndex={-1} className="text-lg font-medium focus:outline-none">
          This week&apos;s steps
        </h2>
        <p className="text-sm text-muted">{weekLabel(weekStart)}</p>
      </div>
      <WeeklyStepsList
        steps={steps.map((s) => ({ id: s.id, text: s.text, status: s.status, milestoneId: s.milestoneId }))}
        stats={stats}
        max={max}
        maxLength={STEP_TEXT_MAX}
        linkToRoadmap={linkToRoadmap}
        headingId={headingId}
      />
    </Card>
  );
}
