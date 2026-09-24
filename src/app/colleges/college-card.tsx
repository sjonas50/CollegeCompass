import Link from "next/link";
import { FOR_PROFIT_NOTE, TRANSFER_NOTE, locationText, sizeText } from "@/lib/colleges/describe";
import { AID_EXCEEDS_COST, NOT_REPORTED, formatDollars, formatNetPrice, formatPercent } from "@/lib/colleges/format";
import { CONTROL_LABELS, DEGREE_LABELS } from "@/lib/colleges/labels";
import type { CollegeSummary } from "@/lib/colleges/search";
import { BandPriceLine } from "./income-band";
import { MissionBadges } from "./shared";

/** A search result. Net price comes first; the sticker price follows in smaller type. */
export function CollegeCard({ college, major }: { college: CollegeSummary; major?: string }) {
  const netPrice = formatNetPrice(college.avgNetPrice);
  const sticker = formatDollars(college.costOfAttendance);
  const completion = formatPercent(college.completionRate);
  const earnings = formatDollars(college.medianEarnings10yr);
  const facts = [
    locationText(college.city, college.state),
    college.control ? CONTROL_LABELS[college.control] : null,
    sizeText(college.enrollment),
    college.predominantDegree ? DEGREE_LABELS[college.predominantDegree]?.typical : null,
  ].filter((f): f is string => Boolean(f));
  const headingId = `college-${college.unitId}`;
  // Public colleges report net price and cost of attendance for in-state students.
  const inState = college.control === 1;

  return (
    <li>
      {/* The heading link stretches over the whole card, so the card is one big tap target. */}
      <article aria-labelledby={headingId} className="relative rounded-xl border border-border bg-surface p-5 hover:border-accent">
        <h3 id={headingId} className="text-lg font-medium">
          <Link
            href={`/colleges/${college.unitId}${major ? `?major=${major}` : ""}`}
            className="underline-offset-2 after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
          >
            {college.name}
          </Link>
        </h3>
        {facts.length > 0 && <p className="mt-1 text-sm text-muted">{facts.join(" · ")}</p>}
        <div className="mt-2">
          <MissionBadges missions={college.missions} onlineOnly={college.onlineOnly} />
        </div>

        <div className="mt-3 rounded-lg bg-background p-3">
          <dl>
            <div>
              <dt className="text-sm text-muted">Average net price after grants{inState ? ", in-state" : ""}</dt>
              <dd>
                {netPrice ? (
                  <>
                    <span className="text-2xl font-semibold tabular-nums">{netPrice.text}</span>{" "}
                    <span className="text-sm text-muted">a year</span>
                    {netPrice.aidExceedsCost && <span className="block text-sm">{AID_EXCEEDS_COST}</span>}
                  </>
                ) : (
                  <span className="text-sm">Not reported for this college. Its own net price calculator can give an estimate.</span>
                )}
                <BandPriceLine byIncome={college.netPriceByIncome} inState={inState} className="mt-1" />
              </dd>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-1 text-sm text-muted">
              <dt>Sticker price before aid{inState ? ", in-state" : ""}:</dt>
              <dd className="tabular-nums">{sticker ? `${sticker} a year` : NOT_REPORTED.toLowerCase()}</dd>
            </div>
          </dl>
          {inState && <p className="mt-1 text-sm text-muted">Students from other states usually pay more at public colleges.</p>}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Graduation rate</dt>
            <dd className="font-medium tabular-nums">
              {completion ?? NOT_REPORTED}
              {/* Community college students often transfer on purpose, which this rate counts against them. */}
              {completion && college.predominantDegree === 2 && (
                <span className="block text-xs font-normal text-muted">{TRANSFER_NOTE}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Earnings 10 years after starting</dt>
            <dd className="font-medium tabular-nums">{earnings ? `${earnings} a year` : NOT_REPORTED}</dd>
          </div>
        </dl>

        {college.control === 3 && <p className="mt-3 border-t border-border pt-3 text-sm">{FOR_PROFIT_NOTE}</p>}
      </article>
    </li>
  );
}
