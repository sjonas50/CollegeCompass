import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { hasAidOffer } from "@/lib/applications/aid";
import { usToday } from "@/lib/applications/dates";
import { listMode, plural } from "@/lib/applications/display";
import { keyDatesForStudent } from "@/lib/applications/key-dates";
import { MAX_LIST_ENTRIES, listEntriesWithScorecard } from "@/lib/applications/service";
import { buildTimeline } from "@/lib/applications/timeline";
import { requireUser } from "@/lib/auth/dal";
import { AddCustomForm } from "./add-custom-form";
import { DeadlineTimeline } from "./deadline-timeline";
import { EntryCard } from "./entry-card";
import { KeyDatesCard } from "./key-dates-card";
import { RemovedNotice } from "./removed-notice";

export const metadata: Metadata = { title: "My college list" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const student = await requireUser(["student"]);
  const { removed } = await searchParams;
  const now = new Date();
  const today = usToday(now);
  const mode = listMode(student.grade);
  const entries = await listEntriesWithScorecard(await getDb(), student.id);
  const timeline = buildTimeline(entries, today);
  const hasDeadlines = timeline.pastDue.length + timeline.soon.length + timeline.later.length > 0;
  const offers = entries.filter((e) => hasAidOffer(e.aidOffer)).length;
  const full = entries.length >= MAX_LIST_ENTRIES;
  const keyDates = mode.showKeyDates ? keyDatesForStudent(student.grade, now) : null;

  return (
    <div className="space-y-8">
      {mode.applying ? (
        <PageHeading
          title="My college list"
          lead="Keep your colleges and programs, deadlines, checklists and aid offers in one place. A four-year college, a community college and a training program are all great paths."
        />
      ) : (
        <PageHeading
          title="Colleges and programs I'm curious about"
          lead="Save colleges, training programs and apprenticeships you'd like to learn more about. This is a place to collect ideas, not to decide anything. Your list can change as often as you like."
        />
      )}
      {removed && <RemovedNotice />}

      {(mode.applying || hasDeadlines) && <DeadlineTimeline timeline={timeline} />}

      <section aria-labelledby="list-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="list-heading" className="text-xl font-semibold">
            {mode.applying ? "Your list" : "Your ideas"}
          </h2>
          <p className="text-sm text-muted">
            {entries.length} of {MAX_LIST_ENTRIES} spots used
          </p>
        </div>
        {entries.length === 0 ? (
          <Card>
            <p>Nothing here yet.</p>
            <p className="mt-1 text-sm text-muted">
              {mode.applying
                ? "Search for colleges to add them, or add a training program or apprenticeship below."
                : "Search for colleges that sound interesting, or add a program or apprenticeship below. There are no wrong answers."}
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} mode={mode} today={today} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-heading" className="space-y-4">
        <h2 id="add-heading" className="text-xl font-semibold">
          Add to your list
        </h2>
        {full ? (
          <Card>
            <p>
              Your list has {MAX_LIST_ENTRIES} colleges and programs, which is the most it can hold. Remove one you&apos;re less sure
              about to make room.
            </p>
          </Card>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <ButtonLink href="/colleges" className="w-full sm:w-auto">
                Find colleges
              </ButtonLink>
              <p className="text-sm text-muted">Look up colleges, then choose &ldquo;Add to my list&rdquo;.</p>
            </div>
            <AddCustomForm />
          </>
        )}
      </section>

      {keyDates && <KeyDatesCard year={keyDates.year} senior={keyDates.senior} />}

      {mode.applying && (
        <Card>
          <h2 className="text-xl font-semibold">Compare aid offers</h2>
          {offers > 0 ? (
            <>
              <p className="mt-1 text-sm">You&apos;ve saved {plural(offers, "aid offer")}. See them side by side, with the net price for each.</p>
              <ButtonLink href="/applications/compare" variant="secondary" className="mt-3 w-full sm:w-auto">
                Compare aid offers
              </ButtonLink>
            </>
          ) : (
            <p className="mt-1 text-sm">
              When you get an aid offer, choose &ldquo;Update&rdquo; on that college and fill in the aid offer. Then you can see your
              offers side by side.
            </p>
          )}
          <p className="mt-2 text-sm">
            <Link href="/aid/en/comparing-aid-offers" className={linkClass}>
              How to compare aid offers
            </Link>
          </p>
        </Card>
      )}

      <p className="text-sm">
        <Link href="/dashboard" className={linkClass}>
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
