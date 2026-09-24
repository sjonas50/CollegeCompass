import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { compareAidOffer, hasAidOffer } from "@/lib/applications/aid";
import { deadlineWindow, usToday } from "@/lib/applications/dates";
import { listMode, scorecardPrice } from "@/lib/applications/display";
import { KIND_LABELS } from "@/lib/applications/labels";
import { getEntryWithScorecard } from "@/lib/applications/service";
import { requireUser } from "@/lib/auth/dal";
import { AidOfferLinesList, AidWarnings } from "../aid-offer-card";
import { EntryForm } from "./entry-form";
import { RemoveEntry } from "./remove-entry";

export const metadata: Metadata = { title: "Update my list" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

export default async function EntryPage({ params }: PageProps<"/applications/[id]">) {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const { id } = await params;
  // Only the signed-in student's own entries; anyone else's id is simply "not found".
  const entry = await getEntryWithScorecard(await getDb(), student.id, id);
  if (!entry) notFound();

  const mode = listMode(student.grade);
  const window = deadlineWindow(usToday());
  // A deadline saved long ago stays valid, so the date box must accept it too.
  const deadlineMin = entry.deadline && entry.deadline < window.min ? entry.deadline : window.min;
  const deadlineMax = entry.deadline && entry.deadline > window.max ? entry.deadline : window.max;
  const offer = mode.applying && hasAidOffer(entry.aidOffer) ? compareAidOffer(entry.aidOffer) : null;

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/applications" className={linkClass}>
          Back to my list
        </Link>
      </p>
      <PageHeading title={entry.name} lead={KIND_LABELS[entry.kind]} />
      {/* A college can drop out of the College Scorecard data after it was saved; its page is gone then. */}
      {entry.unitId !== null && entry.scorecard?.found && (
        <p className="-mt-4 text-sm">
          <Link href={`/colleges/${entry.unitId}`} className={linkClass}>
            About this college
          </Link>
        </p>
      )}
      {entry.scorecard && !entry.scorecard.found && <p className="-mt-4 text-sm text-muted">{scorecardPrice(entry.scorecard).note}</p>}

      {offer && (
        <section aria-labelledby="offer-heading" className="rounded-xl border border-border bg-surface p-5">
          <h2 id="offer-heading" className="font-semibold">
            Your saved aid offer
          </h2>
          <div className="mt-2">
            <AidOfferLinesList comparison={offer} />
          </div>
          <div className="mt-3">
            <AidWarnings warnings={offer.warnings} />
          </div>
        </section>
      )}

      <Card>
        <EntryForm
          entry={{
            id: entry.id,
            name: entry.name,
            status: entry.status,
            deadlineType: entry.deadlineType,
            deadline: entry.deadline,
            notes: entry.notes,
            checklist: entry.checklist,
            aidOffer: entry.aidOffer,
          }}
          applying={mode.applying}
          deadlineMin={deadlineMin}
          deadlineMax={deadlineMax}
        />
      </Card>

      <RemoveEntry entryId={entry.id} name={entry.name} />
    </div>
  );
}
