import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { compareAidOffer, formatDollars, hasAidOffer } from "@/lib/applications/aid";
import { daysBetween, formatDate } from "@/lib/applications/dates";
import { type ListMode, deadlineName, dueText, scorecardPrice } from "@/lib/applications/display";
import { KIND_BADGES, STATUS_LABELS } from "@/lib/applications/labels";
import type { ListEntryWithScorecard } from "@/lib/applications/service";
import { checklistProgress, isSubmitted } from "@/lib/applications/timeline";

const badge = "rounded-full px-2 py-0.5 text-xs font-medium";

/** One college or program on the main list page. */
export function EntryCard({ entry, mode, today }: { entry: ListEntryWithScorecard; mode: ListMode; today: string }) {
  const progress = checklistProgress(entry.checklist);
  const price = entry.scorecard ? scorecardPrice(entry.scorecard) : null;
  const place = [entry.scorecard?.city, entry.scorecard?.state].filter(Boolean).join(", ");
  const offer = mode.applying && hasAidOffer(entry.aidOffer) ? compareAidOffer(entry.aidOffer) : null;
  const daysLeft = entry.deadline ? daysBetween(today, entry.deadline) : null;
  const showStatus = mode.applying || entry.status !== "considering";

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div>
            <h3 className="font-medium break-words">{entry.name}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className={`${badge} border border-border`}>{KIND_BADGES[entry.kind]}</span>
              {showStatus && <span className={`${badge} bg-accent-soft text-foreground`}>{STATUS_LABELS[entry.status]}</span>}
              {place && <span>{place}</span>}
            </p>
          </div>

          <p className="text-sm">
            {entry.deadline && daysLeft !== null ? (
              <>
                {deadlineName(entry.deadlineType)}: <time dateTime={entry.deadline}>{formatDate(entry.deadline)}</time>
                {!isSubmitted(entry) && <span className="text-muted"> · {dueText(daysLeft)}</span>}
              </>
            ) : (
              <span className="text-muted">No deadline saved yet</span>
            )}
          </p>

          {mode.applying && (
            <div className="text-sm">
              <p>
                Checklist: {progress.done} of {progress.total} done
              </p>
              <div aria-hidden className="mt-1 h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {offer && (
            <p className="text-sm">
              {offer.netPrice === null
                ? "Aid offer saved. Add the total cost to see your net price."
                : `Your net price from the aid offer: ${formatDollars(offer.netPrice)} a year`}
            </p>
          )}

          {price && !offer && (
            <p className="text-sm text-muted">
              {price.amount ? `Average net price: ${price.amount} a year (College Scorecard)` : price.note}
              {price.amount && price.note ? ` ${price.note}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <ButtonLink href={`/applications/${entry.id}`} variant="secondary" className="w-full sm:w-auto">
            {mode.applying ? "Update" : "Notes and details"}
            <span className="sr-only"> for {entry.name}</span>
          </ButtonLink>
          {entry.unitId !== null && entry.scorecard?.found && (
            <Link href={`/colleges/${entry.unitId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
              About this college<span className="sr-only">: {entry.name}</span>
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
