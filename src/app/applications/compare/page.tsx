import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { GIFT_AID_NOTE, WORK_STUDY_NOTE } from "@/lib/applications/aid";
import { aidOfferLines, scorecardPrice } from "@/lib/applications/display";
import { type AidOfferRow, listAidOffers, lowestNetPriceIds } from "@/lib/applications/service";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { AidOfferLinesList, AidWarnings, LOWEST_BADGE } from "../aid-offer-card";

export const metadata: Metadata = { title: "Compare aid offers" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/** Scorecard context only for colleges from the Scorecard (custom entries have none). */
const scorecardFor = (row: AidOfferRow) => (row.unitId === null ? undefined : scorecardPrice(row.scorecard));

function PhoneCards({ rows, lowest }: { rows: AidOfferRow[]; lowest: Set<string> }) {
  return (
    <ul className="space-y-4 sm:hidden">
      {rows.map((row) => (
        <li key={row.id}>
          <article aria-labelledby={`offer-${row.id}`} className="rounded-xl border border-border bg-surface p-4">
            <h2 id={`offer-${row.id}`} className="font-semibold break-words">
              {row.name}
            </h2>
            {lowest.has(row.id) && <p className={`mt-1 inline-block ${LOWEST_BADGE}`}>Lowest net price</p>}
            <div className="mt-2">
              <AidOfferLinesList comparison={row.comparison} scorecard={scorecardFor(row)} />
            </div>
            <div className="mt-3">
              <AidWarnings warnings={row.comparison.warnings} />
            </div>
            <Link href={`/applications/${row.id}`} className={`${linkClass} text-sm`}>
              Change this offer<span className="sr-only"> from {row.name}</span>
            </Link>
          </article>
        </li>
      ))}
    </ul>
  );
}

function CompareTable({ rows, lowest }: { rows: AidOfferRow[]; lowest: Set<string> }) {
  const lines = rows.map((r) => aidOfferLines(r.comparison));
  const labels = lines[0];
  const hasScorecard = rows.some((r) => r.unitId !== null);
  const hasWarnings = rows.some((r) => r.comparison.warnings.length > 0);
  return (
    // Scrolls sideways when there are many offers; focusable so keyboard users can scroll it.
    <div role="region" aria-labelledby="compare-caption" tabIndex={0} className="hidden overflow-x-auto rounded-xl border border-border bg-surface focus-visible:outline-2 focus-visible:outline-accent sm:block">
      <table className="w-full text-left text-sm">
        <caption id="compare-caption" className="p-4 text-left font-medium">
          Your aid offers side by side, for one year
        </caption>
        <thead>
          <tr className="border-b border-border align-bottom">
            <td className="min-w-44 p-3" />
            {rows.map((row) => (
              <th key={row.id} scope="col" className="min-w-40 p-3 font-semibold">
                <span className="break-words">{row.name}</span>
                {lowest.has(row.id) && <span className={`mt-1 block w-fit ${LOWEST_BADGE}`}>Lowest net price</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {labels.map((label, i) => (
            <tr key={label.key} className={label.strong ? "bg-accent-soft font-semibold" : ""}>
              <th scope="row" className="p-3 font-medium">
                {label.label}
              </th>
              {lines.map((offer, j) => (
                <td key={rows[j].id} className="p-3 align-top">
                  {offer[i].value}
                  {offer[i].note && <span className="block text-xs font-normal text-muted">{offer[i].note}</span>}
                </td>
              ))}
            </tr>
          ))}
          {hasScorecard && (
            <tr className="text-muted">
              <th scope="row" className="p-3 font-medium">
                College Scorecard average net price
              </th>
              {rows.map((row) => {
                const price = scorecardFor(row);
                return (
                  <td key={row.id} className="p-3 align-top">
                    {price ? (
                      <>
                        {price.amount}
                        {price.note && <span className="block text-xs">{price.note}</span>}
                      </>
                    ) : (
                      <span className="text-xs">Not in the College Scorecard</span>
                    )}
                  </td>
                );
              })}
            </tr>
          )}
          {hasWarnings && (
            <tr>
              <th scope="row" className="p-3 font-medium">
                Loans to know about
              </th>
              {rows.map((row) => (
                <td key={row.id} className="p-3 align-top">
                  {row.comparison.warnings.length ? <AidWarnings warnings={row.comparison.warnings} /> : <span className="text-muted">None</span>}
                </td>
              ))}
            </tr>
          )}
          <tr>
            <td className="p-3" />
            {rows.map((row) => (
              <td key={row.id} className="p-3">
                <Link href={`/applications/${row.id}`} className={linkClass}>
                  Change<span className="sr-only"> the offer from {row.name}</span>
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function CompareAidPage() {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const rows = await listAidOffers(await getDb(), student.id);
  const lowest = lowestNetPriceIds(rows);

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/applications" className={linkClass}>
          Back to my list
        </Link>
      </p>
      <PageHeading title="Compare aid offers" lead="See your aid offers side by side. All amounts are for one year." />

      <section aria-labelledby="how-heading" className="rounded-xl bg-accent-soft p-5 text-sm">
        <h2 id="how-heading" className="text-base font-semibold">
          How to read this
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>{GIFT_AID_NOTE}</strong>
          </li>
          <li>The net price is the total cost minus grants and scholarships. It&apos;s the fairest way to compare offers.</li>
          <li>{WORK_STUDY_NOTE}</li>
          <li>
            &ldquo;Left to pay&rdquo; is what&apos;s still owed after loans and work-study. Families often cover it with savings, income or
            a payment plan.
          </li>
          <li>
            The College Scorecard average is what first-year students who got federal aid paid on average, after grants and
            scholarships. Your own price can be higher or lower.
          </li>
        </ul>
        <p className="mt-2">
          <Link href="/aid/en/comparing-aid-offers" className={linkClass}>
            Read our guide to comparing aid offers
          </Link>
        </p>
      </section>

      {rows.length === 0 ? (
        <Card>
          <p>You haven&apos;t saved an aid offer yet.</p>
          <p className="mt-1 text-sm text-muted">
            When a college sends you an aid offer, open that college on your list, choose &ldquo;Update&rdquo;, and copy the amounts into
            the aid offer section. Then come back here to compare.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/applications" className={linkClass}>
              Go to my list
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <PhoneCards rows={rows} lowest={lowest} />
          <CompareTable rows={rows} lowest={lowest} />
        </>
      )}
    </div>
  );
}
