import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { AddToListButton } from "@/components/add-to-list";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { FOR_PROFIT_NOTE, MEANINGS, admissionContext, sizeText } from "@/lib/colleges/describe";
import { type CollegeDetail, getCollege, parseUnitId } from "@/lib/colleges/detail";
import { AID_EXCEEDS_COST, NOT_REPORTED, formatDollars, formatNetPrice, formatPercent } from "@/lib/colleges/format";
import { CONTROL_LABELS, CREDENTIAL_LABELS, DEGREE_LABELS, MISSION_LABELS } from "@/lib/colleges/labels";
import { CIP4_PATTERN } from "@/lib/colleges/search";
import { stateName } from "@/lib/colleges/states";
import { IncomeBandPicker, NetPriceHeadline, NetPriceTable } from "../income-band";
import { ExternalLink, MissionBadges, ScorecardAttribution } from "../shared";
import { ProgramGroups, YourMajor } from "./programs";

// Shared by generateMetadata and the page so the college is read once per request.
const loadCollege = cache(async (param: string): Promise<CollegeDetail | null> => {
  const unitId = parseUnitId(param);
  if (unitId === null) return null;
  return getCollege(await getDb(), unitId);
});

export async function generateMetadata({ params }: PageProps<"/colleges/[unitId]">): Promise<Metadata> {
  const college = await loadCollege((await params).unitId);
  if (!college) return { title: "College not found" };
  return {
    title: college.name,
    description: `Net price by family income, graduation rate, earnings and programs at ${college.name}.`,
  };
}

function Stat({ term, value, children }: { term: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <dt className="text-sm text-muted">{term}</dt>
      <dd>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {children && <span className="mt-1 block text-sm text-muted">{children}</span>}
      </dd>
    </div>
  );
}

function perYear(amount: string | null) {
  return amount ? `${amount} a year` : NOT_REPORTED;
}

export default async function CollegePage({ params, searchParams }: PageProps<"/colleges/[unitId]">) {
  const college = await loadCollege((await params).unitId);
  if (!college) notFound();
  const { major } = await searchParams;
  const majorCip = typeof major === "string" && CIP4_PATTERN.test(major) ? major : null;

  const place = [college.city, stateName(college.state) ?? college.state].filter(Boolean).join(", ");
  const facts = [
    place || null,
    college.control ? CONTROL_LABELS[college.control] : null,
    college.predominantDegree ? DEGREE_LABELS[college.predominantDegree]?.typical : null,
  ].filter((f): f is string => Boolean(f));

  const netPrice = formatNetPrice(college.avgNetPrice);
  const programCounts = college.programs.map(
    (g) => `${g.programs.length} ${(g.programs.length === 1 ? CREDENTIAL_LABELS[g.credentialLevel].one : g.label).toLowerCase()}`,
  );
  const degreeDetail = [
    college.highestDegree && `Highest degree offered: ${DEGREE_LABELS[college.highestDegree].many.toLowerCase()}.`,
    programCounts.length > 0 && `Undergraduate programs: ${programCounts.join(", ")}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <PageHeading title={college.name} lead={facts.join(" · ") || undefined} />
        <MissionBadges missions={college.missions} onlineOnly={college.onlineOnly} />
        <AddToListButton unitId={college.unitId} name={college.name} />
      </div>

      {college.control === 3 && <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">{FOR_PROFIT_NOTE}</p>}

      <section aria-labelledby="cost-heading" className="space-y-4">
        <h2 id="cost-heading" className="text-xl font-semibold">
          What it costs
        </h2>

        <Card className="space-y-4">
          <h3 className="font-medium">Net price: what students paid after grants</h3>
          <NetPriceHeadline byIncome={college.netPriceByIncome} />
          <dl>
            <Stat term="Average net price, all income ranges" value={netPrice ? perYear(netPrice.text) : NOT_REPORTED}>
              {netPrice?.aidExceedsCost
                ? AID_EXCEEDS_COST
                : netPrice
                  ? null
                  : "This college didn't report an average net price. Its net price calculator can give you an estimate."}
            </Stat>
          </dl>
          <IncomeBandPicker compact />
          <NetPriceTable byIncome={college.netPriceByIncome} />
          <p className="text-sm">{MEANINGS.netPrice}</p>
          {college.netPriceCalculatorUrl ? (
            <ExternalLink href={college.netPriceCalculatorUrl} variant="primary">
              Get your own estimate
            </ExternalLink>
          ) : (
            <p className="text-sm text-muted">
              We don&apos;t have a link to this college&apos;s net price calculator. Search its website for &ldquo;net price
              calculator&rdquo;. Every college that offers federal aid has one.
            </p>
          )}
        </Card>

        <Card className="space-y-3">
          <h3 className="font-medium">Sticker price: the full price before aid</h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat term="Cost of attendance" value={perYear(formatDollars(college.costOfAttendance))} />
            <Stat term="Tuition and fees, in-state" value={perYear(formatDollars(college.tuitionInState))} />
            <Stat term="Tuition and fees, out-of-state" value={perYear(formatDollars(college.tuitionOutOfState))} />
          </dl>
          <p className="text-sm text-muted">
            {MEANINGS.stickerPrice}
            {college.control === 1 && " Public colleges usually charge less tuition to students who live in their state."}
          </p>
        </Card>
      </section>

      <section aria-labelledby="outcomes-heading" className="space-y-4">
        <h2 id="outcomes-heading" className="text-xl font-semibold">
          Graduation, earnings and debt
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Stat term="Graduation rate" value={formatPercent(college.completionRate) ?? NOT_REPORTED}>
            {MEANINGS.completion}
          </Stat>
          <Stat term="Earnings 10 years after starting" value={perYear(formatDollars(college.medianEarnings10yr))}>
            {MEANINGS.earnings}
          </Stat>
          <Stat term="Typical federal loan debt" value={formatDollars(college.medianDebt) ?? NOT_REPORTED}>
            {MEANINGS.debt}
          </Stat>
          <Stat term="Students with a Pell Grant" value={formatPercent(college.pellShare) ?? NOT_REPORTED}>
            {MEANINGS.pell}
          </Stat>
        </dl>
      </section>

      <section aria-labelledby="about-heading" className="space-y-4">
        <h2 id="about-heading" className="text-xl font-semibold">
          About this college
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Stat term="Size" value={sizeText(college.enrollment) ?? NOT_REPORTED} />
          <Stat term="Admission rate" value={formatPercent(college.admissionRate) ?? NOT_REPORTED}>
            {admissionContext(college.admissionRate)}
          </Stat>
          <Stat
            term="Degrees"
            value={college.predominantDegree ? DEGREE_LABELS[college.predominantDegree].typical : NOT_REPORTED}
          >
            {degreeDetail || null}
          </Stat>
          {college.missions.length > 0 && (
            <Stat term="Special mission" value={college.missions.map((m) => MISSION_LABELS[m].label).join(", ")} />
          )}
          {college.onlineOnly && <Stat term="How classes are taught" value="Online only" />}
        </dl>
      </section>

      <section aria-labelledby="programs-heading" className="space-y-4">
        <h2 id="programs-heading" className="text-xl font-semibold">
          Programs and majors
        </h2>
        {majorCip && <YourMajor groups={college.programs} cip4={majorCip} />}
        <ProgramGroups groups={college.programs} />
      </section>

      <section aria-labelledby="more-heading" className="space-y-2">
        <h2 id="more-heading" className="text-xl font-semibold">
          Learn more
        </h2>
        <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {college.netPriceCalculatorUrl && (
            <li>
              <ExternalLink href={college.netPriceCalculatorUrl} variant="secondary">
                Net price calculator
              </ExternalLink>
            </li>
          )}
          {college.url && (
            <li>
              <ExternalLink href={college.url} variant="secondary">
                College website
              </ExternalLink>
            </li>
          )}
          <li>
            <ExternalLink href={college.scorecardUrl} variant="secondary">
              See it on College Scorecard
            </ExternalLink>
          </li>
        </ul>
        <p className="text-sm">
          <Link href="/colleges" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Search more colleges
          </Link>
        </p>
      </section>

      <ScorecardAttribution />
    </div>
  );
}
